// Per-user fixed-window rate limiter for the D365 publish endpoints (SF-07).
//
// In-memory and per-process — good enough to stop a runaway client or a rogue
// account flooding SysMessageService with batch messages. Shared by the
// Express server and the Azure Functions host (per-instance limits there,
// which is acceptable at this scale; move to API Management if a customer
// needs a hard global ceiling).

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const hits = new Map(); // user -> [timestamps within the current window]

/** True when `user` is still within their per-minute budget; records the hit. */
function allow(user) {
  const key = user || 'anonymous';
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Express middleware flavour (mount after requireAuth so req.user is set). */
function limited() {
  return (req, res, next) => {
    if (allow(req.user)) return next();
    res.status(429).json({ error: 'Too many requests — try again in a minute.' });
  };
}

module.exports = { allow, limited, WINDOW_MS, MAX_PER_WINDOW };
