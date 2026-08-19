'use strict';

var crypto = require('crypto');

var WINDOWS = { minute: 60 * 1000, day: 24 * 60 * 60 * 1000 };
var LIMITS = {
  anonymous: { minute: 3, day: 30 },
  contributor: { minute: 10, day: 200 },
  verified_contributor: { minute: 20, day: 500 },
  professional_user: { minute: 60, day: 5000 },
  system: { minute: 60, day: 5000 },
  admin: { minute: Infinity, day: Infinity }
};
var MEDIA_LIMITS = { anonymous: 50 * 1024 * 1024, authenticated: 250 * 1024 * 1024 };
var UPSERT = 'INSERT INTO idauto_rate_limit_counters (bucket_key, window_start, count) VALUES ($1, $2, $3) ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = idauto_rate_limit_counters.count + EXCLUDED.count RETURNING count';

function bucketKey(dimension, identifier) {
  if (typeof dimension !== 'string' || !dimension || typeof identifier !== 'string' || !identifier) {
    throw new TypeError('rate-limit bucket dimension and identifier are required');
  }
  return crypto.createHash('sha256').update(dimension + ':' + identifier).digest('hex');
}

function floorWindow(value, tier) {
  var size = WINDOWS[tier];
  var date = value instanceof Date ? value : new Date(value);
  if (!size || isNaN(date.getTime())) throw new TypeError('rate-limit window is invalid');
  return new Date(Math.floor(date.getTime() / size) * size);
}

function policyClass(request) {
  if (request.actor_type === 'contributor' && Number(request.trust_score) >= 60) return 'verified_contributor';
  return request.actor_type;
}

function actorIdentifier(request) {
  if (request.actor_type === 'professional_user' || request.actor_type === 'system') {
    if (typeof request.org !== 'string' || !request.org) throw new TypeError('rate-limit organization is required');
    return request.actor_ref + ':' + request.org;
  }
  return request.actor_ref;
}

function selectBuckets(request, now) {
  var klass = policyClass(request);
  if (!LIMITS[klass]) throw new TypeError('rate-limit actor class is invalid');
  if (klass === 'admin') return [];
  var buckets = [];
  function add(dimension, identifier, tier, limit, amount) {
    buckets.push({ key: bucketKey(dimension, identifier), dimension: dimension, tier: tier,
      window_start: floorWindow(now, tier), limit: limit, amount: amount });
  }
  if (klass === 'anonymous') {
    if (!request.ip_hash) throw new TypeError('anonymous rate-limit ip_hash is required');
    add('anon:minute', request.ip_hash, 'minute', LIMITS.anonymous.minute, 1);
    add('anon:day', request.ip_hash, 'day', LIMITS.anonymous.day, 1);
  } else {
    var identifier = actorIdentifier(request);
    add('actor:' + klass + ':minute', identifier, 'minute', LIMITS[klass].minute, 1);
    add('actor:' + klass + ':day', identifier, 'day', LIMITS[klass].day, 1);
    if (request.ip_hash) {
      add('ip:' + klass + ':minute', request.ip_hash, 'minute', LIMITS[klass].minute, 1);
      add('ip:' + klass + ':day', request.ip_hash, 'day', LIMITS[klass].day, 1);
    }
  }
  if (request.media_bytes > 0) {
    var mediaIdentifier = klass === 'anonymous' ? request.ip_hash : actorIdentifier(request);
    if (mediaIdentifier) add('media_bytes:day:' + (klass === 'anonymous' ? 'anonymous' : 'authenticated'), mediaIdentifier,
      'day', klass === 'anonymous' ? MEDIA_LIMITS.anonymous : MEDIA_LIMITS.authenticated, request.media_bytes);
  }
  return buckets;
}

