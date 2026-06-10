// Per-deployment, NON-SECRET front-end configuration.
//
// Local development: leave everything blank — the page talks to the local
// Express server on the same origin with no sign-in.
//
// GitHub Pages deployment: set apiBase to your Azure Functions host and fill
// in the Entra app registration ids (these are public identifiers, safe to
// commit — the client SECRET never goes anywhere near the front-end).

window.APP_CONFIG = {
  // Where the API lives. '' = same origin (local Express server).
  apiBase: 'https://prorate-fn-wmv50.azurewebsites.net',

  auth: {
    // Entra Directory (tenant) ID. Empty = sign-in disabled (local dev).
    tenantId: '2dc13492-37f4-46a1-9e46-309ec01a7d60',
    // App registration "Application (client) ID" (SPA platform).
    clientId: '162a0065-8d4e-4c6b-be83-e911e3904a68',
    // Scope requested for API calls — must be the FULL URI (api://<clientId>/<scope>).
    // Empty = api://<clientId>/access_as_user
    apiScope: 'api://162a0065-8d4e-4c6b-be83-e911e3904a68/access_as_user',
  },
};
