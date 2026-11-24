// Tests for the service-processing layer:
//   - proration.js   (the three allocation strategies + remainder handling)
//   - d365Client.js  (snapshot normalization from the D365 read service,
//                     SendMessage envelope construction)
// Run with: npm test  (node --test, no extra dependencies)

const test = require('node:test');
const assert = require('node:assert/strict');

const { prorate, PRIORITY_WEIGHTS } = require('../server/proration');
const { buildBatchMessage, buildSubstitutionMessage } = require('../server/d365Client');

function line(salesId, customerId, requestedQty, extra = {}) {
  return { key: `${salesId}:1`, salesId, lineNum: 1, customerId, requestedQty, ...extra };
}

const sum = (rows, f = r => r.allocatedQty) => rows.reduce((s, r) => s + f(r), 0);

// ---- StraightLine -----------------------------------------------------------

test('StraightLine: allocates everything when supply covers demand', () => {
  const lines = [line('SO1', 'C1', 100), line('SO2', 'C2', 50)];
  const out = prorate('StraightLine', lines, 200);
  assert.equal(sum(out), 150);
  for (const r of out) assert.equal(r.allocatedQty, r.requestedQty);
});

test('StraightLine: shorts everyone at the same fill rate', () => {
  const lines = [line('SO1', 'C1', 100), line('SO2', 'C2', 100)];
  const out = prorate('StraightLine', lines, 100);
  assert.equal(sum(out), 100, 'allocates exactly the available qty');
  // equal requests -> equal (or ±1 from remainder) allocations
  assert.ok(Math.abs(out[0].allocatedQty - out[1].allocatedQty) <= 1);
});

test('StraightLine: integer allocations, exact conservation with awkward numbers', () => {
  const lines = [line('SO1', 'C1', 33), line('SO2', 'C2', 33), line('SO3', 'C3', 34)];
  const out = prorate('StraightLine', lines, 50);
  assert.equal(sum(out), 50);
  for (const r of out) {
    assert.equal(r.allocatedQty, Math.trunc(r.allocatedQty), 'whole units only');
    assert.ok(r.allocatedQty <= r.requestedQty, 'never over-allocates a line');
  }
});

test('StraightLine: zero demand and zero supply are safe', () => {
  assert.equal(sum(prorate('StraightLine', [], 100)), 0);
  assert.equal(sum(prorate('StraightLine', [line('SO1', 'C1', 0)], 100)), 0);
  assert.equal(sum(prorate('StraightLine', [line('SO1', 'C1', 10)], 0)), 0);
});

// ---- Weighted ---------------------------------------------------------------

const CUSTOMERS = [
  { customerId: 'C1', name: 'Priority One', priority: 1 },
  { customerId: 'C3', name: 'Standard',     priority: 3 },
  { customerId: 'C5', name: 'Priority Five', priority: 5 },
];

test('Weighted: higher-priority customer gets a larger share of a short supply', () => {
  const lines = [line('SO1', 'C1', 100), line('SO2', 'C5', 100)];
  const out = prorate('Weighted', lines, 100, { customers: CUSTOMERS });
  assert.equal(sum(out), 100);
  const p1 = out.find(r => r.customerId === 'C1');
  const p5 = out.find(r => r.customerId === 'C5');
  assert.ok(p1.allocatedQty > p5.allocatedQty, `P1 (${p1.allocatedQty}) should beat P5 (${p5.allocatedQty})`);
  // expected split is 1.50 : 0.50 -> 75 / 25
  assert.equal(p1.allocatedQty, 75);
  assert.equal(p5.allocatedQty, 25);
});

test('Weighted: caps at requested and redistributes (iterative solve)', () => {
  // C1's weighted share would exceed its small request -> capped, leftover flows to C5
  const lines = [line('SO1', 'C1', 10), line('SO2', 'C5', 100)];
  const out = prorate('Weighted', lines, 60, { customers: CUSTOMERS });
  assert.equal(sum(out), 60);
  assert.equal(out.find(r => r.customerId === 'C1').allocatedQty, 10, 'capped at request');
  assert.equal(out.find(r => r.customerId === 'C5').allocatedQty, 50, 'gets the remainder');
});

