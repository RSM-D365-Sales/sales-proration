// Portal read logic as pure functions over a normalized snapshot.
//
// server/portalService.js wraps these with the live D365 snapshot (Express and
// Azure Functions); static builds call them in the browser on the bundled
// demo snapshot (js/static-api.js). Same code, same answers, either host.
(function (root) {

const Proration = (typeof module === 'object' && module.exports)
  ? require('./proration.js') : root.Proration;
const Subs = (typeof module === 'object' && module.exports)
  ? require('./subs.js') : root.Subs;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fillStatus(fillRate) {
  if (fillRate < 0.9) return 'Short';
  if (fillRate < 1)   return 'AtRisk';
  return 'OK';
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const asOfOf = snap => snap.asOf || todayIso();

/** Commodity roll-up for the landing page. */
function listCommodities(snap) {
  const { commodities, items, demand, supply } = snap;
  return commodities.map(c => {
    const itemIds = items.filter(i => i.commodityId === c.id).map(i => i.itemId);
    const itemSet = new Set(itemIds);
    const totalDemand = demand.filter(d => itemSet.has(d.itemId)).reduce((s, d) => s + d.requestedQty, 0);
    const totalSupply = supply.filter(s => itemSet.has(s.itemId)).reduce((s, x) => s + x.availableQty, 0);
    const fillRate = totalDemand ? totalSupply / totalDemand : 1;
    // Items short on their own, even when the commodity total looks covered
    // (one pack size short, another long) — that gap is what substitution fixes.
    const shortItems = itemIds.filter(id => {
      const d = demand.filter(x => x.itemId === id).reduce((s, x) => s + x.requestedQty, 0);
      const s = supply.filter(x => x.itemId === id).reduce((t, x) => t + x.availableQty, 0);
      return d > s;
    }).length;
    return { ...c, itemCount: itemIds.length, totalDemand, totalSupply, fillRate, status: fillStatus(fillRate), shortItems };
  });
}

/** One commodity with per-item demand/supply detail. Throws 404 if unknown. */
function getCommodityDetail(snap, id) {
  const { commodities, items, customers, demand, supply, substitutions = [] } = snap;
  const c = commodities.find(x => x.id === id);
  if (!c) throw httpError(404, 'Commodity not found');

  const itemList = items.filter(i => i.commodityId === c.id);
  const custIds = new Set();
  const itemDetail = itemList.map(it => {
    const itDemand = demand
      .filter(d => d.itemId === it.itemId)
      .map(d => {
        const cust = customers.find(x => x.customerId === d.customerId);
        custIds.add(d.customerId);
        return {
          ...d,
          customerName: cust?.name ?? d.customerId,
          priority: cust?.priority ?? 3,
          substitutionPolicy: cust?.substitutionPolicy ?? 'Standard',
        };
      });
    const itSupply = supply.filter(s => s.itemId === it.itemId);
    const totalDemand = itDemand.reduce((s, d) => s + d.requestedQty, 0);
    const totalSupply = itSupply.reduce((s, x) => s + x.availableQty, 0);
    return { ...it, demand: itDemand, supply: itSupply, totalDemand, totalSupply };
  });

  // Substitution rules touching this commodity's items, plus the customers on
  // its open lines (their policy decides which of those rules apply).
  const itemSet = new Set(itemList.map(i => i.itemId));
  const subRules = substitutions.filter(s => itemSet.has(s.fromItemId) || itemSet.has(s.toItemId));
  const lineCustomers = customers.filter(x => custIds.has(x.customerId));

  return { commodity: c, items: itemDetail, substitutions: subRules, customers: lineCustomers, asOf: asOfOf(snap) };
}

/**
 * Customers enriched with an open-demand rollup:
 *   openLines / requestedQty / itemCount — the customer's open order book
 *   needsProration — true when any of their demand sits on a SHORT item
 *   customerRules  — substitution rules that name this customer
 */
function listCustomers(snap) {
  const { customers, demand, supply, substitutions = [] } = snap;

  const demandByItem = {};
  for (const d of demand) demandByItem[d.itemId] = (demandByItem[d.itemId] || 0) + d.requestedQty;
  const supplyByItem = {};
  for (const s of supply) supplyByItem[s.itemId] = (supplyByItem[s.itemId] || 0) + s.availableQty;
  const shortItems = new Set(
    Object.keys(demandByItem).filter(id => demandByItem[id] > (supplyByItem[id] || 0)));

  return customers.map(c => {
    const lines = demand.filter(d => d.customerId === c.customerId);
    return {
      ...c,
      openLines: lines.length,
      requestedQty: lines.reduce((s, l) => s + l.requestedQty, 0),
      itemCount: new Set(lines.map(l => l.itemId)).size,
      needsProration: lines.some(l => shortItems.has(l.itemId)),
      customerRules: substitutions.filter(r => r.customerId === c.customerId).length,
    };
  });
}

/**
 * Run a proration proposal (does NOT publish).
 * body: { strategy, itemId, siteId?, warehouseId?, alpha? }
 */
function runProration(snap, { strategy, itemId, siteId, warehouseId, alpha } = {}) {
  if (!strategy || !itemId) throw httpError(400, 'strategy and itemId required');

  const { customers, demand, supply, customerFillHistory } = snap;

  const lines = demand
    .filter(d => d.itemId === itemId
      && (!siteId || d.siteId === siteId)
      && (!warehouseId || d.warehouseId === warehouseId))
    .map(d => ({ ...d, key: `${d.salesId}:${d.lineNum}` }));

  const available = supply
    .filter(s => s.itemId === itemId
      && (!siteId || s.siteId === siteId)
      && (!warehouseId || s.warehouseId === warehouseId))
    .reduce((s, x) => s + x.availableQty, 0);

  const results = Proration.prorate(strategy, lines, available, {
    customers,
    history: customerFillHistory,
    options: { alpha },
  });

  return {
    strategy,
    itemId,
    available,
    // R-11: lets the UI disclose when HistoryAware silently degrades to
    // Weighted because the D365 feed carries no fill-rate history.
    historyAvailable: Object.keys(customerFillHistory || {}).length > 0,
    totalRequested: lines.reduce((s, l) => s + l.requestedQty, 0),
    totalAllocated: results.reduce((s, l) => s + l.allocatedQty, 0),
    lines: results,
  };
}

/** Everything the Substitutions page needs: customers + policies, items by
 *  buyer group (with prices when the feed has them), and every rule with its
 *  lifecycle status on the as-of date. */
function substitutionBook(snap) {
  const asOf = asOfOf(snap);
  const commodityName = Object.fromEntries(snap.commodities.map(c => [c.id, c.name]));
  const openItemsByCustomer = {};
  for (const d of snap.demand) {
    const list = openItemsByCustomer[d.customerId] || (openItemsByCustomer[d.customerId] = []);
    if (!list.includes(d.itemId)) list.push(d.itemId);
  }
  return {
    asOf,
    openItemsByCustomer,
    commodities: snap.commodities.map(c => ({ id: c.id, name: c.name })),
    items: snap.items.map(i => ({ ...i, commodityName: commodityName[i.commodityId] || i.commodityId })),
    customers: listCustomers(snap).map(c => ({
      customerId: c.customerId, name: c.name, priority: c.priority, segment: c.segment,
      city: c.city, state: c.state,
      substitutionPolicy: c.substitutionPolicy, substitutionNote: c.substitutionNote,
      openLines: c.openLines, needsProration: c.needsProration,
    })),
    rules: (snap.substitutions || []).map(r => ({ ...r, status: Subs.ruleStatus(r, asOf) })),
  };
}

/** Validate a rule/policy publish request; returns the cleaned payload. */
function cleanRulePublish(body, snap) {
  const rules = Array.isArray(body?.rules) ? body.rules : [];
  const policies = Array.isArray(body?.policies) ? body.policies : [];
  if (!rules.length && !policies.length) throw httpError(400, 'rules or policies required');
  for (const ch of rules) {
    if (!ch || !ch.rule || !['Upsert', 'Delete'].includes(ch.action)) throw httpError(400, 'each rule change needs action Upsert|Delete and a rule');
    if (ch.action === 'Upsert') {
      const errs = Subs.validateRule(ch.rule, snap.items);
      if (errs.length) throw httpError(400, `Rule ${ch.rule.ruleId || ''}: ${errs[0]}`);
    }
  }
  const custIds = new Set(snap.customers.map(c => c.customerId));
  for (const p of policies) {
    if (!custIds.has(p?.customerId)) throw httpError(400, `Unknown customer ${p?.customerId}`);
    if (!['Standard', 'CustomerOnly', 'Never'].includes(p.substitutionPolicy)) throw httpError(400, `Invalid policy for ${p.customerId}`);
  }
  return { rules, policies };
}

/** Shape checks shared by every host before substitutions are published. */
function checkSubstitutions(subs) {
  if (!Array.isArray(subs) || subs.length === 0) throw httpError(400, 'substitutions required');
  for (const s of subs) {
    if (!s.salesId || !s.fromItemId || !s.toItemId) throw httpError(400, 'salesId, fromItemId, toItemId required on every substitution');
    if (!(Number(s.qty) > 0)) throw httpError(400, `Invalid substitute qty on ${s.salesId}/${s.lineNum}`);
    if (Number(s.remainingOriginalQty) < 0) throw httpError(400, `Invalid remaining qty on ${s.salesId}/${s.lineNum}`);
  }
  return subs;
}

const api = {
  httpError, fillStatus, listCommodities, getCommodityDetail, listCustomers,
  runProration, substitutionBook, cleanRulePublish, checkSubstitutions,
};
if (typeof module === 'object' && module.exports) module.exports = api;
else root.PortalCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
