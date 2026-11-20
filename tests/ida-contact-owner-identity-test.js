'use strict';

/* CONTACT integration — vehicle owner identity (reference/contact/owner-identity.js).
 *
 * Database-free and network-free. The SDK is the real vendored one
 * (reference/contact/contact-client.js) with a FAKE fetch transport; the
 * database is a fake client that records every statement. The registration
 * and owner-save paths are the real registration-service.js / owner-contacts.js
 * code; only the vehicle repository's SQL-heavy helpers are stubbed.
 *
 * Proves: off = no CONTACT call; shadow = CNT stored after the commit;
 * CONTACT down in shadow = the request succeeds and the row is marked pending;
 * authoritative = no local PII insert, refuses on outage before any
 * transaction, never fabricates an id; no PII in audit rows or log lines. */

var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

// a closed port: an accidental real query fails instantly instead of finding anything
process.env.IDAUTO_DB_HOST = process.env.IDAUTO_DB_HOST || '127.0.0.1';
process.env.IDAUTO_DB_PORT = process.env.IDAUTO_DB_PORT || '1';
process.env.IDAUTO_DB_USER = process.env.IDAUTO_DB_USER || 'unused';
process.env.IDAUTO_DB_PASSWORD = process.env.IDAUTO_DB_PASSWORD || 'unused';
process.env.IDAUTO_DB_NAME = process.env.IDAUTO_DB_NAME || 'unused';
delete process.env.IDAUTO_CONTACT_MODE;

var db = require(path.join(BASE, 'reference', 'db.js'));
var repository = require(path.join(BASE, 'reference', 'vehicle', 'vehicle-repository.js'));
var oi = require(path.join(BASE, 'reference', 'contact', 'owner-identity.js'));
var sdk = require(path.join(BASE, 'reference', 'contact', 'contact-client.js'));
var owners = require(path.join(BASE, 'reference', 'workspace', 'owner-contacts.js'));
var registration = require(path.join(BASE, 'reference', 'workspace', 'registration-service.js'));

// ---- fake database: one shared statement log; BEGIN/COMMIT/ROLLBACK are recorded too ----
var SQL = [];
function record(text, params) { SQL.push({ text: String(text), params: params || [] }); return Promise.resolve({ rows: [], rowCount: 1 }); }
db.getClientForTransaction = function () { return Promise.resolve({ query: record, release: function () {} }); };
db.query = record;
repository.lockIdentifiers = function () { return Promise.resolve(); };
repository.vehiclesWithVin = function () { return Promise.resolve([]); };
repository.insertIdentifiedVehicle = function (client) { return client.query('INSERT INTO idauto_vehicles (stub) VALUES ($1)', ['stub']).then(function () { return { id: 4242, ivid: 'IVID-TEST-0001' }; }); };

