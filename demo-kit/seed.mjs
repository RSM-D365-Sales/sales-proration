/**
 * Generates the Bluestem demo data set the booth video is recorded from.
 *
 *   node demo-kit/seed.mjs                 # as-of today
 *   node demo-kit/seed.mjs --as-of 2026-10-20
 *
 * Writes (git-tracked, regenerate rather than hand-edit):
 *   demo-kit/data/bluestem-snapshot.json   raw GetOpenSalesOrders shape the server
 *                                          normalizes exactly like the live feed
 *   demo-kit/data/outbox.jsonl             two "recent batches" for the landing page
 *
 * Serve it with (PowerShell):
 *   $env:D365_SNAPSHOT_FILE = 'demo-kit/data/bluestem-snapshot.json'
 *   $env:OUTBOX_FILE = 'demo-kit/data/outbox.jsonl'
 *   $env:PORT = '5199'; node server/index.js
 *
 * Why this exists: the live DEV08/USMF feed is Contoso data (speakers and HDMI
 * cables under "Blueberries", ship dates back to 2016), which cannot be shown
 * under the bluestem brand. Every figure here is synthetic; the RNG is seeded so
 * a rebuild gives the same numbers, and every date is relative to --as-of so the
 * kit never goes stale. Every customer is fictional because every customer on a
 * short item is shown as "Needs proration".
 *
 * The hero item (BLU-PT12, blueberry pints) is specified line by line so the
 * cheat sheet can quote its figures; the rest is distributed by the seeded RNG.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((p) => p.length))
const AS_OF = args['as-of'] ? new Date(args['as-of'] + 'T12:00:00') : new Date()
AS_OF.setHours(12, 0, 0, 0)

// Seeded RNG (mulberry32) — same seed, same demo.
let seed = 20261006
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const isoDay = (offset) => { const d = new Date(AS_OF); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }

// ---------------------------------------------------------------------------
// Cast. Fictional customers (the Grower Harvesting cast plus a few more so all
// five priorities appear). Priority 1 = strategic … 5 = spot.
// ---------------------------------------------------------------------------
export const CUSTOMERS = [
  { customerId: 'C10001', name: 'Great Lakes Grocers',      priority: 1, shipToCity: 'Grand Rapids',  shipToState: 'MI' },
  { customerId: 'C10007', name: 'Summit Club Stores',       priority: 1, shipToCity: 'Chicago',       shipToState: 'IL' },
  { customerId: 'C10002', name: 'Northwind Foods',          priority: 2, shipToCity: 'Detroit',       shipToState: 'MI' },
  { customerId: 'C10009', name: 'Lakeside Natural Foods',   priority: 2, shipToCity: 'Traverse City', shipToState: 'MI' },
  { customerId: 'C10011', name: 'Harbor Street Markets',    priority: 2, shipToCity: 'Milwaukee',     shipToState: 'WI' },
  { customerId: 'C10004', name: 'Campus Dining Partners',   priority: 3, shipToCity: 'Ann Arbor',     shipToState: 'MI' },
  { customerId: 'C10005', name: 'Fresh Bowl Kitchens',      priority: 3, shipToCity: 'Indianapolis',  shipToState: 'IN' },
  { customerId: 'C10006', name: 'Pantry Prime Meal Kits',   priority: 3, shipToCity: 'Columbus',      shipToState: 'OH' },
  { customerId: 'C10008', name: 'Windy City Salad Works',   priority: 3, shipToCity: 'Chicago',       shipToState: 'IL' },
  { customerId: 'C10012', name: 'Maple & Main Co-op',       priority: 4, shipToCity: 'Kalamazoo',     shipToState: 'MI' },
  { customerId: 'C10013', name: 'Prairie Foodservice',      priority: 4, shipToCity: 'Fort Wayne',    shipToState: 'IN' },
  { customerId: 'C10014', name: 'QuickCart Online Grocery', priority: 5, shipToCity: 'Toledo',        shipToState: 'OH' },
]
const byId = Object.fromEntries(CUSTOMERS.map((c) => [c.customerId, c]))

// Sites / warehouses from the brand guide (GRP HQ & DC, HOL greenhouse campus, HRT packing).
const SHIP_FROM = [
  { SiteId: 'GRP', WarehouseId: 'GRP-DC' },
  { SiteId: 'GRP', WarehouseId: 'GRP-DC' },
  { SiteId: 'HOL', WarehouseId: 'HOL-DC' },
]

// ---------------------------------------------------------------------------
// Commodities and items. demand/supply are case totals per item; `lines` is how
// many customer lines the demand is split across (or an explicit list).
// Target picture: 1 Short (Blueberries), 1 At risk (Strawberries), 5 On track.
// ---------------------------------------------------------------------------
const COMMODITIES = [
  { id: 'BLU', name: 'Blueberries', items: [
    { ItemId: 'BLU-PT12',  name: 'Blueberries 1 pt · 12 ct',         uom: 'cs', demand: 2400, supply: 1440, supplyAt: { SiteId: 'HRT', WarehouseId: 'HRT-PK' },
      lines: [ // hero item — specified so the cheat sheet can quote it
        { customerId: 'C10001', qty: 600, ship: 2, from: 0 },
        { customerId: 'C10007', qty: 480, ship: 3, from: 0 },
        { customerId: 'C10002', qty: 360, ship: 2, from: 0 },
        { customerId: 'C10011', qty: 300, ship: 4, from: 2 },
        { customerId: 'C10005', qty: 240, ship: 3, from: 2 },
        { customerId: 'C10012', qty: 220, ship: 5, from: 0 },
        { customerId: 'C10014', qty: 200, ship: 6, from: 2 },
      ] },
    // Same customers as the pint item, so "Needs proration" stays at 7 of 12 and
    // the Customers filter has something to remove.
    { ItemId: 'BLU-18OZ8', name: 'Blueberries 18 oz · 8 ct',         uom: 'cs', demand: 1350, supply: 820,  supplyAt: { SiteId: 'HRT', WarehouseId: 'HRT-PK' },
      lines: [
        { customerId: 'C10007', qty: 420, ship: 3, from: 0 },
        { customerId: 'C10002', qty: 330, ship: 4, from: 0 },
        { customerId: 'C10005', qty: 240, ship: 2, from: 2 },
        { customerId: 'C10011', qty: 200, ship: 5, from: 2 },
        { customerId: 'C10012', qty: 160, ship: 6, from: 0 },
      ] },
    { ItemId: 'BLU-ORG6',  name: 'Organic Blueberries 6 oz · 12 ct', uom: 'cs', demand: 640,  supply: 700,  supplyAt: { SiteId: 'HRT', WarehouseId: 'HRT-PK' }, lines: 4 },
  ] },
  { id: 'STR', name: 'Strawberries', items: [
    { ItemId: 'STR-1LB8', name: 'Strawberries 1 lb · 8 ct', uom: 'cs', demand: 3200, supply: 3200, lines: 5 },
    // The short strawberry item sits on three of the blueberry customers.
    { ItemId: 'STR-2LB4', name: 'Strawberries 2 lb · 4 ct', uom: 'cs', demand: 1100, supply: 980,
      lines: [
        { customerId: 'C10001', qty: 500, ship: 2, from: 0 },
        { customerId: 'C10007', qty: 400, ship: 3, from: 0 },
        { customerId: 'C10011', qty: 200, ship: 4, from: 2 },
      ] },
  ] },
  { id: 'LET', name: 'Lettuce & Leafy Greens', items: [
    { ItemId: 'LET-ROM12', name: 'Romaine Hearts 3-pk · 12 ct',   uom: 'cs', demand: 2100, supply: 2480, supplyAt: { SiteId: 'HOL', WarehouseId: 'HOL-DC' }, lines: 4 },
    { ItemId: 'LET-BUT12', name: 'Living Butter Lettuce · 12 ct', uom: 'cs', demand: 900,  supply: 1180, supplyAt: { SiteId: 'HOL', WarehouseId: 'HOL-DC' }, lines: 3 },
    { ItemId: 'LET-MIX6',  name: 'Spring Mix 5 oz · 6 ct',        uom: 'cs', demand: 1500, supply: 1560, supplyAt: { SiteId: 'HOL', WarehouseId: 'HOL-DC' }, lines: 3 },
  ] },
  { id: 'AVO', name: 'Avocados', items: [
    { ItemId: 'AVO-48',   name: 'Hass Avocados 48 ct',          uom: 'cs', demand: 1800, supply: 2050, lines: 4 },
    { ItemId: 'AVO-BAG5', name: 'Hass Avocados 5-ct bag · 12', uom: 'cs', demand: 760,  supply: 800,  lines: 3 },
  ] },
  { id: 'APL', name: 'Apples', items: [
    { ItemId: 'APL-HC3',  name: 'Honeycrisp 3 lb bag · 10 ct', uom: 'cs', demand: 1900, supply: 3400, lines: 4 },
    { ItemId: 'APL-GALA', name: 'Gala 40 lb carton',           uom: 'cs', demand: 860,  supply: 1250, lines: 3 },
  ] },
  { id: 'TOM', name: 'Tomatoes', items: [
    { ItemId: 'TOM-ROM25', name: 'Roma 25 lb carton',            uom: 'cs', demand: 1200, supply: 1420, lines: 3 },
    { ItemId: 'TOM-GRP12', name: 'Grape Tomatoes 1 pt · 12 ct', uom: 'cs', demand: 980,  supply: 1010, lines: 3 },
  ] },
  { id: 'CIT', name: 'Citrus', items: [
    { ItemId: 'CIT-NAV88',  name: 'Navel Oranges 88 ct', uom: 'cs', demand: 1400, supply: 1900, lines: 3 },
    { ItemId: 'CIT-LEM115', name: 'Lemons 115 ct',       uom: 'cs', demand: 620,  supply: 900,  lines: 2 },
  ] },
]

// Substitution whitelist (RSMItemSubstitution rows). The blueberry rules are what
// the "Sub…" picker shows as "rule · rank 1" in the video.
const SUBSTITUTIONS = [
  { FromItemId: 'BLU-PT12',  ToItemId: 'BLU-ORG6',  Direction: 'OneWay',        Rank: 1, QtyRatio: 2 },
  { FromItemId: 'BLU-18OZ8', ToItemId: 'BLU-PT12',  Direction: 'OneWay',        Rank: 1, QtyRatio: 1.5 },
  { FromItemId: 'STR-1LB8',  ToItemId: 'STR-2LB4',  Direction: 'Bidirectional', Rank: 1, QtyRatio: 0.5 },
  { FromItemId: 'LET-ROM12', ToItemId: 'LET-BUT12', Direction: 'OneWay',        Rank: 2, QtyRatio: 1 },
]

// ---------------------------------------------------------------------------
// Build. Each customer owns a couple of open sales orders; lines attach to them.
// ---------------------------------------------------------------------------
let nextSo = 50610
const orders = Object.fromEntries(CUSTOMERS.map((c) => [c.customerId, { ids: [`SO-${nextSo++}`, `SO-${nextSo++}`], nextLine: {} }]))
function lineOn(customerId) {
  const o = orders[customerId]
  const SalesId = pick(o.ids)
  o.nextLine[SalesId] = (o.nextLine[SalesId] || 0) + 1
  return { SalesId, LineNum: o.nextLine[SalesId] }
}

/** Split `total` across `n` distinct customers, proportional to random weights, whole cases. */
function splitDemand(total, n) {
  const custs = shuffle(CUSTOMERS).slice(0, n)
  const w = custs.map(() => 0.6 + rnd())
  const sum = w.reduce((s, x) => s + x, 0)
  const qty = w.map((x) => Math.max(10, Math.round((total * x) / sum / 10) * 10))
  qty[0] += total - qty.reduce((s, x) => s + x, 0) // absorb rounding in the first line
  return custs.map((c, i) => ({ customerId: c.customerId, qty: qty[i], ship: 1 + Math.floor(rnd() * 8), from: Math.floor(rnd() * SHIP_FROM.length) }))
}

