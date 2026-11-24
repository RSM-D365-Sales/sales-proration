// Customer-based item substitution — the rule engine.
//
// Pure functions over the normalized snapshot (see snapshot.js), shared by the
// planner and rules pages in the browser and by the Node tests. D365 holds the
// same logic in RSMItemSubstitution::findActive / RSMSubstitutionConsumer;
// this copy lets the planner propose only what D365 will accept.
//
// A rule (RSMItemSubstitution row) says: for customer X (blank = every
// customer), item FROM may be replaced by item TO, at QtyRatio TO-cases per
// FROM-case, ranked, optionally both ways, billed at the original or the
// substitute price, inside an optional validity window.
//
// The customer's policy (CustTable.RSMSubstitutionPolicy) decides which rules
// apply to them:
//   Standard      all-customer rules + their own; their own win ties
//   CustomerOnly  only rules that name them (e.g. a menu-spec foodservice account)
//   Never         nothing — the line stays short
(function (root) {

const EPS = 1e-9;

/** Rule lifecycle on a given date (YYYY-MM-DD). */
function ruleStatus(rule, asOf) {
  if (rule.validFrom && asOf < rule.validFrom) return 'Scheduled';
  if (rule.validTo && asOf > rule.validTo) return 'Expired';
  return 'Active';
}

/**
 * Ordered substitutes for one customer and one ordered item.
 * Returns [{ toItemId, ratio, rule, scope: 'Customer'|'All customers', reversed }]
 * — customer-specific rules first, then by rank. A bidirectional rule read
 * backwards uses the inverse ratio.
 */
function substitutesFor(rules, customer, fromItemId, asOf) {
  const policy = customer?.substitutionPolicy || 'Standard';
  if (policy === 'Never') return [];
  const custId = customer?.customerId || '';

  const out = new Map(); // toItemId -> best candidate
  for (const r of rules || []) {
    if (ruleStatus(r, asOf) !== 'Active') continue;
    const forCustomer = r.customerId && r.customerId === custId;
    const forAll = !r.customerId;
    if (!forCustomer && !(forAll && policy === 'Standard')) continue;

    let toItemId = null, ratio = r.qtyRatio || 1, reversed = false;
    if (r.fromItemId === fromItemId) toItemId = r.toItemId;
    else if (r.direction === 'Bidirectional' && r.toItemId === fromItemId) {
      toItemId = r.fromItemId; ratio = 1 / (r.qtyRatio || 1); reversed = true;
    }
    if (!toItemId || toItemId === fromItemId) continue;

    const cand = { toItemId, ratio, rule: r, scope: forCustomer ? 'Customer' : 'All customers', reversed };
    const prev = out.get(toItemId);
    if (!prev || better(cand, prev)) out.set(toItemId, cand);
  }
  return [...out.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
}

function better(a, b) {
  const sa = a.scope === 'Customer' ? 0 : 1, sb = b.scope === 'Customer' ? 0 : 1;
  if (sa !== sb) return sa < sb;
  if (a.rule.rank !== b.rule.rank) return a.rule.rank < b.rule.rank;
  return a.reversed === false && b.reversed === true;
}

/** The rule (if any) that lets this customer take `toItemId` for `fromItemId`. */
function resolveRule(rules, customer, fromItemId, toItemId, asOf) {
  return substitutesFor(rules, customer, fromItemId, asOf).find(c => c.toItemId === toItemId) || null;
}

/**
 * Revenue and margin of a substitution, at list.
 *   qty    substitute cases shipped
 *   ratio  substitute cases per original case (covers qty / ratio ordered cases)
 *   Original basis    customer pays the ordered item's price for the cases covered
 *   Substitute basis  customer pays the substitute's price per substitute case
 * Baseline = what the covered cases would have earned had the ordered item
 * shipped. Returns null when either item has no price/cost in the feed.
 */
function subEconomics({ fromItem, toItem, qty, ratio = 1, priceBasis = 'Original' }) {
  if (!fromItem || !toItem) return null;
  const known = [fromItem.listPrice, fromItem.unitCost, toItem.listPrice, toItem.unitCost]
    .every(v => typeof v === 'number' && Number.isFinite(v));
  if (!known) return null;
  const covered = qty / (ratio || 1);
  const revenue = priceBasis === 'Substitute' ? qty * toItem.listPrice : covered * fromItem.listPrice;
  const cost = qty * toItem.unitCost;
  const margin = revenue - cost;
  const baselineRevenue = covered * fromItem.listPrice;
  const baselineMargin = covered * (fromItem.listPrice - fromItem.unitCost);
  return {
    covered, revenue, cost, margin,
    marginPct: revenue ? margin / revenue : 0,
    baselineRevenue, baselineMargin,
    revenueDelta: revenue - baselineRevenue,
    marginDelta: margin - baselineMargin,
  };
}

/**
 * Fill short lines from each customer's approved substitutes.
 *
 *   shortLines  [{ salesId, lineNum, itemId, customerId, shortfall }]
 *   customers   normalized customers (priority, substitutionPolicy, note)
 *   rules       effective rules
 *   pools       { itemId: units still uncommitted } — copied, not mutated
 *
 * Customers are served in priority order (P1 first), larger shortfalls first
 * within a priority, so scarce substitute stock goes where proration already
 * said it matters most. Returns { staged, skipped, coveredQty, shortQty }.
 */
function autoSubstitute({ shortLines, customers, rules, pools, asOf }) {
  const byId = Object.fromEntries((customers || []).map(c => [c.customerId, c]));
  const left = { ...pools };
  const staged = [];
  const skipped = [];
  let coveredQty = 0, shortQty = 0;

  const queue = (shortLines || [])
    .filter(l => l.shortfall > EPS)
    .map(l => ({ ...l, cust: byId[l.customerId] || { customerId: l.customerId, priority: 3, substitutionPolicy: 'Standard' } }))
    .sort((a, b) => (a.cust.priority - b.cust.priority)
      || (b.shortfall - a.shortfall)
      || String(a.salesId).localeCompare(String(b.salesId))
      || a.lineNum - b.lineNum);

  for (const line of queue) {
    shortQty += line.shortfall;
    if (line.cust.substitutionPolicy === 'Never') {
      skipped.push({ line, reason: 'never', note: line.cust.substitutionNote || '' });
      continue;
    }
    const cands = substitutesFor(rules, line.cust, line.itemId, asOf);
    if (!cands.length) {
      skipped.push({ line, reason: 'no-rule' });
      continue;
    }
    let remaining = line.shortfall;
    for (const c of cands) {
      const pool = Math.floor((left[c.toItemId] || 0) + EPS);
      if (pool <= 0) continue;
      const take = Math.min(Math.ceil(remaining * c.ratio - EPS), pool);
      if (take <= 0) continue;
      const covered = Math.min(remaining, take / c.ratio);
      staged.push({
        salesId: line.salesId, lineNum: line.lineNum, customerId: line.customerId,
        fromItemId: line.itemId, toItemId: c.toItemId, qty: take, ratio: c.ratio,
        ruleId: c.rule.ruleId, scope: c.scope, priceBasis: c.rule.priceBasis || 'Original',
        covered,
      });
      left[c.toItemId] = (left[c.toItemId] || 0) - take;
      remaining -= covered;
      coveredQty += covered;
      if (remaining <= EPS) break;
    }
    if (remaining > EPS) skipped.push({ line, reason: 'stock', remaining });
  }
  return { staged, skipped, coveredQty, shortQty };
}

/** Apply draft rule changes ([{ action: 'Upsert'|'Delete', rule }]) to a rule list. */
function applyRuleChanges(rules, changes) {
  const out = (rules || []).map(r => ({ ...r }));
  for (const ch of changes || []) {
    const i = out.findIndex(r => r.ruleId === ch.rule.ruleId);
    if (ch.action === 'Delete') { if (i >= 0) out.splice(i, 1); continue; }
    if (i >= 0) out[i] = { ...out[i], ...ch.rule };
    else out.push({ ...ch.rule });
  }
  return out;
}

/** Apply draft policy changes ([{ customerId, substitutionPolicy, substitutionNote }]). */
function applyPolicyChanges(customers, policies) {
  const byId = Object.fromEntries((policies || []).map(p => [p.customerId, p]));
  return (customers || []).map(c => (byId[c.customerId]
    ? { ...c, substitutionPolicy: byId[c.customerId].substitutionPolicy, substitutionNote: byId[c.customerId].substitutionNote ?? c.substitutionNote }
    : c));
}

/** Basic shape checks for a rule edited in the UI (D365 re-validates on write). */
function validateRule(r, items) {
  const errs = [];
  const byId = Object.fromEntries((items || []).map(i => [i.itemId, i]));
  if (!byId[r.fromItemId]) errs.push('Pick the ordered item.');
  if (!byId[r.toItemId]) errs.push('Pick the substitute item.');
  if (r.fromItemId && r.fromItemId === r.toItemId) errs.push('An item cannot substitute for itself.');
  if (byId[r.fromItemId] && byId[r.toItemId] && byId[r.fromItemId].commodityId !== byId[r.toItemId].commodityId) {
    errs.push('Substitute must be in the same buyer group as the ordered item.');
  }
  if (!(Number(r.qtyRatio) > 0)) errs.push('Qty ratio must be greater than 0.');
  if (!(Number.isInteger(Number(r.rank)) && Number(r.rank) >= 1)) errs.push('Rank must be a whole number, 1 or higher.');
  if (r.validFrom && r.validTo && r.validTo < r.validFrom) errs.push('Valid to is before valid from.');
  return errs;
}

const api = {
  ruleStatus, substitutesFor, resolveRule, subEconomics, autoSubstitute,
  applyRuleChanges, applyPolicyChanges, validateRule,
};
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Subs = api;
})(typeof self !== 'undefined' ? self : globalThis);
