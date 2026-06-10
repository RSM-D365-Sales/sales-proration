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

// ---- Landing --------------------------------------------------------------
async function renderLanding() {
  try { await initShell({ active: 'plan' }); } catch (e) { console.error('[shell]', e); }
  setPageHead({ title: 'Planning overview', sub: 'Demand vs. available supply across all commodities' });

  let rows;
  try {
    rows = await jget('/api/commodities');
  } catch (err) {
    showLoadError('cards', err, renderLanding);
    return;
  }

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

  document.getElementById('cards').innerHTML = rows.map(commodityCard).join('');

  // Batches are best-effort — a failure here must not blank the page.
  try {
    const batches = await jget('/api/batches');
    const btbody = document.querySelector('#batch-table tbody');
    btbody.innerHTML = batches.length
      ? batches.slice().reverse().map(b => {
          const body = b.body || {};
          return `
            <tr>
              <td><code>${esc(String(body.batchId || '').slice(0, 8) || '—')}</code></td>
              <td>${esc(body.strategy || '')}</td>
              <td>${esc(body.commodityId || '')}</td>
              <td class="num">${Array.isArray(body.lines) ? body.lines.length : 0}</td>
              <td class="muted">${esc(b.enqueuedUtc || '')}</td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="5" class="muted">No batches sent yet.</td></tr>`;
  } catch (err) {
    console.error('[batches]', err);
    document.querySelector('#batch-table tbody').innerHTML =
      `<tr><td colspan="5" class="muted">Couldn’t load batches (${esc(err.message)}).</td></tr>`;
  }
}

function commodityCard(r) {
  const st = STATUS[r.status] || STATUS.OK;
  const fillW = Math.min(100, Math.max(0, r.fillRate * 100));
  return `
    <button class="card" style="--card-tint:${commodityTint(r)}"
            onclick="location.href='commodity.html?id=${encodeURIComponent(r.id)}'">
      <div class="card__media">
        <span class="card__status"><span class="chip ${r.status}">${st.label}</span></span>
        <img src="${commodityIconUrl(r)}" alt="${esc(r.name)}" loading="lazy"
             onerror="this.onerror=null;this.src='img/commodities/_fallback.svg'">
      </div>
      <div class="card__body">
        <div class="card__title">${esc(r.name)}</div>
        <div class="card__desc">${esc(r.description || '')}</div>
        <div class="meter ${st.meter}"><i style="width:${fillW}%"></i></div>
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
  } catch (err) {
    showLoadError('cust-wrap', err, renderCustomers);
    return;
  }

  const withOrders = CUSTOMERS.filter(c => c.openLines > 0);
  const needing = CUSTOMERS.filter(c => c.needsProration);
  document.getElementById('kpis').innerHTML = `
    ${kpi('Customers', CUSTOMERS.length)}
    ${kpi('With open demand', withOrders.length, `${fmt(CUSTOMERS.reduce((s, c) => s + c.openLines, 0))} open lines`)}
    ${kpi('Total requested', fmt(CUSTOMERS.reduce((s, c) => s + c.requestedQty, 0)))}
    ${kpi('Need proration', needing.length, needing.length ? 'demand on short items' : 'all covered', true)}
  `;

  ['cf-search', 'cf-priority', 'cf-needs'].forEach(id =>
    document.getElementById(id).addEventListener('input', renderCustomerRows));

  document.querySelectorAll('#cust-table th[data-sort]').forEach(th =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      CUST_SORT = { key, dir: CUST_SORT.key === key ? -CUST_SORT.dir : 1 };
      renderCustomerRows();
    }));

  renderCustomerRows();
}

function customerComparator(a, b) {
  const { key, dir } = CUST_SORT;
  const val = c => {
    switch (key) {
      case 'name':     return String(c.name).toLowerCase();
      case 'location': return `${c.state} ${c.city}`.trim().toLowerCase();
      // needs proration first, then covered, then no open demand
      case 'status':   return c.needsProration ? 0 : (c.openLines > 0 ? 1 : 2);
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
        </tr>`).join('')
    : `<tr><td colspan="7" class="muted">No customers match the current filters.</td></tr>`;
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

async function renderDetail() {
  try { await initShell({ active: 'plan' }); } catch (e) { console.error('[shell]', e); }
  const id = qs('id');
  if (!id) { location.href = 'index.html'; return; }
  try {
    DETAIL = await jget('/api/commodities/' + encodeURIComponent(id));
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

  PRORATIONS = {};
  renderItems();

  document.getElementById('pp-strategy').addEventListener('change', e => {
    document.getElementById('pp-alpha-wrap').classList.toggle('hidden', e.target.value !== 'HistoryAware');
  });
  document.getElementById('pp-run-all').addEventListener('click', prorateAll);
  document.getElementById('pp-approve').addEventListener('click', approveBatch);

  // Delegated handlers survive re-renders of #items.
  const items = document.getElementById('items');
  items.addEventListener('click', e => {
    const btn = e.target.closest('button[data-prorate]');
    if (btn) prorateItem(btn.dataset.prorate, btn);
  });
  items.addEventListener('input', onAllocEdit);

  // Deep link: commodity.html?id=…&prorate=all runs the default strategy
  // across every item on load — handy for demos.
  if (qs('prorate') === 'all') prorateAll();
}

function renderItems() {
  document.getElementById('items').innerHTML = DETAIL.items.map(itemCard).join('');
  updateSummary();
}

function lineKey(l) { return `${l.salesId}:${l.lineNum}`; }

function itemCard(it) {
  const pr = PRORATIONS[it.itemId];
  const byKey = pr ? Object.fromEntries(pr.lines.map(l => [lineKey(l), l])) : {};

  const extraHead = pr
    ? `<th class="num">Allocated</th><th class="num">Fill %</th><th class="num">Weight</th>` : '';

  const demandRows = it.demand.length
    ? it.demand.map(d => {
        let extra = '';
        if (pr) {
          const l = byKey[lineKey(d)];
          extra = l ? `
            <td class="num"><input type="number" class="alloc-input" min="0" max="${l.requestedQty}" step="1"
                 value="${l.allocatedQty}" data-item="${esc(it.itemId)}" data-key="${esc(lineKey(l))}" /></td>
            <td class="num fill-cell">${pct(l.requestedQty ? l.allocatedQty / l.requestedQty : 0)}</td>
            <td class="num">${l.weightUsed.toFixed(2)}</td>`
            : `<td class="num muted" colspan="3">—</td>`;
        }
        return `
        <tr>
          <td>${esc(d.salesId)} / ${esc(d.lineNum)}</td>
          <td>${esc(d.customerName)} <span class="muted">(P${esc(d.priority)})</span></td>
          <td>${esc(d.siteId)}</td>
          <td>${esc(d.warehouseId)}</td>
          <td>${esc(d.requestedShipDate)}</td>
          <td class="num">${fmt(d.requestedQty)}</td>
          ${extra}
        </tr>`;
      }).join('')
    : `<tr><td colspan="${pr ? 9 : 6}" class="muted">No open demand.</td></tr>`;

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

/** Inventory still on the table for an item = available − sum(allocated). */
function remainingFor(itemId) {
  const pr = PRORATIONS[itemId];
  return pr.available - pr.lines.reduce((s, l) => s + (Number(l.allocatedQty) || 0), 0);
}

function remainingChip(itemId) {
  const rem = remainingFor(itemId);
  const cls = rem > 0 ? 'OK' : rem < 0 ? 'Short' : 'plain';
  const label = rem > 0 ? `+${fmt(rem)} to allocate`
              : rem < 0 ? `${fmt(rem)} over-allocated`
              : 'fully allocated';
  return `<span class="chip ${cls}" data-rem="${esc(itemId)}" title="Available ${fmt(PRORATIONS[itemId].available)} − allocated">${label}</span>`;
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
    renderItems();
  } catch (err) {
    alert(`Proration failed for ${itemId}: ${err.message}`);
    renderItems();
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
  summary.textContent = prorated.length
    ? `${prorated.length} of ${DETAIL.items.length} items prorated · ${fmt(allocated)} of ${fmt(requested)} allocated`
    : '';

  const approve = document.getElementById('pp-approve');
  approve.classList.toggle('hidden', lines.length === 0);
  approve.textContent = lines.length ? `Approve & Send ${lines.length} line(s) to D365` : 'Approve & Send to D365';
}

async function approveBatch() {
  const lines = Object.values(PRORATIONS)
    .flatMap(p => p.lines)
    .filter(l => Number(l.allocatedQty) > 0)
    .map(l => ({ salesId: l.salesId, lineNum: l.lineNum, itemId: l.itemId, allocatedQty: l.allocatedQty }));

  if (lines.length === 0) { alert('Nothing to send — no line has an allocated quantity.'); return; }

  // Warn (but allow) sending while an item is over-allocated.
  const over = Object.keys(PRORATIONS).filter(id => remainingFor(id) < 0);
  if (over.length && !confirm(
    `${over.length} item(s) are over-allocated (red). Send anyway?`)) return;

  const btn = document.getElementById('pp-approve');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = `Sending batch (${lines.length} lines)…`;

  try {
    const r = await jpost('/api/prorate/send', { lines });
    alert(`Sent batch ${String(r.batchId).slice(0, 8)} (${r.recordCount} line(s)) to D365 message queue 'rsmSalesProrateAccelerator'.`);
    location.href = 'index.html';
  } catch (err) {
    alert(`Send failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