test('Weighted: unknown customer defaults to priority 3 weight', () => {
  const lines = [line('SO1', 'C3', 100), line('SO2', 'GHOST', 100)];
  const out = prorate('Weighted', lines, 100, { customers: CUSTOMERS });
  // identical effective weights -> even split
  assert.equal(out[0].allocatedQty, 50);
  assert.equal(out[1].allocatedQty, 50);
});

test('Weighted: never over-allocates and conserves with many uneven lines', () => {
  const lines = [
    line('SO1', 'C1', 17), line('SO2', 'C3', 250), line('SO3', 'C5', 3),
    line('SO4', 'C1', 999), line('SO5', 'C3', 41),
  ];
  const available = 300;
  const out = prorate('Weighted', lines, available, { customers: CUSTOMERS });
  assert.equal(sum(out), available);
  for (const r of out) {
    assert.ok(r.allocatedQty >= 0 && r.allocatedQty <= r.requestedQty);
    assert.equal(r.allocatedQty, Math.trunc(r.allocatedQty));
  }
});

// ---- HistoryAware -----------------------------------------------------------

test('HistoryAware: customer with fill-rate debt gets boosted over an identical peer', () => {
  const customers = [
    { customerId: 'A', priority: 3 },
    { customerId: 'B', priority: 3 },
  ];
  const history = { A: 0.6, B: 1.0 }; // A was shorted recently
  const lines = [line('SO1', 'A', 100), line('SO2', 'B', 100)];
  const out = prorate('HistoryAware', lines, 100, { customers, history, options: { alpha: 0.5 } });
  assert.equal(sum(out), 100);
  const a = out.find(r => r.customerId === 'A');
  const b = out.find(r => r.customerId === 'B');
  assert.ok(a.allocatedQty > b.allocatedQty, `debtor A (${a.allocatedQty}) should beat B (${b.allocatedQty})`);
});

test('HistoryAware: with no history it degrades to plain Weighted', () => {
  const lines = [line('SO1', 'C1', 100), line('SO2', 'C5', 100)];
  const weighted = prorate('Weighted', lines, 100, { customers: CUSTOMERS });
  const history = prorate('HistoryAware', lines, 100, { customers: CUSTOMERS, history: {} });
  assert.deepEqual(
    history.map(r => r.allocatedQty),
    weighted.map(r => r.allocatedQty),
  );
});

test('HistoryAware: alpha=0 ignores history entirely', () => {
  const customers = [{ customerId: 'A', priority: 3 }, { customerId: 'B', priority: 3 }];
  const out = prorate('HistoryAware',
    [line('SO1', 'A', 100), line('SO2', 'B', 100)],
    100,
    { customers, history: { A: 0.1 }, options: { alpha: 0 } });
  assert.equal(out[0].allocatedQty, 50);
  assert.equal(out[1].allocatedQty, 50);
});

// ---- strategy dispatch & metadata --------------------------------------------

test('prorate: unknown strategy throws', () => {
  assert.throws(() => prorate('Nonsense', [], 0), /Unknown strategy/);
});

test('prorate: every result row carries weightUsed and a reason code', () => {
  const out = prorate('Weighted', [line('SO1', 'C1', 10)], 5, { customers: CUSTOMERS });
  for (const r of out) {
    assert.equal(typeof r.weightUsed, 'number');
    assert.match(r.reasonCode, /^PRORATE-/);
  }
  assert.equal(out[0].weightUsed, PRIORITY_WEIGHTS[1]);
});

// ---- d365Client: outbound SendMessage batch envelope ---------------------------
// One SysMessageService message per batch: a head record (BatchId) plus a
// Records array the D365 message processor consumes directly.

