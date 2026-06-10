// Azure Functions front door for the proration portal API.
//
// Same routes, same logic as the local Express server — both call
// server/portalService.js — but hosted serverless so the GitHub Pages
// front-end has a backend that can hold the D365 client secret.
//
// Deployment expectations (Function App settings):
//   D365_CONFIG_MODE = env          <- read D365 config from settings, not files
//   D365_BASE_URL / D365_TENANT_ID / D365_CLIENT_ID / D365_CLIENT_SECRET /
//   D365_COMPANY (+ optional D365_SERVICE_GROUP / _SERVICE / _OPERATION / _SCOPE)
//   AUTH_TENANT_ID / AUTH_CLIENT_ID <- Entra app registration; requests must
//                                      carry a valid bearer token when set
//   CORS: configure your GitHub Pages origin on the Function App (portal or
//   `az functionapp cors add`) — the platform handles preflight.

const { app } = require('@azure/functions');

const portal = require('../server/portalService');
const branding = require('../server/branding');
const d365 = require('../server/d365Client');
const config = require('../server/config');
const { verifyBearer } = require('../server/entraAuth');

function json(status, body) { return { status, jsonBody: body }; }

/** Wrap a handler with Entra auth + error translation (mirrors Express `route`). */
function guarded(handler) {
  return async (request, context) => {
    const auth = await verifyBearer(request.headers.get('authorization'));
    if (!auth.ok) return json(auth.status, { error: auth.error });
    try {
      return await handler(request, context);
    } catch (err) {
      const status = err.status && err.status >= 400 ? err.status : 502;
      context.error(`[D365] ${request.method} ${request.url} -> ${err.message}`);
      return json(status, { error: err.message });
    }
  };
}

app.http('commodities', {
  methods: ['GET'],
  route: 'commodities',
  authLevel: 'anonymous',
  handler: guarded(async () => json(200, await portal.listCommodities())),
});

app.http('commodityDetail', {
  methods: ['GET'],
  route: 'commodities/{id}',
  authLevel: 'anonymous',
  handler: guarded(async (request) =>
    json(200, await portal.getCommodityDetail(request.params.id))),
});

app.http('customers', {
  methods: ['GET'],
  route: 'customers',
  authLevel: 'anonymous',
  handler: guarded(async () => json(200, await portal.listCustomers())),
});

app.http('prorate', {
  methods: ['POST'],
  route: 'prorate',
  authLevel: 'anonymous',
  handler: guarded(async (request) =>
    json(200, await portal.runProration(await request.json().catch(() => ({}))))),
});

app.http('prorateSend', {
  methods: ['POST'],
  route: 'prorate/send',
  authLevel: 'anonymous',
  handler: guarded(async (request) => {
    const body = await request.json().catch(() => ({}));
    const result = await portal.sendBatch(body.lines);
    return json(result.ok ? 202 : 502, result);
  }),
});

app.http('substituteSend', {
  methods: ['POST'],
  route: 'substitute/send',
  authLevel: 'anonymous',
  handler: guarded(async (request) => {
    const body = await request.json().catch(() => ({}));
    const result = await portal.sendSubstitutions(body.substitutions);
    return json(result.ok ? 202 : 502, result);
  }),
});

// Branding is read-only when hosted — edit server/data/branding.json in the
// repo (it deploys with the app). Live editing via Setup is a local feature.
app.http('branding', {
  methods: ['GET'],
  route: 'branding',
  authLevel: 'anonymous',
  handler: guarded(async () => json(200, branding.get())),
});

// Setup is READ-ONLY when hosted: the D365 connection comes from Function App
// settings (D365_CONFIG_MODE=env), not an editable store — serverless storage
// is ephemeral and backend config/secrets must not be editable from a public
// web form. The Setup page reads `readOnly: true` and hides its edit controls;
// profile editing remains a local-development feature.
app.http('setupEnvironments', {
  methods: ['GET'],
  route: 'setup/environments',
  authLevel: 'anonymous',
  handler: guarded(async () => {
    const c = config.getActiveConfig();
    return json(200, {
      readOnly: true,
      activeId: c.id,
      environments: [{
        id: c.id, label: c.label, baseUrl: c.baseUrl,
        tenantId: c.tenantId, clientId: c.clientId, company: c.company,
        serviceGroup: c.serviceGroup, service: c.service, operation: c.operation,
        scope: c.scope, timeoutMs: c.timeoutMs,
        secretEnvVar: c.secretEnvVar, secretConfigured: !!c.clientSecret,
      }],
      defaults: {},
    });
  }),
});

app.http('setupTest', {
  methods: ['POST'],
  route: 'setup/test',
  authLevel: 'anonymous',
  handler: guarded(async () => json(200, await d365.testConnection())),
});

// The local-outbox demo endpoints (/api/batches) are intentionally absent:
// serverless storage is ephemeral. The landing page tolerates this (its
// batches table is best-effort).

app.http('health', {
  methods: ['GET'],
  route: 'health',
  authLevel: 'anonymous',
  handler: guarded(async () => json(200, await d365.testConnection())),
});
