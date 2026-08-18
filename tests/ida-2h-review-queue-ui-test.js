'use strict';
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var fs = require('fs');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }

var TOKEN = crypto.randomBytes(24).toString('hex');
var IDENTITY = 'admin:ida-2h-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: IDENTITY });
var api = require(path.join(BASE, 'reference/api.js'));
var db = require(path.join(BASE, 'reference/db.js'));
var server, port;

function request(method, requestPath, headers, body) {
  return new Promise(function (resolve, reject) {
    var h = Object.assign({}, headers || {});
    if (body != null) h['Content-Length'] = Buffer.byteLength(body);
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: h }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, raw: raw, body: parsed });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
function authed(method, requestPath, body, headers) {
  var h = Object.assign({ Authorization: 'Bearer ' + TOKEN }, headers || {});
  if (body && !Buffer.isBuffer(body)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return request(method, requestPath, h, body);
}
async function createFixture(status, marker) {
  var vehicle = (await authed('POST', '/api/vehicles', { make: 'ReviewTest', model: marker })).body;
  var observation = (await authed('POST', '/api/observations', { vehicle_internal_ref: vehicle.internal_ref, status: status })).body;
  return { vehicle: vehicle, observation: observation };
}
async function auditCount(targetRef, eventType) {
  var result = await db.query('SELECT count(*) FROM idauto_audit_log WHERE target_ref = $1 AND event_type = $2', [String(targetRef), eventType]);
  return parseInt(result.rows[0].count, 10);
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  var seed = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  var pendingReview = await createFixture('pending_review', 'review-' + seed);
  var pendingConfirmation = await createFixture('pending_confirmation', 'confirm-' + seed);
  var notPending = await createFixture('received', 'received-' + seed);

  await authed('POST', '/api/vehicles/' + encodeURIComponent(pendingReview.vehicle.internal_ref) + '/facts', {
    fact_key: 'colour', fact_value: 'green-' + seed, access_scope: 'public'
  });
  await authed('POST', '/api/vehicles/' + encodeURIComponent(pendingReview.vehicle.internal_ref) + '/facts', {
    fact_key: 'vin', fact_value: 'PRIVATE-' + seed, access_scope: 'mythos_private'
  });
  await authed('POST', '/api/observations/' + pendingReview.observation.id + '/media', Buffer.from('public-' + seed), {
    'Content-Type': 'image/png', 'X-Idauto-Access-Scope': 'public'
  });
  await authed('POST', '/api/observations/' + pendingReview.observation.id + '/media', Buffer.from('private-' + seed), {
    'Content-Type': 'image/png', 'X-Idauto-Access-Scope': 'mythos_private'
  });

  console.log('\n1. REVIEW PAGE — protected same-origin client shell');
  var page = await request('GET', '/admin/review');
  ok(page.status === 200 && page.raw.indexOf('Review queue') !== -1, 'GET /admin/review serves the review-queue page');
  ok((page.headers['content-security-policy'] || '').indexOf("default-src 'self'") !== -1, 'Review page preserves restrictive same-origin CSP');
  ok(page.headers['cache-control'] === 'no-store' && page.headers['x-content-type-options'] === 'nosniff', 'Review page preserves no-store and nosniff protections');
  var uiAsset = await request('GET', '/admin/review-ui.js');
  ok(uiAsset.status === 200 && !/localStorage|sessionStorage|document\.cookie/.test(uiAsset.raw), 'Review UI is served and never persists the bearer token');

  console.log('\n2. AUTHORIZATION — every review API remains identity-gated');
  ok((await request('GET', '/api/review/observations')).status === 401, 'Queue list without identity -> 401');
  ok((await request('GET', '/api/review/observations/' + pendingReview.observation.id)).status === 401, 'Review detail without identity -> 401');
  ok((await request('POST', '/api/review/observations/' + pendingReview.observation.id + '/decision', { 'Content-Type': 'application/json' }, '{"decision":"accept"}')).status === 401, 'Review decision without identity -> 401');

  console.log('\n3. QUEUE FILTERING AND SAFE DETAIL');
  var queue = await authed('GET', '/api/review/observations');
  var queueIds = queue.body.observations.map(function (item) { return String(item.id); });
  ok(queue.status === 200, 'Authenticated queue list -> 200');
  ok(queueIds.indexOf(String(pendingReview.observation.id)) !== -1 && queueIds.indexOf(String(pendingConfirmation.observation.id)) !== -1, 'Queue includes pending_review and pending_confirmation observations');
  ok(queueIds.indexOf(String(notPending.observation.id)) === -1, 'Queue excludes non-pending observations');
  var detail = await authed('GET', '/api/review/observations/' + pendingReview.observation.id);
  ok(detail.status === 200 && detail.body.observation.vehicle_internal_ref === pendingReview.vehicle.internal_ref, 'Detail includes linked observation and vehicle');
  ok(detail.body.facts.length === 1 && detail.body.facts[0].fact_key === 'colour', 'Detail includes non-private fact only');
  ok(detail.raw.indexOf('PRIVATE-' + seed) === -1 && detail.raw.indexOf('mythos_private') === -1, 'Private fact value and scope never appear in detail response');
  ok(detail.body.media.length === 1 && detail.body.media[0].access_scope === 'public', 'Detail includes allowed media metadata only');
  ok(detail.raw.indexOf('object_key') === -1 && detail.raw.indexOf(process.env.IDAUTO_MEDIA_STORAGE_PATH) === -1, 'Detail exposes no object key or raw storage path');

  console.log('\n4. UI CLIENT — loading and decisions use authenticated APIs');
  var originalFetch = global.fetch;
  global.fetch = function (requestPath, options) {
    options = options || {};
    var body = options.body == null ? null : options.body;
    return request(options.method || 'GET', requestPath, options.headers, body).then(function (response) {
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async function () { return response.body || {}; } };
    });
  };
  var reviewUi = require(path.join(BASE, 'reference/review-ui.js'));
  var uiQueue, accepted, rejected;
  try {
    uiQueue = await reviewUi.loadQueue(TOKEN);
    accepted = await reviewUi.decide(pendingReview.observation.id, 'accept', TOKEN);
    rejected = await reviewUi.decide(pendingConfirmation.observation.id, 'reject', TOKEN);
  } finally { global.fetch = originalFetch; }
  ok(uiQueue.observations.some(function (item) { return String(item.id) === String(pendingReview.observation.id); }), 'UI client loads the authenticated queue');
  ok(accepted.status === 'accepted', 'Accept action changes pending_review -> accepted');
  ok(rejected.status === 'rejected', 'Reject action changes pending_confirmation -> rejected');

  console.log('\n5. AUDIT ATOMICITY, IDENTITY, AND IDEMPOTENCY');
  ok(await auditCount(pendingReview.observation.id, 'observation.review.accept') === 1, 'Accept creates exactly one audit row');
  ok(await auditCount(pendingConfirmation.observation.id, 'observation.review.reject') === 1, 'Reject creates exactly one audit row');
  var reviewAudits = await db.query(
    "SELECT actor_ref FROM idauto_audit_log WHERE target_ref = ANY($1::text[]) AND event_type IN ('observation.review.accept','observation.review.reject')",
    [[String(pendingReview.observation.id), String(pendingConfirmation.observation.id)]]
  );
  ok(reviewAudits.rows.length === 2 && reviewAudits.rows.every(function (row) { return row.actor_ref === IDENTITY && row.actor_ref !== TOKEN; }), 'Review audits use resolved identity, never bearer token');
  var repeat = await authed('POST', '/api/review/observations/' + pendingReview.observation.id + '/decision', { decision: 'accept' });
  ok(repeat.status === 200 && repeat.body.status === 'accepted', 'Repeated identical decision is a safe idempotent success');
  ok(await auditCount(pendingReview.observation.id, 'observation.review.accept') === 1, 'Repeated decision creates no duplicate audit row');

  console.log('\n6. CONCURRENT DECISIONS — row lock gives one deterministic real mutation');
  var concurrentAccept = await createFixture('pending_review', 'concurrent-accept-' + seed);
  var acceptPair = await Promise.all([
    authed('POST', '/api/review/observations/' + concurrentAccept.observation.id + '/decision', { decision: 'accept' }),
    authed('POST', '/api/review/observations/' + concurrentAccept.observation.id + '/decision', { decision: 'accept' })
  ]);
  ok(acceptPair.every(function (result) { return result.status === 200 && result.body.status === 'accepted'; }), 'Concurrent accept/accept returns two idempotent successes');
  ok(await auditCount(concurrentAccept.observation.id, 'observation.review.accept') === 1, 'Concurrent accept/accept creates exactly one real audit mutation');

  var concurrentReject = await createFixture('pending_confirmation', 'concurrent-reject-' + seed);
  var rejectPair = await Promise.all([
    authed('POST', '/api/review/observations/' + concurrentReject.observation.id + '/decision', { decision: 'reject' }),
    authed('POST', '/api/review/observations/' + concurrentReject.observation.id + '/decision', { decision: 'reject' })
  ]);
  ok(rejectPair.every(function (result) { return result.status === 200 && result.body.status === 'rejected'; }), 'Concurrent reject/reject returns two idempotent successes');
  ok(await auditCount(concurrentReject.observation.id, 'observation.review.reject') === 1, 'Concurrent reject/reject creates exactly one real audit mutation');

  var concurrentOpposed = await createFixture('pending_review', 'concurrent-opposed-' + seed);
  var opposedPair = await Promise.all([
    authed('POST', '/api/review/observations/' + concurrentOpposed.observation.id + '/decision', { decision: 'accept' }),
    authed('POST', '/api/review/observations/' + concurrentOpposed.observation.id + '/decision', { decision: 'reject' })
  ]);
  var opposedStatuses = opposedPair.map(function (result) { return result.status; }).sort();
  ok(opposedStatuses[0] === 200 && opposedStatuses[1] === 409, 'Concurrent accept/reject produces one success and one conflict');
  var opposedAudits = await db.query("SELECT event_type FROM idauto_audit_log WHERE target_ref = $1 AND event_type IN ('observation.review.accept','observation.review.reject')", [String(concurrentOpposed.observation.id)]);
  ok(opposedAudits.rows.length === 1, 'Concurrent accept/reject creates exactly one audit mutation');
  var opposedFinal = await authed('GET', '/api/observations/' + concurrentOpposed.observation.id);
  ok(opposedFinal.body.status === (opposedAudits.rows[0].event_type === 'observation.review.accept' ? 'accepted' : 'rejected'), 'Concurrent accept/reject final state matches its sole audit event');

  console.log('\n7. INVALID TARGETS — fail without phantom audits');
  var beforeAll = await db.query("SELECT count(*) FROM idauto_audit_log WHERE event_type LIKE 'observation.review.%'");
  var invalidDecision = await authed('POST', '/api/review/observations/' + notPending.observation.id + '/decision', { decision: 'accept' });
  var nonexistentId = '999999999999';
  var nonexistent = await authed('POST', '/api/review/observations/' + nonexistentId + '/decision', { decision: 'reject' });
  var malformed = await authed('POST', '/api/review/observations/' + pendingReview.observation.id + '/decision', { decision: 'maybe' });
  var afterAll = await db.query("SELECT count(*) FROM idauto_audit_log WHERE event_type LIKE 'observation.review.%'");
  ok(invalidDecision.status === 409, 'Non-pending target -> 409');
  ok(nonexistent.status === 404, 'Nonexistent target -> 404');
  ok(malformed.status === 400, 'Invalid decision -> 400');
  ok(beforeAll.rows[0].count === afterAll.rows[0].count, 'Failed review attempts create no phantom audit rows');

  var refreshed = await authed('GET', '/api/review/observations');
  var refreshedIds = refreshed.body.observations.map(function (item) { return String(item.id); });
  ok(refreshedIds.indexOf(String(pendingReview.observation.id)) === -1 && refreshedIds.indexOf(String(pendingConfirmation.observation.id)) === -1, 'Resolved observations leave the pending queue');

  var source = fs.readFileSync(path.join(BASE, 'reference/api.js'), 'utf8');
  ok(source.indexOf('object_key') !== -1 && detail.raw.indexOf('object_key') === -1, 'Storage references remain internal even though media support exists');
  var uiSource = fs.readFileSync(path.join(BASE, 'reference/review-ui.js'), 'utf8');
  ok((uiSource.match(/activeId !== id/g) || []).length >= 3 && uiSource.indexOf('activeId = null') !== -1, 'Review UI guards stale detail success, failure, and decision responses before changing active detail');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();
  console.log('\nStage IDA-2H (review queue UI): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (err) {
  console.log('FATAL: ' + err.stack);
  if (server) server.close();
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