test('buildBatchMessage: one envelope per batch — BatchId head + Records array', () => {
  const msg = buildBatchMessage(
    [
      { salesId: '000751', lineNum: 1, itemId: 'A0001', allocatedQty: 5 },
      { salesId: '000811', lineNum: 3, itemId: 'A0001', allocatedQty: 2370 },
    ],
    'USMF',
    '47beadc2-d3fd-4135-a626-ffcd46c16f52',
  );
  assert.equal(msg._companyId, 'USMF');
  assert.equal(msg._messageQueue, 'rsmSalesProrateAccelerator');
  assert.equal(msg._messageType, 'rsmSalesProrateAcceleratorMessage');

  assert.deepEqual(JSON.parse(msg._messageContent), {
    BatchId: '47beadc2-d3fd-4135-a626-ffcd46c16f52',
    Records: [
      { SalesOrderNumber: '000751', SalesLineNumber: 1, ItemId: 'A0001', DeliveryReminder: 5 },
      { SalesOrderNumber: '000811', SalesLineNumber: 3, ItemId: 'A0001', DeliveryReminder: 2370 },
    ],
  });
});

test('buildSubstitutionMessage: own message type, sub-specific record shape', () => {
  const msg = buildSubstitutionMessage(
    [{ salesId: '000697', lineNum: 1, fromItemId: 'D0001', toItemId: 'A0001', qty: 40, remainingOriginalQty: 5 }],
    'USMF',
    '8c1d2f30-aaaa-bbbb-cccc-001122334455',
  );
  assert.equal(msg._messageQueue, 'rsmSalesProrateAccelerator', 'same queue as proration');
  assert.equal(msg._messageType, 'rsmSalesSubstituteAcceleratorMessage', 'but a different message type');

  assert.deepEqual(JSON.parse(msg._messageContent), {
    BatchId: '8c1d2f30-aaaa-bbbb-cccc-001122334455',
    Records: [{
      SalesOrderNumber: '000697',
      SalesLineNumber: 1,
      OriginalItemId: 'D0001',
      SubstituteItemId: 'A0001',
      SubstituteQty: 40,
      RemainingOriginalQty: 5,
    }],
  });
});

test('buildBatchMessage: SalesOrderNumber is a string; line number and qty are numbers', () => {
  const msg = buildBatchMessage(
    [{ salesId: 751, lineNum: '2', itemId: 'X', allocatedQty: '7' }],
    'USMF', 'batch-1');
  const rec = JSON.parse(msg._messageContent).Records[0];
  assert.equal(rec.SalesOrderNumber, '751');
  assert.equal(rec.SalesLineNumber, 2);
  assert.equal(rec.DeliveryReminder, 7);
});

// ---- Customer-based substitution (public/js/shared/subs.js) -------------------

const Subs = require('../public/js/shared/subs.js');
const { buildRuleMessage } = require('../server/d365Client');
const { normalizeSnapshot } = require('../public/js/shared/snapshot.js');
const core = require('../public/js/shared/portal-core.js');

const ASOF = '2026-11-24';
const rule = (o) => ({ ruleId: o.ruleId || `${o.fromItemId}>${o.toItemId}:${o.customerId || '*'}`, direction: 'OneWay', rank: 1, qtyRatio: 1,
  customerId: '', priceBasis: 'Original', validFrom: '', validTo: '', ...o });
const RULES = [
  rule({ fromItemId: 'BELL', toItemId: '3CT', qtyRatio: 0.75 }),
  rule({ fromItemId: 'BELL', toItemId: 'TWST', customerId: 'GL' }),
  rule({ fromItemId: 'WW', toItemId: 'ANGEL', direction: 'Bidirectional', qtyRatio: 1.6 }),
  rule({ fromItemId: 'ROMA', toItemId: 'BEEF', validTo: '2026-11-01' }),
];
const std = { customerId: 'X', priority: 3, substitutionPolicy: 'Standard' };

test('substitutesFor: customer rule first, then all-customer rules', () => {
  const out = Subs.substitutesFor(RULES, { customerId: 'GL', substitutionPolicy: 'Standard' }, 'BELL', ASOF);
  assert.deepEqual(out.map(c => c.toItemId), ['TWST', '3CT']);
  assert.equal(out[0].scope, 'Customer');
});

