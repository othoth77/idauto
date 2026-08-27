'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var STATIC_ONLY = process.env.IDA3E_STATIC_ONLY === '1';
var TOKEN = 'ida3e-token-' + crypto.randomBytes(18).toString('hex');
var IDENTITY = 'usr_' + crypto.randomBytes(16).toString('hex');
var identities = {}; identities[TOKEN] = IDENTITY;
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
var reference = path.join(BASE, 'reference');
var dbPath = require.resolve(path.join(reference, 'db.js'));
var realDbCache = require.cache[dbPath];

var state, audits;
var evidence = [];
var stubClient = {
  release: function () {},
  query: async function (sql, params) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/SELECT id, observation_id[\s\S]+FOR UPDATE/.test(sql)) return { rows: state ? [Object.assign({}, state)] : [] };
    if (/UPDATE idauto_vehicle_facts/.test(sql)) {
      // IDA-V4: the statement is parameterised — status, scope and confidence
      // all arrive as bound values, so the stub reads params instead of
      // scanning SQL text for literals.
      state.verification_status = params[1];
      state.access_scope = params[2];
      state.confidence_score = params[3];
      return { rows: [Object.assign({}, state)] };
    }
    if (/INSERT INTO idauto_fact_evidence/.test(sql)) { evidence.push({ fact_id: params[0], evidence_type: params[1], weight: params[2] }); return { rows: [] }; }
    if (/INSERT INTO idauto_audit_log/.test(sql)) { audits++; return { rows: [] }; }
    throw new Error('unexpected stub query: ' + sql);
  }
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  getClientForTransaction: async function () { return stubClient; }
} };
var writesPath = require.resolve(path.join(reference, 'writes.js'));
delete require.cache[writesPath];
var writes = require(writesPath);
var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function unique(prefix) { return prefix + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'); }
async function statusOf(promise) { try { await promise; return null; } catch (error) { return error.httpStatus; } }
function fact(status, scope) { return { id: 71, observation_id: 31, fact_key: 'colour', fact_value: 'blue', confidence_score: 0.4, verification_status: status, access_scope: scope }; }

async function staticCases() {
  console.log('\nSTATIC SUBSET — no database or network');
  // IDA-V4, 2026-08-27 — OWNER DECISION: verification and publication are
  // separate acts. This assertion used to read "accept maps to verified +
  // public". That coupling is withdrawn: a fact can now be verified and stay
  // private, which is what a VIN read off an official certificate requires.
  // The old behaviour is still reachable — by asking for it — and that is
  // asserted immediately below, so nothing was lost, only made explicit.
  state = fact('pending_review', 'mythos_private'); audits = 0; evidence.length = 0;
  var accepted = await writes.reviewFact(71, 'accept', IDENTITY);
  ok(accepted.verification_status === 'verified', 'accept verifies the fact');
  ok(accepted.access_scope === 'mythos_private', 'accept PRESERVES the existing scope — verifying never publishes by itself');
  ok(audits === 1, 'accept creates exactly one audit row');

  state = fact('pending_review', 'mythos_private'); audits = 0;
  var published = await writes.reviewFact(71, 'accept', IDENTITY, { access_scope: 'public' });
  ok(published.verification_status === 'verified' && published.access_scope === 'public', 'publication is still possible — as an explicit, audited argument');
  ok(audits === 1, 'publishing creates exactly one audit row');

  state = fact('pending_review', 'mythos_private'); audits = 0; evidence.length = 0;
  var official = await writes.reviewFact(71, 'accept', IDENTITY, { confidence_score: 1.0, evidence_type: 'document_scan_official' });
  ok(Number(official.confidence_score) === 1, 'confidence 1.0 can be set on verification');
  ok(official.access_scope === 'mythos_private', 'a fact verified against an official document stays private unless publication is asked for');
  ok(evidence.length === 1 && evidence[0].evidence_type === 'document_scan_official', 'the verification act records its own provenance');
  ok(audits === 1, 'one audit row covers the status, confidence and evidence together');

  state = fact('pending_review', 'mythos_private'); audits = 0;
  ok(await statusOf(writes.reviewFact(71, 'accept', IDENTITY, { access_scope: 'everyone' })) === 400, 'an unknown access_scope is refused');
  state = fact('pending_review', 'mythos_private');
  ok(await statusOf(writes.reviewFact(71, 'accept', IDENTITY, { confidence_score: 1.5 })) === 400, 'a confidence above 1.0 is refused');
  state = fact('pending_review', 'mythos_private');
  ok(await statusOf(writes.reviewFact(71, 'accept', IDENTITY, { evidence_type: 'hearsay' })) === 400, 'an unknown evidence_type is refused');
  ok(audits === 0, 'a refused decision writes nothing');

  state = fact('pending_review', 'mythos_private'); audits = 0;
  var rejected = await writes.reviewFact(71, 'reject', IDENTITY);
  ok(rejected.verification_status === 'rejected' && rejected.access_scope === 'mythos_private', 'reject maps to rejected and leaves scope unchanged');
  ok(audits === 1, 'reject creates exactly one audit row');
  ok(await statusOf(writes.reviewFact(71, 'maybe', IDENTITY)) === 400, 'unknown decision yields 400');

  state = fact('verified', 'public'); audits = 0;
  var acceptReplay = await writes.reviewFact(71, 'accept', IDENTITY);
  ok(acceptReplay.verification_status === 'verified' && audits === 0, 'same accept is a skipAudit no-op');
  ok(await statusOf(writes.reviewFact(71, 'reject', IDENTITY)) === 409, 'verified to rejected reversal yields 409');
  state = fact('rejected', 'mythos_private'); audits = 0;
  var rejectReplay = await writes.reviewFact(71, 'reject', IDENTITY);
  ok(rejectReplay.verification_status === 'rejected' && audits === 0, 'same reject is a skipAudit no-op');
  ok(await statusOf(writes.reviewFact(71, 'accept', IDENTITY)) === 409, 'rejected to verified reversal yields 409');
  state = fact('conflict', 'mythos_private'); audits = 0;
  ok(await statusOf(writes.reviewFact(71, 'accept', IDENTITY)) === 409 && audits === 0, 'conflict start yields 409 without audit');
  state = fact('unverified', 'professional'); audits = 0;
  ok((await writes.reviewFact(71, 'reject', IDENTITY)).access_scope === 'professional', 'reject preserves a reviewable fact existing scope');

  var ingestionSource = fs.readFileSync(path.join(reference, 'ingestion.js'), 'utf8');
  var writesSource = fs.readFileSync(path.join(reference, 'writes.js'), 'utf8');
  var apiSource = fs.readFileSync(path.join(reference, 'api.js'), 'utf8');
  var changedSource = ingestionSource + '\n' + writesSource + '\n' + apiSource;
  ok(/pending_review','mythos_private'/.test(ingestionSource) && !/pending_review','public'/.test(ingestionSource), 'ingestion writes pending community facts mythos_private, not public');
  ok((apiSource.match(/pattern: \/\^\\\/api\\\/review\\\/submissions\$\//g) || []).length === 1, 'submission queue route occurs exactly once');
  ok((apiSource.match(/pattern: \/\^\\\/api\\\/review\\\/submissions\\\/\(\[\^\/\]\+\)\$\//g) || []).length === 1, 'submission detail route occurs exactly once');
  ok((apiSource.match(/pattern: \/\^\\\/api\\\/review\\\/facts\\\/\(\[\^\/\]\+\)\\\/decision\$\//g) || []).length === 1, 'fact decision route occurs exactly once');
  ok(!/api\\\/review\\\/submissions\\\/[^(\n]+decision/.test(apiSource), 'no submission-level decision route exists');
  ok(!/public[^\n]*review|anonymous[^\n]*review/i.test(apiSource), 'no public or anonymous review route exists');
  ok(/if \(!requireAuth\(req, res\)\) return;[\s\S]*route\.handler/.test(apiSource), 'existing global auth gate still precedes route handlers');
  ok((apiSource.match(/\.listen\s*\(/g) || []).length === 1 && (apiSource.match(/'127\.0\.0\.1'/g) || []).length === 1, 'no second listener or bind-host change');
  // IDA-V1B, 2026-08-27 — narrowed, not dropped. See the twin assertion in
  // tests/ida-3d-private-ingest-route-test.js for the full rationale: the
  // owner sanctioned reference/session.js (signed HttpOnly cookie, two READ
  // routes) and this guard now admits that module alone. A JWT, an OAuth
  // library, any external session package, req.cookies/req.session, or a
  // Set-Cookie written by hand still fails here.
  //
  // What matters for THIS suite specifically: the review queue is not in the
  // owner-session grant, so the cookie cannot reach it. That is asserted
  // directly in tests/ida-v1b-owner-session-test.js.
  // jsonwebtoken/jose named explicitly — neither contains "jwt". See the
  // twin assertion in ida-3d for why "passport" is not in this list.
  ok(!/require\s*\(\s*['"](?!\.{1,2}\/session\.js['"])[^'"]*(?:jwt|jsonwebtoken|jose|oauth|session|cookie)[^'"]*['"]\s*\)/i.test(apiSource),
    'no JWT, OAuth or third-party session/cookie library added');
  ok(!/req\.(?:cookies|session)\b/.test(apiSource), 'no framework-implicit cookie or session auth added');
  ok(!/api\\\/review[^\n]*(?:ownerSession|OWNER_SESSION)/.test(apiSource), 'no review route was added to the owner-session grant');
  ok(!/CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE/i.test(changedSource), 'modified sources contain no DDL');
  ok(!/DELETE\s+FROM|TRUNCATE\s|DROP\s/i.test(writesSource.slice(writesSource.indexOf('async function reviewFact'))), 'fact review path contains no destructive SQL');
  var publicRead = /FROM idauto_vehicle_facts WHERE vehicle_id = \$1 AND access_scope != \$2 ORDER BY fact_key/.test(apiSource);
  ok(publicRead && !/FROM idauto_vehicle_facts WHERE vehicle_id = \$1 AND[^'\n]*verification_status/.test(apiSource), 'non-admin fact read remains scope-only with no verification-status filter');
  ok(/SELECT id, fact_key, fact_value, confidence_score, verification_status, access_scope/.test(apiSource), 'review detail includes actionable private fact fields');
  ok(!/SELECT[^;]+object_key[^;]+getReviewSubmission/.test(apiSource), 'review responses do not select media object_key');
  ok(!/SELECT s\.id AS submission_id[^;]+ip_hash/.test(apiSource), 'review responses do not select ip_hash');
  ok(/WHERE id = \$1 FOR UPDATE/.test(writesSource), 'reviewFact locks the fact row FOR UPDATE');
  ok(/skipAudit: true/.test(writesSource) && /reviewFact[\s\S]+withAudit/.test(writesSource), 'reviewFact uses withAudit and supports audited no-op suppression');
  var allowedStatuses = ['unverified','pending_review','verified','conflict','rejected'];
  var factBlock = writesSource.slice(writesSource.indexOf('async function reviewFact'), writesSource.indexOf('var ALLOWED_ACCESS_SCOPE'));
  var reviewStatusLiterals = [];
  factBlock.replace(/(?:targetStatus\s*=|verification_status\s*=|verification_status\s*===)[^'"\n]*['"]([a-z_]+)['"]/g, function (_, value) { reviewStatusLiterals.push(value); });
  ok(reviewStatusLiterals.every(function (value) { return ['accept', 'reject'].indexOf(value) !== -1 || allowedStatuses.indexOf(value) !== -1; }), 'reviewFact introduces no status outside the existing vocabulary');
  ok(['public','professional','mythos_private'].every(function (scope) { return changedSource.indexOf(scope) !== -1; }) && allowedStatuses.length === 5, 'only established fact scopes and statuses are used');
}

var server, port, db, api;
function request(method, requestPath, token, body, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var payload = body == null ? null : Buffer.from(JSON.stringify(body));
    var headers = Object.assign({}, extraHeaders || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () { var raw = Buffer.concat(chunks).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function multipart(boundary, submission, image) {
  var chunks = [];
  chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="submission"\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(submission) + '\r\n'));
  if (image) chunks.push(Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n'), image, Buffer.from('\r\n')]));
  chunks.push(Buffer.from('--' + boundary + '--\r\n'));
  return Buffer.concat(chunks);
}
function minimalPng() { return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68,174,66,96,130]); }
async function ingest(plate, value, withMedia) {
  var boundary = unique('boundary');
  var payload = multipart(boundary, { plate: plate, facts: [{ key: 'colour', value: value }] }, withMedia ? minimalPng() : null);
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: '/api/ingest/observations', method: 'POST', headers: {
      Authorization: 'Bearer ' + TOKEN, 'Idempotency-Key': unique('ida3e'), 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': payload.length
    } }, function (res) { var chunks = []; res.on('data', function (c) { chunks.push(c); }); res.on('end', function () { var raw = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode, body: JSON.parse(raw), raw: raw }); }); });
    req.on('error', reject); req.write(payload); req.end();
  });
}
// Ingestion refuses a fact whose plate is not already linked to a vehicle
// (IDA_FACT_LINK), so every community fixture needs its own seeded vehicle and
// plate, exactly as the IDA-3B suite does. Retries on the rare plate collision
// rather than failing the run.
async function seedPlate() {
  for (var attempt = 0; attempt < 10; attempt++) {
    var plateNumber = (100 + Math.floor(Math.random() * 900)) + ' TUN ' + (1000 + Math.floor(Math.random() * 8000));
    var existing = await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [plateNumber]);
    if (existing.rows.length) continue;
    var client = await db.getClientForTransaction();
    try {
      await client.query('BEGIN');
      var vehicle = await client.query(
        "INSERT INTO idauto_vehicles (internal_ref, make, fiche_status) VALUES ($1,'IDA3E synthetic','initial') RETURNING id",
        [unique('IDA3E')]
      );
      await client.query(
        'INSERT INTO idauto_plates (plate_number, plate_raw, format_code, vehicle_id) VALUES ($1,$1,$2,$3)',
        [plateNumber, 'TUN_STD', vehicle.rows[0].id]
      );
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return plateNumber;
  }
  throw new Error('could not seed a unique synthetic plate after 10 attempts');
}

async function auditCount(id, decision) { var r = await db.query('SELECT count(*) FROM idauto_audit_log WHERE target_type=$1 AND target_ref=$2 AND event_type=$3', ['idauto_vehicle_facts', String(id), 'fact.review.' + decision]); return Number(r.rows[0].count); }

async function liveCases() {
  console.log('\nLIVE DATABASE + HTTP SUITE');
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  var unauthQueue = await request('GET', '/api/review/submissions');
  var unauthDetail = await request('GET', '/api/review/submissions/1');
  var unauthDecision = await request('POST', '/api/review/facts/1/decision', null, { decision: 'accept' });
  ok(unauthQueue.status === 401 && unauthDetail.status === 401 && unauthDecision.status === 401, 'all three review routes require admin authentication');

  var base = Date.now();
  var first = await ingest(await seedPlate(), 'ida3e-blue-' + base, true);
  ok(first.status === 201 && first.body.ok, 'community-shaped fact ingests through the IDA-3D HTTP route');
  var firstFact = (await db.query('SELECT id,verification_status,access_scope FROM idauto_vehicle_facts WHERE observation_id=$1', [first.body.observation_id])).rows[0];
  var firstVehicle = (await db.query('SELECT v.internal_ref FROM idauto_vehicles v JOIN idauto_observations o ON o.vehicle_id=v.id WHERE o.id=$1', [first.body.observation_id])).rows[0].internal_ref;
  ok(firstFact.verification_status === 'pending_review' && firstFact.access_scope === 'mythos_private', 'ingested fact persists pending_review + mythos_private');
  var hidden = await request('GET', '/api/vehicles/' + encodeURIComponent(firstVehicle) + '/facts', TOKEN);
  ok(hidden.status === 200 && hidden.raw.indexOf('ida3e-blue-' + base) === -1, 'pending community fact is absent from vehicle facts response');
  await db.query("UPDATE idauto_observations SET status='pending_review' WHERE id=$1", [first.body.observation_id]);

  var submission = (await db.query('SELECT id FROM idauto_submissions WHERE observation_id=$1', [first.body.observation_id])).rows[0];
  var queue = await request('GET', '/api/review/submissions', TOKEN);
  var queued = queue.body.submissions.filter(function (row) { return String(row.submission_id) === String(submission.id); })[0];
  ok(queue.status === 200 && queued && String(queued.observation_id) === String(first.body.observation_id) && queued.actor_type === 'admin' && queued.capture_source_code === 'MANUAL_ADMIN' && queued.plate_number && queued.fact_count === 1 && queued.media_count === 1, 'queue returns deterministic linked submission provenance and counts');
  var detail = await request('GET', '/api/review/submissions/' + submission.id, TOKEN);
  ok(detail.status === 200 && String(detail.body.submission.id) === String(submission.id) && String(detail.body.observation.id) === String(first.body.observation_id) && detail.body.facts[0].access_scope === 'mythos_private' && detail.body.media.length === 1, 'detail includes submission provenance, linked observation, private facts, and media metadata');
  ok(detail.raw.indexOf('ip_hash') === -1 && detail.raw.indexOf(TOKEN) === -1 && detail.raw.indexOf('object_key') === -1, 'detail leaks no IP hash, bearer token, or object key');

  var accept = await request('POST', '/api/review/facts/' + firstFact.id + '/decision', TOKEN, { decision: 'accept' });
  var acceptReplay = await request('POST', '/api/review/facts/' + firstFact.id + '/decision', TOKEN, { decision: 'accept' });
  var acceptReverse = await request('POST', '/api/review/facts/' + firstFact.id + '/decision', TOKEN, { decision: 'reject' });
  // IDA-V4: accept verifies without publishing. The community fact arrived
  // mythos_private and stays there until publication is asked for.
  ok(accept.status === 200 && accept.body.verification_status === 'verified' && accept.body.access_scope === 'mythos_private', 'fact accept returns verified and keeps its scope');
  ok(acceptReplay.status === 200 && await auditCount(firstFact.id, 'accept') === 1, 'accept replay is idempotent with no phantom audit');
  ok(acceptReverse.status === 409 && await auditCount(firstFact.id, 'reject') === 0, 'accepted fact reversal fails 409 without audit');
  // IDA-V4, 2026-08-27 — OWNER DECISION. This assertion used to read
  // "accepted community fact becomes visible", which held only because accept
  // also published. Verification no longer publishes, and this read route
  // excludes mythos_private, so an accepted-but-unpublished fact is still
  // absent. That is the intended consequence, not a regression: publishing is
  // now a second, deliberate act. Both halves are asserted, so neither the
  // old coupling nor a silent loss of the publication path can come back.
  var stillPrivate = await request('GET', '/api/vehicles/' + encodeURIComponent(firstVehicle) + '/facts', TOKEN);
  ok(stillPrivate.raw.indexOf('ida3e-blue-' + base) === -1, 'a verified but unpublished community fact stays out of the facts response');

  var publish = await request('POST', '/api/review/facts/' + firstFact.id + '/decision', TOKEN, { decision: 'accept', access_scope: 'public' });
  ok(publish.status === 200 && publish.body.access_scope === 'public' && publish.body.verification_status === 'verified',
    'publishing it explicitly succeeds and keeps it verified');
  var visible = await request('GET', '/api/vehicles/' + encodeURIComponent(firstVehicle) + '/facts', TOKEN);
  ok(visible.raw.indexOf('ida3e-blue-' + base) !== -1, 'once published, the accepted community fact becomes visible');

  var secondBase = base + 1;
  var second = await ingest(await seedPlate(), 'ida3e-red-' + base, false);
  var secondFact = (await db.query('SELECT id FROM idauto_vehicle_facts WHERE observation_id=$1', [second.body.observation_id])).rows[0];
  var secondVehicle = (await db.query('SELECT v.internal_ref FROM idauto_vehicles v JOIN idauto_observations o ON o.vehicle_id=v.id WHERE o.id=$1', [second.body.observation_id])).rows[0].internal_ref;
  var reject = await request('POST', '/api/review/facts/' + secondFact.id + '/decision', TOKEN, { decision: 'reject' });
  var rejectReplay = await request('POST', '/api/review/facts/' + secondFact.id + '/decision', TOKEN, { decision: 'reject' });
  var rejectReverse = await request('POST', '/api/review/facts/' + secondFact.id + '/decision', TOKEN, { decision: 'accept' });
  ok(reject.status === 200 && reject.body.verification_status === 'rejected' && reject.body.access_scope === 'mythos_private', 'fact reject retains private scope');
  ok(rejectReplay.status === 200 && await auditCount(secondFact.id, 'reject') === 1, 'reject replay is idempotent with one audit total');
  ok(rejectReverse.status === 409 && await auditCount(secondFact.id, 'accept') === 0, 'rejected fact reversal fails 409 without audit');
  var rejectedRead = await request('GET', '/api/vehicles/' + encodeURIComponent(secondVehicle) + '/facts', TOKEN);
  ok(rejectedRead.raw.indexOf('ida3e-red-' + base) === -1, 'rejected community fact remains unservable');
  var retained = await db.query('SELECT f.id,o.id AS observation_id,s.id AS submission_id FROM idauto_vehicle_facts f JOIN idauto_observations o ON o.id=f.observation_id JOIN idauto_submissions s ON s.observation_id=o.id WHERE f.id=$1', [secondFact.id]);
  ok(retained.rows.length === 1, 'rejected submission, observation, and fact rows remain linked and retained');

  var malformedQueue = await request('GET', '/api/review/submissions/not-a-number', TOKEN);
  var missingQueue = await request('GET', '/api/review/submissions/999999999999', TOKEN);
  var malformedFact = await request('POST', '/api/review/facts/nope/decision', TOKEN, { decision: 'accept' });
  var missingFact = await request('POST', '/api/review/facts/999999999999/decision', TOKEN, { decision: 'accept' });
  var badDecision = await request('POST', '/api/review/facts/' + secondFact.id + '/decision', TOKEN, { decision: 'maybe' });
  ok(malformedQueue.status === 404 && missingQueue.status === 404 && malformedFact.status === 404 && missingFact.status === 404, 'malformed and missing submission/fact ids return 404');
  ok(badDecision.status === 400, 'bad fact decision returns 400 through existing error path');
}

(async function main() {
  await staticCases();
  if (STATIC_ONLY) console.log('\nIDA3E_STATIC_ONLY=1: live database and HTTP cases were not run.');
  else {
    var required = ['IDAUTO_DB_HOST','IDAUTO_DB_PORT','IDAUTO_DB_USER','IDAUTO_DB_PASSWORD','IDAUTO_DB_NAME','IDAUTO_MEDIA_STORAGE_PATH'];
    var missing = required.filter(function (name) { return !process.env[name]; });
    if (missing.length) throw new Error('missing required environment variable(s): ' + missing.join(', '));
    if (realDbCache) require.cache[dbPath] = realDbCache; else delete require.cache[dbPath];
    delete require.cache[writesPath];
    var apiPath = require.resolve(path.join(reference, 'api.js')); delete require.cache[apiPath];
    api = require(apiPath); db = require(dbPath);
    await liveCases();
  }
  if (server) await new Promise(function (resolve) { server.close(resolve); });
  if (db) await db.closePool();
  console.log('\nStage IDA-3E review queue: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (error) {
  if (server) { try { await new Promise(function (resolve) { server.close(resolve); }); } catch (_) {} }
  if (db) { try { await db.closePool(); } catch (_) {} }
  console.log('FATAL: ' + error.message);
  process.exit(1);
});
