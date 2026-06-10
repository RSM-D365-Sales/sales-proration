// Shared app shell + white-label branding.
//
// Every page calls `await initShell({ active })`. This:
//   1. loads branding from /api/branding,
//   2. applies the skin (data-theme) and brand colors (CSS variables),
//   3. renders the sidebar (logo / wordmark + nav) into <aside id="sidebar">.
// Pages then fill <header id="pagehead"> via setPageHead().
//
// Rebrand for a customer by editing server/data/branding.json (or using
// Setup > Branding). Nothing here is hard-coded per customer.

window.BRANDING = null;

const NAV_ICONS = {
  plan: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  customers: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  batches: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"/>',
  setup: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8z"/><path d="M19 12a7 7 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.9-1.1L14.5 2h-5l-.3 2.7a7 7 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6A7 7 0 003 12c0 .4 0 .7.1 1.1l-2 1.6 2 3.4 2.4-1c.6.5 1.2.8 1.9 1.1L9.5 22h5l.3-2.7c.7-.3 1.3-.6 1.9-1.1l2.4 1 2-3.4-2-1.6c0-.4.1-.7.1-1.1z"/>',
};

function navIcon(name) {
  const fill = name === 'plan' ? 'fill' : 'stroke';
  return `<svg class="ic" viewBox="0 0 24 24" ${fill}="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" ${fill === 'stroke' ? 'fill="none"' : ''}>${NAV_ICONS[name]}</svg>`;
}

function initials(name) {
  return (name || 'SP').split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'SP';
}

function escAttr(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Apply brand colors + skin to the document. Safe to call repeatedly. */
function applyBranding(b) {
  window.BRANDING = b;
  const root = document.documentElement;
  root.dataset.theme = b.theme || 'editorial';
  if (b.colors?.accent) root.style.setProperty('--accent', b.colors.accent);
  if (b.colors?.sidebar) root.style.setProperty('--sidebar-bg', b.colors.sidebar);
  const base = document.title.includes('—') ? document.title.split('—').pop().trim() : document.title;
  document.title = `${b.brandName} — ${base}`;
}

async function loadBranding() {
  if (window.BRANDING) return window.BRANDING;
  try {
    const r = await window.AUTH.fetch('/api/branding');
    if (r.ok) return r.json();
  } catch { /* fall back to defaults below */ }
  return { brandName: 'Sales Proration', tagline: 'Proration Accelerator', logo: null, theme: 'editorial', colors: {} };
}

function brandMark(b) {
  if (b.logo) return `<span class="brand__logo"><img src="${escAttr(b.logo)}" alt="${escAttr(b.brandName)} logo"></span>`;
  return `<span class="brand__mark">${escAttr(initials(b.brandName))}</span>`;
}

function renderSidebar(b, active) {
  const item = (key, label, href) =>
    `<a class="nav__item ${active === key ? 'is-active' : ''}" href="${href}">${navIcon(key)}<span>${label}</span></a>`;
  const acct = window.AUTH?.account();
  const userHtml = acct ? `
    <div class="nav__user">
      <span class="nav__user-name" title="${escAttr(acct.username)}">${escAttr(acct.name)}</span>
      <button class="nav__signout" type="button" onclick="AUTH.signOut()">Sign out</button>
    </div>` : '';
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="index.html">
      ${brandMark(b)}
      <span>
        <span class="brand__name">${escAttr(b.brandName)}</span>
        <span class="brand__tag">${escAttr(b.tagline)}</span>
      </span>
    </a>
    <nav class="nav">
      ${item('plan', 'Commodities', 'index.html')}
      ${item('customers', 'Customers', 'customers.html')}
      ${item('batches', 'Batches', 'index.html#batches')}
      ${item('setup', 'Setup', 'setup.html')}
    </nav>
    <span class="nav__spacer"></span>
    ${userHtml}
    <div class="nav__foot">D365 F&amp;SCM companion</div>
  `;
}

/** Set the page header (title + optional sub/crumb HTML + right-aligned actions HTML). */
function setPageHead({ title, sub, crumbHtml, actionsHtml } = {}) {
  const el = document.getElementById('pagehead');
  if (!el) return;
  el.innerHTML = `
    <div class="pagehead__inner">
      <div>
        ${crumbHtml ? `<div class="pagehead__crumb">${crumbHtml}</div>` : ''}
        <h1>${escAttr(title || '')}</h1>
        ${sub ? `<div class="sub">${escAttr(sub)}</div>` : ''}
      </div>
      ${actionsHtml ? `<div class="spacer">${actionsHtml}</div>` : ''}
    </div>`;
}

async function initShell({ active } = {}) {
  await window.AUTH.ensureSignedIn(); // no-op when auth isn't configured
  const b = await loadBranding();
  applyBranding(b);
  renderSidebar(b, active);
  return b;
}

window.initShell = initShell;
window.setPageHead = setPageHead;
window.applyBranding = applyBranding;
window.renderSidebar = renderSidebar;
