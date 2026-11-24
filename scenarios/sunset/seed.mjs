/**
 * SUNSET® (Mastronardi Produce) demo data set — the one source the static
 * build serves.
 *
 *   node scenarios/sunset/seed.mjs                 # as-of from scenario.json (blank = today)
 *   node scenarios/sunset/seed.mjs --as-of 2026-12-01
 *
 * Writes (git-tracked; regenerate, never hand-edit):
 *   scenarios/sunset/data/snapshot.json  raw GetOpenSalesOrders shape, plus the
 *                                        substitution rules and customer
 *                                        policies a rules-aware feed carries
 *   scenarios/sunset/data/outbox.json    recent batches for the landing page
 *
 * The twelve SUNSET products, packs, case list prices and case costs match the
 * pricing dashboard's item master (Pricing-dashboard/src/scenarios/sunset/
 * items.ts) so the two demos read as one D365 environment; WOW™ Dreamberry
 * 1 lb is added here so berries have a pack to substitute into. Product names
 * are SUNSET's own; every figure is synthetic. Every customer is fictional —
 * customers are shown short, skipped and margin-squeezed.
 *
 * Story (as-of in winter, the lit-greenhouse season):
 *   Peppers   SHORT    Sweet Bell 11 lb carton at 54% fill — hero item
 *   Tomatoes  AT RISK  Beefsteak short; Keystone's contract blocks substitutes
 *   Cucumbers on track overall, Mini Cucumbers short, organic upgrade available
 *   Berries   on track overall, 10 oz short, 1 lb pack long
 * Seeded RNG and as-of-relative dates: the same command gives the same demo.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const cfg = JSON.parse(readFileSync(join(here, 'scenario.json'), 'utf8'))
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((p) => p.length))
const asOfArg = args['as-of'] || cfg.asOf || new Date().toISOString().slice(0, 10)
const AS_OF = new Date(asOfArg + 'T12:00:00Z')

// Seeded RNG (mulberry32) — same seed, same demo.
let seed = cfg.seed
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const isoDay = (offset) => { const d = new Date(AS_OF); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10) }

// ---------------------------------------------------------------------------
// Cast — the pricing dashboard's fictional accounts (same numbers, same
// cities), priority 1 = strategic … 5 = spot. Policy is
// CustTable.RSMSubstitutionPolicy; see public/js/shared/subs.js.
// ---------------------------------------------------------------------------
export const CUSTOMERS = [
  { customerId: 'C10001', name: 'Great Lakes Grocers',        priority: 1, segment: 'Grocery',     shipToCity: 'Grand Rapids', shipToState: 'MI' },
  { customerId: 'C10007', name: 'Summit Produce Wholesale',   priority: 1, segment: 'Wholesale',   shipToCity: 'Toronto',      shipToState: 'ON' },
  { customerId: 'C10002', name: 'Northwind Foods',            priority: 2, segment: 'Grocery',     shipToCity: 'Columbus',     shipToState: 'OH' },
  { customerId: 'C10012', name: 'Keystone Foodservice',       priority: 2, segment: 'Foodservice', shipToCity: 'Harrisburg',   shipToState: 'PA',
    substitutionPolicy: 'CustomerOnly', substitutionNote: 'Winter Tomato Program specifies the pack; only substitutes the contract names.' },
  { customerId: 'C10009', name: 'Lakeside Natural Foods',     priority: 2, segment: 'Natural',     shipToCity: 'Ann Arbor',    shipToState: 'MI',
    substitutionPolicy: 'CustomerOnly', substitutionNote: 'Certified-organic shelf: organic-for-organic substitutes only.' },
  { customerId: 'C10003', name: 'Harborline Markets',         priority: 3, segment: 'Grocery',     shipToCity: 'Cleveland',    shipToState: 'OH' },
  { customerId: 'C10006', name: 'Riverbend Supermarkets',     priority: 3, segment: 'Grocery',     shipToCity: 'Pittsburgh',   shipToState: 'PA' },
  { customerId: 'C10005', name: 'Maple Crest Food Markets',   priority: 3, segment: 'Grocery',     shipToCity: 'London',       shipToState: 'ON' },
  { customerId: 'C10011', name: 'Midwest Foodservice Supply', priority: 3, segment: 'Foodservice', shipToCity: 'Fort Wayne',   shipToState: 'IN' },
  { customerId: 'C10014', name: 'North Shore Provisions',     priority: 3, segment: 'Foodservice', shipToCity: 'Evanston',     shipToState: 'IL' },
  { customerId: 'C10016', name: 'Hudson Produce Terminal',    priority: 3, segment: 'Wholesale',   shipToCity: 'Albany',       shipToState: 'NY' },
  { customerId: 'C10008', name: 'Valley Fresh Distributors',  priority: 4, segment: 'Wholesale',   shipToCity: 'Detroit',      shipToState: 'MI' },
  { customerId: 'C10021', name: 'Fresh Bowl Kitchens',        priority: 4, segment: 'Foodservice', shipToCity: 'Indianapolis', shipToState: 'IN' },
  { customerId: 'C10037', name: 'Cedar Bluff Hospitality',    priority: 4, segment: 'Foodservice', shipToCity: 'Traverse City', shipToState: 'MI',
    substitutionPolicy: 'Never', substitutionNote: 'Specialty Menu Agreement: chef-specified product only.' },
  { customerId: 'C10038', name: 'Windy City Salad Works',     priority: 4, segment: 'Foodservice', shipToCity: 'Chicago',      shipToState: 'IL' },
  { customerId: 'C10010', name: 'Green Cart Co-op',           priority: 4, segment: 'Natural',     shipToCity: 'Ottawa',       shipToState: 'ON' },
  { customerId: 'C10026', name: 'Pantry Prime Meal Kits',     priority: 5, segment: 'E-commerce',  shipToCity: 'Indianapolis', shipToState: 'IN' },
  { customerId: 'C10027', name: 'DoorStep Grocer',            priority: 5, segment: 'E-commerce',  shipToCity: 'Chicago',      shipToState: 'IL',
    substitutionPolicy: 'Never', substitutionNote: 'Online listings are SKU-locked; shoppers receive exactly what they ordered.' },
]
const ORGANIC_ONLY = new Set(['C10009', 'C10010']) // natural accounts only carry organic cucumbers

// Ship-from: Kingsville, ON DC and the Coldwater, MI DC.
const KGV = { SiteId: 'KGV', WarehouseId: 'KGV-DC' }
const CWT = { SiteId: 'CWT', WarehouseId: 'CWT-DC' }
const SHIP_FROM = [KGV, KGV, CWT]

// ---------------------------------------------------------------------------
// Buyer groups and items. list / cost are per case (pricing dashboard master).
// demand / supply are case totals; `lines` is a count (seeded split) or an
// explicit list for the items the cheat sheet quotes.
// ---------------------------------------------------------------------------
const COMMODITIES = [
  { id: 'PEP', name: 'Peppers', blurb: 'Sweet bell, snacking and specialty peppers', items: [
    { ItemId: 'SG-PEP-BELL', name: 'Sweet Bell Peppers', pack: '11 lb carton', list: 18.75, cost: 13.4, demand: 2600, supply: 1400, supplyAt: KGV,
      lines: [ // hero item
        { customerId: 'C10001', qty: 600, ship: 2, from: 0 },
        { customerId: 'C10007', qty: 480, ship: 3, from: 0 },
        { customerId: 'C10002', qty: 400, ship: 2, from: 2 },
        { customerId: 'C10012', qty: 360, ship: 4, from: 0 },
        { customerId: 'C10011', qty: 300, ship: 3, from: 2 },
        { customerId: 'C10006', qty: 300, ship: 5, from: 0 },
        { customerId: 'C10027', qty: 160, ship: 2, from: 2 },
      ] },
    { ItemId: 'SG-PEP-BELL-3CT', name: 'Sweet Bell Peppers 3ct', pack: '12 × 3 ct', list: 30.0, cost: 19.6, demand: 900, supply: 1400, supplyAt: KGV, lines: 4 },
    { ItemId: 'SG-PEP-TWST-2LB', name: 'Sweet Twister™ Peppers 2 lb', pack: '6 × 2 lb', list: 28.8, cost: 17.5, demand: 420, supply: 700, supplyAt: CWT, lines: 3 },
    { ItemId: 'SG-PEP-SHAZAM', name: 'SHAZAM!® Shishito Peppers', pack: '12 × 6 oz', list: 32.4, cost: 19.5, demand: 360, supply: 300, supplyAt: CWT, lines: 3 },
  ] },
  { id: 'TOM', name: 'Tomatoes', blurb: 'Greenhouse vine, beefsteak and snacking tomatoes', items: [
    { ItemId: 'SG-TOM-BEEF', name: 'Beefsteak Tomatoes', pack: '15 lb carton', list: 21.0, cost: 14.2, demand: 1500, supply: 1180, supplyAt: KGV,
      lines: [
        { customerId: 'C10012', qty: 500, ship: 2, from: 0 },
        { customerId: 'C10001', qty: 400, ship: 3, from: 0 },
        { customerId: 'C10014', qty: 300, ship: 4, from: 2 },
        { customerId: 'C10016', qty: 300, ship: 3, from: 0 },
      ] },
    { ItemId: 'SG-TOM-ROM-3LB', name: 'Romana Tomatoes 3 lb', pack: '8 × 3 lb', list: 22.5, cost: 15.8, demand: 1400, supply: 1560, supplyAt: KGV, lines: 4 },
    { ItemId: 'SG-TOM-WW-2LB', name: 'Wild Wonders® Tomatoes 2 lb', pack: '6 × 2 lb', list: 36.0, cost: 21.7, demand: 500, supply: 520, supplyAt: CWT, lines: 3 },
    { ItemId: 'SG-TOM-ANGEL', name: 'Angel Sweet® Tomatoes', pack: '12 × 10 oz', list: 29.6, cost: 17.5, demand: 640, supply: 700, supplyAt: CWT, lines: 3 },
  ] },
  { id: 'CUC', name: 'Cucumbers', blurb: 'Mini and organic mini cucumbers', items: [
    { ItemId: 'SG-CUC-MINI', name: 'Mini Cucumbers', pack: '12 × 1 lb', list: 19.2, cost: 13.4, demand: 2000, supply: 1850, supplyAt: KGV, lines: 5 },
    { ItemId: 'SG-CUC-MINI-ORG', name: 'Organic Mini Cucumbers', pack: '12 × 1 lb', list: 24.0, cost: 17.0, demand: 700, supply: 900, supplyAt: KGV,
      lines: [
        { customerId: 'C10009', qty: 300, ship: 2, from: 0 },
        { customerId: 'C10010', qty: 220, ship: 4, from: 0 },
        { customerId: 'C10001', qty: 180, ship: 3, from: 2 },
      ] },
    { ItemId: 'SG-CUC-ORG-6CT', name: 'Organic Mini Cucumber 6ct', pack: '12 × 6 ct', list: 27.6, cost: 17.0, demand: 600, supply: 650, supplyAt: CWT, lines: 3 },
  ] },
  { id: 'BER', name: 'Berries', blurb: 'WOW™ Dreamberry greenhouse strawberries', items: [
    { ItemId: 'SG-BER-WOW-10OZ', name: 'WOW™ Dreamberry 10 oz', pack: '8 × 10 oz', list: 37.0, cost: 22.9, demand: 1200, supply: 860, supplyAt: CWT,
      lines: [
        { customerId: 'C10002', qty: 360, ship: 2, from: 2 },
        { customerId: 'C10007', qty: 300, ship: 3, from: 2 },
        { customerId: 'C10003', qty: 240, ship: 4, from: 2 },
        { customerId: 'C10037', qty: 160, ship: 3, from: 2 },
        { customerId: 'C10026', qty: 140, ship: 5, from: 2 },
      ] },
    { ItemId: 'SG-BER-WOW-1LB', name: 'WOW™ Dreamberry 1 lb', pack: '8 × 1 lb', list: 52.0, cost: 33.0, demand: 300, supply: 700, supplyAt: CWT, lines: 2 },
  ] },
]

// ---------------------------------------------------------------------------
// Substitution rules (RSMItemSubstitution). CustAccount blank = all customers.
// QtyRatio = substitute cases per ordered case (pack weight / count based).
// ---------------------------------------------------------------------------
const R = (o) => ({ Direction: 'OneWay', Rank: 1, QtyRatio: 1, PriceBasis: 'Original', CustAccount: '', ValidFrom: '', ValidTo: '', ...o })
const SUBSTITUTIONS = [
  // Peppers — the hero beats
  R({ RuleId: 'SUB-1001', FromItemId: 'SG-PEP-BELL', ToItemId: 'SG-PEP-BELL-3CT', QtyRatio: 0.75, Note: '22 peppers per carton ≈ 0.75 case of 12 × 3 ct' }),
  R({ RuleId: 'SUB-1002', FromItemId: 'SG-PEP-BELL', ToItemId: 'SG-PEP-TWST-2LB', CustAccount: 'C10001', Note: 'Great Lakes merchandising prefers Sweet Twister on bell shortfalls' }),
  R({ RuleId: 'SUB-1003', FromItemId: 'SG-PEP-TWST-2LB', ToItemId: 'SG-PEP-BELL-3CT', Rank: 2 }),
  // Tomatoes
  R({ RuleId: 'SUB-2001', FromItemId: 'SG-TOM-BEEF', ToItemId: 'SG-TOM-ROM-3LB', QtyRatio: 0.625, Note: '15 lb carton = 0.625 case of 8 × 3 lb' }),
  R({ RuleId: 'SUB-2002', FromItemId: 'SG-TOM-WW-2LB', ToItemId: 'SG-TOM-ANGEL', Direction: 'Bidirectional', QtyRatio: 1.6, PriceBasis: 'Substitute' }),
  R({ RuleId: 'SUB-2003', FromItemId: 'SG-TOM-ROM-3LB', ToItemId: 'SG-TOM-BEEF', QtyRatio: 1.6, ValidFrom: isoDay(-75), ValidTo: isoDay(-20), Note: 'Fall changeover program (ended)' }),
  // Cucumbers
  R({ RuleId: 'SUB-3001', FromItemId: 'SG-CUC-MINI', ToItemId: 'SG-CUC-MINI-ORG', Note: 'Organic upgrade at the conventional price' }),
  R({ RuleId: 'SUB-3002', FromItemId: 'SG-CUC-MINI-ORG', ToItemId: 'SG-CUC-ORG-6CT', CustAccount: 'C10009', QtyRatio: 1, Note: 'Organic-for-organic only' }),
  R({ RuleId: 'SUB-3003', FromItemId: 'SG-CUC-ORG-6CT', ToItemId: 'SG-CUC-MINI-ORG', Rank: 2, ValidFrom: isoDay(10), Note: 'Starts with the winter 6ct reset' }),
  // Berries
  R({ RuleId: 'SUB-4001', FromItemId: 'SG-BER-WOW-10OZ', ToItemId: 'SG-BER-WOW-1LB', QtyRatio: 0.625, Note: '8 × 10 oz = 0.625 case of 8 × 1 lb' }),
  R({ RuleId: 'SUB-4002', FromItemId: 'SG-BER-WOW-10OZ', ToItemId: 'SG-BER-WOW-1LB', CustAccount: 'C10002', QtyRatio: 0.625, PriceBasis: 'Substitute', Note: 'Northwind pays the 1 lb price on trade-up' }),
]

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
let nextSo = 61240
const orders = Object.fromEntries(CUSTOMERS.map((c) => [c.customerId, { ids: [`SO-${nextSo++}`, `SO-${nextSo++}`], nextLine: {} }]))
function lineOn(customerId) {
  const o = orders[customerId]
  const SalesId = pick(o.ids)
  o.nextLine[SalesId] = (o.nextLine[SalesId] || 0) + 1
  return { SalesId, LineNum: o.nextLine[SalesId] }
}

/** Split `total` across `n` distinct customers (weighted random, whole tens). */
function splitDemand(total, n, eligible) {
  const custs = shuffle(eligible).slice(0, n)
  const w = custs.map(() => 0.6 + rnd())
  const sum = w.reduce((s, x) => s + x, 0)
  const qty = w.map((x) => Math.max(10, Math.round((total * x) / sum / 10) * 10))
  qty[0] += total - qty.reduce((s, x) => s + x, 0)
  return custs.map((c, i) => ({ customerId: c.customerId, qty: qty[i], ship: 1 + Math.floor(rnd() * 7), from: Math.floor(rnd() * SHIP_FROM.length) }))
}

