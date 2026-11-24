// ---- shared helpers -------------------------------------------------------
// All API calls go through AUTH.fetch (auth.js): it prefixes the configured
// API base URL and attaches the Entra bearer token when sign-in is enabled.
async function jget(url) { const r = await AUTH.fetch(url); if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`); return r.json(); }
async function jpost(url, body) {
  const r = await AUTH.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText || `HTTP ${r.status}`);
  return r.json();
}
function pct(n) { return (n * 100).toFixed(1) + '%'; }
function fmt(n) { return new Intl.NumberFormat().format(Math.round(n)); }
function qs(name) { return new URLSearchParams(location.search).get(name); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const STATUS = {
  OK:     { label: 'On track', meter: 'is-ok' },
  AtRisk: { label: 'At risk',  meter: 'is-risk' },
  Short:  { label: 'Short',    meter: 'is-short' },
};
function statusOf(fillRate) { return fillRate < 0.9 ? 'Short' : fillRate < 1 ? 'AtRisk' : 'OK'; }
function meterClass(fillRate) { return STATUS[statusOf(fillRate)].meter; }

function kpi(label, value, foot, accent) {
  return `<div class="kpi ${accent ? 'accent' : ''}"><div class="label">${label}</div>
    <div class="value">${value}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
}

// Render a visible, retryable error into a target container instead of leaving
// the page blank when a load fails (e.g. a transient D365 502).
function showLoadError(targetId, err, retryFn) {
  const kpis = document.getElementById('kpis');
  if (kpis) kpis.innerHTML = '';
  const el = document.getElementById(targetId);
  if (!el) { alert(`Couldn’t load: ${err.message}`); return; }
  el.innerHTML = `
    <div class="panel notice bad" style="margin-top:0">
      <strong>Couldn’t load data from D365.</strong>
      <div class="muted" style="margin:.35rem 0 .8rem">${esc(err.message || 'Request failed')}</div>
      <button class="primary" id="retry-load">Retry</button>
    </div>`;
  const btn = document.getElementById('retry-load');
  if (btn && retryFn) btn.addEventListener('click', retryFn);
  console.error('[load error]', err);
}

// ---- Manual in-place refresh ----------------------------------------------
// Data is fetched once on page load and re-fetched ONLY when the user clicks
// Refresh in the page header — every fetch costs D365 calls, so nothing polls
// in the background. The refresh itself is in-place: regions repaint only
// when the payload actually changed (JSON snapshot compare), so there is no
// page reload, no scroll loss, no flicker.
let REFRESH_TICK = null;

function registerRefresh(tick) {
  REFRESH_TICK = tick;
  const inner = document.querySelector('#pagehead .pagehead__inner');
  if (!inner || document.getElementById('page-refresh')) return;
  let spacer = inner.querySelector('.spacer');
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'spacer';
    inner.appendChild(spacer);
  }
  const btn = document.createElement('button');
  btn.id = 'page-refresh';
  btn.className = 'ghost';
  btn.type = 'button';
  btn.textContent = 'Refresh';
  btn.addEventListener('click', () => runRefresh(btn));
  spacer.appendChild(btn);
}

async function runRefresh(btn) {
  if (!REFRESH_TICK || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    await REFRESH_TICK();
    btn.textContent = 'Updated ✓';
  } catch (err) {
    console.error('[refresh]', err);
    btn.textContent = 'Failed — try again';
  } finally {
    setTimeout(() => { btn.textContent = 'Refresh'; btn.disabled = false; }, 1500);
  }
}

/** Fetch url; return parsed data only when it differs from snap[key]. */
const SNAP = {};
async function fetchIfChanged(key, url) {
  const data = await jget(url);
  const s = JSON.stringify(data);
  if (SNAP[key] === s) return null;
  SNAP[key] = s;
  return data;
}

// ---- Landing --------------------------------------------------------------
async function renderLanding() {
  try { await initShell({ active: 'plan' }); } catch (e) { console.error('[shell]', e); }
  setPageHead({ title: 'Planning overview', sub: 'Demand vs. available supply across all commodities' });

  let rows;
  try {
    rows = await fetchIfChanged('commodities', '/api/commodities');
  } catch (err) {
    showLoadError('cards', err, renderLanding);
    return;
  }
  if (rows) paintLanding(rows);

  // Batches are best-effort — a failure here must not blank the page.
  try {
    const batches = await fetchIfChanged('batches', '/api/batches');
    if (batches) paintBatches(batches);
  } catch (err) {
    console.error('[batches]', err);
    document.querySelector('#batch-table tbody').innerHTML =
      `<tr><td colspan="6" class="muted">Couldn’t load batches (${esc(err.message)}).</td></tr>`;
  }

  // Header Refresh button re-pulls and repaints in place — no page reload.
  registerRefresh(async () => {
    const fresh = await fetchIfChanged('commodities', '/api/commodities');
    if (fresh) paintLanding(fresh);
    try {
      const batches = await fetchIfChanged('batches', '/api/batches');
      if (batches) paintBatches(batches);
    } catch { /* batches endpoint is best-effort */ }
  });
}

function paintLanding(rows) {
  const totalDemand = rows.reduce((s, r) => s + r.totalDemand, 0);
  const totalSupply = rows.reduce((s, r) => s + r.totalSupply, 0);
  const fill = totalDemand ? totalSupply / totalDemand : 1;
  const attention = rows.filter(r => r.status !== 'OK').length;
  document.getElementById('kpis').innerHTML = `
    ${kpi('Commodities', rows.length, `${rows.reduce((s, r) => s + r.itemCount, 0)} items`)}
    ${kpi('Total demand', fmt(totalDemand))}
    ${kpi('Available supply', fmt(totalSupply))}
    ${kpi('Overall fill', pct(fill), attention ? `${attention} need attention` : 'All on track', true)}
  `;
  const cards = document.getElementById('cards');
  cards.innerHTML = rows.map(commodityCard).join('');
  // Listeners, not inline on*= attributes — the CSP (script-src 'self',
  // no 'unsafe-inline') blocks inline event handlers.
  cards.querySelectorAll('.card[data-id]').forEach(card =>
    card.addEventListener('click', () => {
      location.href = 'commodity.html?id=' + encodeURIComponent(card.dataset.id);
    }));
  cards.querySelectorAll('img').forEach(img =>
    img.addEventListener('error', () => { img.src = 'img/commodities/_fallback.svg'; }, { once: true }));
}

