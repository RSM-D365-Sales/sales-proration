// Proration algorithms.
// Each algorithm takes:
//   lines       = [{ key, requestedQty, customerId, ...passthrough }]
//   available   = number
//   context     = { customers, history, options }
// and returns:
//   [{ key, requestedQty, allocatedQty, weightUsed, reasonCode }]

const PRIORITY_WEIGHTS = { 1: 1.50, 2: 1.25, 3: 1.00, 4: 0.75, 5: 0.50 };

function roundDown(n) { return Math.floor(n); }

/** Distribute any leftover (from rounding) to lines with most remaining unmet demand. */
function distributeRemainder(results, available) {
  let allocated = results.reduce((s, r) => s + r.allocatedQty, 0);
  let remainder = available - allocated;
  if (remainder <= 0) return results;

  // sort by remaining unmet demand desc
  const eligible = results
    .filter(r => r.allocatedQty < r.requestedQty)
    .sort((a, b) => (b.requestedQty - b.allocatedQty) - (a.requestedQty - a.allocatedQty));

  let i = 0;
  while (remainder > 0 && eligible.length > 0) {
    const r = eligible[i % eligible.length];
    if (r.allocatedQty < r.requestedQty) {
      r.allocatedQty += 1;
      remainder -= 1;
    }
    i++;
    if (i > 100000) break; // safety
  }
  return results;
}

/** Straight-line: every line gets the same fill % = available / totalRequested. */
function straightLine(lines, available) {
  const totalRequested = lines.reduce((s, l) => s + l.requestedQty, 0);
  if (totalRequested === 0) return lines.map(l => ({ ...l, allocatedQty: 0, weightUsed: 1, reasonCode: 'PRORATE-STRAIGHTLINE' }));

  const fillRate = Math.min(1, available / totalRequested);
  const results = lines.map(l => ({
    ...l,
    allocatedQty: roundDown(l.requestedQty * fillRate),
    weightUsed: 1,
    reasonCode: 'PRORATE-STRAIGHTLINE',
  }));
  return distributeRemainder(results, Math.min(available, totalRequested));
}

/**
 * Weighted by customer priority.
 * allocation_i = min(requested_i, requested_i * w_i * k)
 * Solve k so sum(allocation_i) = available (subject to caps at requested).
 */
function weighted(lines, available, context) {
  const customersById = Object.fromEntries((context.customers || []).map(c => [c.customerId, c]));
  const weightFor = (l) => {
    const p = customersById[l.customerId]?.priority ?? 3;
    return PRIORITY_WEIGHTS[p] ?? 1.0;
  };

  return weightedCore(lines, available, weightFor, 'PRORATE-WEIGHTED');
}

/**
 * History-aware: priority weight scaled by recent fill-rate debt.
 *   w' = w * (1 + alpha * (1 - avgFill))
 */
function historyAware(lines, available, context) {
  const customersById = Object.fromEntries((context.customers || []).map(c => [c.customerId, c]));
  const history = context.history || {};
  const alpha = context.options?.alpha ?? 0.5;

  const weightFor = (l) => {
    const p = customersById[l.customerId]?.priority ?? 3;
    const base = PRIORITY_WEIGHTS[p] ?? 1.0;
    const avgFill = history[l.customerId] ?? 1.0;
    const debt = Math.max(0, 1 - avgFill);
    return base * (1 + alpha * debt);
  };

  return weightedCore(lines, available, weightFor, 'PRORATE-HISTORY');
}

/** Shared solver: scale weighted requests to fit `available`, capping at request, iterating for overflow. */
function weightedCore(lines, available, weightFor, reasonCode) {
  // working set with weights
  let working = lines.map(l => ({
    ...l,
    weightUsed: weightFor(l),
    allocatedQty: 0,
    capped: false,
  }));

  let remaining = available;

  // Iterate: at each pass, find k so weighted sum = remaining among non-capped lines.
  // If any allocation exceeds its requestedQty, cap it and re-solve.
  for (let pass = 0; pass < 25; pass++) {
    const open = working.filter(w => !w.capped);
    if (open.length === 0) break;

    const denom = open.reduce((s, w) => s + w.requestedQty * w.weightUsed, 0);
    if (denom <= 0) break;

    const k = remaining / denom;
    let anyCapped = false;

    for (const w of open) {
      const raw = w.requestedQty * w.weightUsed * k;
      if (raw >= w.requestedQty) {
        // cap
        remaining -= w.requestedQty;
        w.allocatedQty = w.requestedQty;
        w.capped = true;
        anyCapped = true;
      }
    }
    if (!anyCapped) {
      // assign final values
      for (const w of open) {
        w.allocatedQty = roundDown(w.requestedQty * w.weightUsed * k);
      }
      break;
    }
  }

  // Set reason code + redistribute rounding remainder
  const totalRequested = working.reduce((s, w) => s + w.requestedQty, 0);
  const results = working.map(w => ({ ...w, reasonCode }));
  return distributeRemainder(results, Math.min(available, totalRequested));
}

const STRATEGIES = {
  StraightLine: straightLine,
  Weighted: weighted,
  HistoryAware: historyAware,
};

function prorate(strategy, lines, available, context = {}) {
  const fn = STRATEGIES[strategy];
  if (!fn) throw new Error(`Unknown strategy: ${strategy}`);
  return fn(lines, available, context);
}

module.exports = { prorate, STRATEGIES, PRIORITY_WEIGHTS };
