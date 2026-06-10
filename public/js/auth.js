// Microsoft Entra ID sign-in (MSAL.js) + authenticated fetch.
//
// Reads window.APP_CONFIG (config.js). When auth.tenantId/clientId are empty,
// everything degrades to plain same-origin fetch with no sign-in — local dev
// is unchanged. When configured (the GitHub Pages deployment), users are
// redirected to Entra to sign in and every API call carries a bearer token.
//
// Public surface (used by shell.js / app.js / setup.js):
//   AUTH.ensureSignedIn()  -> resolves with the account (or null if disabled);
//                             redirects to Entra when sign-in is needed.
//   AUTH.fetch(path, opts) -> fetch with apiBase prefix + Authorization header.
//   AUTH.account()         -> { name, username } | null
//   AUTH.signOut()         -> redirect sign-out
//   AUTH.enabled           -> boolean

(function () {
  const cfg = window.APP_CONFIG || {};
  const apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
  const a = cfg.auth || {};
  const enabled = !!(a.tenantId && a.clientId);
  const scopes = [a.apiScope || `api://${a.clientId}/access_as_user`];

  let pca = null;       // msal.PublicClientApplication
  let ready = null;     // memoized init promise

  function apiUrl(path) { return apiBase + path; }

  async function init() {
    if (!enabled) return null;
    if (!window.msal) throw new Error('MSAL library failed to load');
    // Redirect to the site's directory (e.g. https://www.rsmd365.com/sales-proration/
    // or http://localhost:5173/) so only ONE redirect URI per environment needs
    // registering; MSAL returns the user to the page they started on.
    const baseDir = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    pca = new window.msal.PublicClientApplication({
      auth: {
        clientId: a.clientId,
        authority: `https://login.microsoftonline.com/${a.tenantId}`,
        redirectUri: baseDir,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await pca.initialize();
    const result = await pca.handleRedirectPromise();
    if (result?.account) pca.setActiveAccount(result.account);
    if (!pca.getActiveAccount() && pca.getAllAccounts().length) {
      pca.setActiveAccount(pca.getAllAccounts()[0]);
    }
    return pca.getActiveAccount();
  }

  async function ensureSignedIn() {
    if (!enabled) return null;
    if (!ready) ready = init();
    const account = await ready;
    if (account) return account;
    await pca.loginRedirect({ scopes });
    return new Promise(() => {}); // navigating away — never resolves
  }

  async function getToken() {
    if (!enabled) return null;
    await ensureSignedIn();
    try {
      const r = await pca.acquireTokenSilent({ scopes, account: pca.getActiveAccount() });
      return r.accessToken;
    } catch {
      await pca.acquireTokenRedirect({ scopes });
      return new Promise(() => {});
    }
  }

  async function authFetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (enabled) headers.authorization = `Bearer ${await getToken()}`;
    return fetch(apiUrl(path), { ...opts, headers });
  }

  function account() {
    const acct = enabled && pca ? pca.getActiveAccount() : null;
    return acct ? { name: acct.name || acct.username, username: acct.username } : null;
  }

  function signOut() {
    if (enabled && pca) pca.logoutRedirect({ account: pca.getActiveAccount() });
  }

  window.AUTH = { ensureSignedIn, getToken, fetch: authFetch, apiUrl, account, signOut, enabled };
})();