test('substitutesFor: CustomerOnly ignores all-customer rules; Never gets nothing', () => {
  assert.deepEqual(Subs.substitutesFor(RULES, { customerId: 'GL', substitutionPolicy: 'CustomerOnly' }, 'BELL', ASOF).map(c => c.toItemId), ['TWST']);
  assert.deepEqual(Subs.substitutesFor(RULES, { customerId: 'X', substitutionPolicy: 'CustomerOnly' }, 'BELL', ASOF), []);
  assert.deepEqual(Subs.substitutesFor(RULES, { customerId: 'GL', substitutionPolicy: 'Never' }, 'BELL', ASOF), []);
});

test('substitutesFor: bidirectional rule read backwards uses the inverse ratio; expired rules are ignored', () => {
  const back = Subs.substitutesFor(RULES, std, 'ANGEL', ASOF);
  assert.equal(back[0].toItemId, 'WW');
  assert.ok(Math.abs(back[0].ratio - 1 / 1.6) < 1e-9);
  assert.equal(Subs.substitutesFor(RULES, std, 'ROMA', ASOF).length, 0);
  assert.equal(Subs.ruleStatus(RULES[3], ASOF), 'Expired');
  assert.equal(Subs.ruleStatus(rule({ validFrom: '2026-12-01' }), ASOF), 'Scheduled');
});

test('autoSubstitute: P1 served first, pools respected, Never and no-rule lines skipped', () => {
  const customers = [
    { customerId: 'GL', priority: 1, substitutionPolicy: 'Standard' },
    { customerId: 'A', priority: 2, substitutionPolicy: 'Standard' },
    { customerId: 'B', priority: 3, substitutionPolicy: 'Standard' },
    { customerId: 'N', priority: 1, substitutionPolicy: 'Never' },
  ];
  const shortLines = [
    { salesId: 'S3', lineNum: 1, itemId: 'BELL', customerId: 'B', shortfall: 100 },
    { salesId: 'S2', lineNum: 1, itemId: 'BELL', customerId: 'A', shortfall: 100 },
    { salesId: 'S1', lineNum: 1, itemId: 'BELL', customerId: 'GL', shortfall: 50 },
    { salesId: 'S4', lineNum: 1, itemId: 'BELL', customerId: 'N', shortfall: 40 },
    { salesId: 'S5', lineNum: 1, itemId: 'SHAZ', customerId: 'A', shortfall: 10 },
  ];
  const pools = { '3CT': 90, TWST: 30 };
  const r = Subs.autoSubstitute({ shortLines, customers, rules: RULES, pools, asOf: ASOF });
  // GL: 30 Twister (customer rule) then 3ct for the remaining 20 → ceil(20 × 0.75) = 15
  assert.deepEqual(r.staged.filter(s => s.customerId === 'GL').map(s => [s.toItemId, s.qty]), [['TWST', 30], ['3CT', 15]]);
  // A takes the next 75 of 3ct (100 × 0.75); B is left with nothing
  assert.deepEqual(r.staged.filter(s => s.customerId === 'A').map(s => [s.toItemId, s.qty]), [['3CT', 75]]);
  assert.equal(r.staged.filter(s => s.customerId === 'B').length, 0);
  assert.equal(r.staged.filter(s => s.toItemId === '3CT').reduce((t, s) => t + s.qty, 0), 90, 'never exceeds the pool');
  assert.deepEqual(r.skipped.map(s => s.reason).sort(), ['never', 'no-rule', 'stock']);
  assert.equal(pools['3CT'], 90, 'input pools not mutated');
});

