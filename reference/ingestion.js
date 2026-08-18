'use strict';

// IDA-3B: pure submission-envelope ingestion service.  This module has no
// transport concerns; callers provide an already classified server context.
var crypto = require('crypto');
var db = null;
var storage = require('./storage.js');
var identity = require('./identity.js');
var plateValidator = require('./plate-validator.js');
var rateLimit = require('./rate-limit.js');

var ACTORS = {
  anonymous: { source: 'PUBLIC_UPLOAD', status: 'pending_review', confidence: 0.30, identified: false },
  contributor: { source: 'CONTRIBUTOR_UPLOAD', status: 'pending_review', confidence: 0.45, identified: true },
  professional_user: { source: 'PROFESSIONAL_SCAN', status: 'pending_review', confidence: 0.70, identified: true },
  admin: { source: 'MANUAL_ADMIN', status: 'accepted', confidence: 0.90, identified: true },
  system: { source: 'MANUAL_ADMIN', status: 'pending_review', confidence: 0.70, identified: true }
};
var FORBIDDEN_PAYLOAD_FIELDS = [
  'capture_source_id', 'contributor_id', 'actor_ref', 'actor_type', 'trust_level',
  'confidence', 'status', 'trust_score', 'bucket_key', 'ip_hash', 'window', 'limit',
  'rate_limit', 'rate_limit_override'
];
var FACT_KEYS = [
  'colour', 'make', 'model', 'variant', 'year', 'body_type', 'fuel_type',
  'seats', 'engine_cc', 'category_code', 'gross_weight_kg', 'plate_number'
];
var MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
var METHODS = ['plate_scan', 'vehicle_scan'];
var MAX_PUBLIC_IMAGE_BYTES = 10 * 1024 * 1024;
var MAX_SUBMISSION_BYTES = 20 * 1024 * 1024;

function database() {
  if (!db) db = require('./db.js');
  return db;
}

function rejection(code, fields, message) {
  return { ok: false, rejected: true, error: { code: code, fields: fields, message: message } };
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function resolveActor(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context) || !ACTORS[context.actor_type]) {
    return { error: rejection('INVALID_ACTOR_TYPE', ['actor_type'], 'actor_type is invalid') };
  }
  var rule = ACTORS[context.actor_type];
  if (!rule.identified) return { actor_type: 'anonymous', actor_ref: null, rule: rule };
  if (typeof context.actor_ref !== 'string' || !context.actor_ref) {
    return { error: rejection('INVALID_ACTOR_REF', ['actor_ref'], 'identified actors require an actor reference') };
  }
  var resolved = identity.resolveIdentity(context.actor_ref);
  if (!resolved) {
    return { error: rejection('INVALID_ACTOR_REF', ['actor_ref'], 'actor reference could not be resolved') };
  }
  var expectedPrefix = context.actor_type === 'system' ? 'svc_' : 'usr_';
  if (resolved.slice(0, expectedPrefix.length) !== expectedPrefix) {
    return { error: rejection('INVALID_ACTOR_REF', ['actor_ref'], 'actor reference has the wrong identity class') };
  }
  return { actor_type: context.actor_type, actor_ref: resolved, rule: rule };
}

