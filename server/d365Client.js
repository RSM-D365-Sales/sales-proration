// D365 F&SCM client for the Sales Prorate Accelerator (SPA) read service.
//
// A single custom-service operation returns the full planning snapshot:
//   POST {baseUrl}/api/services/{serviceGroup}/{service}/{operation}
//   body: { "_inputContract": "{\"dataAreaId\":\"<legal entity>\"}" }
//   (the service takes _inputContract as a string and deserializes the JSON
//   inside it — a bare company string is rejected since the June 2026 update)
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

// Tolerant field access + snapshot normalization live in the shared module so
// the browser (static demo builds) normalizes exactly like the server.
const { normalizeSnapshot, num, asArray } = require('../public/js/shared/snapshot.js');
const Messages = require('../public/js/shared/messages.js');

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

// Demo snapshot override (opt-in, local only). When D365_SNAPSHOT_FILE names a
// JSON file in the raw GetOpenSalesOrders shape, getSnapshot() reads that file
// instead of calling D365, and the outbound send writes to the local outbox
// instead of SysMessageService. Unset = live D365, exactly as before; the
// hosted Function App never sets it. Used by demo-kit/ to record the booth
// video from the generated Bluestem data set (demo-kit/seed.mjs).
const SNAPSHOT_FILE = (process.env.D365_SNAPSHOT_FILE || '').trim();
function snapshotFromFile() {
  const fs = require('fs');
  const path = require('path');
  const file = path.isAbsolute(SNAPSHOT_FILE) ? SNAPSHOT_FILE : path.join(__dirname, '..', SNAPSHOT_FILE);
  if (!fs.existsSync(file)) {
    throw new D365Error(`D365_SNAPSHOT_FILE not found: ${file}`, { status: 503 });
  }
  return normalizeSnapshot(JSON.parse(fs.readFileSync(file, 'utf8')));
}
const usingSnapshotFile = () => !!SNAPSHOT_FILE;

/**
 * Pull (and cache) the full planning snapshot for the active environment's
 * legal entity. Pass a company to override the profile's value.
 */
async function getSnapshot(companyOverride) {
  if (usingSnapshotFile()) return snapshotFromFile();
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
      body: JSON.stringify({ _inputContract: JSON.stringify({ dataAreaId: company }) }),
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

const { SEND_MESSAGE_PATH, MESSAGE_TYPE, SUB_MESSAGE_TYPE, RULE_MESSAGE_TYPE,
  buildBatchMessage, buildSubstitutionMessage, buildRuleMessage } = Messages;

function resolveCompany(c, companyOverride) {
  const company = (companyOverride || c.company || '').trim();
  if (!company) {
    throw new D365Error('No company (legal entity) set on the active environment. Add it on the Setup page.',
      { status: 503 });
  }
  return company;
}

/** Shared SysMessageService POST + result shaping for both message types. */
async function postQueueMessage(c, message, base) {
  if (usingSnapshotFile()) {
    // Demo snapshot mode: nothing leaves the machine. Append to the local
    // outbox (the Service Bus stand-in the landing page's Batches table reads).
    const { publishBatch } = require('./messageQueue');
    const content = JSON.parse(message._messageContent);
    const pub = publishBatch({
      batchId: base.batchId, createdUtc: new Date().toISOString(), createdBy: 'demo@local',
      strategy: base.messageType === SUB_MESSAGE_TYPE ? 'Substitution'
        : base.messageType === RULE_MESSAGE_TYPE ? 'Substitution rules'
        : (base.strategy || 'Proration'),
      commodityId: base.commodityId || null, lines: content.Records || [...(content.Rules || []), ...(content.CustomerPolicies || [])],
    });
    return { ok: true, ...base, url: pub.outbox, status: 202, response: { demo: true } };
  }
  const token = await getToken(c);
  const url = `${c.baseUrl}${SEND_MESSAGE_PATH}`;

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
    return { ok: false, ...base, url, error: err.message };
  }

  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    if (res.status === 401) tokenCache = { key: null, value: null, expiresAt: 0 };
    const detail = (body && (body.error?.message || body.Message || body.message)) ||
      (typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300));
    return { ok: false, ...base, url, status: res.status, error: detail };
  }
  return { ok: true, ...base, url, status: res.status, response: body };
}

/**
 * POST one SysMessageService.SendMessage carrying the whole proration batch.
 * Lines with allocatedQty <= 0 are dropped from Records (nothing to apply).
 * Returns { ok, batchId, recordCount, skipped, … } — `error` set when not ok.
 */
async function sendProrationBatch(lines, { company: companyOverride, batchId } = {}) {
  if (!usingSnapshotFile()) assertConfigured();
  const c = getActiveConfig();
  const company = usingSnapshotFile() ? (c.company || 'BFP') : resolveCompany(c, companyOverride);

  const records = asArray(lines).filter(l => num(l.allocatedQty) > 0);
  const skipped = asArray(lines).length - records.length;
  if (records.length === 0) {
    throw new D365Error('No lines with an allocated quantity > 0 to send.', { status: 400 });
  }

  const id = batchId || crypto.randomUUID();
  return postQueueMessage(c, buildBatchMessage(records, company, id),
    { batchId: id, messageType: MESSAGE_TYPE, company, recordCount: records.length, skipped });
}

/**
 * POST one SysMessageService.SendMessage carrying staged substitutions
 * (message type rsmSalesSubstituteAcceleratorMessage).
 * subs: [{ salesId, lineNum, fromItemId, toItemId, qty, remainingOriginalQty }]
 */
async function sendSubstitutionBatch(subs, { company: companyOverride, batchId } = {}) {
  if (!usingSnapshotFile()) assertConfigured();
  const c = getActiveConfig();
  const company = usingSnapshotFile() ? (c.company || 'BFP') : resolveCompany(c, companyOverride);

  const records = asArray(subs).filter(s => num(s.qty) > 0 && s.fromItemId && s.toItemId);
  if (records.length === 0) {
    throw new D365Error('No substitutions with a quantity > 0 to send.', { status: 400 });
  }

  const id = batchId || crypto.randomUUID();
  return postQueueMessage(c, buildSubstitutionMessage(records, company, id),
    { batchId: id, messageType: SUB_MESSAGE_TYPE, company, recordCount: records.length, skipped: 0 });
}

/**
 * POST one SysMessageService.SendMessage carrying substitution rule upserts /
 * deletes, interchangeable group changes and customer policy changes (message type
 * rsmSalesSubstitutionRuleMessage, consumed by RSMSubstitutionRuleConsumer).
 */
async function sendRuleChanges({ rules = [], policies = [], groups = [] } = {}, { company: companyOverride, batchId } = {}) {
  if (!usingSnapshotFile()) assertConfigured();
  const c = getActiveConfig();
  const company = usingSnapshotFile() ? (c.company || 'BFP') : resolveCompany(c, companyOverride);
  if (!rules.length && !policies.length && !groups.length) {
    throw new D365Error('No rule, group or policy changes to send.', { status: 400 });
  }
  const id = batchId || crypto.randomUUID();
  return postQueueMessage(c, buildRuleMessage({ rules, policies, groups }, company, id),
    { batchId: id, messageType: RULE_MESSAGE_TYPE, company, recordCount: rules.length + groups.length + policies.length, skipped: 0 });
}

module.exports = {
  D365Error, getSnapshot, testConnection, normalizeSnapshot,
  sendProrationBatch, buildBatchMessage,
  sendSubstitutionBatch, buildSubstitutionMessage,
  sendRuleChanges, buildRuleMessage,
};