const BATCH_LABEL = {
  rsmSalesSubstitutionRuleMessage: 'Substitution rules',
  rsmSalesSubstituteAcceleratorMessage: 'Substitution',
  rsmSalesProrateAcceleratorMessage: 'Proration',
};
let BATCHES = [];

function paintBatches(batches) {
  BATCHES = batches.slice().reverse();
  const tbody = document.querySelector('#batch-table tbody');
  tbody.innerHTML = BATCHES.length
    ? BATCHES.map((b, i) => {
        const body = b.body || {};
        // Outbox entries without an envelope (local Express outbox, seeded
        // history) are proration unless their strategy says otherwise.
        const type = b.envelope?._messageType
          || ({ Substitution: 'rsmSalesSubstituteAcceleratorMessage', 'Substitution rules': 'rsmSalesSubstitutionRuleMessage' }[body.strategy])
          || 'rsmSalesProrateAcceleratorMessage';
        const kind = BATCH_LABEL[type];
        const detail = type === 'rsmSalesProrateAcceleratorMessage' && body.strategy && body.strategy !== 'Proration' ? ` · ${esc(body.strategy)}` : '';
        return `
          <tr>
            <td><code>${esc(String(body.batchId || '').slice(0, 8) || '—')}</code></td>
            <td>${esc(kind)}${detail}</td>
            <td>${esc(body.commodityId || '')}</td>
            <td class="num">${Array.isArray(body.lines) ? body.lines.length : 0}</td>
            <td class="muted">${esc(b.enqueuedUtc || '')}</td>
            <td class="num">${b.envelope ? `<button class="ghost" data-batch-payload="${i}">Payload</button>` : ''}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="muted">No batches sent yet.</td></tr>`;
  if (!tbody.dataset.wired) {
    tbody.dataset.wired = '1';
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('[data-batch-payload]');
      if (!btn) return;
      const b = BATCHES[Number(btn.dataset.batchPayload)];
      openOverlay(`
        <h3>${esc(BATCH_LABEL[b.envelope._messageType] || 'Message')} · <code>${esc(String(b.body?.batchId || '').slice(0, 8))}</code></h3>
        <div class="overlay__sub">SysMessageService.SendMessage as sent ${esc(b.enqueuedUtc || '')}</div>
        ${envelopeHtml(b.envelope)}
        <div class="row" style="margin:1rem 0 0;justify-content:flex-end"><button class="primary" data-close>Close</button></div>`, { wide: true });
    });
  }
}

function commodityCard(r) {
  const st = STATUS[r.status] || STATUS.OK;
  const fillW = Math.min(100, Math.max(0, r.fillRate * 100));
  return `
    <button class="card" style="--card-tint:${commodityTint(r)}" data-id="${esc(r.id)}">
      <div class="card__media">
        <span class="card__status"><span class="chip ${r.status}">${st.label}</span></span>
        <img src="${commodityIconUrl(r)}" alt="${esc(r.name)}" loading="lazy">
      </div>
      <div class="card__body">
        <div class="card__title">${esc(r.name)}</div>
        <div class="card__desc">${esc(r.description || '')}</div>
        <div class="meter ${st.meter}"><i style="width:${fillW}%"></i></div>
        ${r.shortItems ? `<div class="card__flag">${r.shortItems} of ${r.itemCount} item${r.itemCount === 1 ? '' : 's'} short</div>` : ''}
        <div class="card__stats">
          <div class="card__stat"><div class="k">Items</div><div class="v">${r.itemCount}</div></div>
          <div class="card__stat"><div class="k">Demand</div><div class="v">${fmt(r.totalDemand)}</div></div>
          <div class="card__stat"><div class="k">Fill</div><div class="v">${pct(r.fillRate)}</div></div>
        </div>
      </div>
    </button>`;
}

// ---- Customers --------------------------------------------------------------
let CUSTOMERS = null;
let CUST_SORT = { key: 'priority', dir: 1 }; // click a column header to change

async function renderCustomers() {
  try { await initShell({ active: 'customers' }); } catch (e) { console.error('[shell]', e); }
  setPageHead({ title: 'Customers', sub: 'Who is asking for product, at what priority, and who is short' });

  try {
    CUSTOMERS = await jget('/api/customers');
    SNAP.customers = JSON.stringify(CUSTOMERS);
  } catch (err) {
    showLoadError('cust-wrap', err, renderCustomers);
    return;
  }

  paintCustomersKpis();

  ['cf-search', 'cf-priority', 'cf-needs'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderCustomerRows));

  document.querySelectorAll('#cust-table th[data-sort]').forEach(th =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      CUST_SORT = { key, dir: CUST_SORT.key === key ? -CUST_SORT.dir : 1 };
      renderCustomerRows();
    }));

  renderCustomerRows();

  // Header Refresh button; renderCustomerRows re-applies the current
  // filters/sort, and the filter inputs themselves are never re-rendered.
  registerRefresh(async () => {
    const fresh = await fetchIfChanged('customers', '/api/customers');
    if (!fresh) return;
    CUSTOMERS = fresh;
    paintCustomersKpis();
    renderCustomerRows();
  });
}

function paintCustomersKpis() {
  const withOrders = CUSTOMERS.filter(c => c.openLines > 0);
  const needing = CUSTOMERS.filter(c => c.needsProration);
  document.getElementById('kpis').innerHTML = `
    ${kpi('Customers', CUSTOMERS.length)}
    ${kpi('With open demand', withOrders.length, `${fmt(CUSTOMERS.reduce((s, c) => s + c.openLines, 0))} open lines`)}
    ${kpi('Total requested', fmt(CUSTOMERS.reduce((s, c) => s + c.requestedQty, 0)))}
    ${kpi('Need proration', needing.length, needing.length ? 'demand on short items' : 'all covered', true)}
  `;
}

