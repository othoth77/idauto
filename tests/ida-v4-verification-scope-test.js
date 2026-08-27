'use strict';

/* IDA-V4 — a fact carries FOUR independent dimensions. Owner decision,
 * 2026-08-27.
 *
 *   SOURCE        where it came from     idauto_fact_evidence.evidence_type
 *   VERIFICATION  has it been checked    verification_status
 *   ACCESS SCOPE  who may see it         access_scope
 *   CONFIDENCE    how much it is trusted confidence_score
 *
 * Before this change two of them were welded together: accepting a fact in
 * review set verification_status='verified' AND access_scope='public' in the
 * same statement, so a VIN read off an official certificate could not be
 * recorded as certain without also being published. The model had no way to
 * express "verified, and private".
 *
 * The property that matters most here is negative and is asserted several
 * ways: verifying a private fact must NEVER publish it, and the public
 * passport must never carry a VIN however the fact was verified.
 *
 * The database is stubbed, so each case is deterministic and no real database
 * is touched. Every statement is captured, which is how "the scope was not
 * changed" is proved rather than assumed. */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, label) { if (v) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function say(m) { console.log(m); }

process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ 'tok': 'usr_test' });

var SQL = [];
var state = null;
var IDENTITY = 'usr_' + crypto.randomBytes(8).toString('hex');
var dbPath = require.resolve(path.join(BASE, 'reference', 'db.js'));
var stubClient = {
  release: function () {},
  query: async function (sql, params) {
    SQL.push({ sql: sql, params: params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/FOR UPDATE/.test(sql)) return { rows: state ? [Object.assign({}, state)] : [] };
    if (/UPDATE idauto_vehicle_facts/.test(sql)) {
      state.verification_status = params[1]; state.access_scope = params[2]; state.confidence_score = params[3];
      return { rows: [Object.assign({}, state)] };
    }
    if (/INSERT INTO idauto_fact_evidence/.test(sql)) return { rows: [] };
    if (/INSERT INTO idauto_audit_log/.test(sql)) return { rows: [] };
    return { rows: [] };
  }
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getClientForTransaction: async function () { return stubClient; },
  query: async function (sql, params) { return stubClient.query(sql, params); }
} };
var writesPath = require.resolve(path.join(BASE, 'reference', 'writes.js'));
delete require.cache[writesPath];
var writes = require(writesPath);

function fact(status, scope, conf) {
  return { id: 42, observation_id: null, fact_key: 'vin', fact_value: 'KPT60A1YSLP025697',
    confidence_score: conf === undefined ? 0.5 : conf, verification_status: status, access_scope: scope };
}
function updates() { return SQL.filter(function (q) { return /UPDATE idauto_vehicle_facts/.test(q.sql); }); }
function evidences() { return SQL.filter(function (q) { return /INSERT INTO idauto_fact_evidence/.test(q.sql); }); }
async function statusOf(p) { try { await p; return null; } catch (e) { return e.httpStatus; } }

