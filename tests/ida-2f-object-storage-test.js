'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2F tests
// tests/ida-2f-object-storage-test.js
//
// Live, not offline — same pattern as tests/ida-2c/2d. Requires
// IDAUTO_DB_HOST/PORT/USER/PASSWORD/NAME and IDAUTO_MEDIA_STORAGE_PATH in
// the environment. The admin identity token is generated fresh by this
// test itself, same as tests/ida-2d-write-api-and-audit-test.js.
//
// Run with: env IDAUTO_DB_HOST=... IDAUTO_MEDIA_STORAGE_PATH=... node tests/ida-2f-object-storage-test.js
// =====================================================

var http = require('http');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var TOKEN = crypto.randomBytes(24).toString('hex');
var TEST_IDENTITY = 'admin:ida-2f-test-run';
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify({ [TOKEN]: TEST_IDENTITY });

var api = require(path.join(BASE, 'reference', 'api.js'));
var db = require(path.join(BASE, 'reference', 'db.js'));
var writes = require(path.join(BASE, 'reference', 'writes.js'));
var storage = require(path.join(BASE, 'reference', 'storage.js'));

var server, port;

function request(method, requestPath, headers, bodyBuffer) {
  return new Promise(function (resolve, reject) {
    var h = Object.assign({}, headers || {});
    if (bodyBuffer) h['Content-Length'] = bodyBuffer.length;
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method, headers: h }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}
function authed(requestPath, method, headers, bodyBuffer) {
  var h = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, headers || {});
  return request(method || 'GET', requestPath, h, bodyBuffer);
}

async function auditCount() {
  var r = await db.query('SELECT count(*) FROM idauto_audit_log');
  return parseInt(r.rows[0].count, 10);
}
async function latestAudit() {
  var r = await db.query('SELECT event_type, actor_type, actor_ref, target_type, target_ref FROM idauto_audit_log ORDER BY id DESC LIMIT 1');
  return r.rows[0];
}
async function mediaRowCountForKey(objectKey) {
  var r = await db.query('SELECT count(*) FROM idauto_observation_media WHERE object_key = $1', [objectKey]);
  return parseInt(r.rows[0].count, 10);
}
function fakePng(seed) {
  // Not a real, valid PNG — just distinct bytes with a PNG-shaped magic
  // number prefix. storage.js never parses image content, only mime type
  // + size, so this is sufficient to exercise the storage/DB wiring
  // without needing real image data.
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('IDA2F-TEST-' + seed)]);
}