function customerComparator(a, b) {
  const { key, dir } = CUST_SORT;
  const val = c => {
    switch (key) {
      case 'name':     return String(c.name).toLowerCase();
      case 'location': return `${c.state} ${c.city}`.trim().toLowerCase();
      // needs proration first, then covered, then no open demand
      case 'status':   return c.needsProration ? 0 : (c.openLines > 0 ? 1 : 2);
      case 'policy':   return { Never: 0, CustomerOnly: 1 }[c.substitutionPolicy] ?? 2;
      default:         return c[key]; // priority / openLines / itemCount / requestedQty
    }
  };
  const va = val(a), vb = val(b);
  const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
  return (cmp * dir) || String(a.name).localeCompare(String(b.name));
}

function customerStatus(c) {
  if (c.needsProration) return `<span class="chip Short">Needs proration</span>`;
  if (c.openLines > 0)  return `<span class="chip OK">Covered</span>`;
  return `<span class="chip plain">No open demand</span>`;
}

function renderCustomerRows() {
  const q = document.getElementById('cf-search').value.trim().toLowerCase();
  const p = document.getElementById('cf-priority').value;
  const needsOnly = document.getElementById('cf-needs').checked;

  const rows = CUSTOMERS
    .filter(c => !q || `${c.name} ${c.customerId}`.toLowerCase().includes(q))
    .filter(c => !p || String(c.priority) === p)
    .filter(c => !needsOnly || c.needsProration)
    .sort(customerComparator);

  document.querySelectorAll('#cust-table th[data-sort]').forEach(th => {
    th.classList.toggle('is-asc',  th.dataset.sort === CUST_SORT.key && CUST_SORT.dir === 1);
    th.classList.toggle('is-desc', th.dataset.sort === CUST_SORT.key && CUST_SORT.dir === -1);
  });

  document.getElementById('cf-count').textContent =
    `${rows.length} of ${CUSTOMERS.length} customers`;

  const loc = c => [c.city, c.state].filter(Boolean).join(', ');
  document.querySelector('#cust-table tbody').innerHTML = rows.length
    ? rows.map(c => `
        <tr>
          <td><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.customerId)}</span></td>
          <td>${esc(loc(c)) || '<span class="muted">—</span>'}</td>
          <td><span class="chip plain">P${esc(c.priority)}</span></td>
          <td class="num">${fmt(c.openLines)}</td>
          <td class="num">${fmt(c.itemCount)}</td>
          <td class="num">${fmt(c.requestedQty)}</td>
          <td>${customerStatus(c)}</td>
          <td><a href="substitutions.html?customer=${encodeURIComponent(c.customerId)}">${c.substitutionPolicy && c.substitutionPolicy !== 'Standard' ? policyChip(c) : '<span class="chip plain">Standard</span>'}</a>${c.customerRules ? ` <span class="muted">${fmt(c.customerRules)} own rule${c.customerRules === 1 ? '' : 's'}</span>` : ''}</td>
        </tr>`).join('')
    : `<tr><td colspan="8" class="muted">No customers match the current filters.</td></tr>`;
}

// ---- Commodity detail: inline proration -------------------------------------
//
// The strategy bar at the top prorates one item ("Prorate" on its card) or
// every item in the commodity ("Prorate all items"). Results render INLINE as
// three extra columns on each item's demand grid — Allocated (editable),
// Fill %, Weight — plus a running "remaining inventory" chip per item:
//   green  (+N to allocate)   you freed units by lowering an allocation
//   red    (−N over-allocated) you promised more than is available — short
//                              someone else or dial it back
// One "Approve & Send" publishes every allocated line as a single batch.

let DETAIL = null;       // loaded commodity payload
let PRORATIONS = {};     // itemId -> /api/prorate response
let SUBSTITUTIONS = [];  // staged subs: { salesId, lineNum, customerId, customerName,
                         //   fromItemId, fromName, toItemId, toName, qty (substitute cases),
                         //   ratio, covered (ordered cases), ruleId, scope, priceBasis, pending }

async function renderDetail() {
  try { await initShell({ active: 'plan' }); } catch (e) { console.error('[shell]', e); }
  const id = qs('id');
  if (!id) { location.href = 'index.html'; return; }
  try {
    DETAIL = await jget('/api/commodities/' + encodeURIComponent(id));
    SNAP.detail = JSON.stringify(DETAIL);
  } catch (err) {
    setPageHead({ title: 'Commodity', crumbHtml: `<a href="index.html">Commodities</a>` });
    showLoadError('items', err, renderDetail);
    return;
  }

  const c = DETAIL.commodity;
  setPageHead({
    title: c.name,
    sub: c.description || '',
    crumbHtml: `<a href="index.html">Commodities</a> <span>›</span> <span>${esc(c.name)}</span>`,
  });
  document.title = `${c.name}`;

  paintDetailKpis();

  PRORATIONS = {};
  SUBSTITUTIONS = [];
  AUTO_NOTE = null;
  renderItems();

  // Header Refresh button. Staged proration work belongs to the planner —
  // fresh D365 data would fight it, so refreshing asks before discarding.
  registerRefresh(async () => {
    const hadWork = Object.keys(PRORATIONS).length || SUBSTITUTIONS.length;
    if (hadWork) {
      if (!confirm('Refreshing re-pulls D365 data and discards your staged proration work. Continue?')) return;
      PRORATIONS = {};
      SUBSTITUTIONS = [];
      AUTO_NOTE = null;
    }
    const fresh = await fetchIfChanged('detail', '/api/commodities/' + encodeURIComponent(id));
    if (fresh) DETAIL = fresh;
    if (fresh || hadWork) {
      paintDetailKpis();
      renderItems();
    }
  });

  document.getElementById('pp-strategy').addEventListener('change', e => {
    document.getElementById('pp-alpha-wrap').classList.toggle('hidden', e.target.value !== 'HistoryAware');
  });
  document.getElementById('pp-run-all').addEventListener('click', prorateAll);
  document.getElementById('pp-approve').addEventListener('click', approveBatch);
  document.getElementById('pp-auto-sub').addEventListener('click', async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await autoSubstituteAll(); } finally { btn.disabled = false; }
  });
  document.getElementById('autosub-note').addEventListener('click', e => {
    if (e.target.id === 'autosub-dismiss') { AUTO_NOTE = null; renderAutoNote(); }
  });

  // Delegated handlers survive re-renders of #items.
  const items = document.getElementById('items');
  items.addEventListener('click', e => {
    const run = e.target.closest('button[data-prorate]');
    if (run) { prorateItem(run.dataset.prorate, run); return; }
    const sub = e.target.closest('button[data-sub-item]');
    if (sub) openSubPicker(sub.dataset.subItem, sub.dataset.subKey);
  });
  items.addEventListener('input', onAllocEdit);

  document.getElementById('subs').addEventListener('click', e => {
    const rm = e.target.closest('button[data-unsub]');
    if (rm) { SUBSTITUTIONS.splice(Number(rm.dataset.unsub), 1); renderItems(); return; }
    if (e.target.closest('[data-unsub-all]')) { SUBSTITUTIONS = []; AUTO_NOTE = null; renderItems(); }
  });

  // Deep link: commodity.html?id=…&prorate=all runs the default strategy
  // across every item on load — handy for demos.
  if (qs('prorate') === 'all') prorateAll();
}