// ---- fake CONTACT transport ----
var CALLS = [], BEHAVIOUR = 'ok', NEXT_CNT = 'CNT000125';
function fakeFetch(url, init) {
  CALLS.push({ url: url, method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
  var orderIdx = SQL.length;
  CALLS[CALLS.length - 1].sqlIndex = orderIdx;
  if (BEHAVIOUR === 'down') return Promise.reject(new TypeError('fetch failed'));
  var status = 200, body;
  if (BEHAVIOUR === '500') { status = 500; body = { error: { code: 'internal_error', message: 'x' } }; }
  else if (BEHAVIOUR === 'review') body = { decision: 'review', contact_id: null, candidates: [], review_required: true };
  else if (/\/associations$/.test(url)) { status = 201; body = { contact_id: NEXT_CNT, relationship_type: 'vehicle_owner' }; }
  else { status = 201; body = { decision: 'created', contact_id: NEXT_CNT, review_required: false }; }
  var text = JSON.stringify(body);
  return Promise.resolve({ status: status, text: function () { return Promise.resolve(text); }, headers: { get: function () { return null; } } });
}

var LOGS = [];
var ENV_BASE = { CONTACT_BASE_URL: 'https://contact.invalid', CONTACT_TOKEN: 'idauto.' + 'a'.repeat(32), CONTACT_RETRIES: '0', CONTACT_TIMEOUT_MS: '500' };
function useMode(m, extra) {
  var env = Object.assign({}, ENV_BASE, extra || {});
  if (m !== undefined) env.IDAUTO_CONTACT_MODE = m;
  oi.configure({ env: env, fetch: fakeFetch, log: function (l) { LOGS.push(l); } });
  SQL.length = 0; CALLS.length = 0; LOGS.length = 0; BEHAVIOUR = 'ok';
}

var ACTOR = { identity: 'user:test-mechanic', principal: { kind: 'organisation', org_id: 7, scopes: ['vehicle:read', 'owner:write'] } };
var OWNER = { full_name: 'Propriétaire Fictif', phone: '+216 20 000 801', email: 'proprio.fictif@example.tn', address: '1 rue Fictive, Testville', notes: 'client fidèle' };
var PII = ['Propriétaire Fictif', '20 000 801', '20000801', 'proprio.fictif@example.tn', 'rue Fictive', 'client fidèle'];
function body() { return { plate: { type: 'TU', series: '123', number: '4567' }, make: 'exemple', owner: Object.assign({}, OWNER) }; }

function stmts(re) { return SQL.filter(function (s) { return re.test(s.text); }); }
function auditRows() { return stmts(/INSERT INTO idauto_audit_log/); }
function containsPII(s) { return PII.some(function (p) { return s.indexOf(p) !== -1; }); }
function auditClean() { return auditRows().every(function (a) { return !containsPII(JSON.stringify(a.params)) && !/CNT\d/.test(JSON.stringify(a.params)); }); }
function logsClean() { return LOGS.every(function (l) { return !containsPII(l) && !/CNT\d/.test(l) && l.indexOf(ENV_BASE.CONTACT_TOKEN) === -1; }); }
function ownerInsert() { return stmts(/INSERT INTO idauto_vehicle_owner_contacts/)[0]; }
function idx(re) { for (var i = 0; i < SQL.length; i++) if (re.test(SQL[i].text)) return i; return -1; }

async function main() {
  say('1. MODE SELECTION');
  useMode(undefined); ok(oi.mode() === 'off', 'unset IDAUTO_CONTACT_MODE → off');
  useMode('SHADOW'); ok(oi.mode() === 'shadow', 'shadow (case-insensitive)');
  useMode('authoritative'); ok(oi.mode() === 'authoritative', 'authoritative');
  useMode('yes-please'); ok(oi.mode() === 'off', 'an unknown value falls back to off');
  ok(oi.recordId(4242, 7) === '4242@7' && oi.recordId(4242, null) === '4242@admin', 'record_id is <vehicle_id>@<org_id|admin>');

  say('2. OFF — legacy behaviour, no CONTACT call');
  useMode('off');
  var r = await registration.register(body(), ACTOR); await oi.settle();
  ok(r.ivid === 'IVID-TEST-0001' && r.owner_recorded === true, 'registration succeeds and records the owner locally');
  ok(CALLS.length === 0, 'no CONTACT request at all');
  ok(ownerInsert() && ownerInsert().params.indexOf('Propriétaire Fictif') !== -1, 'the local owner row is written (legacy store)');
  ok(stmts(/contact_id|contact_sync_pending/).length === 0, 'no statement touches the new CONTACT columns');
  useMode('off');
  await owners.put({ id: 4242, ivid: 'IVID-TEST-0001' }, OWNER, ACTOR); await oi.settle();
  ok(CALLS.length === 0 && ownerInsert(), 'owner save (dossier) in off mode: local only, no CONTACT call');

  say('3. SHADOW — local store authoritative, CNT stored after the commit');
  useMode('shadow');
  r = await registration.register(body(), ACTOR); await oi.settle();
  ok(r.owner_recorded === true, 'registration succeeds');
  ok(CALLS.length === 1 && /\/api\/v1\/contacts\/resolve$/.test(CALLS[0].url) && CALLS[0].method === 'POST', 'one CONTACT resolve');
  var rb = CALLS[0] && CALLS[0].body;
  ok(rb && rb.source.ref_kind === 'vehicle_owner' && rb.source.record_id === '4242@7' && rb.relationship_type === 'vehicle_owner', 'resolve carries ref_kind vehicle_owner, record_id 4242@7, relationship vehicle_owner');
  ok(rb && rb.full_name === 'Propriétaire Fictif' && rb.channels.some(function (c) { return c.kind === 'PHONE'; }) && !rb.notes && JSON.stringify(rb).indexOf('client fidèle') === -1, 'the owner identity goes to CONTACT; the workshop notes do not');
  ok(CALLS[0] && CALLS[0].headers['Idempotency-Key'], 'the write carries an Idempotency-Key (SDK)');
  ok(idx(/^COMMIT$/) !== -1 && CALLS[0].sqlIndex > idx(/^COMMIT$/), 'CONTACT is called only AFTER the local transaction committed');
  ok(ownerInsert() && ownerInsert().params.indexOf('Propriétaire Fictif') !== -1, 'the local owner row is still written (legacy store authoritative)');
  var link = stmts(/SET contact_id = \$6, contact_sync_pending = FALSE/)[0];
  ok(link && link.params[5] === 'CNT000125' && link.params[0] === 4242 && link.params[1] === 7, 'the returned CNT is stored on that vehicle/organisation row');
  ok(auditClean(), 'audit rows carry no owner PII and no CNT');
  ok(logsClean() && LOGS.some(function (l) { return /shadow vehicle=4242 linked/.test(l); }), 'log line: vehicle id and outcome only');

  useMode('shadow');
  await owners.put({ id: 4242, ivid: 'IVID-TEST-0001' }, OWNER, ACTOR); await oi.settle();
  ok(CALLS.length === 1 && stmts(/SET contact_id = \$6/).length === 1, 'owner save (dossier) in shadow: same post-commit link');

  useMode('shadow'); BEHAVIOUR = 'review';
  r = await registration.register(body(), ACTOR); await oi.settle();
  ok(r.owner_recorded === true && stmts(/SET contact_id = \$6/).length === 0, 'CONTACT asks for review: request succeeds, no CNT invented');
  ok(stmts(/SET contact_sync_pending = FALSE WHERE/).length === 1, 'and the row is left unlinked (not retried; a human decides in CONTACT)');

  say('4. SHADOW — CONTACT DOWN: the request still succeeds, the row is marked pending');
  for (var b of ['down', '500']) {
    useMode('shadow'); BEHAVIOUR = b;
    var threw = null;
    try { r = await registration.register(body(), ACTOR); } catch (e) { threw = e; }
    await oi.settle();
    ok(!threw && r.ivid === 'IVID-TEST-0001' && r.owner_recorded === true, 'CONTACT ' + b + ': registration succeeds');
    var pend = stmts(/SET contact_sync_pending = \$6/)[0];
    ok(pend && pend.params[5] === true && pend.params[0] === 4242, 'CONTACT ' + b + ': contact_sync_pending = TRUE on the row');
    ok(stmts(/SET contact_id/).length === 0, 'CONTACT ' + b + ': no CNT written (none fabricated)');
    ok(logsClean() && LOGS.some(function (l) { return /pending error=(UNREACHABLE|SERVER_ERROR)/.test(l); }), 'CONTACT ' + b + ': logged as pending, without PII');
  }
  useMode('shadow', { CONTACT_BASE_URL: '' });
  r = await registration.register(body(), ACTOR); await oi.settle();
  ok(r.owner_recorded === true && stmts(/SET contact_sync_pending = \$6/).length === 1, 'CONTACT not configured in shadow: request succeeds, row pending');

  say('5. SHADOW — drainPending() links pending rows once CONTACT is back');
  useMode('shadow');
  var pendingRow = { vehicle_id: 4242, org_id: 7, full_name: 'Propriétaire Fictif', phone: '+216 20 000 801', phone_normalized: '+21620000801', email: 'proprio.fictif@example.tn', address: null };
  oi.configure({ env: Object.assign({ IDAUTO_CONTACT_MODE: 'shadow' }, ENV_BASE), fetch: fakeFetch, log: function (l) { LOGS.push(l); },
    query: function (text, params) { SQL.push({ text: text, params: params }); return Promise.resolve({ rows: /^SELECT/.test(text) ? [pendingRow] : [], rowCount: 1 }); } });
  var d = await oi.drainPending(10);
  ok(d.attempted === 1 && d.linked === 1 && stmts(/SET contact_id = \$6/).length === 1, 'one pending row resolved and linked');

  say('6. AUTHORITATIVE — CONTACT first, CNT only, refuses on outage (NOT enabled anywhere)');
  useMode('authoritative');
  r = await registration.register(body(), ACTOR); await oi.settle();
  ok(r.owner_recorded === true, 'registration succeeds when CONTACT answers');
  ok(CALLS.length >= 1 && /\/contacts\/resolve$/.test(CALLS[0].url) && CALLS[0].sqlIndex === 0, 'the resolve happens BEFORE the transaction (no SQL yet)');
  var ins = ownerInsert();
  ok(ins && /\(vehicle_id, org_id, contact_id, created_by\)/.test(ins.text) && ins.params[2] === 'CNT000125', 'the owner row stores only vehicle, organisation, CNT and author');
  ok(SQL.every(function (s) { return !containsPII(JSON.stringify(s.params)); }), 'no local statement carries owner PII');
  ok(auditClean() && logsClean(), 'audit rows and log lines carry no PII and no CNT');
  ok(CALLS.length === 2 && /\/contacts\/CNT000125\/associations$/.test(CALLS[1].url) && CALLS[1].body.source_record_ref === '4242@7', 'after the commit the vehicle reference is attached in CONTACT');

  for (var b2 of ['down', '500']) {
    useMode('authoritative'); BEHAVIOUR = b2;
    var err = null;
    try { await registration.register(body(), ACTOR); } catch (e) { err = e; }
    ok(err && err.code === 'CONTACT_UNAVAILABLE' && err.httpStatus === 503 && /CONTACT/.test(err.message_fr), 'CONTACT ' + b2 + ': registration refused with 503 CONTACT_UNAVAILABLE');
    ok(SQL.length === 0, 'CONTACT ' + b2 + ': no transaction was opened, nothing written locally');
    ok(logsClean(), 'CONTACT ' + b2 + ': log line without PII');
  }
  useMode('authoritative'); BEHAVIOUR = 'review';
  var e3 = null;
  try { await registration.register(body(), ACTOR); } catch (e) { e3 = e; }
  ok(e3 && e3.code === 'CONTACT_REVIEW_REQUIRED' && SQL.length === 0, 'CONTACT asks for review: refused (409), no id fabricated, nothing written');

  useMode('authoritative'); BEHAVIOUR = 'down';
  var e4 = null;
  try { await owners.put({ id: 4242, ivid: 'IVID-TEST-0001' }, OWNER, ACTOR); } catch (e) { e4 = e; }
  ok(e4 && e4.code === 'CONTACT_UNAVAILABLE' && SQL.length === 0, 'owner save (dossier) in authoritative mode refuses on outage too');
  useMode('authoritative');
  var res = await owners.put({ id: 4242, ivid: 'IVID-TEST-0001' }, OWNER, ACTOR); await oi.settle();
  ok(CALLS[0].body.source.record_id === '4242@7' && ownerInsert().params[2] === 'CNT000125' && res.fields_present.indexOf('notes') === -1, 'owner save (dossier) authoritative: CNT only, reference known up front, notes not carried');

  say('7. GUARANTEES OF THE VENDORED SDK');
  ok(sdk.isContactId('CNT000125') && !sdk.isContactId('CNT12') && !sdk.isContactId('local-1'), 'CNT format is checked');
  var cfgErr = null; try { sdk.createClient({ baseUrl: 'http://contact.invalid', token: ENV_BASE.CONTACT_TOKEN }); } catch (e) { cfgErr = e; }
  ok(cfgErr && cfgErr.name === 'ContactConfigError', 'plain http to a non-loopback host is refused');

  console.log('\nCONTACT owner identity: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
