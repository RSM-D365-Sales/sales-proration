// Portal API logic, host-agnostic.
//
// Both front doors — the local Express server (server/index.js) and the Azure
// Functions app (api/index.js) — call these functions, so the behavior is
// identical whether the portal runs locally or hosted. Anything HTTP-specific
// (status codes, headers, auth) stays in the host; errors thrown here carry an
// optional `status` for the host to translate.
//
// The read logic itself is in public/js/shared/portal-core.js (pure functions
// over a snapshot), which static demo builds also run in the browser.

const d365 = require('./d365Client');
const core = require('../public/js/shared/portal-core.js');

const { httpError, fillStatus } = core;

const listCommodities    = async () => core.listCommodities(await d365.getSnapshot());
const getCommodityDetail = async id => core.getCommodityDetail(await d365.getSnapshot(), id);
const listCustomers      = async () => core.listCustomers(await d365.getSnapshot());
const runProration       = async body => core.runProration(await d365.getSnapshot(), body);
const substitutionBook   = async () => core.substitutionBook(await d365.getSnapshot());

/** Publish an approved batch to D365 (one SysMessageService message). */
async function sendBatch(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw httpError(400, 'lines required');
  return d365.sendProrationBatch(lines);
}

/** Publish staged substitutions (own message type, same queue). */
async function sendSubstitutions(subs) {
  return d365.sendSubstitutionBatch(core.checkSubstitutions(subs));
}

/** Publish substitution rule + customer policy changes (own message type). */
async function sendRuleChanges(body) {
  const clean = core.cleanRulePublish(body, await d365.getSnapshot());
  return d365.sendRuleChanges(clean);
}

module.exports = {
  listCommodities, getCommodityDetail, listCustomers, runProration, substitutionBook,
  sendBatch, sendSubstitutions, sendRuleChanges, fillStatus, httpError,
};