async function main() {
  say('\n1 & 2. VERIFICATION NEVER PUBLISHES BY ITSELF');
  state = fact('unverified', 'public'); SQL.length = 0;
  var pub = await writes.reviewFact(42, 'accept', IDENTITY);
  ok(pub.verification_status === 'verified' && pub.access_scope === 'public', 'a PUBLIC fact verified stays public');

  state = fact('unverified', 'mythos_private'); SQL.length = 0;
  var priv = await writes.reviewFact(42, 'accept', IDENTITY);
  ok(priv.verification_status === 'verified', 'a PRIVATE fact can be verified');
  ok(priv.access_scope === 'mythos_private', 'a PRIVATE fact verified STAYS private');
  ok(updates()[0].params[2] === 'mythos_private', 'the statement binds the preserved scope, it does not hardcode public');
  ok(!/'public'/.test(updates()[0].sql), 'no literal public appears in the update statement at all');

  say('\n3. VIN — verified, certain, and still private');
  state = fact('unverified', 'mythos_private'); SQL.length = 0;
  var vin = await writes.reviewFact(42, 'accept', IDENTITY, { confidence_score: 1.0, evidence_type: 'document_scan_official' });
  ok(vin.verification_status === 'verified', 'VIN verified');
  ok(Number(vin.confidence_score) === 1, 'VIN confidence 1.0');
  ok(vin.access_scope === 'mythos_private', 'VIN REMAINS mythos_private');
  ok(evidences().length === 1 && evidences()[0].params[1] === 'document_scan_official', 'VIN provenance recorded as document_scan_official');

  say('\n4. CONFIDENCE');
  state = fact('unverified', 'public', 0.5); SQL.length = 0;
  var c1 = await writes.reviewFact(42, 'accept', IDENTITY, { confidence_score: 1.0 });
  ok(Number(c1.confidence_score) === 1, 'confidence 1.0 is accepted');
  state = fact('unverified', 'public', 0.5); SQL.length = 0;
  var c2 = await writes.reviewFact(42, 'accept', IDENTITY);
  ok(Number(c2.confidence_score) === 0.5, 'confidence is PRESERVED when not named — never silently raised');
  state = fact('unverified', 'public');
  ok(await statusOf(writes.reviewFact(42, 'accept', IDENTITY, { confidence_score: 1.01 })) === 400, 'confidence above 1.0 refused');
  state = fact('unverified', 'public');
  ok(await statusOf(writes.reviewFact(42, 'accept', IDENTITY, { confidence_score: -0.1 })) === 400, 'negative confidence refused');
  state = fact('unverified', 'public');
  ok(await statusOf(writes.reviewFact(42, 'accept', IDENTITY, { confidence_score: 'high' })) === 400, 'non-numeric confidence refused');

  say('\n5. OFFICIAL DOCUMENT SOURCE');
  state = fact('unverified', 'public'); SQL.length = 0;
  await writes.reviewFact(42, 'accept', IDENTITY, { evidence_type: 'document_scan_official' });
  ok(evidences().length === 1, 'document_scan_official is accepted');
  state = fact('unverified', 'public'); SQL.length = 0;
  await writes.reviewFact(42, 'accept', IDENTITY, { evidence_type: 'document_scan' });
  ok(evidences()[0].params[1] === 'document_scan', 'document_scan remains accepted and DISTINCT');
  state = fact('unverified', 'public');
  ok(await statusOf(writes.reviewFact(42, 'accept', IDENTITY, { evidence_type: 'official' })) === 400, 'an invented evidence type is refused');
  var writesSrc = fs.readFileSync(path.join(BASE, 'reference', 'writes.js'), 'utf8');
  ok(/'document_scan_official'/.test(writesSrc) && /'document_scan'/.test(writesSrc), 'both values exist in the allow-list, neither replaces the other');
  var mig = fs.readFileSync(path.join(BASE, 'database', 'migrations', 'ida-v4-verification-scope-separation.sql'), 'utf8');
  ok(/document_scan_official/.test(mig), 'the migration admits the new value');
  ok(/ADD CONSTRAINT chk_evidence_type/.test(mig) && !/DROP TABLE|DELETE FROM|TRUNCATE/i.test(mig), 'the migration is additive — it drops no data');
  ['user_confirmation','cross_source_match','vin_decode','document_scan','professional_assertion','automated_check','admin_validation'].forEach(function (v) {
    ok(mig.indexOf("'" + v + "'") !== -1, 'the migration preserves the pre-existing value ' + v);
  });

  say('\n6. PROVENANCE IS KEPT');
  state = fact('unverified', 'mythos_private'); SQL.length = 0;
  await writes.reviewFact(42, 'accept', IDENTITY, { evidence_type: 'document_scan_official' });
  var audit = SQL.filter(function (q) { return /INSERT INTO idauto_audit_log/.test(q.sql); });
  ok(audit.length === 1, 'the verification act is audited');
  ok(evidences().length === 1, 'and its evidence row is written');
  var order = SQL.map(function (q) { return /BEGIN|COMMIT/.test(q.sql) ? q.sql : (/idauto_fact_evidence/.test(q.sql) ? 'EVIDENCE' : (/audit_log/.test(q.sql) ? 'AUDIT' : '')); }).filter(Boolean);
  ok(order[0] === 'BEGIN' && order[order.length - 1] === 'COMMIT', 'status, evidence and audit all land in ONE transaction');

  say('\n9. A REVIEW DECISION ERASES NOTHING');
  state = fact('verified', 'mythos_private', 1.0); SQL.length = 0;
  var noop = await writes.reviewFact(42, 'accept', IDENTITY);
  ok(noop.access_scope === 'mythos_private' && Number(noop.confidence_score) === 1, 'replaying accept changes neither scope nor confidence');
  ok(updates().length === 0, 'and issues no statement at all');
  state = fact('verified', 'public', 1.0); SQL.length = 0;
  var rescope = await writes.reviewFact(42, 'accept', IDENTITY, { access_scope: 'mythos_private' });
  ok(rescope.access_scope === 'mythos_private' && rescope.verification_status === 'verified', 'a published fact can be UNpublished without losing its verification');
  ok(Number(rescope.confidence_score) === 1, 'and without losing its confidence');

  say('\n8. THE API PASSES EVERY DIMENSION THROUGH, VALIDATED');
  var api = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  ok(/access_scope: body\.access_scope/.test(api) && /confidence_score: body\.confidence_score/.test(api) && /evidence_type: body\.evidence_type/.test(api),
    'the route forwards scope, confidence and evidence');
  ok(!/body\.verification_status/.test(api), 'the caller cannot set verification_status directly — the decision does');
  ok(/ALLOWED_ACCESS_SCOPE\.indexOf\(options\.access_scope\)/.test(writesSrc), 'the scope is validated in writes.js, not at the route');

  say('\n7. THE PUBLIC PASSPORT NEVER CARRIES A VIN');
  var policy = require(path.join(BASE, 'reference', 'public-surface-policy.js'));
  ok(policy.deniedFactKeys().indexOf('vin') !== -1, 'vin is still on the anonymous-surface deny-list');
  ok(policy.deniedFactKeys().indexOf('plate_number') !== -1, 'plate_number is still on it');
  var apiSrc = api;
  ok(/deniedFactKeys\(\)/.test(apiSrc), 'the public route still applies the deny-list');
  ok(/access_scope = \$2/.test(apiSrc) || /access_scope = '?public'?/.test(apiSrc), 'the public route still filters on scope in SQL');

  console.log('\nIDA-V4 verification/scope separation: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