(async function main() {
  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  // Fresh vehicle + observation to attach media to (this suite's own
  // fixtures, doesn't depend on IDA-2C/2D's synthetic data existing).
  var vehicleResp = await authed('/api/vehicles', 'POST', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ make: 'IDA2F-Test-Vehicle' })));
  var vehicleRef = vehicleResp.body.internal_ref;
  var obsResp = await authed('/api/observations', 'POST', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ vehicle_internal_ref: vehicleRef })));
  var obsId = obsResp.body.id;
  ok(vehicleResp.status === 201 && obsResp.status === 201, 'Fixture setup: vehicle + observation created for this suite to attach media to');

  console.log('\n1. AUTH GATE — preserved on media routes');
  var noAuth = await request('POST', '/api/observations/' + obsId + '/media', { 'Content-Type': 'image/png' }, fakePng('noauth'));
  ok(noAuth.status === 401, 'POST .../media with no auth -> 401');
  var noAuthGet = await request('GET', '/api/observations/' + obsId + '/media');
  ok(noAuthGet.status === 401, 'GET .../media with no auth -> 401');

  console.log('\n2. POST /api/observations/:id/media — public-scope upload, creates row + audit atomically');
  var beforeCount = await auditCount();
  // Unique per run (Date.now()-seeded) so this suite is safe to re-run
  // against the same persistent database — the same lesson IDA-2D's own
  // hardcoded-plate-number bug taught: a static seed here would make
  // "exactly 2 rows for this object_key" assertions accumulate garbage
  // across runs instead of measuring THIS run's behaviour.
  var img1 = fakePng('public-1-' + Date.now());
  var expectedHash1 = crypto.createHash('sha256').update(img1).digest('hex');
  var upload1 = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'image/png', 'X-Idauto-Access-Scope': 'public' }, img1);
  ok(upload1.status === 201, 'POST .../media (image/png, access_scope=public) -> 201');
  ok(upload1.body.object_key === expectedHash1 && upload1.body.image_hash === expectedHash1, 'object_key and image_hash both equal the SHA-256 of the uploaded bytes');
  ok(upload1.body.file_size_bytes === img1.length, 'file_size_bytes matches the actual uploaded size');
  ok(upload1.body.access_scope === 'public', 'access_scope is public, as requested via header');
  var afterCount = await auditCount();
  ok(afterCount === beforeCount + 1, 'Exactly one new audit_log row appeared');
  var audit1 = await latestAudit();
  ok(audit1.event_type === 'observation_media.create' && audit1.actor_ref === TEST_IDENTITY, 'Audit row: event_type=observation_media.create, actor_ref=real identity');

  console.log('\n3. The file actually exists on disk at the expected content-addressed path, with correct content');
  var expectedPath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, expectedHash1.slice(0, 2), expectedHash1.slice(2, 4), expectedHash1);
  ok(fs.existsSync(expectedPath), 'File exists at IDAUTO_MEDIA_STORAGE_PATH/<hash[0:2]>/<hash[2:4]>/<hash>');
  ok(fs.readFileSync(expectedPath).equals(img1), 'File content on disk exactly matches what was uploaded');

  console.log('\n4. GET /api/observations/:id/media — public upload is visible');
  var mediaList1 = await authed('/api/observations/' + obsId + '/media');
  ok(mediaList1.status === 200 && mediaList1.body.media.length === 1 && mediaList1.body.media[0].access_scope === 'public', 'GET .../media lists the public upload');

  console.log('\n5. DEFAULT access_scope (no header) is mythos_private, and reads still exclude it (IDA-2C/2D policy unchanged)');
  var img2 = fakePng('default-scope-2');
  var upload2 = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'image/jpeg' }, img2);
  ok(upload2.status === 201 && upload2.body.access_scope === 'mythos_private', 'No X-Idauto-Access-Scope header -> defaults to mythos_private (matches schema.sql\'s own column default)');
  var mediaList2 = await authed('/api/observations/' + obsId + '/media');
  ok(mediaList2.body.media.length === 1, 'GET .../media STILL shows only 1 row (the public one) — the mythos_private upload is excluded from reads, same as IDA-2C/2D\'s established policy for facts');

  console.log('\n6. DUPLICATE content — same bytes uploaded twice: same object_key, one file on disk, TWO distinct DB rows');
  var dup1 = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'image/png', 'X-Idauto-Access-Scope': 'public' }, img1);
  ok(dup1.status === 201 && dup1.body.object_key === expectedHash1, 'Re-uploading the same bytes succeeds and reuses the same object_key (content-addressed dedup)');
  var rowsForKey = await mediaRowCountForKey(expectedHash1);
  ok(rowsForKey === 2, 'Two separate idauto_observation_media rows now reference the same object_key (each upload is its own row — file dedup, not row dedup) — found ' + rowsForKey);

  console.log('\n7. INVALID mime type -> 400, no DB row, no file written');
  var beforeInvalidCount = await auditCount();
  var invalidMime = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'application/pdf' }, Buffer.from('not-an-allowed-type'));
  ok(invalidMime.status === 400, 'Unsupported mime type (application/pdf) -> 400');
  var afterInvalidCount = await auditCount();
  ok(afterInvalidCount === beforeInvalidCount, 'No audit_log row was created for the rejected upload');

  console.log('\n8. EMPTY body -> 400');
  var emptyBody = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'image/png' }, Buffer.alloc(0));
  ok(emptyBody.status === 400, 'Empty file body -> 400');
  var oversizedBody = await authed('/api/observations/' + obsId + '/media', 'POST', { 'Content-Type': 'image/png' }, Buffer.alloc(storage.MAX_UPLOAD_BYTES + 1));
  ok(oversizedBody.status === 413, 'Binary body over 20MB -> 413 without resetting the client connection');

  console.log('\n9. Nonexistent observation -> 404, file never touches disk (existence checked BEFORE storage.store() runs)');
  var beforeGhostCount = await auditCount();
  var ghostImg = fakePng('ghost-observation');
  var ghostHash = crypto.createHash('sha256').update(ghostImg).digest('hex');
  var ghostUpload = await authed('/api/observations/999999999/media', 'POST', { 'Content-Type': 'image/png' }, ghostImg);
  ok(ghostUpload.status === 404, 'POST to a nonexistent observation id -> 404');
  var ghostPath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, ghostHash.slice(0, 2), ghostHash.slice(2, 4), ghostHash);
  ok(!fs.existsSync(ghostPath), 'No file was ever written to disk for the rejected upload — the observation-exists check runs before storage.store()');
  var afterGhostCount = await auditCount();
  ok(afterGhostCount === beforeGhostCount, 'No audit_log row was created either');

  console.log('\n10. ATOMICITY (direct, not reachable via HTTP) — DB/audit failure AFTER a successful disk write cleans up an unreferenced file');
  var orphanImg = fakePng('should-be-cleaned-up-' + Date.now());
  var orphanHash = crypto.createHash('sha256').update(orphanImg).digest('hex');
  var orphanPath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, orphanHash.slice(0, 2), orphanHash.slice(2, 4), orphanHash);
  var threwForOrphan = false;
  try {
    // identity=null is never reachable via HTTP (requireAuth always
    // resolves a real identity or returns 401 first) — called directly
    // against the exported function, same pattern as IDA-2D's atomicity
    // unit test.
    await writes.createObservationMedia(obsId, orphanImg, 'image/png', {}, null);
  } catch (e) {
    threwForOrphan = true;
    ok(e.httpStatus === 401, 'createObservationMedia() with no identity throws httpStatus 401, same as every other write function');
  }
  ok(threwForOrphan, 'The no-identity call did throw');
  ok(!fs.existsSync(orphanPath), 'The file WAS written to disk by storage.store() (identity is checked inside withAudit, after storage.store() already ran) but is CLEANED UP after the failure, since no idauto_observation_media row references it');
  var orphanRowCount = await mediaRowCountForKey(orphanHash);
  ok(orphanRowCount === 0, 'No idauto_observation_media row exists for the orphaned upload attempt');

  console.log('\n11. ATOMICITY, still-referenced case — a failed re-upload of ALREADY-referenced content does NOT delete the shared file');
  // img1's hash is already referenced by 2 successful rows (steps 2 and 6).
  var threwForShared = false;
  try {
    await writes.createObservationMedia(obsId, img1, 'image/png', {}, null);
  } catch (e) {
    threwForShared = true;
  }
  ok(threwForShared, 'The no-identity call on already-shared content also throws');
  ok(fs.existsSync(expectedPath), 'The file for img1 STILL EXISTS on disk — it was not deleted, because 2 earlier successful rows still reference this exact object_key (the cleanup correctly checked for other references first)');
  ok(fs.readFileSync(expectedPath).equals(img1), 'And its content is still intact');

  console.log('\n12. WRITE METHODS on the media collection path still 405 where unsupported');
  var putAttempt = await authed('/api/observations/' + obsId + '/media', 'PUT', { 'Content-Type': 'image/png' }, img1);
  ok(putAttempt.status === 405, 'PUT .../media -> 405');

  console.log('\n13. storage.js source — never imports pg or performs a network call (pure local filesystem module)');
  var storageSrc = fs.readFileSync(path.join(BASE, 'reference', 'storage.js'), 'utf8');
  var forbidden = [/require\(['"]pg['"]\)/, /require\(['"]http/, /fetch\(/, /aws-sdk/i, /S3Client/];
  ok(forbidden.every(function (re) { return !re.test(storageSrc); }), 'No database driver, network library, or cloud SDK import anywhere in storage.js — purely local filesystem, as documented');

  await new Promise(function (resolve) { server.close(resolve); });
  await db.closePool();

  console.log('\nStage IDA-2F (object storage wiring): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.message);
  process.exit(1);
});
