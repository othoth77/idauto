'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var STATIC_ONLY = process.env.IDA3D_STATIC_ONLY === '1';
var TOKEN = 'ida3d-token-' + crypto.randomBytes(18).toString('hex');
var IDENTITY = 'usr_' + crypto.randomBytes(16).toString('hex');
var identities = {}; identities[TOKEN] = IDENTITY;
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
var apiPath = path.join(BASE, 'reference', 'api.js');
// api.js has a legacy eager db.js import. Keep the mandated static mode free
// of the optional pg package without changing that existing API behaviour.
if (STATIC_ONLY) {
  var dbPath = require.resolve(path.join(BASE, 'reference', 'db.js'));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
}
var api = require(apiPath);
var storage = require(path.join(BASE, 'reference', 'storage.js'));
var ingestion = require(path.join(BASE, 'reference', 'ingestion.js'));
var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function unique(prefix) { return prefix + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'); }
function throwsStatus(fn, status) { try { fn(); } catch (error) { return error.httpStatus === status; } return false; }

function multipart(boundary, submission, images) {
  var chunks = [];
  function part(headers, body) {
    chunks.push(Buffer.from('--' + boundary + '\r\n' + headers.join('\r\n') + '\r\n\r\n'));
    chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    chunks.push(Buffer.from('\r\n'));
  }
  part(['Content-Disposition: form-data; name="submission"', 'Content-Type: application/json'], JSON.stringify(submission));
  (images || []).forEach(function (image) {
    part(['Content-Disposition: form-data; name="image"; filename="evidence.bin"', 'Content-Type: ' + image.mime_type], image.buffer);
  });
  chunks.push(Buffer.from('--' + boundary + '--\r\n'));
  return Buffer.concat(chunks);
}

async function staticCases() {
  console.log('\nSTATIC SUBSET — no database or network');
  var boundary = 'ida3d-boundary';
  var first = Buffer.from([1, 2, 3]), second = Buffer.from([4, 5]);
  var parsed = api.parseMultipartBuffer(multipart(boundary, { plate: '123 TUN 4567' }, [
    { mime_type: 'image/png', buffer: first }, { mime_type: 'image/jpeg', buffer: second }
  ]), 'multipart/form-data; boundary=' + boundary);
  ok(parsed.submission.plate === '123 TUN 4567', 'well-formed submission JSON is parsed');
  ok(parsed.media.length === 2 && parsed.media[0].buffer.equals(first) && parsed.media[1].buffer.equals(second), 'several image parts preserve byte and part order');
  ok(parsed.media[0].mime_type === 'image/png' && parsed.media[1].mime_type === 'image/jpeg', 'per-part Content-Type is preserved');
  ok(api.parseMultipartBuffer(multipart(boundary, { plate: '123 TUN 4567' }, []), 'multipart/form-data; boundary=' + boundary).media.length === 0, 'zero image parts are accepted by transport');
  ok(throwsStatus(function () { api.parseMultipartBuffer(Buffer.alloc(0), 'multipart/form-data'); }, 400), 'missing boundary is rejected');
  ok(throwsStatus(function () { api.parseMultipartBuffer(Buffer.alloc(0), 'multipart/form-data; boundary=bad boundary'); }, 400), 'malformed boundary is rejected');
  ok(throwsStatus(function () { api.parseMultipartBuffer(Buffer.alloc(0), 'application/json'); }, 400), 'non-multipart Content-Type is rejected');
  ok(throwsStatus(function () { api.parseMultipartBuffer(Buffer.alloc(storage.MAX_UPLOAD_BYTES + 1), 'multipart/form-data; boundary=' + boundary); }, 413), 'input above storage.MAX_UPLOAD_BYTES is rejected');
  var malformedJson = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="submission"\r\n\r\n{bad\r\n--' + boundary + '--\r\n');
  ok(throwsStatus(function () { api.parseMultipartBuffer(malformedJson, 'multipart/form-data; boundary=' + boundary); }, 400), 'malformed submission JSON is rejected');

  var groups = {
    422: ['INVALID_PLATE'],
    413: ['INVALID_MEDIA_SIZE', 'SUBMISSION_TOO_LARGE', 'TOO_MANY_IMAGES'],
    415: ['INVALID_MEDIA', 'INVALID_MEDIA_MAGIC', 'MALFORMED_MEDIA'],
    429: ['RATE_LIMITED'],
    500: ['CAPTURE_SOURCE_UNAVAILABLE', 'INGESTION_FAILED', 'IDA_FACT_LINK', 'RATE_LIMIT_STORAGE_ERROR'],
    400: ['MALFORMED_PAYLOAD', 'SERVER_DERIVED_FIELD', 'INVALID_ACTOR_TYPE', 'INVALID_ACTOR_REF', 'INVALID_CAPTURE_METHOD', 'INVALID_CAPTURE_TIME', 'INVALID_FACT', 'INVALID_FACTS', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_RATE_LIMIT_IDENTITY']
  };
  Object.keys(groups).forEach(function (status) { groups[status].forEach(function (code) {
    ok(api.ingestHttpStatus({ ok: false, error: { code: code } }) === Number(status), code + ' maps to ' + status);
  }); });
  ok(api.ingestHttpStatus({ replay: true, status: 'accepted' }) === 200, 'replay maps to 200');
  ok(api.ingestHttpStatus({ status: 'duplicate' }) === 202, 'duplicate maps to 202');
  ok(api.ingestHttpStatus({ ok: true, status: 'accepted' }) === 201, 'ordinary success maps to 201');
  var now = new Date('2026-08-12T12:00:00Z');
  ok(api.retryAfterSeconds(new Date(now.getTime() + 1501), now) === 2, 'Retry-After rounds up to whole seconds');
  ok(api.retryAfterSeconds(new Date(now.getTime() - 5000), now) === 1, 'Retry-After never becomes zero or negative');

  var source = fs.readFileSync(apiPath, 'utf8');
  ok((source.match(/\^\\\/api\\\/ingest\\\/observations\$/g) || []).length === 1, 'private ingestion route occurs exactly once');
  ok((source.match(/\.listen\s*\(/g) || []).length === 1, 'no second listener was added');
  ok((source.match(/'127\.0\.0\.1'/g) || []).length === 1, 'loopback bind host remains unchanged');
  ok(!/api\\\/v1\\\/ingest|anonymous[^\n]*route/i.test(source), 'no public or anonymous ingestion route was added');
  ok(!/require\s*\(\s*['"][^'"]*(?:jwt|oauth|session|cookie)[^'"]*['"]\s*\)|req\.(?:cookies|session)|set-cookie/i.test(source), 'no JWT, OAuth, session, or cookie auth was added');
  ok(!/CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE/i.test(source), 'api.js contains no DDL');
  // A5 OPTION C, 2026-08-19: api.js may now CALL reference/rate-limit.js for
  // the public passport route (IDA-4 Option C requires that route to be
  // rate-limited), so requiring rate-limit.js is no longer forbidden here —
  // but api.js must still never host counter/bucket-selection machinery
  // itself; that stays exclusively in reference/rate-limit.js.
  ok(!/idauto_rate_limit_counters|bucketKey|selectBuckets/.test(source), 'api.js contains no inline rate-limit counter implementation — the sanctioned public_resolution limiter lives in reference/rate-limit.js');
  // F9 (Opus review, 2026-08-19): api.js may call rate-limit.js's
  // public-resolution-specific function, but must never invoke the
  // ingestion limiter (enforce()) itself — that stays exclusively behind
  // reference/ingestion.js's own call site.
  ok(source.indexOf('rateLimit.enforce(') === -1, 'api.js never calls the ingestion rate limiter (rateLimit.enforce) directly');
  ok(source.indexOf('FORBIDDEN_PAYLOAD_FIELDS') === -1 && source.indexOf("'capture_source_id', 'contributor_id'") === -1, 'api.js does not reimplement the forbidden-field list');
  ok(/if \(!requireAuth\(req, res\)\) return;[\s\S]*route\.handler/.test(source), 'existing authentication gate still precedes every route handler');
}

var server, port, db;
function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: Object.assign({ 'Content-Length': body ? body.length : 0 }, headers || {}) }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
function ingestRequest(token, key, submission, images) {
  var boundary = unique('boundary'), body = multipart(boundary, submission, images || []);
  var headers = { 'Content-Type': 'multipart/form-data; boundary=' + boundary };
  if (token) headers.Authorization = 'Bearer ' + token;
  // Omit the header entirely rather than sending an undefined value. Node
  // rejects `undefined` as a header value and aborts the whole run, which
  // would stop the missing-key case below from ever reaching the route.
  if (key !== undefined && key !== null) headers['Idempotency-Key'] = key;
  return request('POST', '/api/ingest/observations', headers, body);
}
function minimalPng() { return Buffer.from([137,80,78,71,13,10,26,10, 0,0,0,0, 73,69,78,68, 174,66,96,130]); }
async function scalar(sql, params) { var result = await db.query(sql, params || []); return Number(result.rows[0].count); }

async function liveCases() {
  console.log('\nLIVE DATABASE + HTTP SUITE');
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  var noAuth = await ingestRequest(null, unique('idem'), { plate: '123 TUN 4567' });
  var badAuth = await ingestRequest('unrecognized', unique('idem'), { plate: '123 TUN 4567' });
  ok(noAuth.status === 401 && badAuth.status === 401, 'missing and unrecognized bearer tokens both return real 401 responses');
  var missingKey = await ingestRequest(TOKEN, undefined, { plate: '123 TUN 4567' });
  ok(missingKey.status === 400, 'missing Idempotency-Key returns 400');

  var plate = (Date.now() % 800 + 100) + ' TUN ' + (Date.now() % 8000 + 1000);
  var key = unique('ida3d-success');
  var countersBefore = await scalar('SELECT count(*) FROM idauto_rate_limit_counters');
  var success = await ingestRequest(TOKEN, key, { plate: plate }, [{ mime_type: 'image/png', buffer: minimalPng() }]);
  ok(success.status === 201 && success.body && success.body.ok, 'real admin ingestion returns 201');
  var replay = await ingestRequest(TOKEN, key, { plate: plate });
  ok(replay.status === 200 && replay.body && replay.body.replay, 'real idempotent replay returns 200');
  ok(await scalar('SELECT count(*) FROM idauto_rate_limit_counters') === countersBefore, 'admin submission writes no rate-limit counter rows');
  var persisted = await db.query('SELECT actor_ref, actor_type, ip_hash FROM idauto_submissions WHERE id=$1', [success.body.submission_id]);
  ok(persisted.rows[0].actor_ref === IDENTITY && persisted.rows[0].actor_type === 'admin' && persisted.rows[0].ip_hash === null, 'submission stores resolved usr identity and no IP hash');
  var audit = await db.query('SELECT actor_ref,actor_type,event_type,new_value_json,change_summary FROM idauto_audit_log WHERE request_id=$1', [key]);
  ok(audit.rows.length === 1 && audit.rows[0].actor_ref === IDENTITY && audit.rows[0].actor_type === 'admin' && audit.rows[0].event_type === 'ingestion.submit', 'audit attribution is exact and stores resolved identity');
  ok(JSON.stringify(persisted.rows).indexOf(TOKEN) === -1 && JSON.stringify(audit.rows).indexOf(TOKEN) === -1 && success.raw.indexOf(TOKEN) === -1 && replay.raw.indexOf(TOKEN) === -1, 'bearer token appears in no submission row, audit row, or response');
  var media = await db.query('SELECT access_scope,mime_type FROM idauto_observation_media WHERE observation_id=$1', [success.body.observation_id]);
  ok(media.rows.length === 1 && media.rows[0].access_scope === 'mythos_private' && media.rows[0].mime_type === 'image/png', 'real media remains mythos_private with declared MIME');

  var spoofFields = ingestion.constants.forbiddenPayloadFields;
  for (var i = 0; i < spoofFields.length; i++) {
    var spoof = { plate: plate }; spoof[spoofFields[i]] = 'client-controlled';
    var rejected = await ingestRequest(TOKEN, unique('spoof'), spoof);
    ok(rejected.status === 400 && rejected.body.error.code === 'SERVER_DERIVED_FIELD', 'spoofed ' + spoofFields[i] + ' is rejected end to end');
  }
  var invalidPlate = await ingestRequest(TOKEN, unique('invalid'), { plate: 'not-a-plate' });
  ok(invalidPlate.status === 422, 'real invalid plate rejection maps to 422');
  var invalidMedia = await ingestRequest(TOKEN, unique('media'), { plate: plate }, [{ mime_type: 'text/plain', buffer: Buffer.from('not image') }]);
  ok(invalidMedia.status === 415, 'real invalid media rejection maps to 415');

  var originalSubmit = ingestion.submit;
  ingestion.submit = async function () { return { ok: true, replay: false, status: 'duplicate', original_observation_id: 7 }; };
  var duplicate = await ingestRequest(TOKEN, unique('duplicate'), { plate: plate });
  ok(duplicate.status === 202 && duplicate.body.status === 'duplicate', 'live HTTP duplicate result maps to 202');
  ingestion.submit = async function () { return { ok: false, retry_at: new Date(Date.now() + 1500), error: { code: 'RATE_LIMITED', fields: [], message: 'limited' } }; };
  var limited = await ingestRequest(TOKEN, unique('limited'), { plate: plate });
  ok(limited.status === 429 && Number(limited.headers['retry-after']) >= 1, 'live HTTP rate-limit result maps to 429 with Retry-After');
  ingestion.submit = originalSubmit;

  var health = await request('GET', '/health', { Authorization: 'Bearer ' + TOKEN });
  var missing = await request('GET', '/api/not-a-route', { Authorization: 'Bearer ' + TOKEN });
  ok(health.status === 200 && missing.status === 404, 'existing health and not-found route behavior remains intact');
}

(async function main() {
  await staticCases();
  if (STATIC_ONLY) console.log('\nIDA3D_STATIC_ONLY=1: live database and HTTP cases were not run.');
  else {
    var required = ['IDAUTO_DB_HOST','IDAUTO_DB_PORT','IDAUTO_DB_USER','IDAUTO_DB_PASSWORD','IDAUTO_DB_NAME','IDAUTO_MEDIA_STORAGE_PATH'];
    var missing = required.filter(function (name) { return !process.env[name]; });
    if (missing.length) throw new Error('missing required environment variable(s): ' + missing.join(', '));
    db = require(path.join(BASE, 'reference', 'db.js'));
    await liveCases();
  }
  if (server) await new Promise(function (resolve) { server.close(resolve); });
  if (db) await db.closePool();
  console.log('\nStage IDA-3D private ingestion route: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (error) {
  if (server) { try { await new Promise(function (resolve) { server.close(resolve); }); } catch (_) {} }
  if (db) { try { await db.closePool(); } catch (_) {} }
  console.log('FATAL: ' + error.message);
  process.exit(1);
});
