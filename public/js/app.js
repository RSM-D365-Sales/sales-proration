// ---- shared helpers -------------------------------------------------------
// All API calls go through AUTH.fetch (auth.js): it prefixes the configured
// API base URL and attaches the Entra bearer token when sign-in is enabled.
async function jget(url) { const r = await AUTH.fetch(url); if (!r.ok) throw new Error(r.statusText); return r.json(); }
async function jpost(url, body) {
  const r = await AUTH.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
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
            onclick="location.href='/commodity.html?id=${encodeURIComponent(r.id)}'">
      <div class="card__media">
        <span class="card__status"><span class="chip ${r.status}">${st.label}</span></span>
        <img src="${commodityIconUrl(r)}" alt="${esc(r.name)}" loading="lazy"
             onerror="this.onerror=null;this.src='/img/commodities/_fallback.svg'">
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

// ---- Detail ---------------------------------------------------------------
let DETAIL = null;          // loaded commodity payload
let CURRENT_ITEM = null;    // item the user is prorating
let CURRENT_RESULTS = null; // last proration response

async function renderDetail() {
  try { await initShell({ active: 'plan' }); } catch (e) { console.error('[shell]', e); }
  const id = qs('id');
  if (!id) { location.href = '/'; return; }
  try {
    DETAIL = await jget('/api/commodities/' + encodeURIComponent(id));
  } catch (err) {
    setPageHead({ title: 'Commodity', crumbHtml: `<a href="/">Commodities</a>` });
    showLoadError('items', err, renderDetail);
    return;
  }

  const c = DETAIL.commodity;
  setPageHead({
    title: c.name,
    sub: c.description || '',
    crumbHtml: `<a href="/">Commodities</a> <span>›</span> <span>${esc(c.name)}</span>`,
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

  document.getElementById('items').innerHTML = DETAIL.items.map(itemCard).join('');

  document.getElementById('pp-strategy').addEventListener('change', e => {
    document.getElementById('pp-alpha-wrap').classList.toggle('hidden', e.target.value !== 'HistoryAware');
  });
  document.getElementById('pp-run').addEventListener('click', runProration);
  document.getElementById('pp-approve').addEventListener('click', approveBatch);
}

function itemCard(it) {
  const demandRows = it.demand.length
    ? it.demand.map(d => `
        <tr>
          <td>${esc(d.salesId)} / ${esc(d.lineNum)}</td>
          <td>${esc(d.customerName)} <span class="muted">(P${esc(d.priority)})</span></td>
          <td>${esc(d.siteId)}</td>
          <td>${esc(d.warehouseId)}</td>
          <td>${esc(d.requestedShipDate)}</td>
          <td class="num">${fmt(d.requestedQty)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="muted">No open demand.</td></tr>`;
  const fill = it.totalDemand ? it.totalSupply / it.totalDemand : 1;
  return `
    <div class="item-card">
      <header>
        <div>
          <h3><img class="thumb" src="${commodityIconUrl(DETAIL.commodity)}" alt="">${esc(it.name)}</h3>
          <div class="meta">${esc(it.itemId)} · Demand ${fmt(it.totalDemand)} · Supply ${fmt(it.totalSupply)} · Fill ${pct(fill)}</div>
        </div>
        <button onclick="openProrate('${esc(it.itemId)}')">Run Proration</button>
      </header>
      <table class="grid">
        <thead><tr><th>SO / Line</th><th>Customer</th><th>Site</th><th>WH</th><th>Req. Ship</th><th class="num">Requested</th></tr></thead>
        <tbody>${demandRows}</tbody>
      </table>
    </div>`;
}

function openProrate(itemId) {
  CURRENT_ITEM = DETAIL.items.find(i => i.itemId === itemId);
  CURRENT_RESULTS = null;
  document.getElementById('prorate-panel').classList.remove('hidden');
  document.getElementById('pp-item').textContent = `${CURRENT_ITEM.name} (${CURRENT_ITEM.itemId})`;
  document.getElementById('pp-results').classList.add('hidden');
  document.getElementById('pp-actions').style.display = 'none';
  document.getElementById('prorate-panel').scrollIntoView({ behavior: 'smooth' });
}

async function runProration() {
  if (!CURRENT_ITEM) return;
  const strategy = document.getElementById('pp-strategy').value;
  const alpha = parseFloat(document.getElementById('pp-alpha').value);
  const body = { strategy, itemId: CURRENT_ITEM.itemId, alpha };
  const res = await jpost('/api/prorate', body);
  CURRENT_RESULTS = res;

  const tbody = document.querySelector('#pp-results tbody');
  tbody.innerHTML = res.lines.map((l, idx) => {
    const cust = DETAIL.items.flatMap(i => i.demand).find(d => d.salesId === l.salesId && d.lineNum === l.lineNum);
    const name = cust ? `${cust.customerName} (P${cust.priority})` : l.customerId;
    const fill = l.requestedQty ? l.allocatedQty / l.requestedQty : 0;
    return `<tr data-idx="${idx}">
      <td>${esc(l.salesId)} / ${esc(l.lineNum)}</td>
      <td>${esc(name)}</td>
      <td>${esc(l.siteId)}</td>
      <td>${esc(l.warehouseId)}</td>
      <td class="num">${fmt(l.requestedQty)}</td>
      <td class="num"><input type="number" class="alloc-input" min="0" max="${l.requestedQty}" step="1" value="${l.allocatedQty}" data-idx="${idx}" /></td>
      <td class="num fill-cell">${pct(fill)}</td>
      <td class="num">${l.weightUsed.toFixed(2)}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.alloc-input').forEach(inp => inp.addEventListener('input', onAllocEdit));
  updateProrationTotals();

  document.getElementById('pp-results').classList.remove('hidden');
  document.getElementById('pp-actions').style.display = 'flex';
}

function onAllocEdit(e) {
  const idx = Number(e.target.dataset.idx);
  const line = CURRENT_RESULTS.lines[idx];
  let v = Number(e.target.value);
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v > line.requestedQty) { v = line.requestedQty; e.target.value = v; }
  line.allocatedQty = v;
  const row = e.target.closest('tr');
  const fill = line.requestedQty ? v / line.requestedQty : 0;
  row.querySelector('.fill-cell').textContent = pct(fill);
  updateProrationTotals();
}

function updateProrationTotals() {
  const totalAllocated = CURRENT_RESULTS.lines.reduce((s, l) => s + (Number(l.allocatedQty) || 0), 0);
  CURRENT_RESULTS.totalAllocated = totalAllocated;
  document.getElementById('pp-req-total').textContent = fmt(CURRENT_RESULTS.totalRequested);
  document.getElementById('pp-alloc-total').textContent = fmt(totalAllocated);
  document.getElementById('pp-fill-total').textContent = pct(CURRENT_RESULTS.totalRequested ? totalAllocated / CURRENT_RESULTS.totalRequested : 0);
}

async function approveBatch() {
  if (!CURRENT_RESULTS) return;

  const lines = CURRENT_RESULTS.lines
    .filter(l => Number(l.allocatedQty) > 0)
    .map(l => ({ salesId: l.salesId, lineNum: l.lineNum, itemId: l.itemId, allocatedQty: l.allocatedQty }));

  if (lines.length === 0) { alert('Nothing to send — no line has an allocated quantity.'); return; }

  const btn = document.getElementById('pp-approve');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = `Sending batch (${lines.length} lines)…`;

  try {
    const r = await jpost('/api/prorate/send', { lines });
    alert(`Sent batch ${String(r.batchId).slice(0, 8)} (${r.recordCount} line(s)) to D365 message queue 'rsmSalesProrateAccelerator'.`);
    location.href = '/';
  } catch (err) {
    alert(`Send failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