const raw = { asOf: isoDay(0), commodities: [], items: [], customers: [], Demand: [], Supply: [], substitutions: SUBSTITUTIONS }
raw.customers = CUSTOMERS.map((c) => ({ substitutionPolicy: 'Standard', substitutionNote: '', ...c }))

for (const c of COMMODITIES) {
  raw.commodities.push({ CommodityId: c.id, Description: c.name, Blurb: c.blurb })
  for (const it of c.items) {
    raw.items.push({ ItemId: it.ItemId, CommodityId: c.id, name: it.name, uom: 'cs', Pack: it.pack, ListPrice: it.list, UnitCost: it.cost })
    // Natural accounts only buy organic cucumbers; no Never account takes the
    // generated lines (their beats are placed explicitly above).
    const eligible = CUSTOMERS.filter((x) => x.substitutionPolicy !== 'Never'
      && (c.id !== 'CUC' || /ORG/.test(it.ItemId) || !ORGANIC_ONLY.has(x.customerId)))
    const lines = Array.isArray(it.lines) ? it.lines : splitDemand(it.demand, it.lines, eligible)
    const lineSum = lines.reduce((s, l) => s + l.qty, 0)
    if (lineSum !== it.demand) throw new Error(`${it.ItemId}: lines sum ${lineSum} ≠ demand ${it.demand}`)
    for (const l of lines) {
      const { SalesId, LineNum } = lineOn(l.customerId)
      const from = SHIP_FROM[l.from]
      raw.Demand.push({ SalesId, LineNum, ItemId: it.ItemId, CustAccount: l.customerId, SiteId: from.SiteId, WarehouseId: from.WarehouseId,
        RequestedQty: l.qty, RequestedShipDate: isoDay(l.ship) })
    }
    raw.Supply.push({ ItemId: it.ItemId, ...(it.supplyAt || KGV), AvailableQty: it.supply })
  }
}

