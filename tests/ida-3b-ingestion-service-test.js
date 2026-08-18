'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var STATIC_ONLY = process.env.IDA3B_STATIC_ONLY === '1';
var pass = 0, fail = 0;
function ok(value, label) {
  if (value) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
function unique(prefix) { return prefix + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'); }

var ADMIN_TOKEN = unique('token');
var CONTRIBUTOR_TOKEN = unique('token');
var SYSTEM_TOKEN = unique('token');
var ADMIN_REF = 'usr_' + crypto.randomBytes(16).toString('hex');
var CONTRIBUTOR_REF = 'usr_' + crypto.randomBytes(16).toString('hex');
var SYSTEM_REF = 'svc_' + crypto.randomBytes(12).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify((function () {
  var map = {}; map[ADMIN_TOKEN] = ADMIN_REF; map[CONTRIBUTOR_TOKEN] = CONTRIBUTOR_REF; map[SYSTEM_TOKEN] = SYSTEM_REF; return map;
})());

var ingestion = require(path.join(BASE, 'reference', 'ingestion.js'));
var ingestionPath = path.join(BASE, 'reference', 'ingestion.js');
var validPlateCounter = Date.now() % 800 + 100;
function plate(offset) { return ((validPlateCounter + (offset || 0)) % 900 + 100) + ' TUN ' + ((Date.now() + (offset || 0)) % 8000 + 1000); }
// An anonymous submitter is accountable only through its hashed IP (design §5),
// and IDA-3C rate-limits anonymous traffic on exactly that bucket — an anonymous
// request carrying no address cannot be throttled and is refused. Give every
// anonymous fixture its own synthetic address so each case is attributable and
// no case inherits another's allowance.
function context(actor, token, key) {
  var built = { actor_type: actor, actor_ref: token, idempotency_key: key || unique('idem') };
  if (actor === 'anonymous') built.raw_ip = 'synthetic-test-address-' + unique('ip');
  return built;
}
function minimalPng() {
  return Buffer.from([137,80,78,71,13,10,26,10, 0,0,0,0, 73,69,78,68, 174,66,96,130]);
}

async function staticCases() {
  console.log('\nSTATIC SUBSET — no database or network');
  var malformed = ingestion.validate(null, context('anonymous', null));
  ok(malformed.rejected && malformed.error.code === 'MALFORMED_PAYLOAD', 'malformed payload is rejected');

  var actors = {
    anonymous: ['PUBLIC_UPLOAD', 'pending_review'], contributor: ['CONTRIBUTOR_UPLOAD', 'pending_review'],
    professional_user: ['PROFESSIONAL_SCAN', 'pending_review'], admin: ['MANUAL_ADMIN', 'accepted'],
    system: ['MANUAL_ADMIN', 'pending_review']
  };
  Object.keys(actors).forEach(function (actor) {
    var mapping = ingestion.actorMapping(actor);
    ok(mapping.source === actors[actor][0] && mapping.status === actors[actor][1], actor + ' maps to server capture source and review status');
  });
  ok(ingestion.actorMapping('root') === null, 'unknown actor type has no mapping');

  var anon = ingestion.validate({ plate: plate(1) }, context('anonymous', null));
  ok(anon.ok && anon.actor_ref === null && anon.capture_method === 'plate_scan', 'anonymous validation keeps actor_ref NULL and defaults to plate_scan');
  var admin = ingestion.validate({ plate: plate(2), capture_method: 'vehicle_scan' }, context('admin', ADMIN_TOKEN));
  ok(admin.ok && admin.actor_ref === ADMIN_REF && admin.rule.status === 'accepted', 'identified admin is resolved server-side and routed to accepted');
  var system = ingestion.validate({ plate: plate(3) }, context('system', SYSTEM_TOKEN));
  ok(system.ok && system.actor_ref === SYSTEM_REF && system.rule.status === 'pending_review', 'system identity requires svc_ and is not auto-accepted');
  ok(ingestion.validate({ plate: plate(4) }, context('bogus', null)).error.code === 'INVALID_ACTOR_TYPE', 'malformed actor type is rejected');
  ok(ingestion.validate({ plate: plate(5), capture_method: 'public_upload' }, context('anonymous', null)).error.code === 'INVALID_CAPTURE_METHOD', 'invalid client capture method is rejected');

  var forbidden = ingestion.constants.forbiddenPayloadFields;
  forbidden.forEach(function (field, index) {
    var payload = { plate: plate(20 + index) }; payload[field] = field === 'confidence' ? 1 : 'spoof';
    var result = ingestion.validate(payload, context('anonymous', null));
    ok(result.rejected && result.error.code === 'SERVER_DERIVED_FIELD' && result.error.fields.indexOf(field) !== -1,
      'payload field ' + field + ' is rejected, never honoured or ignored');
  });
  var allSpoof = { plate: plate(40) };
  forbidden.forEach(function (field) { allSpoof[field] = 'spoof'; });
  var allResult = ingestion.validate(allSpoof, context('anonymous', null));
  ok(allResult.error.fields.length === forbidden.length, 'field-level rejection reports every spoofed server-derived field');
  ok(ingestion.validate({ plate: 'not a plate' }, context('anonymous', null)).error.code === 'INVALID_PLATE', 'bad plate is rejected before writes');
  ok(ingestion.validate({ plate: plate(50), facts: 'bad' }, context('anonymous', null)).error.code === 'INVALID_FACTS', 'malformed facts are rejected');
  ok(ingestion.validate({ plate: plate(51), media: [{}] }, context('anonymous', null)).error.code === 'INVALID_MEDIA', 'malformed media are rejected');
  ok(ingestion.validate({ plate: plate(52), media: [{ mime_type: 'image/png', buffer: Buffer.from('not png') }] }, context('anonymous', null)).error.code === 'INVALID_MEDIA_MAGIC', 'MIME magic mismatch is rejected');
  var jpegWithExif = Buffer.from([0xff,0xd8, 0xff,0xe1, 0x00,0x08, 0x45,0x78,0x69,0x66,0x00,0x00, 0xff,0xd9]);
  var stripped = ingestion.validate({ plate: plate(53), media: [{ mime_type: 'image/jpeg', buffer: jpegWithExif }] }, context('anonymous', null));
  ok(stripped.ok && stripped.media[0].buffer.equals(Buffer.from([0xff,0xd8,0xff,0xd9])), 'JPEG EXIF metadata is stripped before storage');

  var source = fs.readFileSync(ingestionPath, 'utf8');
  ok(!/require\s*\(\s*['"]https?['"]\s*\)/.test(source), 'service does not require http or https');
  ok(!/require\s*\(\s*['"]express['"]\s*\)/.test(source), 'service does not require express');
  ok(!/\.listen\s*\(/.test(source), 'service introduces no listener');
  ok(!/\.(get|post|put|patch|delete)\s*\(\s*['"]\//.test(source), 'service registers no route');
  ok(!/process\.argv/.test(source), 'service does not read process.argv');
}

async function scalar(sql, params) {
  var result = await db.query(sql, params || []);
  return parseInt(result.rows[0].count, 10);
}

async function liveCases() {
  console.log('\nLIVE DATABASE + LIVE MEDIA SUITE');
  var beforeSubmissions = await scalar('SELECT count(*) FROM idauto_submissions');
  var beforeAudit = await scalar('SELECT count(*) FROM idauto_audit_log');
  var invalid = await ingestion.submit({ plate: plate(60), status: 'accepted' }, context('anonymous', null));
  ok(invalid.rejected && invalid.error.code === 'SERVER_DERIVED_FIELD', 'pre-validation spoof is rejected by submit');
  ok(await scalar('SELECT count(*) FROM idauto_submissions') === beforeSubmissions, 'pre-validation rejection writes no submission');
  ok(await scalar('SELECT count(*) FROM idauto_audit_log') === beforeAudit, 'pre-validation rejection writes no audit event');

  var anonKey = unique('anon');
  var anonContext = context('anonymous', null, anonKey);
  anonContext.raw_ip = 'synthetic-test-address-' + unique('ip');
  var contributorsBeforeAnon = await scalar('SELECT count(*) FROM idauto_contributors');
  var anonResult = await ingestion.submit({ plate: plate(61) }, anonContext);
  ok(anonResult.ok && anonResult.status === 'pending_review' && anonResult.observation_id, 'valid anonymous submission creates pending-review observation');
  var anonRows = await db.query('SELECT s.actor_ref, s.ip_hash, s.observation_id, o.contributor_id, o.ip_hash AS observation_ip FROM idauto_submissions s JOIN idauto_observations o ON o.id=s.observation_id WHERE s.id=$1', [anonResult.submission_id]);
  ok(anonRows.rows[0].actor_ref === null && anonRows.rows[0].contributor_id === null, 'anonymous actor_ref and contributor_id stay NULL');
  ok(await scalar('SELECT count(*) FROM idauto_contributors') === contributorsBeforeAnon, 'anonymous submission creates no contributor row');
  ok(anonRows.rows[0].ip_hash && anonRows.rows[0].observation_ip === null, 'ip_hash is present only on submission, never observation');
  ok(JSON.stringify(anonResult).indexOf(anonContext.raw_ip) === -1 && !ownAny(anonResult, ['ip_hash','object_key','access_scope']), 'result exposes no raw IP, hash, object key, or private scope');

  var auditForAnon = await db.query('SELECT actor_type, actor_ref, ip_hash, change_summary FROM idauto_audit_log WHERE request_id=$1', [anonKey]);
  ok(auditForAnon.rows.length === 1 && auditForAnon.rows[0].actor_type === 'anonymous' && auditForAnon.rows[0].actor_ref === null, 'exactly one anonymous audit row uses submitter actor type');
  ok(auditForAnon.rows[0].ip_hash === null, 'ingestion audit row never receives ip_hash');

  var adminKey = unique('admin');
  var adminResult = await ingestion.submit({ plate: plate(62) }, context('admin', ADMIN_TOKEN, adminKey));
  ok(adminResult.ok && adminResult.status === 'accepted', 'valid identified admin routes to accepted');
  ok(await scalar('SELECT count(*) FROM idauto_audit_log WHERE request_id=$1', [adminKey]) === 1, 'admin ingestion has exactly one audit row');

  var replay = await ingestion.submit({ plate: plate(63) }, context('anonymous', null, anonKey));
  ok(replay.replay && replay.submission_id === anonResult.submission_id && replay.observation_id === anonResult.observation_id, 'idempotency replay returns original result');
  ok(await scalar('SELECT count(*) FROM idauto_audit_log WHERE request_id=$1', [anonKey]) === 1, 'replay creates no second audit row');

  var raceKey = unique('race');
  var raced = await Promise.all([
    ingestion.submit({ plate: plate(64) }, context('anonymous', null, raceKey)),
    ingestion.submit({ plate: plate(64) }, context('anonymous', null, raceKey))
  ]);
  ok(raced[0].submission_id === raced[1].submission_id && raced[0].observation_id === raced[1].observation_id, 'concurrent duplicate loser returns winner result');
  ok(raced.filter(function (r) { return r.replay; }).length === 1, 'concurrency race produces exactly one replay');
  ok(await scalar('SELECT count(*) FROM idauto_audit_log WHERE request_id=$1', [raceKey]) === 1, 'concurrency race writes exactly one audit row');

  var fixturePlate = plate(65);
  var client = await db.getClientForTransaction();
  var vehicleId;
  try {
    await client.query('BEGIN');
    var vehicle = await client.query("INSERT INTO idauto_vehicles (internal_ref, make, fiche_status) VALUES ($1,'IDA3B synthetic','initial') RETURNING id", [unique('IDA3B')]);
    vehicleId = vehicle.rows[0].id;
    await client.query('INSERT INTO idauto_plates (plate_number, plate_raw, format_code, vehicle_id) VALUES ($1,$1,$2,$3)', [fixturePlate, 'TUN_STD', vehicleId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }

  var factKey = unique('fact');
  var factResult = await ingestion.submit({ plate: fixturePlate, facts: [{ key: 'colour', value: 'blue' }] }, context('contributor', CONTRIBUTOR_TOKEN, factKey));
  ok(factResult.ok, 'identified contributor submission with fact commits');
  ok(await scalar('SELECT count(*) FROM idauto_vehicle_facts WHERE observation_id=$1 AND vehicle_id=$2', [factResult.observation_id, vehicleId]) === 1, 'fact is linked to observation and vehicle');
  ok(await scalar('SELECT count(*) FROM idauto_contributors WHERE mythos_user_id=$1', [CONTRIBUTOR_REF]) === 1, 'identified contributor is resolved to one contributor row');

  var image = minimalPng();
  var mediaKey1 = unique('media');
  var media1 = await ingestion.submit({ plate: plate(66), media: [{ mime_type: 'image/png', buffer: image }] }, context('anonymous', null, mediaKey1));
  var mediaKey2 = unique('media');
  var media2 = await ingestion.submit({ plate: plate(67), media: [{ mime_type: 'image/png', buffer: image }] }, context('anonymous', null, mediaKey2));
  var mediaRows = await db.query('SELECT observation_id, object_key, access_scope FROM idauto_observation_media WHERE observation_id IN ($1,$2) ORDER BY observation_id', [media1.observation_id, media2.observation_id]);
  ok(mediaRows.rows.length === 2 && mediaRows.rows[0].object_key === mediaRows.rows[1].object_key, 'identical bytes dedup object while preserving two evidence rows');
  ok(mediaRows.rows.every(function (row) { return row.access_scope === 'mythos_private'; }), 'all ingestion media remains mythos_private');
  ok(!ownAny(media1, ['object_key','access_scope','ip_hash']), 'media result cannot leak object key or mythos_private fields');

  var failedKey = unique('rollback');
  var failed = await ingestion.submit({ plate: plate(68), facts: [{ key: 'colour', value: 'red' }], media: [{ mime_type: 'image/png', buffer: image }] }, context('anonymous', null, failedKey));
  ok(failed.rejected && failed.submission_id, 'post-envelope transaction failure returns recorded rejection');
  ok(await scalar('SELECT count(*) FROM idauto_observations WHERE id=$1', [failed.observation_id]) === 0, 'rollback leaves no observation');
  ok(await scalar('SELECT count(*) FROM idauto_audit_log WHERE request_id=$1', [failedKey]) === 0, 'rollback leaves no audit row');
  ok(await scalar('SELECT count(*) FROM idauto_vehicle_facts WHERE observation_id IN (SELECT observation_id FROM idauto_submissions WHERE id=$1)', [failed.submission_id]) === 0, 'rollback leaves no fact row');
  ok(await scalar('SELECT count(*) FROM idauto_observation_media WHERE observation_id IN (SELECT observation_id FROM idauto_submissions WHERE id=$1)', [failed.submission_id]) === 0, 'rollback leaves no media row');
  var hash = crypto.createHash('sha256').update(image).digest('hex');
  var storedPath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, hash.slice(0,2), hash.slice(2,4), hash);
  ok(fs.existsSync(storedPath), 'failed shared-byte ingestion does not delete an object referenced by prior rows');

  var uniqueImage = Buffer.from(minimalPng());
  uniqueImage[uniqueImage.length - 1] ^= 1;
  var uniqueHash = crypto.createHash('sha256').update(uniqueImage).digest('hex');
  var cleanupKey = unique('cleanup');
  var cleanup = await ingestion.submit({ plate: plate(69), facts: [{ key: 'colour', value: 'green' }], media: [{ mime_type: 'image/png', buffer: uniqueImage }] }, context('anonymous', null, cleanupKey));
  var uniquePath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, uniqueHash.slice(0,2), uniqueHash.slice(2,4), uniqueHash);
  ok(cleanup.rejected && !fs.existsSync(uniquePath), 'failure cleanup deletes newly stored object only when unreferenced');
}

function ownAny(object, fields) {
  return fields.some(function (field) { return Object.prototype.hasOwnProperty.call(object, field); });
}

var db;
(async function main() {
  await staticCases();
  if (STATIC_ONLY) {
    console.log('\nIDA3B_STATIC_ONLY=1: live database/media cases were not run.');
  } else {
    var required = ['IDAUTO_DB_HOST','IDAUTO_DB_PORT','IDAUTO_DB_USER','IDAUTO_DB_PASSWORD','IDAUTO_DB_NAME','IDAUTO_MEDIA_STORAGE_PATH'];
    var missing = required.filter(function (name) { return !process.env[name]; });
    if (missing.length) throw new Error('missing required environment variable(s): ' + missing.join(', '));
    db = require(path.join(BASE, 'reference', 'db.js'));
    await liveCases();
    await db.closePool();
  }
  console.log('\nStage IDA-3B ingestion service: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (error) {
  if (db) { try { await db.closePool(); } catch (_) {} }
  console.log('FATAL: ' + error.message);
  process.exit(1);
});