function paintDetailKpis() {
  const totalDemand = DETAIL.items.reduce((s, i) => s + i.totalDemand, 0);
  const totalSupply = DETAIL.items.reduce((s, i) => s + i.totalSupply, 0);
  const gap = Math.max(0, totalDemand - totalSupply);
  const fill = totalDemand ? totalSupply / totalDemand : 1;
  document.getElementById('kpis').innerHTML = `
    ${kpi('Total demand', fmt(totalDemand))}
    ${kpi('Available supply', fmt(totalSupply))}
    ${kpi('Gap', fmt(gap), gap ? 'undersupplied' : 'covered')}
    ${kpi('Fill rate', pct(fill), STATUS[statusOf(fill)].label, true)}
  `;
}

function renderItems() {
  document.getElementById('items').innerHTML = DETAIL.items.map(itemCard).join('');
  renderSubs();
  updateSummary();
}

function lineKey(l) { return `${l.salesId}:${l.lineNum}`; }

/** Last column of a prorated line: "Sub…" while it's short, a covered chip once substitutes fill it. */
function subCell(itemId, l) {
  const covered = subCoverage(l.salesId, l.lineNum);
  const short = lineShortfall(l);
  const chip = covered ? ` <span class="chip OK" title="${fmt(covered)} ordered cases covered by substitutes">sub +${fmt(covered)}</span>` : '';
  if (short > 0) return `<button class="ghost" data-sub-item="${esc(itemId)}" data-sub-key="${esc(lineKey(l))}">Sub…</button>${chip}`;
  return chip;
}

function itemCard(it) {
  const pr = PRORATIONS[it.itemId];
  const byKey = pr ? Object.fromEntries(pr.lines.map(l => [lineKey(l), l])) : {};

  const canSub = DETAIL.items.length > 1;
  const extraHead = pr
    ? `<th class="num">Allocated</th><th class="num">Fill %</th><th class="num">Weight</th>${canSub ? '<th></th>' : ''}` : '';

  const demandRows = it.demand.length
    ? it.demand.map(d => {
        let extra = '';
        if (pr) {
          const l = byKey[lineKey(d)];
          extra = l ? `
            <td class="num"><input type="number" class="alloc-input" min="0" max="${l.requestedQty}" step="1"
                 value="${l.allocatedQty}" data-item="${esc(it.itemId)}" data-key="${esc(lineKey(l))}" /></td>
            <td class="num fill-cell">${pct(l.requestedQty ? l.allocatedQty / l.requestedQty : 0)}</td>
            <td class="num">${l.weightUsed.toFixed(2)}</td>
            ${canSub ? `<td class="nowrap">${subCell(it.itemId, l)}</td>` : ''}`
            : `<td class="num muted" colspan="${canSub ? 4 : 3}">—</td>`;
        }
        return `
        <tr>
          <td class="nowrap">${esc(d.salesId)} / ${esc(d.lineNum)}</td>
          <td>${esc(d.customerName)} <span class="muted">(P${esc(d.priority)})</span> ${policyChip(custFor(d.customerId))}</td>
          <td>${esc(d.siteId)}</td>
          <td>${esc(d.warehouseId)}</td>
          <td>${esc(d.requestedShipDate)}</td>
          <td class="num">${fmt(d.requestedQty)}</td>
          ${extra}
        </tr>`;
      }).join('')
    : `<tr><td colspan="${pr ? (canSub ? 10 : 9) : 6}" class="muted">No open demand.</td></tr>`;

  const fill = it.totalDemand ? it.totalSupply / it.totalDemand : 1;
  return `
    <div class="item-card">
      <header>
        <div>
          <h3><img class="thumb" src="${commodityIconUrl(DETAIL.commodity)}" alt="">${esc(it.name)}</h3>
          <div class="meta">${esc(it.itemId)} · Demand ${fmt(it.totalDemand)} · Supply ${fmt(it.totalSupply)} · Fill ${pct(fill)}</div>
        </div>
        <div class="item-card__actions">
          ${pr ? remainingChip(it.itemId) : ''}
          <button data-prorate="${esc(it.itemId)}" ${it.demand.length ? '' : 'disabled'}>${pr ? 'Re-run' : 'Prorate'}</button>
        </div>
      </header>
      <table class="grid">
        <thead><tr><th>SO / Line</th><th>Customer</th><th>Site</th><th>WH</th><th>Req. Ship</th><th class="num">Requested</th>${extraHead}</tr></thead>
        <tbody>${demandRows}</tbody>
      </table>
    </div>`;
}

// ---- Substitution helpers ---------------------------------------------------
// Rules, interchangeable groups and customer policies are the server's plus
// any unpublished drafts (substitutions.js), so a rule approved mid-planning
// is usable at once. Groups expand to virtual rules ranked after every
// explicit rule (Subs.withGroups).

function detailRules() { return planningRules(DETAIL.substitutions || [], DETAIL.substitutionGroups || []); }
function detailCustomers() { return effectiveCustomers(DETAIL.customers || []); }
function custFor(id) {
  return detailCustomers().find(c => c.customerId === id)
    || { customerId: id, name: id, priority: 3, substitutionPolicy: 'Standard', substitutionNote: '' };
}
function itemFor(id) { return DETAIL.items.find(i => i.itemId === id); }

