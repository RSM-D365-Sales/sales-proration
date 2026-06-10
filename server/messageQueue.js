// Stub message-queue publisher.
// In production this becomes an Azure Service Bus client publishing to
// topic `d365-proration-inbound`. For the shell we just append to a JSON log file
// so you can demo the round-trip without provisioning Azure.

const fs = require('fs');
const path = require('path');

const OUTBOX = path.join(__dirname, '..', '.outbox', 'd365-proration-inbound.log.jsonl');

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function publishBatch(batchMessage) {
  ensureDir(OUTBOX);
  const envelope = {
    topic: 'd365-proration-inbound',
    enqueuedUtc: new Date().toISOString(),
    messageId: batchMessage.batchId,
    body: batchMessage,
  };
  fs.appendFileSync(OUTBOX, JSON.stringify(envelope) + '\n', 'utf8');
  return { ok: true, messageId: envelope.messageId, outbox: OUTBOX };
}

function readOutbox() {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

module.exports = { publishBatch, readOutbox, OUTBOX };
