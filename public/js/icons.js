// Commodity imagery resolver.
//
// D365 buyer-group / commodity codes differ per customer, so we don't key on a
// fixed list. Instead we keyword-match the commodity's id + name + description
// against known produce categories, each mapped to a bundled SVG icon and a
// tint color (used for the card's media gradient). Anything unmatched falls back
// to a generic produce-crate icon. To add coverage: drop a new SVG in
// /public/img/commodities/ and add a rule here.

const ICON_DIR = '/img/commodities/';

// Per-customer override: pin a specific commodity / buyer-group CODE to an icon.
// Live D365 often returns opaque codes (id "10", name "Buyer group 1") that the
// keyword rules below can't match — so for a given customer's demo, map their
// codes here. Key = commodity.id, value = an icon file name (without .svg) from
// /public/img/commodities/. This is checked BEFORE the keyword rules.
//   e.g.  '10': 'strawberry',  'BG-AVO': 'avocado'
const COMMODITY_ICON_OVERRIDES = {
  // '10': 'strawberry',
};

const RULES = [
  { re: /strawberr/i,                                   icon: 'strawberry', tint: '#e23744' },
  { re: /blue ?berr|blueberr|berr/i,                    icon: 'blueberry',  tint: '#4b6cb7' },
  { re: /lettuce|romaine|iceberg|spring ?mix|spinach|kale|greens|cabbage|arugula/i,
                                                        icon: 'lettuce',    tint: '#5aa64b' },
  { re: /avocado|guac/i,                                icon: 'avocado',    tint: '#6c8c3c' },
  { re: /citrus|orange|lemon|lime|grapefruit|mandarin|tangerine|clementine/i,
                                                        icon: 'citrus',     tint: '#f29f1f' },
  { re: /peach|nectarine|plum|cherry|apricot|stone ?fruit/i,
                                                        icon: 'peach',      tint: '#f08a5d' },
  { re: /tomato/i,                                      icon: 'tomato',     tint: '#e2483a' },
  { re: /grape(?!fruit)/i,                              icon: 'grape',      tint: '#7a4ea3' },
  { re: /apple|pear/i,                                  icon: 'apple',      tint: '#d24b3e' },
];

const FALLBACK = { icon: '_fallback', tint: '#7c9a6a' };

// Tint to use when an override names an icon (reuse the rule's tint if known).
function tintForIcon(icon) {
  return (RULES.find(r => r.icon === icon) || FALLBACK).tint;
}

function matchCommodity(commodity = {}) {
  const override = COMMODITY_ICON_OVERRIDES[commodity.id];
  if (override) return { icon: override, tint: tintForIcon(override) };
  const hay = `${commodity.id || ''} ${commodity.name || ''} ${commodity.description || ''}`;
  return RULES.find(r => r.re.test(hay)) || FALLBACK;
}

function commodityIconUrl(commodity) { return ICON_DIR + matchCommodity(commodity).icon + '.svg'; }
function commodityTint(commodity) { return matchCommodity(commodity).tint; }

window.commodityIconUrl = commodityIconUrl;
window.commodityTint = commodityTint;
