// Snapshot normalization — the raw GetOpenSalesOrders payload (D365 or a
// seeded demo file) into the shapes the rest of the app uses.
//
// Shared between the Node server (server/d365Client.js) and the browser
// (static builds normalize the bundled snapshot client-side), so a live feed
// and a demo file go through exactly the same code. Field access is tolerant:
// ItemId vs itemId, $id noise, and optional fields older feeds don't send.
(function (root) {

function get(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (name in obj) return obj[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}
function pick(obj, ...names) {
  for (const n of names) {
    const v = get(obj, n);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** Like num() but undefined/blank stays null (unknown, not zero). */
function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** "01" -> 1, "" -> fallback, 2 -> 2. */
function intOr(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
/** ISO datetime -> YYYY-MM-DD (leaves already-short dates alone). D365's
 *  "never" date (1900-01-01) means no bound. */
function toDate(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return s.startsWith('1900-01-01') ? '' : s;
}
function asArray(v) { return Array.isArray(v) ? v : []; }

// Customer substitution policy (CustTable.RSMSubstitutionPolicy):
//   Standard      — all-customer rules plus the customer's own rules apply
//   CustomerOnly  — only rules that name this customer apply
//   Never         — the customer never accepts a substitute
const POLICIES = ['Standard', 'CustomerOnly', 'Never'];
function policyOf(v) {
  const s = String(v ?? '').replace(/\s+/g, '');
  const hit = POLICIES.find(p => p.toLowerCase() === s.toLowerCase());
  return hit || 'Standard';
}

// RSMSubstitutionPriceBasis: bill the substitute at the price of the item the
// customer ordered, or at the substitute item's own price.
function priceBasisOf(v) {
  return /^sub/i.test(String(v ?? '')) ? 'Substitute' : 'Original';
}

function normalizeSubstitution(s, i) {
  const fromItemId = pick(s, 'fromItemId', 'FromItemId');
  const toItemId = pick(s, 'toItemId', 'ToItemId');
  const customerId = String(pick(s, 'custAccount', 'CustAccount', 'customerId') ?? '');
  return {
    ruleId:     String(pick(s, 'ruleId', 'RuleId', 'RecId') ?? `R-${String(i + 1).padStart(4, '0')}`),
    fromItemId,
    toItemId,
    direction:  /^bi/i.test(String(pick(s, 'direction', 'Direction') ?? '')) ? 'Bidirectional' : 'OneWay',
    rank:       num(pick(s, 'rank', 'Rank'), 1),
    qtyRatio:   num(pick(s, 'qtyRatio', 'QtyRatio'), 1) || 1,
    customerId,
    priceBasis: priceBasisOf(pick(s, 'priceBasis', 'PriceBasis')),
    validFrom:  toDate(pick(s, 'validFrom', 'ValidFrom')),
    validTo:    toDate(pick(s, 'validTo', 'ValidTo')),
    note:       String(pick(s, 'note', 'Note') ?? ''),
  };
}

function normalizeSnapshot(raw) {
  const commodities = asArray(get(raw, 'commodities')).map(c => {
    const id = pick(c, 'commodityId', 'CommodityId');
    const desc = pick(c, 'description', 'Description') ?? '';
    return { id, name: desc || id, description: String(pick(c, 'blurb', 'Blurb') ?? '') };
  });

  const items = asArray(get(raw, 'items')).map(i => ({
    itemId:      pick(i, 'itemId', 'ItemId'),
    commodityId: pick(i, 'commodityId', 'CommodityId') ?? '',
    name:        pick(i, 'name') ?? pick(i, 'itemId', 'ItemId'),
    uom:         pick(i, 'uom', 'unit') ?? '',
    // Optional commercial fields (price-aware feeds and demo snapshots).
    // null = unknown; the UI shows "—" rather than a fake zero margin.
    pack:        String(pick(i, 'pack', 'Pack') ?? ''),
    listPrice:   numOrNull(pick(i, 'listPrice', 'ListPrice', 'SalesPrice')),
    unitCost:    numOrNull(pick(i, 'unitCost', 'UnitCost', 'StandardCost')),
  }));

  const customers = asArray(get(raw, 'customers')).map(c => ({
    customerId: pick(c, 'customerId', 'CustAccount', 'AccountNum'),
    name:       pick(c, 'name') ?? pick(c, 'customerId'),
    priority:   intOr(pick(c, 'priority', 'Priority'), 3),
    // Ship-to location — optional in the feed (RSMProrationCustomerContract
    // exposes shipToCity/shipToState); blank when the contract omits them.
    city:       String(pick(c, 'shipToCity', 'city') ?? ''),
    state:      String(pick(c, 'shipToState', 'state') ?? ''),
    segment:    String(pick(c, 'segment', 'Segment', 'CustGroup') ?? ''),
    substitutionPolicy: policyOf(pick(c, 'substitutionPolicy', 'SubstitutionPolicy', 'RSMSubstitutionPolicy')),
    substitutionNote:   String(pick(c, 'substitutionNote', 'SubstitutionNote', 'RSMSubstitutionNote') ?? ''),
  }));

  const demand = asArray(get(raw, 'Demand') || get(raw, 'demand')).map(d => ({
    salesId:           pick(d, 'salesId', 'SalesId'),
    lineNum:           num(pick(d, 'lineNum', 'LineNum')),
    itemId:            pick(d, 'itemId', 'ItemId'),
    customerId:        pick(d, 'customerId', 'CustAccount'),
    siteId:            String(pick(d, 'siteId', 'SiteId', 'InventSiteId') ?? ''),
    warehouseId:       String(pick(d, 'warehouseId', 'WarehouseId', 'InventLocationId') ?? ''),
    requestedQty:      num(pick(d, 'requestedQty', 'RequestedQty', 'Qty')),
    requestedShipDate: toDate(pick(d, 'requestedShipDate', 'RequestedShipDate', 'ShippingDateRequested')),
  }));

  const supply = asArray(get(raw, 'Supply') || get(raw, 'supply')).map(s => ({
    itemId:       pick(s, 'itemId', 'ItemId'),
    siteId:       String(pick(s, 'siteId', 'SiteId', 'InventSiteId') ?? ''),
    warehouseId:  String(pick(s, 'warehouseId', 'WarehouseId', 'InventLocationId') ?? ''),
    availableQty: num(pick(s, 'availableQty', 'AvailableQty')),
  }));

  // Item substitution whitelist (RSMItemSubstitution rows). Optional — a feed
  // without it leaves every candidate "unverified".
  const substitutions = asArray(get(raw, 'substitutions')).map(normalizeSubstitution);

  // The SPA feed has no fill-rate history; History-Aware degrades to Weighted.
  const customerFillHistory = {};

  // Seeded demo snapshots carry the "today" their dates were generated from;
  // a live feed doesn't, and rule validity is then judged against today.
  const asOf = toDate(get(raw, 'asOf'));

  return { asOf, commodities, items, customers, demand, supply, substitutions, customerFillHistory };
}

const api = { normalizeSnapshot, normalizeSubstitution, policyOf, priceBasisOf, POLICIES, get, pick, num, intOr, toDate, asArray };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Snapshot = api;
})(typeof self !== 'undefined' ? self : globalThis);
