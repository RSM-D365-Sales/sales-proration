// Setup page — D365 connection profiles + white-label branding.
// Secrets are never sent here; each profile references a .env variable.

let STATE = { activeId: null, environments: [], defaults: {} };
let BRAND_DRAFT = null;  // working copy for the Branding tab (preview before save)
let BRAND_SAVED = null;  // last persisted branding, for Revert

async function jget(url) { const r = await AUTH.fetch(url); if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`); return r.json(); }
async function jsend(method, url, body) {
  const r = await AUTH.fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText || `HTTP ${r.status}`);
  return data;
}

function banner(msg, kind = 'ok') {
  const el = document.getElementById('banner');
  el.className = `notice ${kind === 'bad' ? 'bad' : 'ok'}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function renderSetup() {
  await initShell({ active: 'setup' });
  setPageHead({ title: 'Setup', sub: 'Connection profiles and white-label branding' });
  wireTabs();
  await renderEnvironments();
  await loadBrandingTab();
}

// ---- Tabs -----------------------------------------------------------------
function wireTabs() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('is-active', x === t));
    document.getElementById('tab-env').classList.toggle('hidden', t.dataset.tab !== 'env');
    document.getElementById('tab-brand').classList.toggle('hidden', t.dataset.tab !== 'brand');
  }));
}

// ===== Environments ========================================================
async function renderEnvironments() {
  STATE = await jget('/api/setup/environments');
  const tbody = document.querySelector('#env-table tbody');
  const readOnly = !!STATE.readOnly;

  // Hosted mode: the API's D365 connection comes from Azure Function App
  // settings, so profiles can't be edited from the browser — show, don't edit.
  document.getElementById('btn-new').classList.toggle('hidden', readOnly);
  if (readOnly) {
    banner('Hosted mode — the D365 connection is managed in the Azure Function App’s ' +
      'environment variables (D365_*). Environment editing is available when running locally.');
  }

  if (!STATE.environments.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No environments yet. Click “New environment”.</td></tr>`;
  } else {
    tbody.innerHTML = STATE.environments.map(e => {
      const active = e.id === STATE.activeId;
      const secret = e.secretConfigured ? `<span class="chip OK">set</span>` : `<span class="chip Short">missing</span>`;
      const actions = readOnly ? '<span class="muted">managed in Azure</span>' : `
          ${active ? '' : `<button data-act="activate" data-id="${esc(e.id)}">Make active</button>`}
          <button data-act="edit" data-id="${esc(e.id)}">Edit</button>
          <button data-act="delete" data-id="${esc(e.id)}">Delete</button>`;
      return `<tr>
        <td>${active ? '<span class="chip OK">active</span>' : ''}</td>
        <td><strong>${esc(e.label)}</strong><div class="muted">${esc(e.id)}</div></td>
        <td>${esc(e.baseUrl) || '<span class="muted">—</span>'}</td>
        <td><code>${esc(e.company)}</code></td>
        <td>${secret} <code>${esc(e.secretEnvVar)}</code></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');
  }

  tbody.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.id));
  });
}

async function onAction(act, id) {
  const env = STATE.environments.find(e => e.id === id);
  try {
    if (act === 'activate') {
      await jsend('POST', '/api/setup/active', { id });
      banner(`Active environment: ${env.label}`);
      await renderEnvironments();
    } else if (act === 'delete') {
      if (!confirm(`Delete environment “${env.label}”?`)) return;
      await jsend('DELETE', '/api/setup/environments/' + encodeURIComponent(id));
      banner(`Deleted ${env.label}`);
      await renderEnvironments();
    } else if (act === 'edit') {
      openForm(env);
    }
  } catch (err) {
    banner(err.message, 'bad');
  }
}

function openForm(env) {
  const d = STATE.defaults || {};
  document.getElementById('edit-title').textContent = env ? `Edit “${env.label}”` : 'New environment';
  const v = (id, val) => { document.getElementById(id).value = val ?? ''; };
  v('f-id', env?.id);
  v('f-label', env?.label);
  v('f-baseUrl', env?.baseUrl);
  v('f-tenantId', env?.tenantId);
  v('f-clientId', env?.clientId);
  v('f-company', env?.company ?? d.company);
  v('f-secretEnvVar', env?.secretEnvVar ?? d.secretEnvVar);
  v('f-timeoutMs', env?.timeoutMs ?? d.timeoutMs);
  v('f-serviceGroup', env?.serviceGroup ?? d.serviceGroup);
  v('f-service', env?.service ?? d.service);
  v('f-operation', env?.operation ?? d.operation);
  v('f-scope', env?.scope);
  const p = document.getElementById('edit-panel');
  p.classList.remove('hidden');
  p.scrollIntoView({ behavior: 'smooth' });
}

function closeForm() { document.getElementById('edit-panel').classList.add('hidden'); }

async function saveForm() {
  const g = id => document.getElementById(id).value.trim();
  const body = {
    id: g('f-id') || undefined,
    label: g('f-label'), baseUrl: g('f-baseUrl'), tenantId: g('f-tenantId'), clientId: g('f-clientId'),
    company: g('f-company'), secretEnvVar: g('f-secretEnvVar'), timeoutMs: g('f-timeoutMs'),
    serviceGroup: g('f-serviceGroup'), service: g('f-service'), operation: g('f-operation'), scope: g('f-scope'),
  };
  if (!body.label) { banner('Label is required', 'bad'); return; }
  try {
    await jsend('POST', '/api/setup/environments', body);
    banner(`Saved ${body.label}`);
    closeForm();
    await renderEnvironments();
  } catch (err) {
    banner(err.message, 'bad');
  }
}

