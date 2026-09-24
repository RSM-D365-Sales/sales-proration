// Pre-paint branding — loaded synchronously in <head> on every page, before
// the body renders. Applies the last branding the shell saw (cached in
// localStorage by shell.js) so the skin, colors and title are right on the
// very first frame; shell.js then re-fetches /api/branding and reconciles.
// Without this, every navigation flashed the default sidebar look until the
// sign-in + branding round-trip finished.
//
// A file (not inline) so the CSP can keep script-src at 'self'. Only
// whitelisted, pattern-checked values ever reach the DOM.
(function () {
  var KEY = 'spa.branding';
  var HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var THEME = /^[a-z][a-z0-9-]{0,30}$/;
  var b = null;
  try { b = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { b = null; }
  if (!b || typeof b !== 'object') return;
  var root = document.documentElement;
  if (THEME.test(b.theme || '')) root.dataset.theme = b.theme;
  var c = b.colors || {};
  if (HEX.test(c.accent || '')) root.style.setProperty('--accent', c.accent);
  if (HEX.test(c.sidebar || '')) root.style.setProperty('--sidebar-bg', c.sidebar);
  if (typeof b.brandName === 'string' && b.brandName) {
    document.title = b.brandName.slice(0, 60) + ' — ' + document.title;
  }
})();
