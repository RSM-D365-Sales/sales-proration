// Portal API logic, host-agnostic.
//
// Both front doors — the local Express server (server/index.js) and the Azure
// Functions app (api/index.js) — call these functions, so the behavior is
// identical whether the portal runs locally or hosted. Anything HTTP-specific
// (status codes, headers, auth) stays in the host; errors thrown here carry an
// optional `status` for the host to translate.

const d365 = require('./d365Client');
const { prorate } = require('./proration');

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

/** Commodity roll-up for the landing page. */
async function listCommodities() {
  const { commodities, items, demand, supply } = await d365.getSnapshot();
  return commodities.map(c => {
    const itemIds = items.filter(i => i.commodityId === c.id).map(i => i.itemId);
    const itemSet = new Set(itemIds);
    const totalDemand = demand.filter(d => itemSet.has(d.itemId)).reduce((s, d) => s + d.requestedQty, 0);
    const totalSupply = supply.filter(s => itemSet.has(s.itemId)).reduce((s, x) => s + x.availableQty, 0);
    const fillRate = totalDemand ? totalSupply / totalDemand : 1;
    return { ...c, itemCount: itemIds.length, totalDemand, totalSupply, fillRate, status: fillStatus(fillRate) };
  });
}

/** One commodity with per-item demand/supply detail. Throws 404 if unknown. */
async function getCommodityDetail(id) {
  const { commodities, items, customers, demand, supply, substitutions = [] } = await d365.getSnapshot();
  const c = commodities.find(x => x.id === id);
  if (!c) throw httpError(404, 'Commodity not found');

  const itemList = items.filter(i => i.commodityId === c.id);
  const itemDetail = itemList.map(it => {
    const itDemand = demand
      .filter(d => d.itemId === it.itemId)
      .map(d => {
        const cust = customers.find(x => x.customerId === d.customerId);
        return { ...d, customerName: cust?.name ?? d.customerId, priority: cust?.priority ?? 3 };
      });
    const itSupply = supply.filter(s => s.itemId === it.itemId);
    const totalDemand = itDemand.reduce((s, d) => s + d.requestedQty, 0);
    const totalSupply = itSupply.reduce((s, x) => s + x.availableQty, 0);
    return { ...it, demand: itDemand, supply: itSupply, totalDemand, totalSupply };
  });

  // Substitution rules touching this commodity's items (Option 1 whitelist —
  // empty until the D365 feed sends them; the UI shows candidates as
  // "unverified" in that case).
  const itemSet = new Set(itemList.map(i => i.itemId));
  const subRules = substitutions.filter(s => itemSet.has(s.fromItemId) || itemSet.has(s.toItemId));

  return { commodity: c, items: itemDetail, substitutions: subRules };
}

/**
 * Customers enriched with an open-demand rollup:
 *   openLines / requestedQty / itemCount — the customer's open order book
 *   needsProration — true when any of their demand sits on a SHORT item
 *                    (snapshot-wide demand for that item exceeds supply)
 */
async function listCustomers() {
  const { customers, demand, supply } = await d365.getSnapshot();

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
    };
  });
}

/**
 * Run a proration proposal (does NOT publish).
 * body: { strategy, itemId, siteId?, warehouseId?, alpha? }
 */
async function runProration({ strategy, itemId, siteId, warehouseId, alpha } = {}) {
  if (!strategy || !itemId) throw httpError(400, 'strategy and itemId required');

  const { customers, demand, supply, customerFillHistory } = await d365.getSnapshot();

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

  const results = prorate(strategy, lines, available, {
    customers,
    history: customerFillHistory,
    options: { alpha },
  });

  return {
    strategy,
    itemId,
    available,
    totalRequested: lines.reduce((s, l) => s + l.requestedQty, 0),
    totalAllocated: results.reduce((s, l) => s + l.allocatedQty, 0),
    lines: results,
  };
}

/** Publish an approved batch to D365 (one SysMessageService message). */
async function sendBatch(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw httpError(400, 'lines required');
  return d365.sendProrationBatch(lines);
}

/** Publish staged substitutions (own message type, same queue). */
async function sendSubstitutions(subs) {
  if (!Array.isArray(subs) || subs.length === 0) throw httpError(400, 'substitutions required');
  for (const s of subs) {
    if (!s.salesId || !s.fromItemId || !s.toItemId) throw httpError(400, 'salesId, fromItemId, toItemId required on every substitution');
    if (!(Number(s.qty) > 0)) throw httpError(400, `Invalid substitute qty on ${s.salesId}/${s.lineNum}`);
    if (Number(s.remainingOriginalQty) < 0) throw httpError(400, `Invalid remaining qty on ${s.salesId}/${s.lineNum}`);
  }
  return d365.sendSubstitutionBatch(subs);
}

module.exports = { listCommodities, getCommodityDetail, listCustomers, runProration, sendBatch, sendSubstitutions, fillStatus, httpError };
