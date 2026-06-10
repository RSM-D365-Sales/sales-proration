const express = require('express');
const path = require('path');
const crypto = require('crypto');

const d365 = require('./d365Client');
const config = require('./config');
const branding = require('./branding');
const portal = require('./portalService');
const { authConfig, requireAuth } = require('./entraAuth');
const { missingD365Settings } = config;
const { publishBatch, readOutbox } = require('./messageQueue');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS — only needed when the front-end is served from another origin (e.g.
// GitHub Pages). Set CORS_ORIGIN to that origin (comma-separate for several).
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

// Entra ID bearer-token guard for the API. Active only when AUTH_TENANT_ID +
// AUTH_CLIENT_ID are set (see server/entraAuth.js); otherwise a no-op so local
// development needs no sign-in. Static files stay public — the data is what's
// protected.
app.use('/api', requireAuth());

app.use(express.static(path.join(__dirname, '..', 'public')));

// Wrap async route handlers so thrown D365 errors become a clean 502 (or the
// error's own status) instead of an unhandled rejection. Live D365; no mock
// fallback — failures are surfaced to the UI.
function route(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch(err => {
      const status = err.status && err.status >= 400 ? err.status : 502;
      console.error(`[D365] ${req.method} ${req.originalUrl} -> ${err.message}`);
      res.status(status).json({ error: err.message });
    });
  };
}

// ---- Read APIs (live D365 — built from the SPA snapshot) ---------------------
// Route logic lives in server/portalService.js, shared with the Azure
// Functions app (api/index.js) so local and hosted behavior stay identical.

app.get('/api/commodities', route(async (req, res) => {
  res.json(await portal.listCommodities());
}));

app.get('/api/commodities/:id', route(async (req, res) => {
  res.json(await portal.getCommodityDetail(req.params.id));
}));

app.get('/api/customers', route(async (req, res) => {
  res.json(await portal.listCustomers());
}));

// ---- Proration --------------------------------------------------------------

/**
 * POST /api/prorate
 * body: { strategy, itemId, siteId, warehouseId, alpha? }
 * Returns the proposed allocation (does NOT publish).
 */
app.post('/api/prorate', route(async (req, res) => {
  res.json(await portal.runProration(req.body || {}));
}));

// ---- Publish to D365 via MQ -------------------------------------------------

app.post('/api/batches', (req, res) => {
  const { strategy, commodityId, lines, createdBy } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'lines required' });
  }

  // Server-side validation (defense in depth)
  for (const l of lines) {
    if (typeof l.allocatedQty !== 'number' || l.allocatedQty < 0) {
      return res.status(400).json({ error: `Invalid allocatedQty on ${l.salesId}/${l.lineNum}` });
    }
    if (l.allocatedQty > l.originalQty) {
      return res.status(400).json({ error: `allocatedQty exceeds originalQty on ${l.salesId}/${l.lineNum}` });
    }
  }

  const batchMessage = {
    batchId: crypto.randomUUID(),
    createdUtc: new Date().toISOString(),
    createdBy: createdBy || 'unknown@local',
    strategy: strategy || 'Manual',
    commodityId: commodityId || null,
    lines,
  };

  const pub = publishBatch(batchMessage);
  res.status(202).json({ accepted: true, batchId: batchMessage.batchId, queue: pub });
});

app.get('/api/batches', (req, res) => res.json(readOutbox()));

// ---- Send a prorated batch to D365 (one SendMessage per batch) ---------------
// The whole approval is published as a single SysMessageService.SendMessage on
// queue `rsmSalesProrateAccelerator`: a head record (BatchId) plus a Records
// array of allocated sales lines, consumed directly by the message processor.
app.post('/api/prorate/send', route(async (req, res) => {
  const result = await portal.sendBatch((req.body || {}).lines);
  res.status(result.ok ? 202 : 502).json(result);
}));

// ---- Branding (white-label: logo, name, colors, skin) -----------------------

app.get('/api/branding', (req, res) => res.json(branding.get()));

app.post('/api/branding', (req, res) => {
  try {
    res.json(branding.update(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Setup: environment profiles (secrets stay in .env) ---------------------

// List profiles (secrets redacted) + which one is active.
app.get('/api/setup/environments', (req, res) => {
  res.json(config.listEnvironments());
});

// Create or update a profile. Never accepts a secret value.
app.post('/api/setup/environments', (req, res) => {
  const body = req.body || {};
  if (!body.label && !body.id) return res.status(400).json({ error: 'label required' });
  if ('clientSecret' in body || 'secret' in body) {
    return res.status(400).json({ error: 'Secrets are not stored here — set the named .env variable instead.' });
  }
  const env = config.upsertEnvironment(body);
  res.json({ saved: env.id, ...config.listEnvironments() });
});

app.delete('/api/setup/environments/:id', (req, res) => {
  config.deleteEnvironment(req.params.id);
  res.json(config.listEnvironments());
});

// Switch the active environment (takes effect immediately, no restart).
app.post('/api/setup/active', (req, res) => {
  const { id } = req.body || {};
  try {
    config.setActive(id);
    res.json(config.listEnvironments());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Test the active profile end-to-end (token + one live read).
app.post('/api/setup/test', route(async (req, res) => {
  res.json(await d365.testConnection());
}));

// ---- Boot -------------------------------------------------------------------

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`Sales Proration shell listening on http://localhost:${PORT}`);
  const missing = missingD365Settings();
  if (missing.length) {
    console.warn(`[D365] Not fully configured (missing: ${missing.join(', ')}). ` +
      `Open /setup.html to manage environments; client secrets go in .env. ` +
      `Read endpoints return 502/503 until ready.`);
  } else {
    const c = require('./config').getActiveConfig();
    console.log(`[D365] Active environment "${c.label}" -> ${c.baseUrl} (company ${c.company})`);
  }
});