function jpegMagic(buffer) { return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; }
function pngMagic(buffer) { return buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])); }
function webpMagic(buffer) { return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'; }

function stripJpegMetadata(buffer) {
  var chunks = [buffer.slice(0, 2)];
  var offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff || offset + 1 >= buffer.length) return null;
    var marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) { chunks.push(buffer.slice(offset)); break; }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) { chunks.push(buffer.slice(offset, offset + 2)); offset += 2; continue; }
    if (offset + 4 > buffer.length) return null;
    var length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    // APP1..APP15 and COM contain EXIF/XMP/vendor metadata. APP0 is structural JFIF.
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) chunks.push(buffer.slice(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return Buffer.concat(chunks);
}

function stripPngMetadata(buffer) {
  var chunks = [buffer.slice(0, 8)];
  var offset = 8;
  var metadata = ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'];
  while (offset + 12 <= buffer.length) {
    var length = buffer.readUInt32BE(offset);
    var end = offset + 12 + length;
    if (end > buffer.length) return null;
    var type = buffer.toString('ascii', offset + 4, offset + 8);
    if (metadata.indexOf(type) === -1) chunks.push(buffer.slice(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(chunks);
}

function stripWebpMetadata(buffer) {
  var body = [];
  var offset = 12;
  while (offset + 8 <= buffer.length) {
    var type = buffer.toString('ascii', offset, offset + 4);
    var length = buffer.readUInt32LE(offset + 4);
    var end = offset + 8 + length + (length % 2);
    if (end > buffer.length) return null;
    if (type !== 'EXIF' && type !== 'XMP ') body.push(buffer.slice(offset, end));
    offset = end;
  }
  var payload = Buffer.concat(body);
  var header = Buffer.from('RIFF\0\0\0\0WEBP', 'binary');
  header.writeUInt32LE(payload.length + 4, 4);
  return Buffer.concat([header, payload]);
}

function validateAndSanitizeMedia(media, actorType) {
  if (media === undefined) media = [];
  if (!Array.isArray(media)) return { error: rejection('INVALID_MEDIA', ['media'], 'media must be an array') };
  var limit = actorType === 'anonymous' ? 2 : 5;
  if (media.length > limit) return { error: rejection('TOO_MANY_IMAGES', ['media'], 'too many images') };
  var total = 0;
  var sanitized = [];
  for (var i = 0; i < media.length; i++) {
    var item = media[i];
    var field = 'media[' + i + ']';
    if (!item || typeof item !== 'object' || !Buffer.isBuffer(item.buffer) || MIME_TYPES.indexOf(item.mime_type) === -1) {
      return { error: rejection('INVALID_MEDIA', [field], 'media requires allowed mime_type and a Buffer') };
    }
    var perImageLimit = actorType === 'admin' ? storage.MAX_UPLOAD_BYTES : MAX_PUBLIC_IMAGE_BYTES;
    if (!item.buffer.length || item.buffer.length > perImageLimit) {
      return { error: rejection('INVALID_MEDIA_SIZE', [field], 'image size is outside the allowed range') };
    }
    var validMagic = item.mime_type === 'image/jpeg' ? jpegMagic(item.buffer) :
      item.mime_type === 'image/png' ? pngMagic(item.buffer) : webpMagic(item.buffer);
    if (!validMagic) return { error: rejection('INVALID_MEDIA_MAGIC', [field], 'declared MIME does not match file signature') };
    total += item.buffer.length;
    if (total > MAX_SUBMISSION_BYTES) return { error: rejection('SUBMISSION_TOO_LARGE', ['media'], 'submission media exceeds 20MB') };
    var clean = item.mime_type === 'image/jpeg' ? stripJpegMetadata(item.buffer) :
      item.mime_type === 'image/png' ? stripPngMetadata(item.buffer) : stripWebpMetadata(item.buffer);
    if (!clean) return { error: rejection('MALFORMED_MEDIA', [field], 'media container is malformed') };
    sanitized.push({ buffer: clean, mime_type: item.mime_type });
  }
  return { media: sanitized };
}

function validate(payload, context) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return rejection('MALFORMED_PAYLOAD', ['payload'], 'payload must be an object');
  }
  var spoofed = FORBIDDEN_PAYLOAD_FIELDS.filter(function (field) { return own(payload, field); });
  if (spoofed.length) return rejection('SERVER_DERIVED_FIELD', spoofed, 'server-derived fields are forbidden in payload');
  var actor = resolveActor(context);
  if (actor.error) return actor.error;
  if (typeof context.idempotency_key !== 'string' || !context.idempotency_key.trim() || context.idempotency_key.length > 64) {
    return rejection('INVALID_IDEMPOTENCY_KEY', ['idempotency_key'], 'a valid idempotency key is required');
  }
  var match = plateValidator.matchPlateFormat(payload.plate);
  if (!match) return rejection('INVALID_PLATE', ['plate'], 'plate is missing or invalid');
  var method = payload.capture_method === undefined ? 'plate_scan' : payload.capture_method;
  if (METHODS.indexOf(method) === -1) return rejection('INVALID_CAPTURE_METHOD', ['capture_method'], 'capture_method must be plate_scan or vehicle_scan');
  var capturedAt = payload.captured_at === undefined ? new Date() : new Date(payload.captured_at);
  if (isNaN(capturedAt.getTime())) return rejection('INVALID_CAPTURE_TIME', ['captured_at'], 'captured_at is invalid');
  var facts = payload.facts === undefined ? [] : payload.facts;
  if (!Array.isArray(facts) || facts.length > 20) return rejection('INVALID_FACTS', ['facts'], 'facts must be an array of at most 20 items');
  for (var i = 0; i < facts.length; i++) {
    if (!facts[i] || typeof facts[i] !== 'object' || FACT_KEYS.indexOf(facts[i].key) === -1 ||
        (typeof facts[i].value !== 'string' && typeof facts[i].value !== 'number') || String(facts[i].value).length > 500) {
      return rejection('INVALID_FACT', ['facts[' + i + ']'], 'fact key or value is invalid');
    }
  }
  var mediaResult = validateAndSanitizeMedia(payload.media, actor.actor_type);
  if (mediaResult.error) return mediaResult.error;
  return {
    ok: true, actor_type: actor.actor_type, actor_ref: actor.actor_ref, rule: actor.rule,
    idempotency_key: context.idempotency_key.trim(), ip_hash: normalizeIpHash(context),
    plate_raw: payload.plate, plate_normalised: match.plate_normalised,
    capture_method: method, captured_at: capturedAt, facts: facts, media: mediaResult.media
  };
}

function normalizeIpHash(context) {
  if (typeof context.ip_hash === 'string' && /^[a-f0-9]{64}$/i.test(context.ip_hash)) return context.ip_hash.toLowerCase();
  if (typeof context.raw_ip === 'string' && context.raw_ip) return crypto.createHash('sha256').update(context.raw_ip).digest('hex');
  return null;
}

function publicResult(row, replay) {
  var status = row.result_status || row.status;
  return {
    ok: status !== 'rejected', rejected: status === 'rejected', replay: Boolean(replay),
    submission_id: Number(row.id), observation_id: row.observation_id === null ? null : Number(row.observation_id),
    status: status
  };
}

async function findSubmission(key) {
  var result = await database().query(
    'SELECT s.id, s.status, s.observation_id, COALESCE(o.status, s.status) AS result_status FROM idauto_submissions s LEFT JOIN idauto_observations o ON o.id = s.observation_id WHERE s.idempotency_key = $1',
    [key]
  );
  return result.rows[0] || null;
}

async function waitForSubmission(key) {
  for (var i = 0; i < 100; i++) {
    var row = await findSubmission(key);
    if (row && row.status !== 'pending') return row;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  return findSubmission(key);
}

async function insertEnvelope(v, sourceId) {
  var client = await database().getClientForTransaction();
  try {
    await client.query('BEGIN');
    var result = await client.query(
      'INSERT INTO idauto_submissions (idempotency_key, actor_ref, actor_type, capture_source_id, ip_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, status, observation_id',
      [v.idempotency_key, v.actor_ref, v.actor_type, sourceId, v.ip_hash]
    );
    await client.query('COMMIT');
    return { row: result.rows[0], replay: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (error.code === '23505') return { row: await waitForSubmission(v.idempotency_key), replay: true };
    throw error;
  } finally { client.release(); }
}

async function cleanupStored(stored) {
  var seen = Object.create(null);
  for (var i = 0; i < stored.length; i++) {
    var hash = stored[i].image_hash;
    if (seen[hash]) continue;
    seen[hash] = true;
    try {
      var refs = await database().query('SELECT count(*) FROM idauto_observation_media WHERE object_key = $1', [stored[i].object_key]);
      if (parseInt(refs.rows[0].count, 10) === 0) storage.removeUnconditionally(hash);
    } catch (_) { /* preserve uncertain objects; never risk deleting shared bytes */ }
  }
}

async function markRejected(submissionId) {
  await database().query("UPDATE idauto_submissions SET status = 'rejected' WHERE id = $1", [submissionId]);
}

async function submit(payload, context) {
  var v = validate(payload, context);
  if (!v.ok) return v;

  var existing = await findSubmission(v.idempotency_key);
  if (existing) {
    if (existing.status === 'pending') existing = await waitForSubmission(v.idempotency_key);
    return publicResult(existing, true);
  }
  var limitResult = await rateLimit.enforce(database(), {
    actor_type: v.actor_type, actor_ref: v.actor_ref, ip_hash: v.ip_hash,
    trust_score: context.trust_score, org: context.org,
    media_bytes: v.media.reduce(function (sum, item) { return sum + item.buffer.length; }, 0),
    idempotency_key: v.idempotency_key
  });
  if (!limitResult.allowed) {
    if (limitResult.state === rateLimit.states.limited) {
      return { ok: false, rejected: true, replay: false, state: 'limited', tier: limitResult.tier,
        retry_at: limitResult.retry_at, error: { code: 'RATE_LIMITED', fields: [], message: 'submission rate limit exceeded' } };
    }
    return { ok: false, rejected: true, replay: false, state: limitResult.state,
      error: { code: limitResult.state === 'invalid' ? 'INVALID_RATE_LIMIT_IDENTITY' : 'RATE_LIMIT_STORAGE_ERROR', fields: [], message: 'submission rate limit could not be satisfied' } };
  }
  var sourceResult = await database().query('SELECT id FROM idauto_capture_sources WHERE code = $1 AND active = TRUE', [v.rule.source]);
  if (!sourceResult.rows[0]) return rejection('CAPTURE_SOURCE_UNAVAILABLE', ['capture_source'], 'server capture source is unavailable');
  var sourceId = sourceResult.rows[0].id;
  var envelope = await insertEnvelope(v, sourceId);
  if (envelope.replay) return publicResult(envelope.row, true);
  var submissionId = envelope.row.id;
  var stored = [];
  try {
    for (var m = 0; m < v.media.length; m++) stored.push(storage.store(v.media[m].buffer, v.media[m].mime_type));
    var client = await database().getClientForTransaction();
    var observation;
    var counts = { facts: 0, media: 0 };
    try {
      await client.query('BEGIN');
      var plate = await client.query('SELECT id, vehicle_id FROM idauto_plates WHERE plate_number = $1 AND status = $2 ORDER BY id DESC LIMIT 1', [v.plate_normalised, 'active']);
      var plateId = plate.rows[0] ? plate.rows[0].id : null;
      var vehicleId = plate.rows[0] ? plate.rows[0].vehicle_id : null;
      if (v.facts.length && !vehicleId) throw Object.assign(new Error('facts require an existing vehicle-linked plate'), { code: 'IDA_FACT_LINK' });
      var contributorId = null;
      if (v.actor_type === 'contributor' || v.actor_type === 'professional_user') {
        var contributor = await client.query(
          'INSERT INTO idauto_contributors (mythos_user_id) VALUES ($1) ON CONFLICT (mythos_user_id) DO UPDATE SET updated_at = NOW() RETURNING id',
          [v.actor_ref]
        );
        contributorId = contributor.rows[0].id;
      }
      var obs = await client.query(
        'INSERT INTO idauto_observations (vehicle_id, plate_id, capture_source_id, contributor_id, capture_method, capture_time, plate_candidate, plate_normalised, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [vehicleId, plateId, sourceId, contributorId, v.capture_method, v.captured_at, v.plate_raw, v.plate_normalised, v.rule.status]
      );
      observation = obs.rows[0];
      for (var f = 0; f < v.facts.length; f++) {
        await client.query(
          "INSERT INTO idauto_vehicle_facts (vehicle_id, observation_id, fact_key, fact_value, fact_value_normalized, source_id, confidence_score, verification_status, access_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_review','mythos_private')",
          [vehicleId, observation.id, v.facts[f].key, String(v.facts[f].value), String(v.facts[f].value).toLowerCase(), sourceId, v.rule.confidence]
        );
        counts.facts++;
      }
      for (m = 0; m < stored.length; m++) {
        await client.query(
          "INSERT INTO idauto_observation_media (observation_id, media_type, object_key, mime_type, file_size_bytes, image_hash, access_scope) VALUES ($1,'original_image',$2,$3,$4,$5,'mythos_private')",
          [observation.id, stored[m].object_key, v.media[m].mime_type, stored[m].file_size_bytes, stored[m].image_hash]
        );
        counts.media++;
      }
      await client.query(
        'INSERT INTO idauto_audit_log (event_type, actor_type, actor_ref, target_type, target_ref, change_summary, new_value_json, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        ['ingestion.submit', v.actor_type, v.actor_ref, 'idauto_observations', String(observation.id),
          'created observation=1 facts=' + counts.facts + ' media=' + counts.media,
          JSON.stringify({ submission_id: Number(submissionId), observation_id: Number(observation.id), status: v.rule.status, facts_created: counts.facts, media_created: counts.media }),
          v.idempotency_key]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
    await database().query("UPDATE idauto_submissions SET status = 'accepted', observation_id = $1 WHERE id = $2", [observation.id, submissionId]);
    return { ok: true, rejected: false, replay: false, submission_id: Number(submissionId), observation_id: Number(observation.id), status: v.rule.status, media: stored.map(function (_, i) { return { index: i, media_type: 'original_image' }; }) };
  } catch (error) {
    await cleanupStored(stored);
    try { await markRejected(submissionId); } catch (_) {}
    return { ok: false, rejected: true, replay: false, submission_id: Number(submissionId), observation_id: null, status: 'rejected', error: { code: 'INGESTION_FAILED', fields: [], message: 'submission could not be committed' } };
  }
}

module.exports = {
  submit: submit,
  validate: validate,
  actorMapping: function (actorType) { return ACTORS[actorType] ? Object.assign({}, ACTORS[actorType]) : null; },
  constants: { forbiddenPayloadFields: FORBIDDEN_PAYLOAD_FIELDS.slice(), mimeTypes: MIME_TYPES.slice(), captureMethods: METHODS.slice() }
};