test('subEconomics: price basis changes revenue, cost is always the substitute', () => {
  const from = { listPrice: 18.75, unitCost: 13.4 }, to = { listPrice: 28.8, unitCost: 17.5 };
  const orig = Subs.subEconomics({ fromItem: from, toItem: to, qty: 10, ratio: 1, priceBasis: 'Original' });
  const sub = Subs.subEconomics({ fromItem: from, toItem: to, qty: 10, ratio: 1, priceBasis: 'Substitute' });
  assert.equal(orig.revenue, 187.5); assert.equal(sub.revenue, 288);
  assert.equal(orig.cost, 175); assert.equal(sub.cost, 175);
  assert.ok(Math.abs(orig.baselineMargin - 53.5) < 1e-9);
  assert.equal(Subs.subEconomics({ fromItem: {}, toItem: to, qty: 1 }), null, 'unknown prices → null, not a fake margin');
});

test('validateRule: same buyer group, no self-substitution, sane ratio and dates', () => {
  const items = [{ itemId: 'A', commodityId: 'P' }, { itemId: 'B', commodityId: 'P' }, { itemId: 'C', commodityId: 'T' }];
  assert.deepEqual(Subs.validateRule(rule({ fromItemId: 'A', toItemId: 'B' }), items), []);
  assert.ok(Subs.validateRule(rule({ fromItemId: 'A', toItemId: 'C' }), items).length);
  assert.ok(Subs.validateRule(rule({ fromItemId: 'A', toItemId: 'A' }), items).length);
  assert.ok(Subs.validateRule(rule({ fromItemId: 'A', toItemId: 'B', qtyRatio: 0 }), items).length);
  assert.ok(Subs.validateRule(rule({ fromItemId: 'A', toItemId: 'B', validFrom: '2026-12-01', validTo: '2026-11-01' }), items).length);
});

test('buildRuleMessage: own message type, rules + customer policies', () => {
  const env = buildRuleMessage({
    rules: [{ action: 'Upsert', rule: rule({ ruleId: 'SUB-1', fromItemId: 'A', toItemId: 'B', customerId: 'C1', priceBasis: 'Substitute' }) },
            { action: 'Delete', rule: rule({ ruleId: 'SUB-2', fromItemId: 'A', toItemId: 'C' }) }],
    policies: [{ customerId: 'C9', substitutionPolicy: 'Never', substitutionNote: 'menu spec' }],
  }, 'MPL', 'b-1');
  assert.equal(env._messageType, 'rsmSalesSubstitutionRuleMessage');
  assert.equal(env._messageQueue, 'rsmSalesProrateAccelerator');
  const c = JSON.parse(env._messageContent);
  assert.equal(c.BatchId, 'b-1');
  assert.deepEqual(c.Rules.map(r => r.Action), ['Upsert', 'Delete']);
  assert.equal(c.Rules[0].PriceBasis, 'SubstituteItemPrice');
  assert.equal(c.Rules[1].CustAccount, '');
  assert.deepEqual(c.CustomerPolicies, [{ CustAccount: 'C9', SubstitutionPolicy: 'Never', Note: 'menu spec' }]);
});

test('normalizeSnapshot: prices, policies and rule fields; D365 "never" dates are blank', () => {
  const snap = normalizeSnapshot({
    asOf: '2026-11-24',
    items: [{ ItemId: 'A', CommodityId: 'P', name: 'A', ListPrice: 10, UnitCost: 6 }, { ItemId: 'B', CommodityId: 'P' }],
    customers: [{ CustAccount: 'C1', name: 'One', RSMSubstitutionPolicy: 'never' }, { CustAccount: 'C2', name: 'Two' }],
    substitutions: [{ FromItemId: 'A', ToItemId: 'B', Direction: 'Bidirectional', PriceBasis: 'SubstituteItemPrice', ValidFrom: '1900-01-01T00:00:00' }],
  });
  assert.equal(snap.asOf, '2026-11-24');
  assert.equal(snap.items[0].listPrice, 10); assert.equal(snap.items[1].listPrice, null);
  assert.deepEqual(snap.customers.map(c => c.substitutionPolicy), ['Never', 'Standard']);
  assert.equal(snap.substitutions[0].direction, 'Bidirectional');
  assert.equal(snap.substitutions[0].priceBasis, 'Substitute');
  assert.equal(snap.substitutions[0].validFrom, '');
});