/** Ordered cases on a line already covered by staged substitutes. */
function subCoverage(salesId, lineNum) {
  return SUBSTITUTIONS.filter(s => s.salesId === salesId && s.lineNum === lineNum)
    .reduce((t, s) => t + (Number(s.covered) || 0), 0);
}
/** What is still unfilled on a prorated line after allocation and staged substitutes. */
function lineShortfall(l) {
  return Math.max(0, l.requestedQty - (Number(l.allocatedQty) || 0) - subCoverage(l.salesId, l.lineNum));
}

/** Units of an item already promised away as a SUBSTITUTE on staged subs. */
function subDrawn(itemId) {
  return SUBSTITUTIONS.filter(s => s.toItemId === itemId)
    .reduce((s, x) => s + (Number(x.qty) || 0), 0);
}

/** Inventory still on the table for an item = available − allocated − staged subs drawing on it. */
function remainingFor(itemId) {
  const pr = PRORATIONS[itemId];
  return pr.available
    - pr.lines.reduce((s, l) => s + (Number(l.allocatedQty) || 0), 0)
    - subDrawn(itemId);
}

/** Pool a substitute can draw from: prorated items use their live remaining;
 *  unprorated items offer only their surplus over their own open demand. */
function poolFor(item) {
  return PRORATIONS[item.itemId]
    ? remainingFor(item.itemId)
    : Math.max(0, item.totalSupply - item.totalDemand) - subDrawn(item.itemId);
}

function remainingChip(itemId) {
  const rem = remainingFor(itemId);
  const cls = rem > 0 ? 'OK' : rem < 0 ? 'Short' : 'plain';
  const label = rem > 0 ? `+${fmt(rem)} to allocate`
              : rem < 0 ? `${fmt(rem)} over-allocated`
              : 'fully allocated';
  return `<span class="chip ${cls}" data-rem="${esc(itemId)}" title="Available ${fmt(PRORATIONS[itemId].available)} − allocated − substitutes drawn">${label}</span>`;
}

function econFor(s) {
  return Subs.subEconomics({ fromItem: itemFor(s.fromItemId), toItem: itemFor(s.toItemId), qty: s.qty, ratio: s.ratio, priceBasis: s.priceBasis });
}

function stageSub({ line, itemId, cust, toItemId, qty, ratio, rule, scope }) {
  const fromId = itemId || line.itemId;
  const from = itemFor(fromId), to = itemFor(toItemId);
  const short = lineShortfall(line);
  SUBSTITUTIONS.push({
    salesId: line.salesId, lineNum: line.lineNum,
    customerId: cust.customerId, customerName: cust.name || cust.customerId,
    fromItemId: fromId, fromName: from?.name || fromId,
    toItemId, toName: to?.name || toItemId,
    qty, ratio, covered: Math.min(short, qty / ratio),
    ruleId: rule?.ruleId || '', groupName: rule?.groupName || '',
    scope: scope || (rule?.groupId ? 'Group' : rule?.customerId ? 'Customer' : 'All customers'),
    priceBasis: rule?.priceBasis || 'Original', pending: !!rule?.pending,
  });
}

// ---- Substitute picker ------------------------------------------------------
//
// Approved: the customer's applicable rules (their own first, then
// all-customer rules unless their policy is "customer rules only"), each with
// a live margin preview. Other items in the buyer group can be approved for
// this customer on the spot — that drafts a customer rule, which is published
// to D365 ahead of the substitution on approval. "Never substitute"
// customers get no candidates.