// Recent batches for the landing page ("Recent batches sent to D365").
const batch = (daysAgo, hour, n, strategy, commodityId, itemId, fill) => {
  const d = new Date(AS_OF); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hour, 10 + Math.floor(rnd() * 45), 0, 0)
  const batchId = `${(0x5a17c0de + n).toString(16)}-6f1c-4b7a-9a7e-${String(n).padStart(12, '0')}`
  return { topic: 'd365-proration-inbound', enqueuedUtc: d.toISOString(), messageId: batchId,
    body: { batchId, createdUtc: d.toISOString(), createdBy: cfg.persona.username, strategy, commodityId,
      lines: raw.Demand.filter((x) => x.ItemId === itemId).map((x) => ({ salesId: x.SalesId, lineNum: x.LineNum, itemId, allocatedQty: Math.round(x.RequestedQty * fill) })) } }
}
const outbox = [
  batch(4, 13, 1, 'Weighted', 'TOM', 'SG-TOM-WW-2LB', 0.95),
  batch(2, 8, 2, 'StraightLine', 'CUC', 'SG-CUC-ORG-6CT', 0.97),
  batch(1, 15, 3, 'Weighted', 'PEP', 'SG-PEP-SHAZAM', 0.83),
]

mkdirSync(join(here, 'data'), { recursive: true })
writeFileSync(join(here, 'data', 'snapshot.json'), JSON.stringify(raw, null, 2) + '\n')
writeFileSync(join(here, 'data', 'outbox.json'), JSON.stringify(outbox, null, 2) + '\n')