async function testConnection() {
  const btn = document.getElementById('btn-test');
  const box = document.getElementById('test-result');
  btn.disabled = true; btn.textContent = 'Testing…';
  try {
    const r = await jsend('POST', '/api/setup/test');
    box.className = `panel notice ${r.ok ? 'ok' : 'bad'}`;
    const counts = r.counts
      ? `${r.counts.commodities} commodities · ${r.counts.items} items · ${r.counts.demand} demand · ${r.counts.supply} supply · ${r.counts.customers} customers`
      : '';
    box.innerHTML = r.ok
      ? `<strong>✓ Connected</strong> to <code>${esc(r.environment)}</code> (company <code>${esc(r.company)}</code>)<br>
         <span class="muted">${esc(r.baseUrl)} · ${counts} · ${r.elapsedMs} ms</span>`
      : `<strong>✗ Failed</strong> for <code>${esc(r.environment || '(no active env)')}</code><br>
         <span class="muted">${esc(r.error)}</span>`;
    box.classList.remove('hidden');
  } catch (err) {
    banner(err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Test active connection';
  }
}

// ===== Branding ============================================================
async function loadBrandingTab() {
  BRAND_SAVED = await jget('/api/branding');
  BRAND_DRAFT = JSON.parse(JSON.stringify(BRAND_SAVED));
  fillBrandingForm(BRAND_DRAFT);
  if (STATE.readOnly) {
    // Hosted: branding ships with the deploy (server/data/branding.json in the
    // repo); the live preview still works, but persisting is local-only.
    const save = document.getElementById('b-save');
    save.disabled = true;
    save.title = 'Hosted mode — edit server/data/branding.json in the repo to change branding.';
  }
}

function fillBrandingForm(b) {
  document.getElementById('b-name').value = b.brandName || '';
  document.getElementById('b-tagline').value = b.tagline || '';
  document.getElementById('b-theme').value = b.theme || 'editorial';
  setColor('b-accent', b.colors?.accent || '#2f7d4f');
  setColor('b-sidebar', b.colors?.sidebar || '#14241c');
  renderLogoPreview(b.logo);
}

function setColor(id, hex) {
  document.getElementById(id).value = hex;
  document.getElementById(id + '-hex').value = hex;
}

function renderLogoPreview(logo) {
  const el = document.getElementById('b-logo-preview');
  el.innerHTML = logo ? `<img src="${esc(logo)}" alt="logo preview">` : '';
}

// Read current form -> draft, apply live preview to the sidebar.
function syncBrandingPreview() {
  BRAND_DRAFT.brandName = document.getElementById('b-name').value.trim() || 'Sales Proration';
  BRAND_DRAFT.tagline = document.getElementById('b-tagline').value.trim();
  BRAND_DRAFT.theme = document.getElementById('b-theme').value;
  BRAND_DRAFT.colors = {
    accent: document.getElementById('b-accent').value,
    sidebar: document.getElementById('b-sidebar').value,
  };
  applyBranding(BRAND_DRAFT);             // tokens + skin live
  renderSidebarFromDraft();               // re-render sidebar text/logo/colors
}

// Re-render the sidebar with the draft (shell.js owns the markup).
function renderSidebarFromDraft() {
  window.renderSidebar(BRAND_DRAFT, 'setup');
}

function bindColorPair(colorId) {
  const color = document.getElementById(colorId);
  const hex = document.getElementById(colorId + '-hex');
  color.addEventListener('input', () => { hex.value = color.value; syncBrandingPreview(); });
  hex.addEventListener('input', () => {
    const v = hex.value.trim();
    if (/^#([0-9a-fA-F]{6})$/.test(v)) { color.value = v; syncBrandingPreview(); }
  });
}

function onLogoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 400 * 1024) { banner('Logo is larger than 400 KB — please use a smaller/optimized image (SVG preferred).', 'bad'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    BRAND_DRAFT.logo = reader.result;          // data URL
    renderLogoPreview(BRAND_DRAFT.logo);
    syncBrandingPreview();
  };
  reader.readAsDataURL(file);
}

async function saveBranding() {
  syncBrandingPreview();
  try {
    BRAND_SAVED = await jsend('POST', '/api/branding', BRAND_DRAFT);
    BRAND_DRAFT = JSON.parse(JSON.stringify(BRAND_SAVED));
    fillBrandingForm(BRAND_DRAFT);
    applyBranding(BRAND_SAVED);
    renderSidebarFromDraft();
    banner('Branding saved.');
  } catch (err) {
    banner(err.message, 'bad');
  }
}

function revertBranding() {
  BRAND_DRAFT = JSON.parse(JSON.stringify(BRAND_SAVED));
  fillBrandingForm(BRAND_DRAFT);
  applyBranding(BRAND_DRAFT);
  renderSidebarFromDraft();
  banner('Reverted to last saved branding.');
}

// ---- wire up ---------------------------------------------------------------
document.getElementById('btn-new').addEventListener('click', () => openForm(null));
document.getElementById('btn-save').addEventListener('click', saveForm);
document.getElementById('btn-cancel').addEventListener('click', closeForm);
document.getElementById('btn-test').addEventListener('click', testConnection);

['b-name', 'b-tagline', 'b-theme'].forEach(id => document.getElementById(id).addEventListener('input', syncBrandingPreview));
bindColorPair('b-accent');
bindColorPair('b-sidebar');
document.getElementById('b-logo-file').addEventListener('change', onLogoFile);
document.getElementById('b-logo-clear').addEventListener('click', () => {
  BRAND_DRAFT.logo = null;
  document.getElementById('b-logo-file').value = '';
  renderLogoPreview(null);
  syncBrandingPreview();
});
document.getElementById('b-save').addEventListener('click', saveBranding);
document.getElementById('b-reset').addEventListener('click', revertBranding);
