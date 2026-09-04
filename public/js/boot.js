// Page dispatch — lives in a file (not an inline <script>) so the CSP can
// keep script-src at 'self' with no 'unsafe-inline' (SF-04). Loaded last on
// every page; calls the page's render function from app.js / setup.js.
(function () {
  // Cloudflare Pages 308-redirects "customers.html" to "/customers", so the
  // last path segment arrives with or without ".html" depending on the host —
  // dispatch on the extensionless name.
  const page = (location.pathname.split('/').pop() || 'index')
    .toLowerCase().replace(/\.html$/, '');
  const boot = {
    'index': () => renderLanding(),
    '': () => renderLanding(),
    'commodity': () => renderDetail(),
    'customers': () => renderCustomers(),
    'setup': () => renderSetup(),
  }[page];
  if (boot) boot();
})();