// A5 OPTION C, 2026-08-19 — IDA-4 Option C's public passport surface.
// This dimension ('public_resolution:window') is used by exactly one
// caller: reference/api.js's GET /public/passport/:ivid route (its
// header names this function specifically). It is a first-class
// rate-limiting function, not ingestion-specific like enforce() above,
// so it lives here rather than being reimplemented inline in api.js —
// the IDA-3D structural guard (tests/ida-3d-private-ingest-route-test.js)
// exists precisely to keep counter/bucket machinery out of api.js, and
// this function is how a second, independent caller gets one without
// violating that.
//
// Deliberately NOT built on enforce()/selectBuckets() above: those are
// shaped around the ingestion actor-class model (anonymous/contributor/
// professional_user/etc., admin-exempt, media-byte quotas) which does
// not apply here — the public passport route has exactly one caller
// class (unauthenticated, IP-only) and one configurable limit+window,
// sourced from api.js's own config file rather than the LIMITS table
// above. It DOES reuse bucketKey() and the atomic UPSERT (atomicStatement)
// this file already exports, so the underlying counter mechanics are
// shared, not duplicated.
//
// `dbClient` is any object exposing query(text, params) returning a
// node-postgres-shaped { rows } — reference/db.js's pool object is
// sufficient; no transaction is required since this is a single atomic
// UPSERT. `config` is { limit: number, window_seconds: number } —
// api.js owns reading this from config/idauto.example.json (config-file
// I/O is an api.js concern, not this module's). `now` defaults to the
// current time; passed explicitly by callers that need determinism.
function floorPublicResolutionWindow(now, windowSeconds) {
  var date = now instanceof Date ? now : new Date(now);
  var size = windowSeconds * 1000;
  if (!(size > 0) || isNaN(date.getTime())) throw new TypeError('rate-limit public-resolution window is invalid');
  return new Date(Math.floor(date.getTime() / size) * size);
}

async function enforcePublicResolution(dbClient, ipHash, config, now) {
  var windowStart = floorPublicResolutionWindow(now || new Date(), config.window_seconds);
  var key = bucketKey('public_resolution:window', ipHash);
  var result = await dbClient.query(UPSERT, [key, windowStart, 1]);
  var count = Number(result.rows[0].count);
  if (count > config.limit) {
    return { allowed: false, retry_at: new Date(windowStart.getTime() + config.window_seconds * 1000) };
  }
  return { allowed: true, retry_at: null };
}

async function enforce(database, request, now) {
  if (request.actor_type === 'admin') return { state: 'allowed', allowed: true, buckets: [] };
  var buckets;
  try {
    if (!Number.isSafeInteger(request.media_bytes) || request.media_bytes < 0 || request.media_bytes > 2147483647) {
      return { state: 'invalid', allowed: false, tier: 'media_bytes' };
    }
    buckets = selectBuckets(request, now || new Date());
  } catch (_) { return { state: 'invalid', allowed: false, tier: null }; }
  var client;
  try {
    client = await database.getClientForTransaction();
    await client.query('BEGIN');
    var tripped = [];
    for (var i = 0; i < buckets.length; i++) {
      var result = await client.query(UPSERT, [buckets[i].key, buckets[i].window_start, buckets[i].amount]);
      var count = Number(result.rows[0].count);
      if (count > buckets[i].limit) tripped.push(buckets[i]);
    }
    if (tripped.length) {
      await client.query(
        'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref, change_summary, new_value_json, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        ['ingestion.rate_limited', request.actor_type, request.actor_ref, 'idauto_rate_limit_counters', tripped[0].key,
          'rate limit exceeded: ' + tripped[0].tier, JSON.stringify({ tier: tripped[0].tier }), request.idempotency_key]
      );
    }
    await client.query('COMMIT');
    if (!tripped.length) return { state: 'allowed', allowed: true, buckets: buckets };
    var retryAt = new Date(tripped[0].window_start.getTime() + WINDOWS[tripped[0].tier]);
    return { state: 'limited', allowed: false, tier: tripped[0].tier, retry_at: retryAt };
  } catch (_) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return { state: 'storage_error', allowed: false, tier: null };
  } finally { if (client) client.release(); }
}

module.exports = {
  enforce: enforce,
  bucketKey: bucketKey,
  floorWindow: floorWindow,
  policyClass: policyClass,
  selectBuckets: selectBuckets,
  limits: JSON.parse(JSON.stringify(LIMITS, function (_, value) { return value === Infinity ? 'unlimited' : value; })),
  mediaLimits: Object.assign({}, MEDIA_LIMITS),
  states: { allowed: 'allowed', limited: 'limited', invalid: 'invalid', storage_error: 'storage_error' },
  atomicStatement: UPSERT,
  // A5 OPTION C, 2026-08-19 — IDA-4 Option C's public passport route only.
  floorPublicResolutionWindow: floorPublicResolutionWindow,
  enforcePublicResolution: enforcePublicResolution
};