function openSubPicker(itemId, key) {
  const pr = PRORATIONS[itemId];
  const line = pr?.lines.find(l => lineKey(l) === key);
  if (!line) return;
  const item = itemFor(itemId);
  const cust = custFor(line.customerId);
  const shortfall = lineShortfall(line);
  const rules = detailRules();

  const approved = Subs.substitutesFor(rules, cust, itemId, DETAIL.asOf)
    .filter(c => itemFor(c.toItemId))
    .map(c => ({ ...c, item: itemFor(c.toItemId), pool: poolFor(itemFor(c.toItemId)) }));
  const approvedIds = new Set(approved.map(c => c.toItemId));
  const others = cust.substitutionPolicy === 'Never' ? [] : DETAIL.items
    .filter(x => x.itemId !== itemId && !approvedIds.has(x.itemId))
    .map(x => ({ toItemId: x.itemId, item: x, pool: poolFor(x), ratio: 1, rule: null }))
    .filter(c => c.pool >= 1);

  const suggest = c => Math.max(1, Math.min(Math.ceil(shortfall * c.ratio - 1e-9), Math.floor(c.pool)));
  const econLine = e => (e ? `covers ${fmt(e.covered)} · ${money(e.revenue)} · margin ${marginCell(e)}` : '');
  const row = (c, i, kind) => {
    const can = c.pool >= 1;
    const qty = can ? suggest(c) : 0;
    const e = can ? Subs.subEconomics({ fromItem: item, toItem: c.item, qty, ratio: c.ratio, priceBasis: c.rule?.priceBasis || 'Original' }) : null;
    return `
      <div class="sub-row ${can ? '' : 'is-off'}">
        <div class="sub-row__main">
          <div class="sub-row__name">${esc(c.item.name)} <span class="muted">${esc(c.item.itemId)}</span></div>
          <div class="sub-row__meta">
            ${fmt(Math.max(0, c.pool))} available ${PRORATIONS[c.item.itemId] ? 'after proration' : 'surplus'}${kind === 'approved' ? ` · ${ratioLabel(c.ratio)} · ${esc(basisLabel(c.rule.priceBasis))}${c.rule.note ? ` · ${esc(c.rule.note)}` : ''}` : ''}
          </div>
          <div class="sub-row__econ" data-econ="${kind}-${i}">${econLine(e)}</div>
        </div>
        ${kind === 'approved' ? `<span class="sub-row__chips">${scopeChip(c.rule, c.scope)} <span class="chip plain">${c.scope === 'Group' ? 'group default' : `rank ${esc(c.rule.rank)}`}</span></span>` : `
          <label class="field mini">Ratio <input type="number" min="0.01" step="0.005" value="1" data-ratio="${i}" /></label>
          <label class="field mini">Bill at <select data-basis="${i}"><option value="Original">Ordered</option><option value="Substitute">Substitute</option></select></label>`}
        <label class="field mini">Cases <input type="number" min="1" max="${Math.floor(Math.max(0, c.pool))}" step="1" value="${qty}" data-qty="${kind}-${i}" ${can ? '' : 'disabled'} /></label>
        <button class="${kind === 'approved' ? 'primary' : ''}" data-use="${kind}-${i}" ${can ? '' : 'disabled'}>${kind === 'approved' ? 'Use' : 'Approve & use'}</button>
      </div>`;
  };

  const neverNote = cust.substitutionPolicy === 'Never'
    ? `<div class="notice bad">${esc(cust.name)} never accepts substitutes${cust.substitutionNote ? ` — ${esc(cust.substitutionNote.replace(/\.$/, ''))}` : ''}. If that has changed, update the policy on the <a href="substitutions.html?customer=${encodeURIComponent(cust.customerId)}">Substitutions</a> page.</div>` : '';
  const approvedHtml = approved.length ? approved.map((c, i) => row(c, i, 'approved')).join('')
    : cust.substitutionPolicy === 'Never' ? ''
    : `<p class="muted">No approved substitute for ${esc(cust.name)}${cust.substitutionPolicy === 'CustomerOnly' ? ' — they only accept substitutes their own rules name' : ''}.</p>`;
  const othersHtml = others.length ? `
    <h4 class="picker__h">Other items in ${esc(DETAIL.commodity.name)} <span class="muted">— no rule for this customer</span></h4>
    <p class="muted picker__help">“Approve & use” adds a ${esc(cust.name)} rule (pending until published), then stages the substitute.</p>
    ${others.map((c, i) => row(c, i, 'other')).join('')}` : '';

  const { overlay, close } = openOverlay(`
    <h3>Substitute for ${esc(item.name)}</h3>
    <div class="overlay__sub">
      ${esc(line.salesId)} / ${esc(line.lineNum)} · ${esc(cust.name)} ${policyChip(cust)} ·
      short <strong>${fmt(shortfall)}</strong> of ${fmt(line.requestedQty)} requested
    </div>
    ${neverNote}
    ${approved.length ? `<h4 class="picker__h">Approved for ${esc(cust.name)}</h4>` : ''}
    ${approvedHtml}
    ${othersHtml}
    <div class="row" style="margin:1.1rem 0 0"><button data-close>Cancel</button></div>`, { wide: true });

  const cand = key => { const [kind, i] = key.split('-'); return { kind, i, c: (kind === 'approved' ? approved : others)[Number(i)] }; };
  const ratioOf = (kind, c, i) => (kind === 'other' ? Number(overlay.querySelector(`[data-ratio="${i}"]`).value) || 1 : c.ratio);
  const basisOf = (kind, c, i) => (kind === 'other' ? overlay.querySelector(`[data-basis="${i}"]`).value : c.rule.priceBasis);
  const repaintEcon = key => {
    const { kind, c, i } = cand(key);
    const qty = Number(overlay.querySelector(`[data-qty="${key}"]`).value) || 0;
    const e = Subs.subEconomics({ fromItem: item, toItem: c.item, qty, ratio: ratioOf(kind, c, i), priceBasis: basisOf(kind, c, i) });
    overlay.querySelector(`[data-econ="${key}"]`).innerHTML = econLine(e);
  };
  const onEdit = e => {
    const t = e.target;
    if (t.dataset.qty) repaintEcon(t.dataset.qty);
    if (t.dataset.ratio !== undefined) {
      const i = t.dataset.ratio, c = others[Number(i)];
      overlay.querySelector(`[data-qty="other-${i}"]`).value =
        Math.max(1, Math.min(Math.ceil(shortfall * (Number(t.value) || 1) - 1e-9), Math.floor(c.pool)));
      repaintEcon(`other-${i}`);
    }
    if (t.dataset.basis !== undefined) repaintEcon(`other-${t.dataset.basis}`);
  };
  overlay.addEventListener('input', onEdit);
  overlay.addEventListener('change', onEdit);
  overlay.addEventListener('click', e => {
    const use = e.target.closest('button[data-use]');
    if (!use) return;
    const { kind, c, i } = cand(use.dataset.use);
    const qty = Math.min(Math.floor(Number(overlay.querySelector(`[data-qty="${use.dataset.use}"]`).value)), Math.floor(c.pool));
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (kind === 'approved') {
      stageSub({ line, itemId, cust, toItemId: c.toItemId, qty, ratio: c.ratio, rule: c.rule, scope: c.scope });
    } else {
      const ratio = ratioOf(kind, c, i);
      const own = rules.filter(r => r.customerId === cust.customerId && r.fromItemId === itemId);
      const rule = {
        ruleId: newRuleId(), fromItemId: itemId, toItemId: c.toItemId, customerId: cust.customerId,
        direction: 'OneWay', rank: own.length ? Math.max(...own.map(r => r.rank)) + 1 : 1,
        qtyRatio: ratio, priceBasis: basisOf(kind, c, i),
        validFrom: '', validTo: '', note: 'Approved in the proration planner',
      };
      draftRuleChange('Upsert', rule, DETAIL.substitutions || []);
      stageSub({ line, itemId, cust, toItemId: c.toItemId, qty, ratio, rule: { ...rule, pending: true }, scope: 'Customer' });
    }
    close();
    renderItems();
  });
}

// ---- Auto-substitute --------------------------------------------------------
// One click: every short line (after proration and anything already staged)
// is filled from that customer's approved substitutes, P1 customers first,
// within what each substitute has left. Prorates first if nothing has been.

let AUTO_NOTE = null;

