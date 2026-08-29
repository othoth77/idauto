'use strict';
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }

var TOKEN = crypto.randomBytes(24).toString('hex');
var IDENTITY = 'admin:ida-2g-test-' + Date.now();
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: IDENTITY });
var api = require(path.join(BASE, 'reference/api.js'));
var db = require(path.join(BASE, 'reference/db.js'));
var server, port;

function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: headers || {} }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function element(value, extras) { return Object.assign({ value: value || '' }, extras || {}); }
function fakeForm(seed) {
  return { elements: {
    make: element('UITestMake'), model: element('UITestModel'), variant: element('IDA-2G-' + seed), year: element('2026'),
    body_type: element('test'), fuel_type: element('electric'), colour: element('blue'), seats: element('4'),
    gross_weight_kg: element('1600'), engine_cc: element(''), category_code: element('M1'),
    plate_number: element('UI ' + seed), format_code: element('TUN_STD'), governorate_code: element('01'),
    status: element('received'), fact_key: element('ui_test_marker'), fact_value: element(seed), confidence_score: element('0.8'),
    access_scope: element('mythos_private'), evidence_type: element('admin_validation'), media: element('', { files: [] }),
    media_type: element('original_image'), media_access_scope: element('mythos_private'), blurred: element('', { checked: false })
  } };
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  console.log('\n1. ADMIN SHELL — static only, no credential disclosure');
  var page = await request('GET', '/admin');
  ok(page.status === 200 && /^text\/html/.test(page.headers['content-type']), 'GET /admin serves the manual-entry page');
  ok(page.raw.indexOf("Enregistrement manuel d'un véhicule") !== -1 && page.raw.indexOf('Review queue') === -1, 'Page is manual-entry UI only (no review queue)');
  ok(page.raw.indexOf('admin-token') !== -1 && page.raw.indexOf('localStorage') === -1, 'Page accepts a token without browser-storage persistence');
  ok((page.headers['content-security-policy'] || '').indexOf("default-src 'self'") !== -1, 'Admin shell has a restrictive same-origin CSP');
  var js = await request('GET', '/admin/admin-ui.js');
  var css = await request('GET', '/admin/admin.css');
  ok(js.status === 200 && /^application\/javascript/.test(js.headers['content-type']), 'Admin JavaScript asset is served');
  ok(css.status === 200 && /^text\/css/.test(css.headers['content-type']), 'Admin CSS asset is served');

  console.log('\n2. AUTH BOUNDARY — API behavior remains protected');
  var unauth = await request('POST', '/api/vehicles', { 'Content-Type': 'application/json' }, '{}');
  ok(unauth.status === 401, 'Serving the UI does not bypass API identity checks');

  console.log('\n3. UI WORKFLOW — existing IDA-2D APIs and audit identity');
  var originalFetch = global.fetch;
  global.fetch = function (requestPath, options) {
    var headers = Object.assign({}, options.headers);
    return request(options.method, requestPath, headers, options.body).then(function (response) {
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async function () { return JSON.parse(response.raw); } };
    });
  };
  var ui = require(path.join(BASE, 'reference/admin-ui.js'));
  var seed = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  var created;
  try { created = await ui.createEntry(fakeForm(seed), TOKEN); } finally { global.fetch = originalFetch; }
  ok(created.vehicle && created.vehicle.internal_ref, 'UI creates a vehicle through POST /api/vehicles');
  ok(created.plate && created.plate.plate_number === 'UI ' + seed, 'UI links an optional plate to the created vehicle');
  ok(created.observation && created.observation.capture_method === 'manual_admin', 'UI creates an observation with API-fixed manual_admin capture method');
  ok(created.fact && created.fact.fact.access_scope === 'mythos_private', 'UI can write a private fact through the audited API');
  ok(String(created.fact.fact.observation_id) === String(created.observation.id), 'UI fact retains observation-first provenance through observation_id');

  var audit = await db.query(
    'SELECT event_type, actor_ref FROM idauto_audit_log WHERE actor_ref = $1 AND target_ref = ANY($2::text[]) ORDER BY event_type',
    [IDENTITY, [created.vehicle.internal_ref, created.plate.plate_number, String(created.observation.id), String(created.fact.fact.id)]]
  );
  ok(audit.rows.length === 4, 'All four UI mutations have matching audit rows');
  ok(audit.rows.every(function (row) { return row.actor_ref === IDENTITY; }), 'Every audit row uses the resolved identity stub value, never the bearer token');

  var privateRead = await request('GET', '/api/vehicles/' + encodeURIComponent(created.vehicle.internal_ref) + '/facts', { Authorization: 'Bearer ' + TOKEN });
  var privateBody = JSON.parse(privateRead.raw);
  ok(privateRead.status === 200 && privateBody.facts.length === 0, 'mythos_private fact remains excluded from reads');

  var source = fs.readFileSync(path.join(BASE, 'reference/admin-ui.js'), 'utf8');
  ok(!/localStorage|sessionStorage/.test(source), 'UI script never persists the admin token');
  ok(source.indexOf('/api/review') === -1 && source.indexOf('rateLimit') === -1, 'UI contains no review-queue or rate-limiting implementation');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();
  console.log('\nStage IDA-2G (admin manual entry UI): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (err) {
  console.log('FATAL: ' + err.stack);
  if (server) server.close();
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
