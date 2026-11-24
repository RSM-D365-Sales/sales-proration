// SysMessageService.SendMessage envelopes — the exact payloads the app pushes
// to the D365 message queue `rsmSalesProrateAccelerator`.
//
// Shared between the Node server (server/d365Client.js posts them to D365)
// and the browser (static builds show and log the same envelope without
// sending it), so a demo shows byte-for-byte what production would send.
//
// One queue, three message types, each with its own X++ consumer:
//   rsmSalesProrateAcceleratorMessage   RSMProrationBatchConsumer    allocate
//   rsmSalesSubstituteAcceleratorMessage RSMSubstitutionConsumer     order surgery
//   rsmSalesSubstitutionRuleMessage     RSMSubstitutionRuleConsumer  rule + policy upkeep
(function (root) {

const SEND_MESSAGE_PATH = '/api/services/SysMessageServices/SysMessageService/SendMessage';
const MESSAGE_QUEUE     = 'rsmSalesProrateAccelerator';
const MESSAGE_TYPE      = 'rsmSalesProrateAcceleratorMessage';
const SUB_MESSAGE_TYPE  = 'rsmSalesSubstituteAcceleratorMessage';
const RULE_MESSAGE_TYPE = 'rsmSalesSubstitutionRuleMessage';

const asArray = v => (Array.isArray(v) ? v : []);
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envelope(company, messageType, content) {
  return {
    _companyId:      company,
    _messageQueue:   MESSAGE_QUEUE,
    _messageType:    messageType,
    _messageContent: JSON.stringify(content),
  };
}

/** One batch of allocated lines:
 *  { BatchId, Records: [{ SalesOrderNumber, SalesLineNumber, ItemId, DeliveryReminder }] } */
function buildBatchMessage(lines, company, batchId) {
  return envelope(company, MESSAGE_TYPE, {
    BatchId: batchId,
    Records: asArray(lines).map(l => ({
      SalesOrderNumber: String(l.salesId),
      SalesLineNumber:  num(l.lineNum, 0),
      ItemId:           l.itemId,
      DeliveryReminder: num(l.allocatedQty, 0), // the prorated quantity
    })),
  });
}

/** One batch of staged substitutions. D365 re-resolves the rule (and its
 *  price basis) from RSMItemSubstitution — the app proposes, D365 disposes. */
function buildSubstitutionMessage(subs, company, batchId) {
  return envelope(company, SUB_MESSAGE_TYPE, {
    BatchId: batchId,
    Records: asArray(subs).map(s => ({
      SalesOrderNumber:     String(s.salesId),
      SalesLineNumber:      num(s.lineNum, 0),
      OriginalItemId:       s.fromItemId,
      SubstituteItemId:     s.toItemId,
      SubstituteQty:        num(s.qty, 0),
      RemainingOriginalQty: num(s.remainingOriginalQty, 0),
    })),
  });
}

/**
 * Rule and policy maintenance: upserts/deletes RSMItemSubstitution rows and
 * sets CustTable.RSMSubstitutionPolicy.
 *   rules:    [{ action: 'Upsert'|'Delete', rule: { ruleId, fromItemId, … } }]
 *   policies: [{ customerId, substitutionPolicy, substitutionNote }]
 */
function buildRuleMessage({ rules = [], policies = [], groups = [] } = {}, company, batchId) {
  return envelope(company, RULE_MESSAGE_TYPE, {
    BatchId: batchId,
    Rules: asArray(rules).map(({ action, rule: r }) => ({
      Action:      action === 'Delete' ? 'Delete' : 'Upsert',
      RuleId:      String(r.ruleId || ''),
      FromItemId:  r.fromItemId,
      ToItemId:    r.toItemId,
      CustAccount: r.customerId || '',            // blank = all customers
      Direction:   r.direction === 'Bidirectional' ? 'Bidirectional' : 'OneWay',
      Rank:        num(r.rank, 1),
      QtyRatio:    num(r.qtyRatio, 1) || 1,
      PriceBasis:  r.priceBasis === 'Substitute' ? 'SubstituteItemPrice' : 'OriginalItemPrice',
      ValidFrom:   r.validFrom || '',
      ValidTo:     r.validTo || '',
    })),
    CustomerPolicies: asArray(policies).map(p => ({
      CustAccount:        p.customerId,
      SubstitutionPolicy: p.substitutionPolicy,
      Note:               String(p.substitutionNote || ''),
    })),
    // Interchangeable groups (RSMItemSubstitutionGroup + members). An Upsert
    // replaces the group's member list; Sequence 1 is the preferred substitute.
    SubstitutionGroups: asArray(groups).map(({ action, group: g }) => ({
      Action:     action === 'Delete' ? 'Delete' : 'Upsert',
      GroupId:    String(g.groupId || ''),
      Name:       String(g.name || ''),
      Unit:       String(g.unit || ''),
      PriceBasis: g.priceBasis === 'Substitute' ? 'SubstituteItemPrice' : 'OriginalItemPrice',
      ValidFrom:  g.validFrom || '',
      ValidTo:    g.validTo || '',
      Note:       String(g.note || ''),
      Members:    action === 'Delete' ? [] : asArray(g.members).map((m, i) => ({
        ItemId: m.itemId, EquivQty: num(m.equivQty, 0), Sequence: i + 1,
      })),
    })),
  });
}

const api = {
  SEND_MESSAGE_PATH, MESSAGE_QUEUE, MESSAGE_TYPE, SUB_MESSAGE_TYPE, RULE_MESSAGE_TYPE,
  buildBatchMessage, buildSubstitutionMessage, buildRuleMessage,
};
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Messages = api;
})(typeof self !== 'undefined' ? self : globalThis);