// ---------------------------------------------------------------------------
// Reconciliation summary — the numbers the pages will show, run through the
// same shared code the browser uses.
// ---------------------------------------------------------------------------
const { normalizeSnapshot } = require('../../public/js/shared/snapshot.js')
const core = require('../../public/js/shared/portal-core.js')
const Subs = require('../../public/js/shared/subs.js')
const snap = normalizeSnapshot(raw)
const fmt = (n) => Math.round(n).toLocaleString('en-US')
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

console.log(`SUNSET demo snapshot · as of ${raw.asOf} · ship dates ${isoDay(1)} … ${isoDay(7)}\n`)
console.log('Buyer group   Items  Demand   Supply   Fill    Status    Short items')
let td = 0, ts = 0
const rows = core.listCommodities(snap)
for (const r of rows) {
  td += r.totalDemand; ts += r.totalSupply
  console.log(`${r.name.padEnd(13)} ${String(r.itemCount).padStart(5)}  ${fmt(r.totalDemand).padStart(6)}   ${fmt(r.totalSupply).padStart(6)}   ${(r.fillRate * 100).toFixed(1).padStart(5)}%  ${r.status.padEnd(8)}  ${r.shortItems}`)
}
console.log(`\nKPIs: ${rows.length} buyer groups · ${snap.items.length} items · demand ${fmt(td)} · supply ${fmt(ts)} · fill ${((ts / td) * 100).toFixed(1)}% · ${rows.filter((r) => r.status !== 'OK').length} need attention`)
const pol = (p) => snap.customers.filter((c) => c.substitutionPolicy === p).length
console.log(`Customers ${snap.customers.length} (Standard ${pol('Standard')} · CustomerOnly ${pol('CustomerOnly')} · Never ${pol('Never')}) · lines ${snap.demand.length} · rules ${snap.substitutions.length} (` +
  ['Active', 'Expired', 'Scheduled'].map((s) => `${s} ${snap.substitutions.filter((r) => Subs.ruleStatus(r, raw.asOf) === s).length}`).join(' · ') + `) · outbox ${outbox.length}`)