test('cleanRulePublish: rejects unknown customers, bad policies and invalid rules', () => {
  const snap = { items: [{ itemId: 'A', commodityId: 'P' }, { itemId: 'B', commodityId: 'P' }], customers: [{ customerId: 'C1' }] };
  assert.throws(() => core.cleanRulePublish({}, snap), /required/);
  assert.throws(() => core.cleanRulePublish({ policies: [{ customerId: 'ZZ', substitutionPolicy: 'Never' }] }, snap), /Unknown customer/);
  assert.throws(() => core.cleanRulePublish({ policies: [{ customerId: 'C1', substitutionPolicy: 'Sometimes' }] }, snap), /Invalid policy/);
  assert.throws(() => core.cleanRulePublish({ rules: [{ action: 'Upsert', rule: rule({ fromItemId: 'A', toItemId: 'A' }) }] }, snap), /itself/);
  assert.equal(core.cleanRulePublish({ rules: [{ action: 'Delete', rule: rule({ ruleId: 'R1', fromItemId: 'A', toItemId: 'B' }) }] }, snap).rules.length, 1);
});

// ---- Interchangeable groups (the generic layer under the rules) ---------------

const PEPPERS = { groupId: 'GRP-PEP', name: 'Sweet peppers', unit: 'lb', priceBasis: 'Original', validFrom: '', validTo: '',
  members: [{ itemId: '3CT', equivQty: 14.7 }, { itemId: 'TWST', equivQty: 12 }, { itemId: 'BELL', equivQty: 11 }] };

test('groupRules: every member covers every other, ratio = equiv(ordered) / equiv(substitute), ranked by member order', () => {
  const vr = Subs.groupRules([PEPPERS]);
  assert.equal(vr.length, 6);
  const b3 = vr.find(r => r.fromItemId === 'BELL' && r.toItemId === '3CT');
  assert.ok(Math.abs(b3.qtyRatio - 11 / 14.7) < 1e-9);
  assert.equal(b3.rank, 1);
  assert.equal(vr.find(r => r.fromItemId === 'BELL' && r.toItemId === 'TWST').rank, 2);
  assert.ok(vr.every(r => r.groupId === 'GRP-PEP' && r.ruleId === 'GRP-PEP' && r.customerId === ''));
});

test('substitutesFor with groups: customer rule, then all-customer rule, then group; explicit rule wins the same pair', () => {
  const rules = Subs.withGroups([
    rule({ fromItemId: 'BELL', toItemId: 'TWST', customerId: 'GL' }),
    rule({ fromItemId: 'BELL', toItemId: '3CT', qtyRatio: 0.75 }),
  ], [PEPPERS]);
  const gl = Subs.substitutesFor(rules, { customerId: 'GL', substitutionPolicy: 'Standard' }, 'BELL', ASOF);
  assert.deepEqual(gl.map(c => [c.toItemId, c.scope]), [['TWST', 'Customer'], ['3CT', 'All customers']]);
  assert.equal(gl[1].ratio, 0.75, 'explicit rule ratio, not the group ratio');
  const other = Subs.substitutesFor(rules, std, 'TWST', ASOF);
  assert.deepEqual(other.map(c => [c.toItemId, c.scope]), [['3CT', 'Group'], ['BELL', 'Group']]);
});

test('groups never apply to CustomerOnly or Never customers, nor outside their validity window', () => {
  const rules = Subs.groupRules([PEPPERS]);
  assert.deepEqual(Subs.substitutesFor(rules, { customerId: 'K', substitutionPolicy: 'CustomerOnly' }, 'BELL', ASOF), []);
  assert.deepEqual(Subs.substitutesFor(rules, { customerId: 'N', substitutionPolicy: 'Never' }, 'BELL', ASOF), []);
  assert.deepEqual(Subs.substitutesFor(Subs.groupRules([{ ...PEPPERS, validFrom: '2026-12-15' }]), std, 'BELL', ASOF), []);
});

