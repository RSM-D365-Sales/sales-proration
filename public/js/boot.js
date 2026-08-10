// Page dispatch — lives in a file (not an inline <script>) so the CSP can
// keep script-src at 'self' with no 'unsafe-inline' (SF-04). Loaded last on
// every page; calls the page's render function from app.js / setup.js.
(function () {
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const boot = {
    'index.html': () => renderLanding(),
    '': () => renderLanding(),
    'commodity.html': () => renderDetail(),
    'customers.html': () => renderCustomers(),
    'setup.html': () => renderSetup(),
  }[page];
  if (boot) boot();
})();
