'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var STATIC_ONLY = process.env.IDA3C_STATIC_ONLY === '1';
var limiter = require(path.join(BASE, 'reference', 'rate-limit.js'));
var ingestionPath = path.join(BASE, 'reference', 'ingestion.js');
var limiterPath = path.join(BASE, 'reference', 'rate-limit.js');
var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }
function unique(prefix) { return prefix + '-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function minimalPng() { return Buffer.from([137,80,78,71,13,10,26,10, 0,0,0,0, 73,69,78,68, 174,66,96,130]); }

var ADMIN_TOKEN = unique('token');
var CONTRIBUTOR_TOKEN = unique('token');
var ADMIN_REF = 'usr_' + crypto.randomBytes(16).toString('hex');
var CONTRIBUTOR_REF = 'usr_' + crypto.randomBytes(16).toString('hex');
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify((function () { var map = {}; map[ADMIN_TOKEN] = ADMIN_REF; map[CONTRIBUTOR_TOKEN] = CONTRIBUTOR_REF; return map; })());
var ingestion = require(ingestionPath);

function request(actor, actorRef, ip, extra) {
  return Object.assign({ actor_type: actor, actor_ref: actorRef || null, ip_hash: ip || null,
    trust_score: 0, org: null, media_bytes: 0, idempotency_key: unique('idem') }, extra || {});
}

async function staticCases() {
  console.log('\nSTATIC SUBSET — no database or network');
  var raw = '198.51.100.77';
  var key = limiter.bucketKey('ip:minute', hash(raw));
  ok(key === limiter.bucketKey('ip:minute', hash(raw)) && /^[a-f0-9]{64}$/.test(key), 'bucket keys are deterministic 64-character lowercase hex');
  ok(key.indexOf(raw) === -1, 'derived bucket key contains no raw IP');
  var instant = new Date('2026-08-12T12:34:56.789Z');
  ok(limiter.floorWindow(instant, 'minute').toISOString() === '2026-08-12T12:34:00.000Z', 'minute window uses UTC 60-second floor');
  ok(limiter.floorWindow(instant, 'day').toISOString() === '2026-08-12T00:00:00.000Z', 'day window uses UTC 24-hour floor');
  var expected = { anonymous: [3,30], contributor: [10,200], verified_contributor: [20,500], professional_user: [60,5000], system: [60,5000] };
  Object.keys(expected).forEach(function (name) { ok(limiter.limits[name].minute === expected[name][0] && limiter.limits[name].day === expected[name][1], name + ' policy limits are correct'); });
  ok(limiter.limits.admin.minute === 'unlimited' && limiter.limits.admin.day === 'unlimited', 'admin limits are unlimited');
  ok(limiter.mediaLimits.anonymous === 50 * 1024 * 1024 && limiter.mediaLimits.authenticated === 250 * 1024 * 1024, 'daily media-byte quotas are correct');
  ok(limiter.policyClass(request('contributor', CONTRIBUTOR_REF, hash('ip'), { trust_score: 60 })) === 'verified_contributor', 'trust score 60 selects verified contributor policy');
  var anon = limiter.selectBuckets(request('anonymous', null, hash('anon')), instant);
  ok(anon.length === 2 && anon.every(function (b) { return b.dimension.indexOf('anon:') === 0; }), 'anonymous selection has minute and day IP buckets only');
  var identified = limiter.selectBuckets(request('contributor', CONTRIBUTOR_REF, hash('identified')), instant);
  ok(identified.length === 4 && identified.filter(function (b) { return b.dimension.indexOf('actor:') === 0; }).length === 2 && identified.filter(function (b) { return b.dimension.indexOf('ip:') === 0; }).length === 2, 'identified selection applies dual actor and IP buckets');
  ok(limiter.selectBuckets(request('contributor', CONTRIBUTOR_REF, null), instant).length === 2, 'identified request without ip_hash uses actor buckets only');
  var missingAnonIp = await limiter.enforce({ getClientForTransaction: function () { throw new Error('must not connect'); } }, request('anonymous', null, null));
  ok(missingAnonIp.state === 'invalid' && !missingAnonIp.allowed, 'anonymous request without server-derived ip_hash is rejected');
  ok(limiter.selectBuckets(request('admin', ADMIN_REF, hash('admin')), instant).length === 0, 'admin selection is exempt from all counters');
  var dbTouched = false;
  var admin = await limiter.enforce({ getClientForTransaction: function () { dbTouched = true; } }, request('admin', ADMIN_REF, hash('admin')));
  ok(admin.allowed && !dbTouched, 'admin enforcement performs no counter read or write');

  var spoofFields = ['actor_ref','actor_type','contributor_id','capture_source_id','trust_level','trust_score','status','confidence','bucket_key','ip_hash','window','limit','rate_limit_override'];
  spoofFields.forEach(function (field) {
    var payload = { plate: '123 TUN 4567' }; payload[field] = 'spoof';
    var result = ingestion.validate(payload, { actor_type: 'anonymous', idempotency_key: unique('idem') });
    ok(result.rejected && result.error.code === 'SERVER_DERIVED_FIELD' && result.error.fields.indexOf(field) !== -1, 'spoofed payload field ' + field + ' is rejected');
  });

  var source = fs.readFileSync(ingestionPath, 'utf8') + '\n' + fs.readFileSync(limiterPath, 'utf8');
  ok(!/require\s*\(\s*['"](?:express|http|https|net|redis|ioredis|n8n)['"]\s*\)/.test(source), 'implementation has no route, socket, Redis, or n8n dependency');
  ok(!/\.listen\s*\(/.test(source) && !/\.(?:get|post|put|patch|delete)\s*\(\s*['"]\//.test(source), 'implementation introduces no listener or route');
  var limiterSource = fs.readFileSync(limiterPath, 'utf8');
  ok(!/SELECT[\s\S]{0,500}UPDATE/i.test(limiterSource), 'limiter contains no SELECT-then-UPDATE mutation pattern');
  ok(/ON CONFLICT \(bucket_key, window_start\)[\s\S]*RETURNING count/.test(limiter.atomicStatement), 'counter mutation is an atomic upsert returning count');
  ok(!/CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE/i.test(source), 'implementation contains no DDL');
  ok(source.indexOf("'mythos_private'") !== -1 && source.indexOf("'pending_review'") !== -1 && source.indexOf("'accepted'") !== -1, 'privacy and observation-status constants remain present');
}

async function scalar(sql, params) { var result = await db.query(sql, params || []); return Number(result.rows[0].count); }

async function liveCases() {
  console.log('\nLIVE DATABASE + LIVE MEDIA SUITE');
  var now = new Date();
  var ip = hash(unique('live-ip'));
  var anon = request('anonymous', null, ip);
  var decisions = [];
  for (var i = 0; i < 6; i++) decisions.push(await limiter.enforce(db, anon, now));
  ok(decisions[0].allowed && decisions[1].allowed, 'first request and below-threshold request are allowed');
  ok(decisions[2].allowed, 'request exactly at threshold is allowed');
  ok(decisions[3].state === 'limited', 'first request above threshold is limited');
  ok(decisions[4].state === 'limited' && decisions[5].state === 'limited', 'repeated rejected attempts remain limited and counted');
  var minuteKey = limiter.bucketKey('anon:minute', ip);
  var minuteStart = limiter.floorWindow(now, 'minute');
  ok(await scalar('SELECT count FROM idauto_rate_limit_counters WHERE bucket_key=$1 AND window_start=$2', [minuteKey, minuteStart]) === 6, 'atomic counter row records all attempts');
  var nextMinute = new Date(minuteStart.getTime() + 60000);
  ok((await limiter.enforce(db, anon, nextMinute)).allowed, 'new fixed window resets allowance');
  ok(await scalar('SELECT count(*) FROM idauto_rate_limit_counters WHERE bucket_key=$1', [minuteKey]) === 2, 'previous window row is preserved');

  var actor = request('contributor', CONTRIBUTOR_REF, hash(unique('actor-ip')));
  var actorDecision = await limiter.enforce(db, actor, now);
  ok(actorDecision.allowed && actorDecision.buckets.length === 4, 'identified request persists real dual actor and IP buckets');
  var persisted = await db.query('SELECT bucket_key FROM idauto_rate_limit_counters WHERE bucket_key = ANY($1)', [actorDecision.buckets.map(function (b) { return b.key; })]);
  ok(persisted.rows.length === 4, 'all identified buckets exist in PostgreSQL');
  ok(JSON.stringify(persisted.rows).indexOf(actor.ip_hash) === -1, 'no supplied IP hash or raw IP is persisted as a bucket key');

  var concurrentIp = hash(unique('concurrent'));
  var concurrent = request('anonymous', null, concurrentIp);
  var raced = await Promise.all(Array.from({ length: 12 }, function () { return limiter.enforce(db, concurrent, now); }));
  ok(raced.filter(function (r) { return r.allowed; }).length === 3, 'concurrent same-bucket requests cannot exceed allowance');
  ok(await scalar('SELECT count FROM idauto_rate_limit_counters WHERE bucket_key=$1 AND window_start=$2', [limiter.bucketKey('anon:minute', concurrentIp), minuteStart]) === 12, 'concurrent atomic increments lose no attempts');

  var failed = await limiter.enforce({ getClientForTransaction: async function () { throw new Error('synthetic'); } }, anon, now);
  ok(!failed.allowed && failed.state === 'storage_error', 'database acquisition error fails closed');
  var rolledBack = false, released = false;
  var failureDb = { getClientForTransaction: async function () { return { query: async function (sql) { if (sql === 'ROLLBACK') { rolledBack = true; return; } if (sql === 'BEGIN') return; throw new Error('synthetic counter failure'); }, release: function () { released = true; } }; } };
  failed = await limiter.enforce(failureDb, anon, now);
  ok(failed.state === 'storage_error' && rolledBack && released, 'counter failure rolls back its transaction and releases client');
  ok((await limiter.enforce(db, Object.assign({}, anon, { media_bytes: -1 }), now)).state === 'invalid', 'malformed bucket increment is rejected');
  var malformedWindow = false; try { limiter.floorWindow('bad', 'minute'); } catch (_) { malformedWindow = true; }
  ok(malformedWindow, 'malformed window is rejected');

  await ingestionIntegrationCases();
}

async function ingestionIntegrationCases() {
  var plateSeed = (Date.now() % 800 + 100) + ' TUN ' + (Date.now() % 8000 + 1000);
  function context(key, ip) { return { actor_type: 'anonymous', idempotency_key: key, ip_hash: ip }; }
  var replayIp = hash(unique('replay-ip')), replayKey = unique('replay');
  var allowed = await ingestion.submit({ plate: plateSeed, media: [{ mime_type: 'image/png', buffer: minimalPng() }] }, context(replayKey, replayIp));
  ok(allowed.ok && allowed.observation_id, 'allowed request follows the full IDA-3B transaction');
  var beforeReplay = await scalar('SELECT COALESCE(sum(count),0) AS count FROM idauto_rate_limit_counters WHERE bucket_key IN ($1,$2)', [limiter.bucketKey('anon:minute', replayIp), limiter.bucketKey('anon:day', replayIp)]);
  var replay = await ingestion.submit({ plate: plateSeed }, context(replayKey, replayIp));
  var afterReplay = await scalar('SELECT COALESCE(sum(count),0) AS count FROM idauto_rate_limit_counters WHERE bucket_key IN ($1,$2)', [limiter.bucketKey('anon:minute', replayIp), limiter.bucketKey('anon:day', replayIp)]);
  ok(replay.replay && beforeReplay === afterReplay, 'idempotent replay consumes no quota');

  var limitedIp = hash(unique('limited-ip'));
  for (var i = 0; i < 3; i++) await limiter.enforce(db, request('anonymous', null, limitedIp), new Date());
  var key = unique('limited'), beforeSub = await scalar('SELECT count(*) FROM idauto_submissions'), beforeObs = await scalar('SELECT count(*) FROM idauto_observations');
  var beforeFacts = await scalar('SELECT count(*) FROM idauto_vehicle_facts'), beforeMedia = await scalar('SELECT count(*) FROM idauto_observation_media');
  var result = await ingestion.submit({ plate: plateSeed }, context(key, limitedIp));
  ok(result.state === 'limited' && result.retry_at && result.tier, 'limited result carries state, tier, and retry time');
  ok(await scalar('SELECT count(*) FROM idauto_submissions') === beforeSub && await scalar('SELECT count(*) FROM idauto_observations') === beforeObs, 'limited request creates no submission or observation');
  ok(await scalar('SELECT count(*) FROM idauto_vehicle_facts') === beforeFacts && await scalar('SELECT count(*) FROM idauto_observation_media') === beforeMedia, 'limited request creates no fact or media row');
  var audit = await db.query('SELECT actor_type,actor_ref,ip_hash FROM idauto_audit_log WHERE request_id=$1', [key]);
  ok(audit.rows.length === 1 && audit.rows[0].actor_type === 'anonymous' && audit.rows[0].actor_ref === null && audit.rows[0].ip_hash === null, 'limited request writes exactly one privacy-safe submitter audit row');
  var allowedMedia = await db.query('SELECT access_scope FROM idauto_observation_media WHERE observation_id=$1', [allowed.observation_id]);
  ok(allowedMedia.rows.length === 1 && allowedMedia.rows[0].access_scope === 'mythos_private', 'mythos_private media behaviour remains unchanged');
  var status = await db.query('SELECT status FROM idauto_observations WHERE id=$1', [allowed.observation_id]);
  ok(['pending_review','accepted','rejected','pending_confirmation'].indexOf(status.rows[0].status) !== -1, 'observation status vocabulary remains valid');
  var scopes = await db.query("SELECT DISTINCT access_scope FROM idauto_observation_media WHERE access_scope IS NOT NULL");
  ok(scopes.rows.every(function (row) { return ['public','professional','mythos_private'].indexOf(row.access_scope) !== -1; }), 'access_scope vocabulary remains unchanged');

  var cleanupImage = Buffer.from(minimalPng()); cleanupImage[cleanupImage.length - 1] ^= 1;
  var cleanupHash = hash(cleanupImage), cleanupKey = unique('cleanup'), cleanupIp = hash(unique('cleanup-ip'));
  var cleanupResult = await ingestion.submit({ plate: plateSeed, facts: [{ key: 'colour', value: 'red' }], media: [{ mime_type: 'image/png', buffer: cleanupImage }] }, context(cleanupKey, cleanupIp));
  var cleanupPath = path.join(process.env.IDAUTO_MEDIA_STORAGE_PATH, cleanupHash.slice(0, 2), cleanupHash.slice(2, 4), cleanupHash);
  ok(cleanupResult.rejected && !fs.existsSync(cleanupPath), 'IDA-3B failure cleanup still removes an unreferenced stored media object');
}

var db;
(async function main() {
  await staticCases();
  if (STATIC_ONLY) console.log('\nIDA3C_STATIC_ONLY=1: live database/media cases were not run.');
  else {
    var required = ['IDAUTO_DB_HOST','IDAUTO_DB_PORT','IDAUTO_DB_USER','IDAUTO_DB_PASSWORD','IDAUTO_DB_NAME','IDAUTO_MEDIA_STORAGE_PATH'];
    var missing = required.filter(function (name) { return !process.env[name]; });
    if (missing.length) throw new Error('missing required environment variable(s): ' + missing.join(', '));
    db = require(path.join(BASE, 'reference', 'db.js'));
    await liveCases();
    await db.closePool();
  }
  console.log('\nStage IDA-3C rate limiting: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(async function (error) {
  if (db) { try { await db.closePool(); } catch (_) {} }
  console.log('FATAL: ' + error.message);
  process.exit(1);
});