async function autoSubstituteAll() {
  if (!Object.keys(PRORATIONS).length) await prorateAll();
  const prorated = Object.values(PRORATIONS);
  if (!prorated.length) return;
  const shortLines = prorated.flatMap(p => p.lines.map(l => ({
    salesId: l.salesId, lineNum: l.lineNum, itemId: p.itemId, customerId: l.customerId, shortfall: lineShortfall(l),
  })));
  const pools = Object.fromEntries(DETAIL.items.map(i => [i.itemId, poolFor(i)]));
  const rules = detailRules();
  const res = Subs.autoSubstitute({ shortLines, customers: detailCustomers(), rules, pools, asOf: DETAIL.asOf });

  for (const s of res.staged) {
    const line = PRORATIONS[s.fromItemId].lines.find(l => l.salesId === s.salesId && l.lineNum === s.lineNum);
    const rule = rules.find(r => r.ruleId === s.ruleId);
    stageSub({ line, itemId: s.fromItemId, cust: custFor(s.customerId), toItemId: s.toItemId, qty: s.qty, ratio: s.ratio, rule, scope: s.scope });
  }
  AUTO_NOTE = res;
  renderItems();
}

function renderAutoNote() {
  const el = document.getElementById('autosub-note');
  if (!el) return;
  const r = AUTO_NOTE;
  if (!r) { el.innerHTML = ''; return; }
  const names = reason => [...new Set(r.skipped.filter(s => s.reason === reason).map(s => custFor(s.line.customerId).name))];
  const never = names('never'), noRule = names('no-rule'), stock = r.skipped.filter(s => s.reason === 'stock').length;
  const bits = [];
  if (never.length) bits.push(`never substitute: ${never.map(esc).join(', ')}`);
  if (noRule.length) bits.push(`no applicable rule: ${noRule.map(esc).join(', ')}`);
  if (stock) bits.push(`${stock} line${stock === 1 ? '' : 's'} ran out of substitute stock`);
  el.innerHTML = `
    <div class="autosub-note">
      <div>
        ${r.shortQty ? `<strong>Auto-substitute staged ${fmt(r.staged.length)} line${r.staged.length === 1 ? '' : 's'}</strong>
        · covers ${fmt(r.coveredQty)} of ${fmt(r.shortQty)} short cases (${pct(r.coveredQty / r.shortQty)})` : '<strong>No short lines left to substitute.</strong>'}
        ${bits.length ? `<div class="muted">Left short — ${bits.join(' · ')}</div>` : ''}
      </div>
      <button class="ghost" id="autosub-dismiss" aria-label="Dismiss">×</button>
    </div>`;
}

function renderSubs() {
  const el = document.getElementById('subs');
  if (!el) return;
  renderAutoNote();
  if (!SUBSTITUTIONS.length) { el.innerHTML = ''; return; }
  const econ = SUBSTITUTIONS.map(econFor);
  const priced = econ.filter(Boolean);
  const tot = priced.reduce((t, e) => ({ revenue: t.revenue + e.revenue, margin: t.margin + e.margin, base: t.base + e.baselineMargin, baseRev: t.baseRev + e.baselineRevenue }),
    { revenue: 0, margin: 0, base: 0, baseRev: 0 });
  const pendingRules = new Set(SUBSTITUTIONS.filter(s => s.pending).map(s => s.ruleId)).size;
  el.innerHTML = `
    <div class="item-card">
      <header>
        <div>
          <h3>Staged substitutions</h3>
          <div class="meta">Sent as an <code>rsmSalesSubstituteAcceleratorMessage</code> batch on approval${pendingRules ? `, after the ${pendingRules} pending rule${pendingRules === 1 ? '' : 's'} or group${pendingRules === 1 ? '' : 's'} it relies on` : ''}. D365 reduces each ordered line and adds the substitute line.</div>
        </div>
        <div class="item-card__actions"><button class="ghost" data-unsub-all>Clear all</button></div>
      </header>
      <table class="grid">
        <thead><tr><th>SO / Line</th><th>Customer</th><th>Ordered</th><th>Substitute</th><th class="num">Cases</th><th class="num">Covers</th><th>Rule</th><th>Bill at</th><th class="num">Revenue</th><th class="num">Margin</th><th></th></tr></thead>
        <tbody>
          ${SUBSTITUTIONS.map((s, i) => `
            <tr>
              <td class="nowrap">${esc(s.salesId)} / ${esc(s.lineNum)}</td>
              <td>${esc(s.customerName)}</td>
              <td title="${esc(s.fromItemId)}">${esc(s.fromName)}</td>
              <td title="${esc(s.toItemId)}">${esc(s.toName)}</td>
              <td class="num">${fmt(s.qty)}</td>
              <td class="num">${fmt(s.covered)}</td>
              <td>${scopeChip(s.ruleId ? { ruleId: s.ruleId, pending: s.pending, customerId: s.scope === 'Customer' ? s.customerId : '', groupName: s.groupName } : null, s.scope)}</td>
              <td class="nowrap">${s.priceBasis === 'Substitute' ? 'Substitute' : 'Ordered item'}</td>
              <td class="num">${money(econ[i]?.revenue)}</td>
              <td class="num nowrap">${marginCell(econ[i])}</td>
              <td><button class="ghost" data-unsub="${i}">Remove</button></td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <th colspan="4">${fmt(SUBSTITUTIONS.length)} substitution${SUBSTITUTIONS.length === 1 ? '' : 's'}</th>
          <th class="num">${fmt(SUBSTITUTIONS.reduce((t, s) => t + s.qty, 0))}</th>
          <th class="num">${fmt(SUBSTITUTIONS.reduce((t, s) => t + s.covered, 0))}</th>
          <th colspan="2"></th>
          <th class="num">${priced.length ? money(tot.revenue) : '—'}</th>
          <th class="num">${priced.length ? marginCell({ marginPct: tot.revenue ? tot.margin / tot.revenue : 0, baselineMargin: tot.base, baselineRevenue: tot.baseRev }) : '—'}</th>
          <th></th>
        </tr></tfoot>
      </table>
    </div>`;
}

function currentStrategy() {
  return {
    strategy: document.getElementById('pp-strategy').value,
    alpha: parseFloat(document.getElementById('pp-alpha').value),
  };
}

async function prorateItem(itemId, btn) {
  const { strategy, alpha } = currentStrategy();
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    PRORATIONS[itemId] = await jpost('/api/prorate', { strategy, itemId, alpha });
    noteHistoryDegraded(PRORATIONS[itemId]);
    renderItems();
  } catch (err) {
    alert(`Proration failed for ${itemId}: ${err.message}`);
    renderItems();
  }
}

// R-11: History-Aware silently degrades to Weighted when the D365 feed has no
// fill-rate history — say so instead of letting planners assume otherwise.
function noteHistoryDegraded(result) {
  const wrap = document.getElementById('pp-controls');
  if (!wrap) return;
  let note = document.getElementById('ha-note');
  const degraded = result && result.strategy === 'HistoryAware' && result.historyAvailable === false;
  if (degraded && !note) {
    note = document.createElement('div');
    note.id = 'ha-note';
    note.className = 'muted';
    note.textContent = 'No fill-rate history in the D365 feed yet — History-Aware ran as Weighted.';
    wrap.appendChild(note);
  } else if (!degraded && note) {
    note.remove();
  }
}

async function prorateAll() {
  const { strategy, alpha } = currentStrategy();
  const targets = DETAIL.items.filter(it => it.demand.length);
  if (!targets.length) return;

  const btn = document.getElementById('pp-run-all');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = `Prorating ${targets.length} items…`;
  try {
    const results = await Promise.all(
      targets.map(it => jpost('/api/prorate', { strategy, itemId: it.itemId, alpha })));
    targets.forEach((it, i) => { PRORATIONS[it.itemId] = results[i]; });
    noteHistoryDegraded(results[0]);
    renderItems();
  } catch (err) {
    alert(`Prorate all failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function onAllocEdit(e) {
  if (!e.target.classList.contains('alloc-input')) return;
  const itemId = e.target.dataset.item;
  const pr = PRORATIONS[itemId];
  const line = pr.lines.find(l => lineKey(l) === e.target.dataset.key);
  if (!line) return;

  let v = Number(e.target.value);
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v > line.requestedQty) { v = line.requestedQty; e.target.value = v; }
  line.allocatedQty = v;

  const row = e.target.closest('tr');
  row.querySelector('.fill-cell').textContent = pct(line.requestedQty ? v / line.requestedQty : 0);

  // Live remaining-inventory chip: green when units were freed up, red when
  // the item is promised beyond available supply.
  const chip = document.querySelector(`[data-rem="${CSS.escape(itemId)}"]`);
  if (chip) chip.outerHTML = remainingChip(itemId);

  updateSummary();
}