test('autoSubstitute: a customer with no rules of their own is filled from the group', () => {
  const r = Subs.autoSubstitute({
    shortLines: [{ salesId: 'S1', lineNum: 1, itemId: 'BELL', customerId: 'X', shortfall: 100 }],
    customers: [std], rules: Subs.withGroups([], [PEPPERS]), pools: { '3CT': 40, TWST: 500 }, asOf: ASOF,
  });
  assert.deepEqual(r.staged.map(s => [s.toItemId, s.qty, s.scope, s.ruleId]), [['3CT', 40, 'Group', 'GRP-PEP'], ['TWST', 43, 'Group', 'GRP-PEP']]); // 40 × 3ct covers 53.5; 46.5 × 11/12 → 43
  assert.ok(Math.abs(r.coveredQty - 100) < 1e-9);
});

test('validateGroup and applyGroupChanges', () => {
  const items = [{ itemId: '3CT', commodityId: 'PEP' }, { itemId: 'TWST', commodityId: 'PEP' }, { itemId: 'BELL', commodityId: 'PEP' }, { itemId: 'BEEF', commodityId: 'TOM' }];
  assert.deepEqual(Subs.validateGroup(PEPPERS, items), []);
  assert.ok(Subs.validateGroup({ ...PEPPERS, members: PEPPERS.members.slice(0, 1) }, items).length);
  assert.ok(Subs.validateGroup({ ...PEPPERS, members: [...PEPPERS.members, { itemId: 'BEEF', equivQty: 15 }] }, items).length);
  assert.ok(Subs.validateGroup({ ...PEPPERS, members: [{ itemId: 'BELL', equivQty: 0 }, { itemId: 'TWST', equivQty: 12 }] }, items).length);
  const out = Subs.applyGroupChanges([PEPPERS], [{ action: 'Upsert', group: { ...PEPPERS, name: 'Peppers' } }, { action: 'Upsert', group: { groupId: 'G2', name: 'New', members: [] } }]);
  assert.deepEqual(out.map(g => g.name), ['Peppers', 'New']);
  assert.deepEqual(Subs.applyGroupChanges(out, [{ action: 'Delete', group: { groupId: 'G2' } }]).map(g => g.groupId), ['GRP-PEP']);
});

test('buildRuleMessage carries SubstitutionGroups; normalizeSnapshot reads them back in Sequence order', () => {
  const c = JSON.parse(buildRuleMessage({ groups: [{ action: 'Upsert', group: { ...PEPPERS, priceBasis: 'Substitute' } }] }, 'MPL', 'b-2')._messageContent);
  assert.equal(c.SubstitutionGroups[0].GroupId, 'GRP-PEP');
  assert.equal(c.SubstitutionGroups[0].PriceBasis, 'SubstituteItemPrice');
  assert.deepEqual(c.SubstitutionGroups[0].Members.map(m => [m.ItemId, m.Sequence]), [['3CT', 1], ['TWST', 2], ['BELL', 3]]);
  const snap = normalizeSnapshot({ substitutionGroups: [{ ...c.SubstitutionGroups[0], Members: c.SubstitutionGroups[0].Members.slice().reverse() }] });
  assert.deepEqual(snap.substitutionGroups[0].members.map(m => m.itemId), ['3CT', 'TWST', 'BELL']);
  assert.equal(snap.substitutionGroups[0].priceBasis, 'Substitute');
});

test('cleanRulePublish validates group changes', () => {
  const snap = { items: [{ itemId: 'A', commodityId: 'P' }, { itemId: 'B', commodityId: 'P' }], customers: [] };
  const g = { groupId: 'G1', name: 'AB', members: [{ itemId: 'A', equivQty: 1 }, { itemId: 'B', equivQty: 2 }] };
  assert.equal(core.cleanRulePublish({ groups: [{ action: 'Upsert', group: g }] }, snap).groups.length, 1);
  assert.throws(() => core.cleanRulePublish({ groups: [{ action: 'Upsert', group: { ...g, members: g.members.slice(0, 1) } }] }, snap), /at least two/);
  assert.throws(() => core.cleanRulePublish({ groups: [{ action: 'Upsert', group: { ...g, groupId: '' } }] }, snap), /groupId/);
});
