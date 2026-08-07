// Microsoft Entra ID bearer-token validation, host-agnostic.
//
// Used by both the Express server (as middleware) and the Azure Functions app
// (via verifyBearer). Auth is OPT-IN: it activates only when AUTH_TENANT_ID
// and AUTH_CLIENT_ID are set (in .env locally, or Function App settings in
// Azure), so plain local development keeps working with no sign-in.
//
//   AUTH_TENANT_ID  Entra Directory (tenant) ID — single-tenant validation
//   AUTH_CLIENT_ID  App registration client ID. Accepted audiences are both
//                   <clientId> and api://<clientId> (v2 and v1 access tokens).

const { createRemoteJWKSet, jwtVerify } = require('jose');

// Entra app roles (values match the app registration's appRoles). Assigned
// per user under Enterprise applications → ProrationApp → Users and groups.
// The enterprise app has "assignment required" ON, so every valid token
// carries at least one of these in its `roles` claim.
const ROLES = {
  ADMIN: 'Proration.Admin',  // everything, incl. Setup
  USER: 'Proration.User',    // update quantities, prorate, send to D365
};

let jwks = null;
let jwksTenant = null;

function authConfig() {
  const tenantId = (process.env.AUTH_TENANT_ID || '').trim();
  const clientId = (process.env.AUTH_CLIENT_ID || '').trim();
  return { enabled: !!(tenantId && clientId), tenantId, clientId };
}

/**
 * Validate an `Authorization: Bearer …` header value.
 * Returns { ok: true, user } on success (user = UPN when present),
 * { ok: true, disabled: true } when auth is not configured,
 * or { ok: false, status, error } on failure.
 */
async function verifyBearer(authHeader) {
  const c = authConfig();
  if (!c.enabled) return { ok: true, disabled: true };

  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  if (!m) return { ok: false, status: 401, error: 'Missing bearer token' };

  if (!jwks || jwksTenant !== c.tenantId) {
    jwks = createRemoteJWKSet(new URL(
      `https://login.microsoftonline.com/${c.tenantId}/discovery/v2.0/keys`));
    jwksTenant = c.tenantId;
  }

  try {
    const { payload } = await jwtVerify(m[1], jwks, {
      // v2 tokens use login.microsoftonline.com; v1 access tokens (the default
      // for custom api:// scopes) use sts.windows.net. Accept both, same tenant.
      issuer: [
        `https://login.microsoftonline.com/${c.tenantId}/v2.0`,
        `https://sts.windows.net/${c.tenantId}/`,
      ],
      audience: [c.clientId, `api://${c.clientId}`],
    });
    return {
      ok: true,
      user: payload.preferred_username || payload.upn || payload.sub,
      roles: payload.roles || [],
      payload,
    };
  } catch (err) {
    return { ok: false, status: 401, error: `Invalid token: ${err.message}` };
  }
}

/** True when the verified auth result carries any of the given roles
 *  (always true when auth is disabled — plain local development). */
function hasAnyRole(auth, roles) {
  if (auth.disabled) return true;
  return (auth.roles || []).some(r => roles.includes(r));
}

/** Express middleware guarding /api routes when auth is configured. */
function requireAuth() {
  return async (req, res, next) => {
    const r = await verifyBearer(req.headers.authorization);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    req.user = r.user || null;
    req.auth = r;
    next();
  };
}

/** Express middleware requiring one of the given app roles (after requireAuth). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || hasAnyRole(req.auth, roles)) return next();
    res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
  };
}

module.exports = { authConfig, verifyBearer, requireAuth, requireRole, hasAnyRole, ROLES };