function updateSummary() {
  const prorated = Object.values(PRORATIONS);
  const lines = prorated.flatMap(p => p.lines).filter(l => Number(l.allocatedQty) > 0);
  const allocated = lines.reduce((s, l) => s + Number(l.allocatedQty), 0);
  const requested = prorated.reduce((s, p) => s + p.totalRequested, 0);

  const summary = document.getElementById('pp-summary');
  const covered = SUBSTITUTIONS.reduce((t, s) => t + (Number(s.covered) || 0), 0);
  const subNote = SUBSTITUTIONS.length ? ` · ${SUBSTITUTIONS.length} substitution(s) covering ${fmt(covered)}` : '';
  summary.textContent = prorated.length
    ? `${prorated.length} of ${DETAIL.items.length} items prorated · ${fmt(allocated)} of ${fmt(requested)} allocated${subNote}`
    : '';

  const approve = document.getElementById('pp-approve');
  const nothing = lines.length === 0 && SUBSTITUTIONS.length === 0;
  approve.classList.toggle('hidden', nothing);
  approve.textContent = nothing ? 'Approve & Send to D365'
    : `Approve & Send ${lines.length} line(s)${SUBSTITUTIONS.length ? ` + ${SUBSTITUTIONS.length} sub(s)` : ''} to D365`;
}

async function approveBatch() {
  const lines = Object.values(PRORATIONS)
    .flatMap(p => p.lines)
    .filter(l => Number(l.allocatedQty) > 0)
    .map(l => ({ salesId: l.salesId, lineNum: l.lineNum, itemId: l.itemId, allocatedQty: l.allocatedQty }));

  // remainingOriginalQty is computed at SEND time from the line's current
  // allocation, so later edits to allocations stay consistent with the sub.
  const subs = SUBSTITUTIONS.map(s => {
    const line = PRORATIONS[s.fromItemId]?.lines.find(l => lineKey(l) === `${s.salesId}:${s.lineNum}`);
    return {
      salesId: s.salesId, lineNum: s.lineNum,
      fromItemId: s.fromItemId, toItemId: s.toItemId,
      qty: s.qty,
      remainingOriginalQty: Number(line?.allocatedQty) || 0,
    };
  });
  const drafts = loadSubDrafts();
  const draftN = subDraftCount(drafts);

  if (lines.length === 0 && subs.length === 0) { alert('Nothing to send.'); return; }

  // Warn (but allow) sending while an item is over-allocated.
  const over = Object.keys(PRORATIONS).filter(id => remainingFor(id) < 0);
  if (over.length && !confirm(
    `${over.length} item(s) are over-allocated (red). Send anyway?`)) return;

  // Substitutions that rely on a rule approved here need that rule in D365
  // first, or RSMSubstitutionConsumer rejects them ("No active substitution rule").
  const needsRules = SUBSTITUTIONS.some(s => s.pending);
  if (draftN && !confirm(
    `${draftN} unpublished substitution rule/policy change(s) go to D365 first` +
    `${needsRules ? ' — staged substitutions depend on them' : ''}. Continue?`)) return;

  const btn = document.getElementById('pp-approve');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Sending…';

  const results = [];
  try {
    if (draftN) {
      const r = await publishSubDrafts();
      results.push({ result: r });
      if (!r.ok) throw Object.assign(new Error(r.error || 'Rule publish failed'), { partial: true });
    }
    if (lines.length) results.push({ result: await jpost('/api/prorate/send', { lines, strategy: currentStrategy().strategy, commodityId: DETAIL.commodity.id }) });
    if (subs.length) results.push({ result: await jpost('/api/substitute/send', { substitutions: subs }) });
    PRORATIONS = {}; SUBSTITUTIONS = []; AUTO_NOTE = null;
    showSendResult(results, { doneHref: 'index.html#batches', doneLabel: 'Back to overview' });
  } catch (err) {
    if (results.length) showSendResult(results, { title: 'Sent with errors' });
    else alert(`Send failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
