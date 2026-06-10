// Connection configuration.
//
// Non-secret settings (base URL, tenant/client id, service names) live in a
// switchable store of environment "profiles" at server/data/environments.json,
// managed from the in-app Setup page. The CLIENT SECRET is never stored there —
// each profile names a `.env` variable that holds its secret, so you can keep
// one secret per environment and toggle between them.
//
// Real OS environment variables always win over the `.env` file.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'data', 'environments.json');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val; // OS env wins
  }
}
loadDotEnv();

const DEFAULTS = {
  serviceGroup: 'SPASalesOrderServiceGroup',
  service:      'SPASalesOrderService',
  operation:    'GetOpenSalesOrders',
  company:      'USMF',          // legal entity / dataAreaId -> _inputContract
  timeoutMs:    20000,
  secretEnvVar: 'D365_CLIENT_SECRET',
};

function slug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'env';
}

function genId(label, existingIds) {
  let base = slug(label);
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return id;
}

/** Coerce arbitrary input into a clean, whitelisted environment profile. */
function normalizeEnv(input = {}, existing = {}, existingIds = []) {
  return {
    id:           input.id || existing.id || genId(input.label || existing.label, existingIds),
    label:        (input.label ?? existing.label ?? '').toString().trim() || 'Untitled',
    baseUrl:      (input.baseUrl ?? existing.baseUrl ?? '').toString().trim().replace(/\/+$/, ''),
    tenantId:     (input.tenantId ?? existing.tenantId ?? '').toString().trim(),
    clientId:     (input.clientId ?? existing.clientId ?? '').toString().trim(),
    company:      (input.company ?? existing.company ?? '').toString().trim() || DEFAULTS.company,
    serviceGroup: (input.serviceGroup ?? existing.serviceGroup ?? '').toString().trim() || DEFAULTS.serviceGroup,
    service:      (input.service ?? existing.service ?? '').toString().trim() || DEFAULTS.service,
    operation:    (input.operation ?? existing.operation ?? '').toString().trim() || DEFAULTS.operation,
    scope:        (input.scope ?? existing.scope ?? '').toString().trim(),
    timeoutMs:    Number(input.timeoutMs ?? existing.timeoutMs) || DEFAULTS.timeoutMs,
    secretEnvVar: (input.secretEnvVar ?? existing.secretEnvVar ?? '').toString().trim() || DEFAULTS.secretEnvVar,
  };
}

// First-run seed: if there's no store yet but the legacy .env has a base URL,
// turn those values into a starter "Default" profile so nothing is lost.
function seedStore() {
  if (process.env.D365_BASE_URL) {
    const env = normalizeEnv({
      id: 'default',
      label: 'Default (from .env)',
      baseUrl: process.env.D365_BASE_URL,
      tenantId: process.env.D365_TENANT_ID,
      clientId: process.env.D365_CLIENT_ID,
      company: process.env.D365_COMPANY,
      serviceGroup: process.env.D365_SERVICE_GROUP,
      scope: process.env.D365_SCOPE,
      timeoutMs: process.env.D365_TIMEOUT_MS,
      secretEnvVar: 'D365_CLIENT_SECRET',
    }, {}, []);
    return { activeId: env.id, environments: [env] };
  }
  return { activeId: null, environments: [] };
}

let cache = null;

function readStore() {
  if (cache) return cache;
  let store;
  if (fs.existsSync(STORE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      const ids = [];
      const environments = (parsed.environments || []).map(e => {
        const n = normalizeEnv(e, e, ids);
        ids.push(n.id);
        return n;
      });
      let activeId = parsed.activeId;
      if (!environments.find(e => e.id === activeId)) activeId = environments[0]?.id ?? null;
      store = { activeId, environments };
      // Upgrade-on-load: rewrite if normalization changed the file (e.g. an
      // older schema with stale fields), so the on-disk shape stays current.
      if (JSON.stringify(store) !== JSON.stringify({ activeId: parsed.activeId, environments: parsed.environments })) {
        cache = store;
        return writeStore(store);
      }
    } catch {
      store = seedStore();
    }
  } else {
    store = seedStore();
    writeStore(store); // persist the seed (or empty store)
  }
  cache = store;
  return cache;
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  cache = store;
  return store;
}

// --- public surface ----------------------------------------------------------

function secretFor(env) {
  return env ? (process.env[env.secretEnvVar] || '') : '';
}