const raw = { commodities: [], items: [], customers: [], Demand: [], Supply: [], substitutions: SUBSTITUTIONS }
raw.customers = CUSTOMERS.map((c) => ({ ...c }))

for (const c of COMMODITIES) {
  raw.commodities.push({ CommodityId: c.id, Description: c.name })
  for (const it of c.items) {
    raw.items.push({ ItemId: it.ItemId, CommodityId: c.id, name: it.name, uom: it.uom })
    const lines = Array.isArray(it.lines) ? it.lines : splitDemand(it.demand, it.lines)
    for (const l of lines) {
      const { SalesId, LineNum } = lineOn(l.customerId)
      const from = SHIP_FROM[l.from]
      raw.Demand.push({ SalesId, LineNum, ItemId: it.ItemId, CustAccount: l.customerId, SiteId: from.SiteId, WarehouseId: from.WarehouseId,
        RequestedQty: l.qty, RequestedShipDate: isoDay(l.ship) })
    }
    const at = it.supplyAt || { SiteId: 'GRP', WarehouseId: 'GRP-DC' }
    raw.Supply.push({ ItemId: it.ItemId, ...at, AvailableQty: it.supply })
  }
}

// Recent batches for the landing page's "Recent batches sent to D365" table.
const batch = (daysAgo, hour, batchId, strategy, commodityId, lines) => {
  const d = new Date(AS_OF); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 12 + Math.floor(rnd() * 40), 0, 0)
  const createdUtc = d.toISOString()
  return JSON.stringify({ topic: 'd365-proration-inbound', enqueuedUtc: createdUtc, messageId: batchId,
    body: { batchId, createdUtc, createdBy: 'rosa.delgado@bluestemfresh.example', strategy, commodityId, lines } })
}
const outbox = [
  batch(3, 7,  '6f1c2a40-5c0e-4b7a-9a7e-bluestem0001', 'Weighted',     'STR', raw.Demand.filter((d) => d.ItemId === 'STR-2LB4').map((d) => ({ salesId: d.SalesId, lineNum: d.LineNum, itemId: d.ItemId, allocatedQty: Math.round(d.RequestedQty * 0.93) }))),
  batch(1, 15, '9b8d7e21-0a3f-4c6d-8e5b-bluestem0002', 'StraightLine', 'TOM', raw.Demand.filter((d) => d.ItemId === 'TOM-GRP12').map((d) => ({ salesId: d.SalesId, lineNum: d.LineNum, itemId: d.ItemId, allocatedQty: Math.round(d.RequestedQty * 0.97) }))),
].join('\n') + '\n'