const lineCheck = raw.Demand.reduce((s, d) => s + d.RequestedQty, 0)
console.log(`Tie-out: demand lines ${fmt(lineCheck)} ${lineCheck === td ? '= buyer-group demand ✓' : '≠ buyer-group demand ✗'}`)

// Hero walk-through: Weighted proration on every item, then auto-substitute.
const prorated = Object.fromEntries(snap.items.map((i) => [i.itemId, core.runProration(snap, { strategy: 'Weighted', itemId: i.itemId })]))
const pools = Object.fromEntries(snap.items.map((i) => { const p = prorated[i.itemId]; return [i.itemId, p.available - p.totalAllocated] }))
const shortLines = Object.values(prorated).flatMap((p) => p.lines.map((l) => ({ ...l, shortfall: l.requestedQty - l.allocatedQty })))
const auto = Subs.autoSubstitute({ shortLines, customers: snap.customers, rules: snap.substitutions, pools, asOf: raw.asOf })
const byItem = Object.fromEntries(snap.items.map((i) => [i.itemId, i]))
let rev = 0, mar = 0, baseMar = 0
for (const s of auto.staged) {
  const e = Subs.subEconomics({ fromItem: byItem[s.fromItemId], toItem: byItem[s.toItemId], qty: s.qty, ratio: s.ratio, priceBasis: s.priceBasis })
  rev += e.revenue; mar += e.margin; baseMar += e.baselineMargin
}
console.log(`\nAfter Weighted proration on every item → Auto-substitute:`)
console.log(`  ${auto.staged.length} substitutions · covers ${fmt(auto.coveredQty)} of ${fmt(auto.shortQty)} short cases (${((auto.coveredQty / auto.shortQty) * 100).toFixed(0)}%)`)
console.log(`  revenue recovered ${money(rev)} · margin ${money(mar)} (${((mar / rev) * 100).toFixed(1)}%) vs ${money(baseMar)} had the ordered items shipped`)
const why = (r) => auto.skipped.filter((s) => s.reason === r)
console.log(`  skipped: never ${why('never').length} · no applicable rule ${why('no-rule').length} · substitute stock ran out ${why('stock').length}`)
for (const s of auto.staged.filter((x) => x.fromItemId === 'SG-PEP-BELL')) {
  const c = snap.customers.find((x) => x.customerId === s.customerId)
  console.log(`    ${s.salesId}/${s.lineNum} ${c.name.padEnd(26)} → ${s.toItemId.padEnd(16)} ${String(s.qty).padStart(4)} cs (${s.scope})`)
}
console.log(`\n→ ${join(here, 'data', 'snapshot.json')}\n→ ${join(here, 'data', 'outbox.json')}`)
