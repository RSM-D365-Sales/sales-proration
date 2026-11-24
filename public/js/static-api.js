// Static-build API — answers the portal's /api/* calls in the browser.
//
// Injected only into static builds (scripts/build-static.mjs), after auth.js
// and the shared modules. It swaps AUTH.fetch for a router over the bundled
// demo snapshot, so app.js / substitutions.js run unchanged on a host with no
// server (Cloudflare Pages):
//
//   reads    data/snapshot.json (raw GetOpenSalesOrders shape) → Snapshot.normalizeSnapshot
//            → PortalCore — the exact functions Express and Azure Functions use
//   sends    Messages.build* — the exact SysMessageService envelope production
//            sends; recorded in this browser's batch history, never transmitted
//   rules    published rule/policy changes are applied on top of the snapshot,
//            standing in for RSMSubstitutionRuleConsumer having run
//
// Dates: when scenario.rebaseDates is on, every date in the snapshot shifts
// by (today − snapshot.asOf) days at load, so ship dates and rule windows
// stay relative to the day the demo is opened.
//
// State lives in localStorage under spa.static.*; STATIC_DEMO.reset() (or
// ?reset=1 on any page) clears it back to the seeded data.
(function () {
  const cfg = window.APP_CONFIG || {};
  if (cfg.mode !== 'static' || !window.AUTH) return;

  const KEYS = { outbox: 'spa.static.outbox', applied: 'spa.static.applied' };
  const realFetch = window.fetch.bind(window);
  const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: session-only */ } };

  if (new URLSearchParams(location.search).get('reset') === '1') reset(false);

  function reset(reload = true) {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('spa.subDrafts');
    if (reload) location.href = location.pathname;
  }

  // ---- data ------------------------------------------------------------------
  let basePromise = null; // memoized: concurrent first calls share one load
  function loadBase() {
    if (!basePromise) basePromise = fetchBase().catch(err => { basePromise = null; throw err; });
    return basePromise;
  }
  async function fetchBase() {
    const [scenario, branding, raw, seededOutbox] = await Promise.all(
      ['data/scenario.json', 'data/branding.json', 'data/snapshot.json', 'data/outbox.json']
        .map(u => realFetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); })));
    const today = new Date().toISOString().slice(0, 10);
    const shiftDays = scenario.rebaseDates && raw.asOf
      ? Math.round((Date.parse(today) - Date.parse(raw.asOf)) / 86400000) : 0;
    return { scenario, branding, raw: rebase(raw, shiftDays), seededOutbox: rebaseOutbox(seededOutbox, shiftDays), shiftDays };
  }

  const shift = (iso, days) => {
    if (!iso || !days) return iso;
    const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
    d.setUTCDate(d.getUTCDate() + days);
    return iso.length <= 10 ? d.toISOString().slice(0, 10) : d.toISOString();
  };
  function rebase(raw, days) {
    if (!days) return raw;
    return {
      ...raw,
      asOf: shift(raw.asOf, days),
      Demand: raw.Demand.map(d => ({ ...d, RequestedShipDate: shift(d.RequestedShipDate, days) })),
      substitutions: (raw.substitutions || []).map(s => ({ ...s, ValidFrom: shift(s.ValidFrom, days), ValidTo: shift(s.ValidTo, days) })),
      substitutionGroups: (raw.substitutionGroups || []).map(g => ({ ...g, ValidFrom: shift(g.ValidFrom, days), ValidTo: shift(g.ValidTo, days) })),
    };
  }
  function rebaseOutbox(list, days) {
    return (list || []).map(b => ({ ...b, enqueuedUtc: shift(b.enqueuedUtc, days), body: { ...b.body, createdUtc: shift(b.body?.createdUtc, days) } }));
  }

  /** Normalized snapshot with every published rule/policy change applied. */
  async function snapshot() {
    const { raw } = await loadBase();
    const snap = Snapshot.normalizeSnapshot(raw);
    for (const ch of read(KEYS.applied, [])) {
      snap.substitutions = Subs.applyRuleChanges(snap.substitutions, ch.rules);
      snap.customers = Subs.applyPolicyChanges(snap.customers, ch.policies);
      snap.substitutionGroups = Subs.applyGroupChanges(snap.substitutionGroups, ch.groups);
    }
    return snap;
  }

  // ---- sends -----------------------------------------------------------------
  async function record(envelope, { strategy, commodityId, records }) {
    const { scenario } = await loadBase();
    const content = JSON.parse(envelope._messageContent);
    const now = new Date().toISOString();
    const entry = {
      topic: 'd365-proration-inbound', enqueuedUtc: now, messageId: content.BatchId, envelope,
      body: { batchId: content.BatchId, createdUtc: now, createdBy: scenario.persona?.username || 'demo', strategy, commodityId, lines: records },
    };
    write(KEYS.outbox, [...read(KEYS.outbox, []), entry]);
    return {
      ok: true, status: 202, demo: true, batchId: content.BatchId, messageType: envelope._messageType,
      company: envelope._companyId, recordCount: records.length, skipped: 0, envelope,
    };
  }

  async function company() { return (await loadBase()).scenario.company || 'DEMO'; }

  async function sendProration(body) {
    const lines = (body.lines || []).filter(l => Number(l.allocatedQty) > 0);
    if (!lines.length) throw PortalCore.httpError(400, 'No lines with an allocated quantity > 0 to send.');
    const snap = await snapshot();
    const items = new Set(lines.map(l => l.itemId));
    const groups = body.commodityId ? [body.commodityId] : [...new Set(snap.items.filter(i => items.has(i.itemId)).map(i => i.commodityId))];
    const env = Messages.buildBatchMessage(lines, await company(), crypto.randomUUID());
    return record(env, { strategy: body.strategy || 'Proration', commodityId: groups.join(', '), records: JSON.parse(env._messageContent).Records });
  }

  async function sendSubs(body) {
    const subs = PortalCore.checkSubstitutions(body.substitutions);
    const snap = await snapshot();
    // Same check RSMSubstitutionConsumer makes: every record needs an active
    // rule or interchangeable group for that customer, or D365 rejects the line.
    const custOf = Object.fromEntries(snap.demand.map(d => [`${d.salesId}:${d.lineNum}`, d.customerId]));
    const byId = Object.fromEntries(snap.customers.map(c => [c.customerId, c]));
    const allRules = Subs.withGroups(snap.substitutions, snap.substitutionGroups);
    const missing = subs.filter(s => !Subs.resolveRule(allRules, byId[custOf[`${s.salesId}:${s.lineNum}`]], s.fromItemId, s.toItemId, snap.asOf));
    if (missing.length) {
      throw PortalCore.httpError(400, `No active substitution rule for ${missing.map(s => `${s.salesId}/${s.lineNum}`).join(', ')} — publish the rule first.`);
    }
    const env = Messages.buildSubstitutionMessage(subs, await company(), crypto.randomUUID());
    const groups = [...new Set(snap.items.filter(i => subs.some(s => s.fromItemId === i.itemId)).map(i => i.commodityId))];
    return record(env, { strategy: 'Substitution', commodityId: groups.join(', '), records: JSON.parse(env._messageContent).Records });
  }

  async function publishRules(body) {
    const snap = await snapshot();
    const clean = PortalCore.cleanRulePublish(body, snap);
    const env = Messages.buildRuleMessage(clean, await company(), crypto.randomUUID());
    const content = JSON.parse(env._messageContent);
    const result = await record(env, { strategy: 'Substitution rules', commodityId: '', records: [...content.Rules, ...content.SubstitutionGroups, ...content.CustomerPolicies] });
    write(KEYS.applied, [...read(KEYS.applied, []), clean]); // "D365 applied it"
    return result;
  }

  // ---- router ----------------------------------------------------------------
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  async function route(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const url = new URL(path, location.href);
    const p = url.pathname.replace(/^.*\/api\//, '/api/');
    const body = opts.body ? JSON.parse(opts.body) : {};
    let m;
    if (method === 'GET' && p === '/api/branding') return json(200, (await loadBase()).branding);
    if (method === 'GET' && p === '/api/commodities') return json(200, PortalCore.listCommodities(await snapshot()));
    if (method === 'GET' && (m = p.match(/^\/api\/commodities\/([^/]+)$/))) return json(200, PortalCore.getCommodityDetail(await snapshot(), decodeURIComponent(m[1])));
    if (method === 'GET' && p === '/api/customers') return json(200, PortalCore.listCustomers(await snapshot()));
    if (method === 'GET' && p === '/api/substitutions') return json(200, PortalCore.substitutionBook(await snapshot()));
    if (method === 'GET' && p === '/api/batches') return json(200, [...(await loadBase()).seededOutbox, ...read(KEYS.outbox, [])]);
    if (method === 'POST' && p === '/api/prorate') return json(200, PortalCore.runProration(await snapshot(), body));
    if (method === 'POST' && p === '/api/prorate/send') return json(202, await sendProration(body));
    if (method === 'POST' && p === '/api/substitute/send') return json(202, await sendSubs(body));
    if (method === 'POST' && p === '/api/substitutions/publish') return json(202, await publishRules(body));
    return json(404, { error: `Not available in this build: ${method} ${p}` });
  }

  window.AUTH.fetch = async (path, opts) => {
    try { return await route(path, opts); }
    catch (err) {
      console.error('[static-api]', err);
      return json(err.status || 500, { error: err.message || 'Request failed' });
    }
  };

  // Signed-in persona from the scenario (display only — there is no sign-in).
  let persona = null;
  loadBase().then(b => { persona = b.scenario.persona || null; }).catch(() => {});
  window.AUTH.ensureSignedIn = async () => { await loadBase().catch(() => {}); return window.AUTH.account(); };
  window.AUTH.account = () => (persona ? { name: persona.name, username: persona.username, demo: true } : null);

  window.STATIC_DEMO = { reset, snapshot, loadBase };
})();
