// Per-customer branding (white-label).
//
// One file is the source of truth — server/data/branding.json — editable two
// ways: by hand (commit it per customer) or live from the Setup > Branding tab.
// It drives the logo, brand name, accent/sidebar colors, and which front-end
// "skin" (editorial | enterprise) the SPA renders. No secrets live here.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'data', 'branding.json');

const THEMES = ['editorial', 'enterprise'];

const DEFAULTS = {
  brandName: 'Sales Proration',
  tagline: 'Proration Accelerator for D365 F&SCM',
  // logo is either a path served from /public (e.g. "/img/brand/acme.svg")
  // or an inline data URL (what the Setup uploader stores). null = wordmark only.
  logo: null,
  theme: 'editorial',
  colors: {
    accent: '#2f7d4f',   // single accent drives buttons, links, focus, tints
    sidebar: '#14241c',  // sidebar / brand rail background
  },
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function cleanColor(input, fallback) {
  const v = (input ?? '').toString().trim();
  return HEX.test(v) ? v : fallback;
}

/** Coerce arbitrary input into a clean, whitelisted branding object. */
function normalize(input = {}, base = DEFAULTS) {
  const colors = { ...base.colors, ...(input.colors || {}) };
  const logo = input.logo === null ? null : (input.logo ?? base.logo);
  return {
    brandName: (input.brandName ?? base.brandName ?? '').toString().trim().slice(0, 60) || DEFAULTS.brandName,
    tagline:   (input.tagline ?? base.tagline ?? '').toString().trim().slice(0, 120),
    logo:      typeof logo === 'string' ? logo.slice(0, 500000) : null, // cap data URLs ~0.5MB
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
