// Per-deployment, NON-SECRET front-end configuration.
//
// Environment-aware: on localhost the app talks to the local Express server
// on the same origin with no sign-in (unchanged dev experience). Anywhere
// else (the GitHub Pages site) it signs in with Entra ID and calls the Azure
// Functions API. The ids below are public identifiers — safe to commit; the
// D365 client SECRET only ever lives in .env / Function App settings.

(function () {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  window.APP_CONFIG = isLocal ? {
    apiBase: '',                       // same-origin local Express server
    auth: { tenantId: '', clientId: '', apiScope: '' },  // sign-in disabled
  } : {
    apiBase: 'https://prorate-fn-wmv50.azurewebsites.net',
    auth: {
      tenantId: '2dc13492-37f4-46a1-9e46-309ec01a7d60',
      clientId: '162a0065-8d4e-4c6b-be83-e911e3904a68',
      // Full scope URI (api://<clientId>/<scope>)
      apiScope: 'api://162a0065-8d4e-4c6b-be83-e911e3904a68/access_as_user',
    },
  };
})();
