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