/**
 * Hosted mode (Azure Functions): D365_CONFIG_MODE=env builds the whole config
 * from environment variables / Function App settings, skipping the on-disk
 * profile store entirely (serverless filesystems are ephemeral). The Setup
 * page's profile management is a local-development feature.
 */
function envConfig() {
  const baseUrl = (process.env.D365_BASE_URL || '').trim().replace(/\/+$/, '');
  const scope = (process.env.D365_SCOPE || '').trim();
  return {
    id: 'env',
    label: process.env.D365_LABEL || 'Hosted (app settings)',
    baseUrl,
    tenantId:     (process.env.D365_TENANT_ID || '').trim(),
    clientId:     (process.env.D365_CLIENT_ID || '').trim(),
    clientSecret: process.env.D365_CLIENT_SECRET || '',
    company:      (process.env.D365_COMPANY || '').trim() || DEFAULTS.company,
    serviceGroup: (process.env.D365_SERVICE_GROUP || '').trim() || DEFAULTS.serviceGroup,
    service:      (process.env.D365_SERVICE || '').trim() || DEFAULTS.service,
    operation:    (process.env.D365_OPERATION || '').trim() || DEFAULTS.operation,
    scope:        scope || (baseUrl ? `${baseUrl}/.default` : ''),
    timeoutMs:    Number(process.env.D365_TIMEOUT_MS) || DEFAULTS.timeoutMs,
    secretEnvVar: 'D365_CLIENT_SECRET',
  };
}

/** The active profile resolved into the full runtime config (incl. secret + default scope). */
function getActiveConfig() {
  if (process.env.D365_CONFIG_MODE === 'env') return envConfig();
  const store = readStore();
  const env = store.environments.find(e => e.id === store.activeId) || null;
  if (!env) {
    return { id: null, label: null, baseUrl: '', tenantId: '', clientId: '', clientSecret: '',
      company: DEFAULTS.company, serviceGroup: DEFAULTS.serviceGroup, service: DEFAULTS.service,
      operation: DEFAULTS.operation, scope: '', timeoutMs: DEFAULTS.timeoutMs,
      secretEnvVar: DEFAULTS.secretEnvVar };
  }
  return {
    ...env,
    clientSecret: secretFor(env),
    scope: env.scope || (env.baseUrl ? `${env.baseUrl}/.default` : ''),
  };
}

/** Human-readable list of settings the active profile is still missing. */
function missingD365Settings() {
  const c = getActiveConfig();
  const missing = [];
  if (!c.id)            missing.push('an active environment (none selected)');
  if (!c.baseUrl)       missing.push('Base URL');
  if (!c.tenantId)      missing.push('Tenant ID');
  if (!c.clientId)      missing.push('Client ID');
  if (c.id && !c.clientSecret) missing.push(`Client secret (set ${c.secretEnvVar} in .env)`);
  return missing;
}

/** Profiles with secrets redacted (only whether the named .env var is present). */
function listEnvironments() {
  const store = readStore();
  return {
    activeId: store.activeId,
    environments: store.environments.map(e => ({
      ...e,
      secretConfigured: !!process.env[e.secretEnvVar],
    })),
    defaults: DEFAULTS,
  };
}

function upsertEnvironment(input) {
  const store = readStore();
  const ids = store.environments.map(e => e.id);
  const existing = input.id ? store.environments.find(e => e.id === input.id) : null;
  const env = normalizeEnv(input, existing || {}, ids.filter(id => id !== input.id));

  if (existing) {
    store.environments = store.environments.map(e => (e.id === env.id ? env : e));
  } else {
    store.environments.push(env);
    if (!store.activeId) store.activeId = env.id;
  }
  writeStore(store);
  return env;
}

function deleteEnvironment(id) {
  const store = readStore();
  store.environments = store.environments.filter(e => e.id !== id);
  if (store.activeId === id) store.activeId = store.environments[0]?.id ?? null;
  writeStore(store);
  return store;
}

function setActive(id) {
  const store = readStore();
  if (!store.environments.find(e => e.id === id)) {
    throw new Error(`Unknown environment '${id}'`);
  }
  store.activeId = id;
  writeStore(store);
  return store;
}

module.exports = {
  getActiveConfig,
  missingD365Settings,
  listEnvironments,
  upsertEnvironment,
  deleteEnvironment,
  setActive,
};