mkdirSync(join(here, 'data'), { recursive: true })
writeFileSync(join(here, 'data', 'bluestem-snapshot.json'), JSON.stringify(raw, null, 2))
writeFileSync(join(here, 'data', 'outbox.jsonl'), outbox)

// ---------------------------------------------------------------------------
// Reconciliation summary — the numbers the landing page will show.
// ---------------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US')
let td = 0, ts = 0, attention = 0
console.log(`Bluestem demo snapshot · as of ${isoDay(0)} · ship dates ${isoDay(1)} … ${isoDay(8)}\n`)
console.log('Commodity                  Items  Demand   Supply   Fill    Status')
for (const c of COMMODITIES) {
  const d = c.items.reduce((s, i) => s + i.demand, 0), s = c.items.reduce((x, i) => x + i.supply, 0)
  const fill = s / d, status = fill < 0.9 ? 'Short' : fill < 1 ? 'At risk' : 'On track'
  if (status !== 'On track') attention++
  td += d; ts += s
  console.log(`${c.name.padEnd(26)} ${String(c.items.length).padStart(5)}  ${fmt(d).padStart(6)}   ${fmt(s).padStart(6)}   ${(fill * 100).toFixed(1).padStart(5)}%  ${status}`)
}
console.log(`\nKPIs: ${COMMODITIES.length} commodities · ${raw.items.length} items · demand ${fmt(td)} · supply ${fmt(ts)} · overall fill ${((ts / td) * 100).toFixed(1)}% · ${attention} need attention`)
console.log(`Customers ${raw.customers.length} · demand lines ${raw.Demand.length} · supply rows ${raw.Supply.length} · substitution rules ${SUBSTITUTIONS.length} · outbox batches 2`)
const lineCheck = raw.Demand.reduce((s, d) => s + d.RequestedQty, 0)
console.log(`Tie-out: sum of demand lines ${fmt(lineCheck)} ${lineCheck === td ? '= commodity demand ✓' : '≠ commodity demand ✗'}`)
console.log(`\n→ ${join(here, 'data', 'bluestem-snapshot.json')}\n→ ${join(here, 'data', 'outbox.jsonl')}`)
