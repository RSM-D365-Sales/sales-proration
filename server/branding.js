// Per-customer branding (white-label).
//
// One file is the source of truth — server/data/branding.json — editable two
// ways: by hand (commit it per customer) or live from the Setup > Branding tab.
// It drives the logo, brand name, accent/sidebar colors, and which front-end
// "skin" (editorial | enterprise) the SPA renders. No secrets live here.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'data', 'branding.json');

const THEMES = ['editorial', 'enterprise', 'bluestem'];

const DEFAULTS = {
  brandName: 'Sales Proration',
  tagline: 'Proration Accelerator for D365 F&SCM',
  // logo is either a path served from /public (e.g. "img/brand/acme.svg" —
  // keep it relative so the site works under a subpath) or an inline data
  // URL (what the Setup uploader stores). null = wordmark only.
  logo: null,
  // Browser-tab icon, same rules as logo. null = whatever the HTML ships.
  favicon: null,
  // Optional sponsor lockup rendered in the shell next to the user block:
  // { label: "Powered by", logo: "img/brand/rsmus-logo-white.png", alt: "RSM" }.
  // null = not rendered (plain white-label).
  sponsor: null,
  theme: 'editorial',
  colors: {
    accent: '#2f7d4f',   // single accent drives buttons, links, focus, tints
    sidebar: '#14241c',  // sidebar / brand rail background
  },
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// SF-05: a logo must be a site-relative path or an image data URL — anything
// else (javascript:, data:text/html, remote URLs) is dropped rather than
// stored and later injected into the sidebar markup.
const DATA_IMAGE = /^data:image\/(png|jpeg|svg\+xml|gif|webp);base64,/;
// Site path: plain path characters only — no scheme (":"), no
// protocol-relative "//", no traversal. Leading "/" is optional so branding
// works when the site is hosted under a subpath.
const SITE_PATH = /^\/?(?!\/)(?!.*\.\.)[A-Za-z0-9_\-./]+\.(png|jpe?g|svg|gif|webp|ico)$/i;

function cleanLogo(logo) {
  if (typeof logo !== 'string' || !logo) return null;
  const s = logo.slice(0, 500000); // cap data URLs ~0.5MB
  if (SITE_PATH.test(s) || DATA_IMAGE.test(s)) return s;
  return null;
}

function cleanSponsor(input) {
  if (!input || typeof input !== 'object') return null;
  const logo = cleanLogo(input.logo);
  if (!logo) return null;
  return {
    label: (input.label ?? 'Powered by').toString().trim().slice(0, 40),
    logo,
    alt: (input.alt ?? '').toString().trim().slice(0, 40),
  };
}

function cleanColor(input, fallback) {
  const v = (input ?? '').toString().trim();
  return HEX.test(v) ? v : fallback;
}

/** Coerce arbitrary input into a clean, whitelisted branding object. */
function normalize(input = {}, base = DEFAULTS) {
  const colors = { ...base.colors, ...(input.colors || {}) };
  const logo = input.logo === null ? null : (input.logo ?? base.logo);
  const favicon = input.favicon === null ? null : (input.favicon ?? base.favicon);
  const sponsor = input.sponsor === null ? null : (input.sponsor ?? base.sponsor);
  return {
    brandName: (input.brandName ?? base.brandName ?? '').toString().trim().slice(0, 60) || DEFAULTS.brandName,
    tagline:   (input.tagline ?? base.tagline ?? '').toString().trim().slice(0, 120),
    logo:      cleanLogo(logo),
    favicon:   cleanLogo(favicon),
    sponsor:   cleanSponsor(sponsor),
    theme:     THEMES.includes(input.theme) ? input.theme : (THEMES.includes(base.theme) ? base.theme : DEFAULTS.theme),
    colors: {
      // An invalid value keeps the current (base) color rather than snapping
      // back to the hard default — friendlier for hand-edits.
      accent:  cleanColor(colors.accent, base.colors?.accent ?? DEFAULTS.colors.accent),
      sidebar: cleanColor(colors.sidebar, base.colors?.sidebar ?? DEFAULTS.colors.sidebar),
    },
  };
}

let cache = null;

function read() {
  if (cache) return cache;
  if (fs.existsSync(STORE_PATH)) {
    try {
      cache = normalize(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
      return cache;
    } catch {
      /* fall through to seed */
    }
  }
  cache = { ...DEFAULTS, colors: { ...DEFAULTS.colors } };
  write(cache); // persist a starter file so it's easy to find and hand-edit
  return cache;
}

function write(branding) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(branding, null, 2), 'utf8');
  cache = branding;
  return branding;
}

function get() {
  return read();
}

/** Merge a partial update over the current branding and persist it. */
function update(patch) {
  return write(normalize(patch || {}, read()));
}

module.exports = { get, update, THEMES, DEFAULTS };
