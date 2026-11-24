// Customer-based substitutions — drafts store, the Substitutions page, and UI
// helpers the commodity planner shares (app.js).
//
// Rule logic lives in js/shared/subs.js (window.Subs). This file is the
// planner-facing layer:
//   · Drafts — rule and policy edits are kept in localStorage until the
//     planner publishes them to D365 as one rsmSalesSubstitutionRuleMessage.
//     Everything (the rules page, the planner's picker and auto-substitute)
//     plans against server rules + drafts, so a rule approved mid-planning
//     can be used straight away and goes to D365 ahead of the substitutions
//     that depend on it.
//   · renderSubstitutions() — the Substitutions page.
//   · showSendResult() — the post-publish summary, with the exact payload.

const SUB_DRAFT_KEY = 'spa.subDrafts';
const POLICY_LABEL = { Standard: 'Standard', CustomerOnly: 'Customer rules only', Never: 'Never substitute' };
const POLICY_HELP = {
  Standard: 'All-customer rules plus this customer’s own',
  CustomerOnly: 'Only rules that name this customer',
  Never: 'Line stays short; no substitute is offered',
};

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function pts(n) { return (n >= 0 ? '+' : '−') + Math.abs(n * 100).toFixed(1) + ' pts'; }
function ratioLabel(r) { return '×' + (Math.round(r * 1000) / 1000).toString(); }

// ---- Drafts -------------------------------------------------------------------

function loadSubDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(SUB_DRAFT_KEY) || 'null');
    if (d && Array.isArray(d.rules) && Array.isArray(d.policies)) return d;
  } catch { /* fall through */ }
  return { rules: [], policies: [] };
}
function saveSubDrafts(d) {
  try { localStorage.setItem(SUB_DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode — drafts live for the page only */ }
}
function clearSubDrafts() { try { localStorage.removeItem(SUB_DRAFT_KEY); } catch { /* ignore */ } }
function subDraftCount(d = loadSubDrafts()) { return d.rules.length + d.policies.length; }

/** Stage a rule upsert/delete. A delete of a rule that only exists as a draft just drops the draft. */
function draftRuleChange(action, rule, serverRules) {
  const d = loadSubDrafts();
  const existsOnServer = (serverRules || []).some(r => r.ruleId === rule.ruleId);
  d.rules = d.rules.filter(ch => ch.rule.ruleId !== rule.ruleId);
  if (action === 'Delete' && !existsOnServer) { saveSubDrafts(d); return d; }
  const clean = { ...rule };
  delete clean.status; delete clean.pending;
  d.rules.push({ action, rule: clean });
  saveSubDrafts(d);
  return d;
}

/** Stage a customer policy change; setting it back to the server value drops the draft. */
function draftPolicyChange(customer, serverCustomer) {
  const d = loadSubDrafts();
  d.policies = d.policies.filter(p => p.customerId !== customer.customerId);
  const same = serverCustomer
    && serverCustomer.substitutionPolicy === customer.substitutionPolicy
    && (serverCustomer.substitutionNote || '') === (customer.substitutionNote || '');
  if (!same) d.policies.push({ customerId: customer.customerId, substitutionPolicy: customer.substitutionPolicy, substitutionNote: customer.substitutionNote || '' });
  saveSubDrafts(d);
  return d;
}

/** Server rules with drafts applied; drafted rules carry pending: true. */
function effectiveRules(serverRules, d = loadSubDrafts()) {
  const pendingIds = new Set(d.rules.filter(ch => ch.action === 'Upsert').map(ch => ch.rule.ruleId));
  return Subs.applyRuleChanges(serverRules, d.rules).map(r => ({ ...r, pending: pendingIds.has(r.ruleId) }));
}
function effectiveCustomers(serverCustomers, d = loadSubDrafts()) {
  const pendingIds = new Set(d.policies.map(p => p.customerId));
  return Subs.applyPolicyChanges(serverCustomers, d.policies).map(c => ({ ...c, policyPending: pendingIds.has(c.customerId) }));
}

function newRuleId() {
  return 'SUB-N' + Date.now().toString(36).toUpperCase().slice(-5) + Math.floor(Math.random() * 36).toString(36).toUpperCase();
}

/** Publish every draft as one rule message. Returns the send result; clears drafts on success. */
async function publishSubDrafts() {
  const d = loadSubDrafts();
  if (!subDraftCount(d)) return null;
  const r = await jpost('/api/substitutions/publish', d);
  if (r.ok) clearSubDrafts();
  return r;
}

// ---- Shared UI bits -------------------------------------------------------------

function policyChip(c) {
  const p = c?.substitutionPolicy || 'Standard';
  if (p === 'Standard') return '';
  const cls = p === 'Never' ? 'Short' : 'AtRisk';
  return `<span class="chip ${cls}" title="${esc(c.substitutionNote || POLICY_HELP[p])}">${esc(POLICY_LABEL[p])}</span>`;
}

function scopeChip(rule, scope) {
  if (rule?.pending) return `<span class="chip AtRisk" title="Approved here; goes to D365 with your next publish">pending rule</span>`;
  if (!rule) return `<span class="chip plain">no rule</span>`;
  return scope === 'Customer' || rule.customerId
    ? `<span class="chip OK">customer rule</span>`
    : `<span class="chip plain">all customers</span>`;
}

function basisLabel(b) { return b === 'Substitute' ? 'Substitute price' : 'Ordered item price'; }

/** "29.2% (−6.9 pts)" for an economics result. */
function marginCell(e) {
  if (!e) return '<span class="muted">—</span>';
  const base = e.baselineRevenue ? e.baselineMargin / e.baselineRevenue : 0;
  const d = e.marginPct - base;
  const cls = d < -0.005 ? 'econ-down' : d > 0.005 ? 'econ-up' : 'muted';
  return `${(e.marginPct * 100).toFixed(1)}% <span class="${cls}">${pts(d)}</span>`;
}

function openOverlay(html, { wide = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="overlay__card${wide ? ' overlay__card--wide' : ''}">${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  return { overlay, close };
}

/** Pretty envelope: _messageContent is a JSON string on the wire; show it parsed. */
function envelopeHtml(envelope) {
  if (!envelope) return '';
  let content = envelope._messageContent;
  try { content = JSON.parse(content); } catch { /* leave as string */ }
  const view = { ...envelope, _messageContent: content };
  return `<pre class="payload">${esc(JSON.stringify(view, null, 2))}</pre>`;
}

const MESSAGE_LABEL = {
  rsmSalesSubstitutionRuleMessage: 'Substitution rules & policies',
  rsmSalesProrateAcceleratorMessage: 'Proration allocations',
  rsmSalesSubstituteAcceleratorMessage: 'Sales order substitutions',
};

/**
 * Summary after publishing. results: [{ label?, result }] in send order.
 * Shows each SendMessage with its batch id and, when the host returns it
 * (static builds do), the exact envelope that went to SysMessageService.
 */
function showSendResult(results, { title = 'Sent to D365', doneHref, doneLabel = 'Done' } = {}) {
  const queue = 'rsmSalesProrateAccelerator';
  const rows = results.map(({ result: r }, i) => `
    <div class="send-row">
      <div class="send-row__head">
        <span class="send-row__n">${i + 1}</span>
        <div class="send-row__main">
          <div class="sub-row__name">${esc(MESSAGE_LABEL[r.messageType] || r.messageType || 'Message')}</div>
          <div class="sub-row__meta"><code>${esc(r.messageType || '')}</code> · batch <code>${esc(String(r.batchId || '').slice(0, 8))}</code> · ${fmt(r.recordCount || 0)} record(s) · ${esc(r.company || '')}</div>
        </div>
        <span class="chip ${r.ok ? 'OK' : 'Short'}">${r.ok ? `queued · ${esc(r.status || 202)}` : 'failed'}</span>
        ${r.envelope ? `<button class="ghost" data-payload="${i}">Payload</button>` : ''}
      </div>
      ${r.ok ? '' : `<div class="notice bad" style="margin-top:.5rem">${esc(r.error || 'Send failed')}</div>`}
      <div class="send-row__payload hidden" data-payload-body="${i}">${envelopeHtml(r.envelope)}</div>
    </div>`).join('');
  const { overlay, close } = openOverlay(`
    <h3>${esc(title)}</h3>
    <div class="overlay__sub">SysMessageService · queue <code>${queue}</code> · applied in order by the D365 message processor</div>
    ${rows}
    <div class="row" style="margin:1.1rem 0 0;justify-content:flex-end">
      ${doneHref ? `<a class="button-link" href="${esc(doneHref)}">${esc(doneLabel)}</a>` : `<button class="primary" data-close>${esc(doneLabel)}</button>`}
    </div>`, { wide: true });
  overlay.addEventListener('click', e => {
    const b = e.target.closest('button[data-payload]');
    if (!b) return;
    overlay.querySelector(`[data-payload-body="${b.dataset.payload}"]`).classList.toggle('hidden');
  });
  return close;
}

// ---- Substitutions page ---------------------------------------------------------

let BOOK = null;           // /api/substitutions payload (server truth)
let SUBS_VIEW = { customerId: '', allItems: false, q: '', group: '', scope: '', status: 'live' };

async function renderSubstitutions() {
  try { await initShell({ active: 'subs' }); } catch (e) { console.error('[shell]', e); }
  setPageHead({ title: 'Substitutions', sub: 'Which items each customer accepts in place of what they ordered' });
  try {
    BOOK = await jget('/api/substitutions');
    SNAP.subs = JSON.stringify(BOOK);
  } catch (err) {
    showLoadError('subs-customer', err, renderSubstitutions);
    return;
  }
  // Open on the strategic customer with the most to lose: first P1/P2 who needs proration.
  const first = BOOK.customers.slice().sort((a, b) => (b.needsProration - a.needsProration) || (a.priority - b.priority))[0];
  SUBS_VIEW.customerId = qs('customer') || first?.customerId || '';

  wireSubstitutionsPage();
  paintSubstitutions();

  registerRefresh(async () => {
    const fresh = await fetchIfChanged('subs', '/api/substitutions');
    if (fresh) { BOOK = fresh; paintSubstitutions(); }
  });
}

function subsState() {
  const d = loadSubDrafts();
  const rules = effectiveRules(BOOK.rules, d).map(r => ({ ...r, status: Subs.ruleStatus(r, BOOK.asOf) }));
  const customers = effectiveCustomers(BOOK.customers, d);
  const items = BOOK.items;
  const itemById = Object.fromEntries(items.map(i => [i.itemId, i]));
  const custById = Object.fromEntries(customers.map(c => [c.customerId, c]));
  return { d, rules, customers, items, itemById, custById };
}

function paintSubstitutions() {
  const st = subsState();
  const live = st.rules.filter(r => r.status === 'Active');
  const restricted = st.customers.filter(c => c.substitutionPolicy !== 'Standard');
  const pending = subDraftCount(st.d);
  document.getElementById('kpis').innerHTML = `
    ${kpi('Active rules', live.length, `${live.filter(r => r.customerId).length} customer-specific · ${live.filter(r => !r.customerId).length} all customers`)}
    ${kpi('Items covered', new Set(live.map(r => r.fromItemId)).size, `of ${st.items.length} items have a substitute`)}
    ${kpi('Restricted customers', restricted.length, `${restricted.filter(c => c.substitutionPolicy === 'Never').length} never · ${restricted.filter(c => c.substitutionPolicy === 'CustomerOnly').length} customer rules only`)}
    ${kpi('Pending changes', pending, pending ? 'not yet in D365' : 'D365 is up to date', true)}
  `;
  paintPendingBar(st);
  paintCustomerView(st);
  paintRuleTable(st);
  paintPolicyTable(st);
}

function paintPendingBar(st) {
  const el = document.getElementById('subs-pending');
  const n = subDraftCount(st.d);
  if (!n) { el.innerHTML = ''; return; }
  const canPublish = window.AUTH?.hasRole('Proration.Admin');
  el.innerHTML = `
    <div class="pending-bar">
      <div>
        <strong>${n} change${n === 1 ? '' : 's'} not yet in D365</strong>
        <span class="muted">· ${st.d.rules.length} rule${st.d.rules.length === 1 ? '' : 's'} · ${st.d.policies.length} customer polic${st.d.policies.length === 1 ? 'y' : 'ies'}. The planner already uses them.</span>
      </div>
      <span class="spacer"></span>
      <button class="ghost" id="subs-discard">Discard</button>
      ${canPublish ? `<button class="primary" id="subs-publish">Publish to D365</button>` : `<span class="muted">Publishing needs the Proration Admin role.</span>`}
    </div>`;
}

function paintCustomerView(st) {
  const sel = document.getElementById('sv-customer');
  sel.innerHTML = st.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c =>
    `<option value="${esc(c.customerId)}" ${c.customerId === SUBS_VIEW.customerId ? 'selected' : ''}>${esc(c.name)} (${esc(c.customerId)})</option>`).join('');
  const c = st.custById[SUBS_VIEW.customerId];
  const wrap = document.getElementById('subs-customer');
  if (!c) { wrap.innerHTML = '<p class="muted">No customers in the snapshot.</p>'; return; }

  const openItems = new Set((BOOK.openItemsByCustomer || {})[c.customerId] || []);
  const ruleItems = new Set(st.rules.filter(r => r.customerId === c.customerId).flatMap(r => [r.fromItemId]));
  const shown = st.items.filter(i => SUBS_VIEW.allItems || openItems.has(i.itemId) || ruleItems.has(i.itemId));

  const rowsHtml = shown.map(it => {
    const cands = Subs.substitutesFor(st.rules, c, it.itemId, BOOK.asOf);
    const chain = c.substitutionPolicy === 'Never'
      ? `<span class="muted">Never substitutes</span>`
      : cands.length ? `<ol class="chain">${cands.map(k => {
          const to = st.itemById[k.toItemId];
          const e = Subs.subEconomics({ fromItem: it, toItem: to, qty: k.ratio, ratio: k.ratio, priceBasis: k.rule.priceBasis });
          return `<li>
            <span class="chain__item">${esc(to?.name || k.toItemId)}</span>
            ${scopeChip(k.rule, k.scope)}
            <span class="muted">${ratioLabel(k.ratio)}${k.reversed ? ' (reverse of a two-way rule)' : ''} · ${esc(basisLabel(k.rule.priceBasis))} · margin ${marginCell(e)}</span>
          </li>`;
        }).join('')}</ol>`
      : `<span class="muted">${c.substitutionPolicy === 'CustomerOnly' ? 'No rule names this customer for this item' : 'No substitute — line stays short'}</span>`;
    return `
      <tr>
        <td><strong>${esc(it.name)}</strong><div class="muted">${esc(it.itemId)}${it.pack ? ' · ' + esc(it.pack) : ''}</div></td>
        <td>${openItems.has(it.itemId) ? '<span class="chip plain">on open orders</span>' : ''}</td>
        <td>${chain}</td>
        <td class="num"><button class="ghost" data-new-rule-from="${esc(it.itemId)}">+ Rule</button></td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="item-card">
      <header>
        <div>
          <h3>${esc(c.name)} ${policyChip(c)} ${c.policyPending ? '<span class="chip AtRisk">pending</span>' : ''}</h3>
          <div class="meta">${esc(c.customerId)} · P${esc(c.priority)}${c.segment ? ' · ' + esc(c.segment) : ''}${c.city ? ' · ' + esc([c.city, c.state].filter(Boolean).join(', ')) : ''}
            ${c.substitutionNote ? ` · <em>${esc(c.substitutionNote)}</em>` : ''}</div>
        </div>
        <div class="item-card__actions">
          <label class="field">Policy
            <select data-policy-for="${esc(c.customerId)}">
              ${Object.keys(POLICY_LABEL).map(p => `<option value="${p}" ${p === c.substitutionPolicy ? 'selected' : ''}>${POLICY_LABEL[p]}</option>`).join('')}
            </select>
          </label>
        </div>
      </header>
      <table class="grid">
        <thead><tr><th>Ordered item</th><th></th><th>Accepts instead, in order</th><th></th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="4" class="muted">This customer has no open orders. Tick “All items” to set up rules anyway.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function paintRuleTable(st) {
  const groupSel = document.getElementById('sr-group');
  if (!groupSel.options.length) {
    groupSel.innerHTML = `<option value="">All buyer groups</option>` +
      BOOK.commodities.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  }
  const q = SUBS_VIEW.q.toLowerCase();
  const rows = st.rules
    .filter(r => !SUBS_VIEW.group || st.itemById[r.fromItemId]?.commodityId === SUBS_VIEW.group)
    .filter(r => !SUBS_VIEW.scope || (SUBS_VIEW.scope === 'customer' ? !!r.customerId : !r.customerId))
    .filter(r => SUBS_VIEW.status === 'all' || (SUBS_VIEW.status === 'live' ? r.status !== 'Expired' : r.status === SUBS_VIEW.status))
    .filter(r => {
      if (!q) return true;
      const hay = [r.ruleId, r.fromItemId, r.toItemId, st.itemById[r.fromItemId]?.name, st.itemById[r.toItemId]?.name,
        r.customerId, st.custById[r.customerId]?.name, r.note].join(' ').toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => String(st.itemById[a.fromItemId]?.commodityId).localeCompare(String(st.itemById[b.fromItemId]?.commodityId))
      || a.fromItemId.localeCompare(b.fromItemId) || (a.customerId ? 0 : 1) - (b.customerId ? 0 : 1) || a.rank - b.rank);

  const deleted = new Set(st.d.rules.filter(ch => ch.action === 'Delete').map(ch => ch.rule.ruleId));
  const statusChip = s => s === 'Active' ? '<span class="chip OK">Active</span>'
    : s === 'Scheduled' ? '<span class="chip AtRisk">Scheduled</span>' : '<span class="chip plain">Expired</span>';
  const validity = r => (r.validFrom || r.validTo) ? `${esc(r.validFrom || '…')} → ${esc(r.validTo || '…')}` : '<span class="muted">—</span>';

  document.getElementById('sr-count').textContent = `${rows.length} of ${st.rules.length} rules`;
  document.querySelector('#rule-table tbody').innerHTML = rows.length ? rows.map(r => {
    const from = st.itemById[r.fromItemId], to = st.itemById[r.toItemId];
    const e = Subs.subEconomics({ fromItem: from, toItem: to, qty: r.qtyRatio, ratio: r.qtyRatio, priceBasis: r.priceBasis });
    return `
      <tr class="${r.pending ? 'is-pending' : ''}">
        <td class="nowrap"><code>${esc(r.ruleId)}</code></td>
        <td title="${esc(r.customerId)}">${r.customerId ? esc(st.custById[r.customerId]?.name || r.customerId) : '<span class="muted">All customers</span>'}</td>
        <td title="${esc(r.fromItemId)}">${esc(from?.name || r.fromItemId)}</td>
        <td title="${esc(r.toItemId)}">${r.direction === 'Bidirectional' ? '⇄' : '→'} ${esc(to?.name || r.toItemId)}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</td>
        <td class="num">${esc(r.rank)}</td>
        <td class="num">${ratioLabel(r.qtyRatio)}</td>
        <td>${esc(basisLabel(r.priceBasis))}</td>
        <td class="num nowrap">${marginCell(e)}</td>
        <td class="nowrap">${validity(r)}</td>
        <td class="nowrap">${statusChip(r.status)} ${r.pending ? '<span class="chip AtRisk">pending</span>' : ''}</td>
        <td class="num nowrap"><button class="ghost" data-edit-rule="${esc(r.ruleId)}">Edit</button><button class="ghost" data-del-rule="${esc(r.ruleId)}">Remove</button></td>
      </tr>`;
  }).join('') : `<tr><td colspan="11" class="muted">No rules match the current filters.</td></tr>`;

  const delNote = document.getElementById('sr-deleted');
  delNote.textContent = deleted.size ? `${deleted.size} rule(s) marked for removal on publish.` : '';
}

function paintPolicyTable(st) {
  const rows = st.customers.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  document.querySelector('#policy-table tbody').innerHTML = rows.map(c => `
    <tr data-customer="${esc(c.customerId)}" class="${c.customerId === SUBS_VIEW.customerId ? 'is-selected' : ''}">
      <td><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.customerId)}</span></td>
      <td>${esc(c.segment || '')}</td>
      <td><span class="chip plain">P${esc(c.priority)}</span></td>
      <td class="num">${fmt(st.rules.filter(r => r.customerId === c.customerId && r.status === 'Active').length)}</td>
      <td>
        <select data-policy-for="${esc(c.customerId)}" class="compact">
          ${Object.keys(POLICY_LABEL).map(p => `<option value="${p}" ${p === c.substitutionPolicy ? 'selected' : ''}>${POLICY_LABEL[p]}</option>`).join('')}
        </select>
        ${c.policyPending ? '<span class="chip AtRisk">pending</span>' : ''}
      </td>
      <td><input type="text" class="compact note-input" data-note-for="${esc(c.customerId)}" value="${esc(c.substitutionNote || '')}" placeholder="${esc(POLICY_HELP[c.substitutionPolicy])}" /></td>
    </tr>`).join('');
}

function wireSubstitutionsPage() {
  document.getElementById('sv-customer').addEventListener('change', e => {
    SUBS_VIEW.customerId = e.target.value; paintSubstitutions();
  });
  document.getElementById('sv-all').addEventListener('change', e => {
    SUBS_VIEW.allItems = e.target.checked; paintSubstitutions();
  });
  ['sr-search', 'sr-group', 'sr-scope', 'sr-status'].forEach(id =>
    document.getElementById(id).addEventListener('input', () => {
      SUBS_VIEW.q = document.getElementById('sr-search').value.trim();
      SUBS_VIEW.group = document.getElementById('sr-group').value;
      SUBS_VIEW.scope = document.getElementById('sr-scope').value;
      SUBS_VIEW.status = document.getElementById('sr-status').value;
      paintRuleTable(subsState());
    }));
  document.getElementById('sr-new').addEventListener('click', () => openRuleEditor({}));

  const main = document.querySelector('main');
  main.addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit-rule]');
    if (edit) { openRuleEditor(subsState().rules.find(r => r.ruleId === edit.dataset.editRule)); return; }
    const del = e.target.closest('[data-del-rule]');
    if (del) {
      const r = subsState().rules.find(x => x.ruleId === del.dataset.delRule);
      if (r && confirm(`Remove rule ${r.ruleId}? It is deleted in D365 when you publish.`)) {
        draftRuleChange('Delete', r, BOOK.rules); paintSubstitutions();
      }
      return;
    }
    const nr = e.target.closest('[data-new-rule-from]');
    if (nr) { openRuleEditor({ fromItemId: nr.dataset.newRuleFrom, customerId: SUBS_VIEW.customerId }); return; }
    const row = e.target.closest('#policy-table tr[data-customer]');
    if (row && !e.target.closest('select, input')) {
      SUBS_VIEW.customerId = row.dataset.customer; paintSubstitutions();
      document.getElementById('sv-anchor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.id === 'subs-discard') {
      if (confirm('Discard every unpublished rule and policy change?')) { clearSubDrafts(); paintSubstitutions(); }
      return;
    }
    if (e.target.id === 'subs-publish') {
      const btn = e.target; btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        const r = await publishSubDrafts();
        if (r) {
          showSendResult([{ result: r }], { title: 'Substitution rules sent to D365' });
          if (r.ok) { BOOK = await jget('/api/substitutions'); SNAP.subs = JSON.stringify(BOOK); }
        }
      } catch (err) {
        alert(`Publish failed: ${err.message}`);
      } finally {
        paintSubstitutions();
      }
    }
  });
  main.addEventListener('change', e => {
    const pol = e.target.closest('select[data-policy-for]');
    if (pol) {
      const id = pol.dataset.policyFor;
      const st = subsState();
      draftPolicyChange({ ...st.custById[id], substitutionPolicy: pol.value }, BOOK.customers.find(c => c.customerId === id));
      paintSubstitutions();
      return;
    }
    const note = e.target.closest('input[data-note-for]');
    if (note) {
      const id = note.dataset.noteFor;
      const st = subsState();
      draftPolicyChange({ ...st.custById[id], substitutionNote: note.value.trim() }, BOOK.customers.find(c => c.customerId === id));
      paintSubstitutions();
    }
  });
}

/** New / edit rule form. Substitute choices are limited to the ordered item's buyer group. */
function openRuleEditor(rule) {
  const st = subsState();
  const isNew = !rule.ruleId;
  const r = { direction: 'OneWay', rank: 1, qtyRatio: 1, priceBasis: 'Original', customerId: '', validFrom: '', validTo: '', note: '', ...rule };
  const groups = BOOK.commodities.map(c => ({ ...c, items: st.items.filter(i => i.commodityId === c.id) }));
  const itemOptions = (sel, limitGroup) => groups
    .filter(g => !limitGroup || g.id === limitGroup)
    .map(g => `<optgroup label="${esc(g.name)}">${g.items.map(i =>
      `<option value="${esc(i.itemId)}" ${i.itemId === sel ? 'selected' : ''}>${esc(i.name)} — ${esc(i.itemId)}</option>`).join('')}</optgroup>`).join('');
  const custOptions = `<option value="">All customers</option>` + st.customers.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${esc(c.customerId)}" ${c.customerId === r.customerId ? 'selected' : ''}>${esc(c.name)} (${esc(c.customerId)})</option>`).join('');

  const { overlay, close } = openOverlay(`
    <h3>${isNew ? 'New substitution rule' : `Edit rule ${esc(r.ruleId)}`}</h3>
    <div class="overlay__sub">Saved as a pending change. It applies in the planner right away and goes to D365 (RSMItemSubstitution) when you publish.</div>
    <form class="rule-form" id="rule-form">
      <label class="field span-2">Customer
        <select name="customerId">${custOptions}</select>
      </label>
      <label class="field">Ordered item
        <select name="fromItemId" required><option value="">Choose…</option>${itemOptions(r.fromItemId)}</select>
      </label>
      <label class="field">Substitute item
        <select name="toItemId" required><option value="">Choose…</option>${itemOptions(r.toItemId, st.itemById[r.fromItemId]?.commodityId)}</select>
      </label>
      <label class="field">Rank
        <input name="rank" type="number" min="1" step="1" value="${esc(r.rank)}" />
      </label>
      <label class="field">Qty ratio <span class="field__hint">substitute cases per ordered case</span>
        <input name="qtyRatio" type="number" min="0.01" step="0.005" value="${esc(r.qtyRatio)}" />
      </label>
      <label class="field">Direction
        <select name="direction">
          <option value="OneWay" ${r.direction === 'OneWay' ? 'selected' : ''}>One-way</option>
          <option value="Bidirectional" ${r.direction === 'Bidirectional' ? 'selected' : ''}>Both ways</option>
        </select>
      </label>
      <label class="field">Bill at
        <select name="priceBasis">
          <option value="Original" ${r.priceBasis !== 'Substitute' ? 'selected' : ''}>Ordered item price</option>
          <option value="Substitute" ${r.priceBasis === 'Substitute' ? 'selected' : ''}>Substitute price</option>
        </select>
      </label>
      <label class="field">Valid from
        <input name="validFrom" type="date" value="${esc(r.validFrom)}" />
      </label>
      <label class="field">Valid to
        <input name="validTo" type="date" value="${esc(r.validTo)}" />
      </label>
      <label class="field span-2">Note
        <input name="note" type="text" value="${esc(r.note)}" placeholder="Why this substitute is acceptable" />
      </label>
      <div class="span-2 rule-form__econ" id="rule-econ"></div>
      <div class="span-2 notice bad hidden" id="rule-errors"></div>
      <div class="span-2 row" style="justify-content:flex-end;margin:0">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${isNew ? 'Add rule' : 'Save changes'}</button>
      </div>
    </form>`);

  const form = overlay.querySelector('#rule-form');
  const read = () => {
    const f = new FormData(form);
    return {
      ...r,
      ruleId: r.ruleId || newRuleId(),
      customerId: f.get('customerId') || '',
      fromItemId: f.get('fromItemId'), toItemId: f.get('toItemId'),
      rank: Number(f.get('rank')), qtyRatio: Number(f.get('qtyRatio')),
      direction: f.get('direction'), priceBasis: f.get('priceBasis'),
      validFrom: f.get('validFrom') || '', validTo: f.get('validTo') || '',
      note: String(f.get('note') || '').trim(),
    };
  };
  const paintEcon = () => {
    const x = read();
    const e = Subs.subEconomics({ fromItem: st.itemById[x.fromItemId], toItem: st.itemById[x.toItemId], qty: x.qtyRatio, ratio: x.qtyRatio, priceBasis: x.priceBasis });
    overlay.querySelector('#rule-econ').innerHTML = e
      ? `Per ordered case at list: revenue ${money(e.revenue)} · cost ${money(e.cost)} · margin ${marginCell(e)} against the ordered item`
      : '';
  };
  form.addEventListener('change', e => {
    if (e.target.name === 'fromItemId') {
      const grp = st.itemById[e.target.value]?.commodityId;
      const to = form.elements.toItemId;
      const keep = st.itemById[to.value]?.commodityId === grp ? to.value : '';
      to.innerHTML = `<option value="">Choose…</option>${itemOptions(keep, grp)}`;
    }
    paintEcon();
  });
  form.addEventListener('input', paintEcon);
  paintEcon();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const x = read();
    const errs = Subs.validateRule(x, st.items);
    const dup = st.rules.find(o => o.ruleId !== x.ruleId && o.fromItemId === x.fromItemId && o.toItemId === x.toItemId && (o.customerId || '') === x.customerId);
    if (dup) errs.push(`Rule ${dup.ruleId} already covers this customer and item pair — edit that one instead.`);
    const box = overlay.querySelector('#rule-errors');
    if (errs.length) { box.innerHTML = errs.map(esc).join('<br>'); box.classList.remove('hidden'); return; }
    draftRuleChange('Upsert', x, BOOK.rules);
    close();
    if (x.customerId) SUBS_VIEW.customerId = x.customerId;
    paintSubstitutions();
  });
}

window.renderSubstitutions = renderSubstitutions;
