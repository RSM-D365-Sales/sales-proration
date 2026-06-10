// D365 F&SCM client for the Sales Prorate Accelerator (SPA) read service.
//
// A single custom-service operation returns the full planning snapshot:
//   POST {baseUrl}/api/services/{serviceGroup}/{service}/{operation}
//   body: { "_inputContract": "<legal entity / dataAreaId>" }
//   ->  { Demand[], items[], commodities[], Supply[], customers[] }
//
// We fetch that once, normalize it into the shapes the rest of the app already
// uses, and cache it briefly so a page that hits several endpoints doesn't
// re-pull the whole snapshot each time. Requires Node 18+ (global fetch).

const crypto = require('crypto');
const { getActiveConfig, missingD365Settings } = require('./config');

const SNAPSHOT_TTL_MS = 30_000;

class D365Error extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'D365Error';
    this.status = status;
    this.details = details;
  }
}

function assertConfigured() {
  const missing = missingD365Settings();
  if (missing.length) {
    throw new D365Error(
      `D365 connection is not configured. Missing: ${missing.join(', ')}. Open the Setup page to fix.`,
      { status: 503 },
    );
  }
}

// --- tolerant field access (handles ItemId vs itemId, $id noise, etc.) -------

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
/** "01" -> 1, "" -> fallback, 2 -> 2. */
function intOr(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
/** ISO datetime -> YYYY-MM-DD (leaves already-short dates alone). */
function toDate(v) {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function asArray(v) { return Array.isArray(v) ? v : []; }

// --- token cache (keyed by environment identity) -----------------------------

let tokenCache = { key: null, value: null, expiresAt: 0 };

async function getToken(c) {
  const now = Date.now();
  const key = `${c.tenantId}|${c.clientId}|${c.scope}`;
  if (tokenCache.value && tokenCache.key === key && now < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  const url = `https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: c.scope,
      }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    throw new D365Error(`Token request to Entra ID failed: ${err.message}`, { status: 502 });
  }

  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) {
    throw new D365Error(
      `Entra ID token request failed (${res.status}): ${json.error_description || json.error || text.slice(0, 300)}`,
      { status: 502, details: json });
  }

  tokenCache = { key, value: json.access_token, expiresAt: now + (num(json.expires_in, 3600) - 60) * 1000 };
  return tokenCache.value;
}

// --- snapshot fetch + normalize ----------------------------------------------

let snapshotCache = { key: null, value: null, expiresAt: 0 };

function normalizeSnapshot(raw) {
  const commodities = asArray(get(raw, 'commodities')).map(c => {
    const id = pick(c, 'commodityId', 'CommodityId');
    const desc = pick(c, 'description', 'Description') ?? '';
    return { id, name: desc || id, description: '' };
  });

  const items = asArray(get(raw, 'items')).map(i => ({
    itemId:      pick(i, 'itemId', 'ItemId'),
    commodityId: pick(i, 'commodityId', 'CommodityId') ?? '',
    name:        pick(i, 'name') ?? pick(i, 'itemId', 'ItemId'),
    uom:         pick(i, 'uom', 'unit') ?? '',
  }));

  const customers = asArray(get(raw, 'customers')).map(c => ({
    customerId: pick(c, 'customerId', 'CustAccount', 'AccountNum'),
    name:       pick(c, 'name') ?? pick(c, 'customerId'),
    priority:   intOr(pick(c, 'priority', 'Priority'), 3),
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

  // The SPA feed has no fill-rate history; History-Aware degrades to Weighted.
  const customerFillHistory = {};

  return { commodities, items, customers, demand, supply, customerFillHistory };
}

/**
 * Pull (and cache) the full planning snapshot for the active environment's
 * legal entity. Pass a company to override the profile's value.
 */
async function getSnapshot(companyOverride) {
  assertConfigured();
  const c = getActiveConfig();
  const company = (companyOverride || c.company || '').trim();
  if (!company) {
    throw new D365Error('No company (legal entity) set on the active environment. Add it on the Setup page.',
      { status: 503 });
  }

  const cacheKey = `${c.tenantId}|${c.clientId}|${c.baseUrl}|${company}`;
  const now = Date.now();
  if (snapshotCache.value && snapshotCache.key === cacheKey && now < snapshotCache.expiresAt) {
    return snapshotCache.value;
  }

  const token = await getToken(c);
  const url = `${c.baseUrl}/api/services/${c.serviceGroup}/${c.service}/${c.operation}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ _inputContract: company }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    throw new D365Error(`D365 ${c.operation} call failed: ${err.message}`, { status: 502 });
  }

  const text = await res.text();
  let raw; try { raw = text ? JSON.parse(text) : null; } catch { raw = text; }
  if (!res.ok) {
    if (res.status === 401) tokenCache = { key: null, value: null, expiresAt: 0 };
    const detail = (raw && (raw.error?.message || raw.Message || raw.message)) ||
      (typeof raw === 'string' ? raw.slice(0, 300) : JSON.stringify(raw)?.slice(0, 300));
    throw new D365Error(`D365 ${c.operation} returned ${res.status}: ${detail}`, { status: 502, details: raw });
  }

  const snapshot = normalizeSnapshot(raw || {});
  snapshotCache = { key: cacheKey, value: snapshot, expiresAt: now + SNAPSHOT_TTL_MS };
  return snapshot;
}

/** Verify the active profile end-to-end (token + one live snapshot pull). */
async function testConnection() {
  const c = getActiveConfig();
  const started = Date.now();
  try {
    const snap = await getSnapshot();
    return {
      ok: true,
      environment: c.label,
      baseUrl: c.baseUrl,
      company: c.company,
      counts: {
        commodities: snap.commodities.length,
        items: snap.items.length,
        customers: snap.customers.length,
        demand: snap.demand.length,
        supply: snap.supply.length,
      },
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, environment: c.label, baseUrl: c.baseUrl, company: c.company, error: err.message };
  }
}

// --- outbound: prorated batch -> D365 message queue --------------------------
//
// On "Approve & Send to D365" we publish ONE SysMessageService.SendMessage per
// approved batch. The `_messageContent` string contract carries a head record
// (BatchId) plus a Records array — one entry per allocated sales line — which
// the D365 message processor consumes directly:
//   { "BatchId": "47beadc2-…", "Records": [
//       { "SalesOrderNumber": "000751", "SalesLineNumber": 1,
//         "ItemId": "A0001", "DeliveryReminder": 5 }, … ] }

const SEND_MESSAGE_PATH = '/api/services/SysMessageServices/SysMessageService/SendMessage';
const MESSAGE_QUEUE     = 'rsmSalesProrateAccelerator';
const MESSAGE_TYPE      = 'rsmSalesProrateAcceleratorMessage';

/** Build the SendMessage envelope for one batch of allocated lines. */
function buildBatchMessage(lines, company, batchId) {
  const content = {
    BatchId: batchId,
    Records: asArray(lines).map(l => ({
      SalesOrderNumber: String(l.salesId),
      SalesLineNumber:  num(l.lineNum, 0),
      ItemId:           l.itemId,
      DeliveryReminder: num(l.allocatedQty, 0), // the prorated quantity
    })),
  };
  return {
    _companyId:      company,
    _messageQueue:   MESSAGE_QUEUE,
    _messageType:    MESSAGE_TYPE,
    _messageContent: JSON.stringify(content),
  };
}

/**
 * POST one SysMessageService.SendMessage carrying the whole batch. Lines with
 * allocatedQty <= 0 are dropped from Records (nothing to apply). Returns
 * { ok, batchId, recordCount, skipped, … } — `error` is set when ok is false.
 */
async function sendProrationBatch(lines, { company: companyOverride, batchId } = {}) {
  assertConfigured();
  const c = getActiveConfig();
  const company = (companyOverride || c.company || '').trim();
  if (!company) {
    throw new D365Error('No company (legal entity) set on the active environment. Add it on the Setup page.',
      { status: 503 });
  }

  const records = asArray(lines).filter(l => num(l.allocatedQty) > 0);
  const skipped = asArray(lines).length - records.length;
  if (records.length === 0) {
    throw new D365Error('No lines with an allocated quantity > 0 to send.', { status: 400 });
  }

  const id = batchId || crypto.randomUUID();
  const token = await getToken(c);
  const url = `${c.baseUrl}${SEND_MESSAGE_PATH}`;
  const message = buildBatchMessage(records, company, id);
  const base = { batchId: id, url, company, recordCount: records.length, skipped };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (err) {
    return { ok: false, ...base, error: err.message };
  }

  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    if (res.status === 401) tokenCache = { key: null, value: null, expiresAt: 0 };
    const detail = (body && (body.error?.message || body.Message || body.message)) ||
      (typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300));
    return { ok: false, ...base, status: res.status, error: detail };
  }
  return { ok: true, ...base, status: res.status, response: body };
}

module.exports = { D365Error, getSnapshot, testConnection, sendProrationBatch, buildBatchMessage };
