'use strict';
// =====================================================
// MYTHOS — ID Auto API — reference/api.js
// (renamed from api-read.js in IDA-2D — see git history — because this
// file is no longer read-only)
//
// IDA-2C (original scope): GET-only, placeholder admin gate, excludes
// mythos_private data (no audit-on-read path existed).
//
// IDA-2D added: write routes (POST /api/vehicles, /api/plates,
// /api/observations, /api/vehicles/:ref/facts), each going through
// reference/writes.js's withAudit() — every mutation
// creates its idauto_audit_log row in the same transaction, atomically.
// Reads are UNCHANGED from IDA-2C, including the mythos_private exclusion
// — writes are now audited (satisfying AD-9), but reads still are not, so
// GET responses still exclude that scope.
//
// IDA-2E-PRE replaced the single undifferentiated placeholder token with
// reference/identity.js's minimal admin-identity map —
// see that file's header for exactly what this is and is not. Full IDA-2E
// (real Mythos OS auth service integration per docs/ARCHITECTURE.md
// §4.1) remains blocked: no such service exists anywhere in this
// codebase. requireAuth() now resolves a real identity string per request
// (req.mythosIdentity) instead of a boolean match against one shared
// token, and every write handler passes it through to writes.js so audit
// records carry the authenticated identity, never the raw bearer token.
//
// IDA-2F added object-storage wiring: POST/GET /api/observations/:id/media,
// backed by reference/storage.js (local, content-addressed
// filesystem storage — not a cloud service; see that file's header for
// why). The write goes through writes.js's withAudit() exactly like every
// other mutation. The read (like every other GET in this file) still
// excludes mythos_private-scope rows — unchanged policy, not relaxed by
// adding a new resource type.
//
// A5 OPTION C, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md §A5 — owner
// decision recorded verbatim there): IDA-4 Option C adds
// GET /public/passport/:ivid — this file's FIRST unauthenticated route.
// It is reached BEFORE requireAuth() below, deliberately: it is not an
// admin route with auth accidentally skipped, it is the one route this
// server intentionally serves with no bearer token at all, scoped
// narrowly to IVID-only public-passport resolution. See
// handlePublicPassportRoute()'s own header for the full control chain.
// Every route below this comment remains authenticated exactly as
// before — requireAuth() still gates the entire ROUTES table.
// =====================================================

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var db = require('./db.js');
var writes = require('./writes.js');
var identity = require('./identity.js');
var storage = require('./storage.js');
var ingestion = require('./ingestion.js');
var ivid = require('./ivid.js');
var passportAssembly = require('./passport-assembly.js');
var rateLimit = require('./rate-limit.js');

function requireAuth(req, res) {
  var header = req.headers['authorization'] || '';
  var match = /^Bearer (.+)$/.exec(header);
  var token = match ? match[1] : null;
  var resolved = identity.resolveIdentity(token);
  if (!resolved) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized — a recognized admin identity token is required' }));
    return false;
  }
  req.mythosIdentity = resolved;
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (err) {
    throw Object.assign(new Error('invalid URL encoding'), { httpStatus: 400 });
  }
}

var ADMIN_ASSETS = {
  '/admin': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/admin-ui.js': { file: 'admin-ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/admin/admin.css': { file: 'admin.css', contentType: 'text/css; charset=utf-8' },
  '/admin/review': { file: 'review.html', contentType: 'text/html; charset=utf-8' },
  '/admin/review/': { file: 'review.html', contentType: 'text/html; charset=utf-8' },
  '/admin/review-ui.js': { file: 'review-ui.js', contentType: 'application/javascript; charset=utf-8' }
};

// The admin shell contains no data or credentials. API calls made by the
// page still pass through requireAuth() below; the bearer token is held only
// in page memory and is never written to browser storage.
function serveAdminAsset(req, res, pathname) {
  var asset = ADMIN_ASSETS[pathname];
  if (!asset || req.method !== 'GET') return false;
  fs.readFile(path.join(__dirname, asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'admin UI unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  });
  return true;
}

// =====================================================
// IDA-4 Option C — GET /public/passport/:ivid
// A5 OPTION C, 2026-08-19 (docs/IDA4_READINESS_AUDIT.md §A5)
//
// This is the repository's ONLY unauthenticated route. It exists to
// resolve an IVID QR code (reference/ivid.js) to a public-scope Digital
// Vehicle Passport (reference/passport-assembly.js) with NO account, NO
// citizen PII, and NO plate-based lookup anywhere on the path — the
// owner's binding constraints. Control chain, in the order implemented
// below (order is itself a security requirement — see the numbered
// comments inline):
//
//   1. Path/method gate — only GET /public/passport/:ivid exists. Any
//      other path under /public/ (including a hypothetical
//      /public/plate/...) is 404, identically to an unknown route
//      elsewhere in this file. A non-GET method on the matched path is
//      405, matching this file's existing convention.
//   2. FORMAT GATE BEFORE ANY DATABASE TOUCH — reference/ivid.js's
//      validate() runs first. A malformed IVID gets the SAME response
//      shape (404, {"error":"not found"}) as a well-formed-but-unknown
//      IVID, so a caller cannot distinguish "no such IVID" from
//      "malformed input" by response shape — and, more importantly, no
//      query ever reaches the database for malformed input.
//   3. Per-IP rate limiting — its own bucket
//      (enforcePublicResolutionLimit() below), independent of every
//      other bucket reference/rate-limit.js's enforce() computes
//      elsewhere (anon:*, ip:*, media_bytes:*). Configured in
//      config/idauto.example.json's public_resolution section.
//   4. No plate parameter is ever read. The query string is never
//      parsed by this handler — only pathname is used — so a ?plate=...
//      parameter is inert by construction, not filtered after the fact.
//   5. Lookup is by ivid only (WHERE ivid = $1), never by plate/internal
//      ref/anything else. scope is HARDCODED to 'public' in the
//      assemblePassport() call — never caller-influenced — and the SQL
//      fact query additionally filters access_scope = 'public' as
//      defense-in-depth, so even a future bug in assemblePassport's own
//      scope filter could not leak a non-public fact through this route.
//   6. qr.payload === the requested ivid is asserted before the
//      response is sent (assemblePassport already enforces this
//      internally and throws otherwise; this route asserts it again at
//      its own boundary, matching the codebase's "structural, not just
//      hoped-for" style — see passport-assembly.js's own qr comment).
//   7. The existing CSP/security-header set (identical to
//      serveAdminAsset()'s) is applied to the response.
// =====================================================

// IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH lets a test point this route at a
// small, fast-cycling config file (short window, low limit) instead of
// the real config/idauto.example.json, so burst/recovery behaviour can
// be exercised in real (not simulated) time without a slow test run —
// see tests/ida4-option-c-test.js. Unset in every real deployment, which
// falls back to the real config file exactly as before.
var PUBLIC_RESOLUTION_CONFIG_PATH = process.env.IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH ||
  path.join(__dirname, '..', 'config', 'idauto.example.json');
var _publicResolutionConfigCache = null;

// Reads config/idauto.example.json's public_resolution.rate_limit
// section once per process (cached, same pattern as
// reference/plate-validator.js's loadFormats()). Falls back to a safe
// default if the section is absent so this route never silently runs
// unlimited.
function loadPublicResolutionConfig() {
  if (_publicResolutionConfigCache) return _publicResolutionConfigCache;
  var section = {};
  try {
    var raw = fs.readFileSync(PUBLIC_RESOLUTION_CONFIG_PATH, 'utf8');
    var config = JSON.parse(raw);
    section = (config.public_resolution && config.public_resolution.rate_limit) || {};
  } catch (_) { /* fall through to defaults below */ }
  _publicResolutionConfigCache = {
    limit: typeof section.limit === 'number' && section.limit > 0 ? section.limit : 30,
    window_seconds: typeof section.window_seconds === 'number' && section.window_seconds > 0 ? section.window_seconds : 60
  };
  return _publicResolutionConfigCache;
}

function floorPublicResolutionWindow(now, windowSeconds) {
  var size = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

// Its OWN rate-limit bucket — dimension 'public_resolution:window' is
// used nowhere else in this codebase, so this route's counters can never
// collide with reference/rate-limit.js's ingestion buckets (anon:*,
// ip:*, media_bytes:*) even though both ultimately share the same
// idauto_rate_limit_counters table and the same bucketKey()/UPSERT
// primitives from reference/rate-limit.js — reused deliberately, not
// reimplemented.
async function enforcePublicResolutionLimit(ipHash, now) {
  var cfg = loadPublicResolutionConfig();
  var nowDate = now || new Date();
  var windowStart = floorPublicResolutionWindow(nowDate, cfg.window_seconds);
  var key = rateLimit.bucketKey('public_resolution:window', ipHash);
  var result = await db.query(rateLimit.atomicStatement, [key, windowStart, 1]);
  var count = Number(result.rows[0].count);
  if (count > cfg.limit) {
    return { allowed: false, retry_at: new Date(windowStart.getTime() + cfg.window_seconds * 1000) };
  }
  return { allowed: true };
}

function clientIpHash(req) {
  var ip = (req.socket && req.socket.remoteAddress) || '';
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Maps one idauto_vehicle_facts row (already filtered to access_scope =
// 'public' by the caller's SQL) into the protocol-shaped fact object
// reference/passport-assembly.js expects (provenance.access_scope, per
// its own header comment) — a pure reshape, no additional filtering
// decision made here.
function factRowToPassportFact(row) {
  return {
    id: 'fact-' + row.id,
    fact_key: row.fact_key,
    fact_value: row.fact_value,
    fact_value_normalized: row.fact_value_normalized,
    confidence_score: row.confidence_score,
    verification_status: row.verification_status,
    provenance: { access_scope: row.access_scope }
  };
}

async function handlePublicPassportRoute(req, res, pathname) {
  // 1. Path gate: only exactly this shape exists under /public/. Any
  // other path (e.g. /public/plate/xyz, /public/, /public/passport/)
  // is 404 regardless of method — matching this file's existing
  // path-then-method dispatch order.
  var m = /^\/public\/passport\/([^/]+)$/.exec(pathname);
  if (!m) return notFound(res);

  // 1. Method gate.
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  // 2. FORMAT GATE BEFORE ANY DATABASE TOUCH. A decode failure is
  // treated as a format failure too (same 404 shape, still zero DB
  // touch) rather than surfaced as a distinct 400 — this route's only
  // job is IVID resolution, and an undecodable path segment cannot be a
  // well-formed IVID either way.
  var candidate;
  try {
    candidate = decodeURIComponent(m[1]);
  } catch (_) {
    return notFound(res);
  }
  if (!ivid.validate(candidate).ok) {
    return notFound(res);
  }

  // 3. Per-IP rate limit, this route's own bucket.
  var limitResult = await enforcePublicResolutionLimit(clientIpHash(req));
  if (!limitResult.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds(limitResult.retry_at)) });
    return res.end(JSON.stringify({ error: 'rate limit exceeded' }));
  }

  // 5. Lookup by ivid only — never by plate, internal_ref, or any other
  // identifier. No plate parameter exists to read in the first place
  // (the query string is never parsed by this handler).
  var vehicleResult = await db.query(
    'SELECT internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, ' +
    'gross_weight_kg, engine_cc, category_code, fiche_status, ivid ' +
    'FROM idauto_vehicles WHERE ivid = $1',
    [candidate]
  );
  if (vehicleResult.rows.length === 0) return notFound(res);
  var vehicleRow = vehicleResult.rows[0];

  // Defense-in-depth: access_scope = 'public' filtered in SQL, in
  // addition to assemblePassport()'s own scope filter below.
  var factsResult = await db.query(
    'SELECT id, fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, access_scope ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = (SELECT id FROM idauto_vehicles WHERE ivid = $1) AND access_scope = $2 AND is_active = TRUE ' +
    'ORDER BY fact_key',
    [candidate, 'public']
  );

  var passport = passportAssembly.assemblePassport({
    vehicle: vehicleRow,
    facts: factsResult.rows.map(factRowToPassportFact),
    scope: 'public', // HARDCODED — never caller-influenced.
    now: new Date()
  });

  // 6. Structural assertion, not just hoped for.
  if (passport.qr.payload !== candidate) {
    throw new Error('handlePublicPassportRoute: internal invariant violated — qr.payload must equal the requested ivid');
  }

  // 7. Existing CSP/security header set, identical to serveAdminAsset().
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(JSON.stringify(passport));
}

// GET /api/vehicles/:internal_ref
// Public/professional-safe vehicle fields only. No owner fields exist in
// the schema at all (idauto_vehicles has none, by design — see AD-2).
async function getVehicle(res, internalRef) {
  var result = await db.query(
    'SELECT internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, ' +
    'gross_weight_kg, engine_cc, category_code, fiche_status, first_seen_at, last_seen_at, observation_count ' +
    'FROM idauto_vehicles WHERE internal_ref = $1',
    [internalRef]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/plates/:plate_number
// No owner fields exist in the schema (idauto_plates has none, by design).
async function getPlate(res, plateNumber) {
  var result = await db.query(
    'SELECT p.plate_number, p.format_code, g.name_fr AS governorate_name, p.status, ' +
    'p.vehicle_id, p.valid_from, p.valid_until ' +
    'FROM idauto_plates p LEFT JOIN idauto_governorates g ON g.id = p.governorate_id ' +
    'WHERE p.plate_number = $1',
    [plateNumber]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/observations/:id
// Deliberately excludes capture_time, plate_candidate, ocr_confidence,
// ip_hash, camera_source_id, contributor_id, capture_session_id — all
// documented in schema.sql as MYTHOS_PRIVATE or contributor/session
// identity. Returns only status-shaped fields safe without audit logging.
async function getObservation(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var result = await db.query(
    'SELECT id, vehicle_id, plate_id, capture_method, status ' +
    'FROM idauto_observations WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/vehicles/:vehicle_internal_ref/facts
// Filters access_scope != 'mythos_private' at the query level — the same
// enforcement point the schema's own design intends for this column.
async function getFactsForVehicle(res, internalRef) {
  var vehicle = await db.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1', [internalRef]);
  if (vehicle.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, ' +
    'access_scope, is_active, first_seen_at, last_seen_at ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND access_scope != $2 ORDER BY fact_key',
    [vehicle.rows[0].id, 'mythos_private']
  );
  sendJson(res, 200, { vehicle_internal_ref: internalRef, facts: result.rows });
}

// GET /api/facts/:fact_id/evidence
async function getEvidenceForFact(res, factId) {
  if (!/^\d+$/.test(factId)) return notFound(res);
  var fact = await db.query('SELECT id, access_scope FROM idauto_vehicle_facts WHERE id = $1', [factId]);
  if (fact.rows.length === 0) return notFound(res);
  if (fact.rows[0].access_scope === 'mythos_private') return notFound(res);
  var result = await db.query(
    'SELECT evidence_type, weight, created_at FROM idauto_fact_evidence WHERE fact_id = $1 ORDER BY created_at',
    [factId]
  );
  sendJson(res, 200, { fact_id: parseInt(factId, 10), evidence: result.rows });
}

async function getHealth(res) {
  await db.query('SELECT 1');
  sendJson(res, 200, { status: 'ok' });
}

// GET /api/observations/:id/media
// Metadata only — object_key is a local storage reference, never a
// fetchable URL, and this endpoint never streams file bytes (no UI, no
// image-serving path exists in this stage). Excludes mythos_private-scope
// rows, same policy as every other read in this file (default access_scope
// on this table is 'mythos_private' per schema.sql, so most rows are
// excluded unless a caller explicitly chose a wider scope on write).
async function getObservationMedia(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var obs = await db.query('SELECT id FROM idauto_observations WHERE id = $1', [id]);
  if (obs.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 AND access_scope != $2 ORDER BY created_at',
    [id, 'mythos_private']
  );
  sendJson(res, 200, { observation_id: parseInt(id, 10), media: result.rows });
}

// GET /api/review/observations — queue view derived from the observation
// statuses already defined by the schema. Only the two pending states enter
// this queue; no private capture fields or storage object keys are selected.
async function getReviewObservations(res) {
  var result = await db.query(
    "SELECT o.id, o.capture_method, o.status, v.internal_ref AS vehicle_internal_ref, v.make, v.model, " +
    "p.plate_number FROM idauto_observations o " +
    "LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id LEFT JOIN idauto_plates p ON p.id = o.plate_id " +
    "WHERE o.status IN ('pending_review','pending_confirmation') ORDER BY o.id ASC"
  );
  sendJson(res, 200, { observations: result.rows });
}

// GET /api/review/observations/:id — admin-safe detail. Facts and media are
// filtered at query level exactly like the existing IDA-2C/2F read routes.
async function getReviewObservation(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var observation = await db.query(
    'SELECT o.id, o.capture_method, o.status, v.internal_ref AS vehicle_internal_ref, v.make, v.model, v.variant, v.year, ' +
    'v.body_type, v.fuel_type, v.colour, p.plate_number, p.format_code ' +
    'FROM idauto_observations o LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id ' +
    'LEFT JOIN idauto_plates p ON p.id = o.plate_id WHERE o.id = $1',
    [id]
  );
  if (observation.rows.length === 0) return notFound(res);
  var item = observation.rows[0];
  var facts = item.vehicle_internal_ref ? await db.query(
    'SELECT fact_key, fact_value, confidence_score, verification_status, access_scope FROM idauto_vehicle_facts f ' +
    'JOIN idauto_vehicles v ON v.id = f.vehicle_id WHERE v.internal_ref = $1 AND f.access_scope != $2 ORDER BY fact_key',
    [item.vehicle_internal_ref, 'mythos_private']
  ) : { rows: [] };
  var media = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 AND access_scope != $2 ORDER BY created_at',
    [id, 'mythos_private']
  );
  sendJson(res, 200, { observation: item, facts: facts.rows, media: media.rows });
}

// GET /api/review/submissions — IDA-3 ingestion review queue with provenance.
async function getReviewSubmissions(res) {
  var result = await db.query(
    "SELECT s.id AS submission_id, s.actor_type, cs.code AS capture_source_code, s.received_at, " +
    "o.id AS observation_id, o.status AS observation_status, p.plate_number, " +
    "count(DISTINCT f.id)::int AS fact_count, count(DISTINCT m.id)::int AS media_count " +
    "FROM idauto_submissions s JOIN idauto_observations o ON o.id = s.observation_id " +
    "JOIN idauto_capture_sources cs ON cs.id = s.capture_source_id " +
    "LEFT JOIN idauto_plates p ON p.id = o.plate_id LEFT JOIN idauto_vehicle_facts f ON f.observation_id = o.id " +
    "LEFT JOIN idauto_observation_media m ON m.observation_id = o.id " +
    "WHERE o.status IN ('pending_review','pending_confirmation') " +
    "GROUP BY s.id, s.actor_type, cs.code, s.received_at, o.id, o.status, p.plate_number ORDER BY s.id ASC"
  );
  sendJson(res, 200, { submissions: result.rows });
}

// GET /api/review/submissions/:id — private reviewer detail. Deliberately
// includes mythos_private fact and media metadata, but never storage paths.
async function getReviewSubmission(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var submission = await db.query(
    'SELECT s.id AS submission_id, s.actor_type, cs.code AS capture_source_code, s.received_at, ' +
    'o.id AS observation_id, o.status AS observation_status, o.capture_method, p.plate_number, p.format_code, ' +
    'v.internal_ref AS vehicle_internal_ref, v.make, v.model, v.variant, v.year, v.body_type, v.fuel_type, v.colour ' +
    'FROM idauto_submissions s JOIN idauto_observations o ON o.id = s.observation_id ' +
    'JOIN idauto_capture_sources cs ON cs.id = s.capture_source_id LEFT JOIN idauto_plates p ON p.id = o.plate_id ' +
    'LEFT JOIN idauto_vehicles v ON v.id = o.vehicle_id WHERE s.id = $1',
    [id]
  );
  if (submission.rows.length === 0) return notFound(res);
  var item = submission.rows[0];
  var facts = await db.query(
    'SELECT id, fact_key, fact_value, confidence_score, verification_status, access_scope ' +
    'FROM idauto_vehicle_facts WHERE observation_id = $1 ORDER BY id ASC',
    [item.observation_id]
  );
  var media = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 ORDER BY id ASC',
    [item.observation_id]
  );
  sendJson(res, 200, {
    submission: { id: item.submission_id, actor_type: item.actor_type, capture_source_code: item.capture_source_code, received_at: item.received_at },
    observation: { id: item.observation_id, status: item.observation_status, capture_method: item.capture_method, plate_number: item.plate_number, format_code: item.format_code, vehicle_internal_ref: item.vehicle_internal_ref, make: item.make, model: item.model, variant: item.variant, year: item.year, body_type: item.body_type, fuel_type: item.fuel_type, colour: item.colour },
    facts: facts.rows,
    media: media.rows
  });
}

// Reads and JSON-parses the request body, capped at 64KB (this API's
// JSON-bodied routes take small admin-entry payloads only; file/image
// uploads use readBinaryBody() below instead, with its own larger cap).
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 65536) {
        tooLarge = true;
        chunks = [];
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('invalid JSON body'), { httpStatus: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Reads a raw binary body, capped at storage.MAX_UPLOAD_BYTES (distinct
// cap from readJsonBody's 64KB — this endpoint carries file bytes, not a
// small admin-entry payload).
function readBinaryBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > storage.MAX_UPLOAD_BYTES) {
        tooLarge = true;
        chunks = [];
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large — max ' + (storage.MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB'), { httpStatus: 413 }));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function multipartBoundary(contentType) {
  if (typeof contentType !== 'string' || !/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    throw Object.assign(new Error('multipart/form-data is required'), { httpStatus: 400 });
  }
  var match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  var boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 70 || /[\x00-\x20\x7f()<>@,;:\\"\/[\]?={}]/.test(boundary)) {
    throw Object.assign(new Error('invalid multipart boundary'), { httpStatus: 400 });
  }
  return boundary;
}

function parseMultipartBuffer(buffer, contentType) {
  var boundary = multipartBoundary(contentType);
  if (!Buffer.isBuffer(buffer)) throw Object.assign(new Error('invalid multipart body'), { httpStatus: 400 });
  if (buffer.length > storage.MAX_UPLOAD_BYTES) throw Object.assign(new Error('payload too large'), { httpStatus: 413 });
  var marker = Buffer.from('--' + boundary);
  var delimiter = Buffer.from('\r\n--' + boundary);
  if (!buffer.slice(0, marker.length).equals(marker)) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
  var parts = [];
  var position = marker.length;
  while (true) {
    if (buffer.slice(position, position + 2).toString() === '--') {
      if (position + 2 !== buffer.length && buffer.slice(position + 2, position + 4).toString() !== '\r\n') throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
      break;
    }
    if (buffer.slice(position, position + 2).toString() !== '\r\n') throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    position += 2;
    var headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headerEnd === -1) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    var headerText = buffer.slice(position, headerEnd).toString('latin1');
    var next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next === -1) throw Object.assign(new Error('malformed multipart body'), { httpStatus: 400 });
    var disposition = /(?:^|\r\n)Content-Disposition:\s*form-data\s*;[^\r\n]*\bname="([^"]+)"/i.exec(headerText);
    if (!disposition) throw Object.assign(new Error('malformed multipart part'), { httpStatus: 400 });
    var type = /(?:^|\r\n)Content-Type:\s*([^\r\n;]+)/i.exec(headerText);
    parts.push({ name: disposition[1], content_type: type ? type[1].trim() : '', buffer: buffer.slice(headerEnd + 4, next) });
    position = next + delimiter.length;
  }
  var submissions = parts.filter(function (part) { return part.name === 'submission'; });
  if (submissions.length !== 1) throw Object.assign(new Error('exactly one submission part is required'), { httpStatus: 400 });
  var submission;
  try { submission = JSON.parse(submissions[0].buffer.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('invalid submission JSON'), { httpStatus: 400 }); }
  return {
    submission: submission,
    media: parts.filter(function (part) { return part.name === 'image'; }).map(function (part) {
      return { mime_type: part.content_type, buffer: part.buffer };
    })
  };
}

function readMultipartBody(req) {
  var contentType = req.headers['content-type'] || '';
  multipartBoundary(contentType);
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0, tooLarge = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > storage.MAX_UPLOAD_BYTES) { tooLarge = true; chunks = []; return; }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', function () {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
      try { resolve(parseMultipartBuffer(Buffer.concat(chunks), contentType)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function ingestHttpStatus(result) {
  if (result && result.replay === true) return 200;
  if (result && result.status === 'duplicate') return 202;
  if (result && result.ok === true) return 201;
  var code = result && result.error && result.error.code;
  if (code === 'INVALID_PLATE') return 422;
  if (['INVALID_MEDIA_SIZE', 'SUBMISSION_TOO_LARGE', 'TOO_MANY_IMAGES'].indexOf(code) !== -1) return 413;
  if (['INVALID_MEDIA', 'INVALID_MEDIA_MAGIC', 'MALFORMED_MEDIA'].indexOf(code) !== -1) return 415;
  if (code === 'RATE_LIMITED') return 429;
  if (['CAPTURE_SOURCE_UNAVAILABLE', 'INGESTION_FAILED', 'IDA_FACT_LINK', 'RATE_LIMIT_STORAGE_ERROR'].indexOf(code) !== -1) return 500;
  return 400;
}

function retryAfterSeconds(retryAt, now) {
  var milliseconds = new Date(retryAt).getTime() - (now === undefined ? Date.now() : new Date(now).getTime());
  if (!isFinite(milliseconds)) return 1;
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

async function postIngestObservation(req, res) {
  var idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) return sendJson(res, 400, { error: 'Idempotency-Key header is required' });
  var match = /^Bearer (.+)$/.exec(req.headers['authorization'] || '');
  var parsed = await readMultipartBody(req);
  var payload = parsed.submission;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !Object.prototype.hasOwnProperty.call(payload, 'media')) {
    payload = Object.assign({}, payload, { media: parsed.media });
  }
  var result = await ingestion.submit(payload, { actor_type: 'admin', actor_ref: match[1], idempotency_key: idempotencyKey });
  var status = ingestHttpStatus(result);
  if (status === 500) return sendJson(res, 500, { error: 'ingestion failed' });
  if (status === 429) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds(result.retry_at)) });
    return res.end(JSON.stringify(result));
  }
  sendJson(res, status, result);
}

// POST /api/observations/:id/media
// Body is the raw file content. Content-Type header is the mime type.
// Optional X-Idauto-Media-Type / X-Idauto-Access-Scope headers (both
// validated + defaulted in writes.js) — kept out of the body since the
// body IS the file, not JSON, matching this being a binary-upload
// endpoint rather than a JSON one like every other write route.
async function postObservationMedia(req, res, observationId) {
  if (!/^\d+$/.test(observationId)) return notFound(res);
  var buffer = await readBinaryBody(req);
  var mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  var body = {
    media_type: req.headers['x-idauto-media-type'],
    access_scope: req.headers['x-idauto-access-scope'],
    blurred: req.headers['x-idauto-blurred'] === 'true'
  };
  var record = await writes.createObservationMedia(observationId, buffer, mimeType, body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/vehicles
async function postVehicle(req, res) {
  var body = await readJsonBody(req);
  var record = await writes.createVehicle(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/plates
async function postPlate(req, res) {
  var body = await readJsonBody(req);
  if (!body.plate_number || !body.format_code) {
    return sendJson(res, 400, { error: 'plate_number and format_code are required' });
  }
  var record = await writes.createPlate(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/observations
async function postObservation(req, res) {
  var body = await readJsonBody(req);
  if (!body.vehicle_internal_ref) {
    return sendJson(res, 400, { error: 'vehicle_internal_ref is required' });
  }
  var record = await writes.createObservation(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/vehicles/:internal_ref/facts
async function postFact(req, res, internalRef) {
  var body = await readJsonBody(req);
  if (!body.fact_key || typeof body.fact_value === 'undefined') {
    return sendJson(res, 400, { error: 'fact_key and fact_value are required' });
  }
  var record = await writes.createFact(internalRef, body, req.mythosIdentity);
  sendJson(res, 201, record);
}

async function postReviewDecision(req, res, observationId) {
  if (!/^\d+$/.test(observationId)) return notFound(res);
  var body = await readJsonBody(req);
  var record = await writes.reviewObservation(observationId, body.decision, req.mythosIdentity);
  sendJson(res, 200, record);
}

async function postFactReviewDecision(req, res, factId) {
  if (!/^\d+$/.test(factId)) return notFound(res);
  var body = await readJsonBody(req);
  var record = await writes.reviewFact(factId, body.decision, req.mythosIdentity);
  sendJson(res, 200, record);
}

var ROUTES = [
  { method: 'GET', pattern: /^\/health$/, handler: function (req, res) { return getHealth(res); } },
  { method: 'GET', pattern: /^\/api\/review\/observations$/, handler: function (req, res) { return getReviewObservations(res); } },
  { method: 'GET', pattern: /^\/api\/review\/observations\/([^/]+)$/, handler: function (req, res, m) { return getReviewObservation(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/review\/observations\/([^/]+)\/decision$/, handler: function (req, res, m) { return postReviewDecision(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/review\/submissions$/, handler: function (req, res) { return getReviewSubmissions(res); } },
  { method: 'GET', pattern: /^\/api\/review\/submissions\/([^/]+)$/, handler: function (req, res, m) { return getReviewSubmission(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/review\/facts\/([^/]+)\/decision$/, handler: function (req, res, m) { return postFactReviewDecision(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return getFactsForVehicle(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return postFact(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)$/, handler: function (req, res, m) { return getVehicle(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles$/, handler: function (req, res) { return postVehicle(req, res); } },
  { method: 'GET', pattern: /^\/api\/plates\/([^/]+)$/, handler: function (req, res, m) { return getPlate(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/plates$/, handler: function (req, res) { return postPlate(req, res); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return getObservationMedia(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/ingest\/observations$/, handler: function (req, res) { return postIngestObservation(req, res); } },
  { method: 'POST', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return postObservationMedia(req, res, decodePathSegment(m[1])); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)$/, handler: function (req, res, m) { return getObservation(res, decodePathSegment(m[1])); } },
  { method: 'POST', pattern: /^\/api\/observations$/, handler: function (req, res) { return postObservation(req, res); } },
  { method: 'GET', pattern: /^\/api\/facts\/([^/]+)\/evidence$/, handler: function (req, res, m) { return getEvidenceForFact(res, decodePathSegment(m[1])); } }
];

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url);
    var pathname = parsed.pathname;

    if (serveAdminAsset(req, res, pathname)) return;

    // A5 OPTION C, 2026-08-19 — the one unauthenticated route, reached
    // BEFORE requireAuth() deliberately. Every path under /public/ is
    // handled here and NEVER falls through to the authenticated ROUTES
    // table below.
    if (pathname === '/public' || pathname.indexOf('/public/') === 0) {
      Promise.resolve().then(function () { return handlePublicPassportRoute(req, res, pathname); }).catch(function (err) {
        if (err && err.httpStatus) return sendJson(res, err.httpStatus, { error: err.message });
        var mapped = writes.mapDbError(err);
        sendJson(res, mapped.status, { error: mapped.error });
      });
      return;
    }

    if (!requireAuth(req, res)) return;

    var matchedPath = ROUTES.filter(function (r) { return r.pattern.test(pathname); });
    if (matchedPath.length === 0) return notFound(res);

    var matchedMethod = matchedPath.filter(function (r) { return r.method === req.method; });
    if (matchedMethod.length === 0) {
      var allowed = matchedPath.map(function (r) { return r.method; }).join(', ');
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': allowed });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);
    Promise.resolve().then(function () { return route.handler(req, res, m); }).catch(function (err) {
      if (err.httpStatus) return sendJson(res, err.httpStatus, { error: err.message });
      // Never include the raw driver error message in the response — it
      // can echo back query fragments or connection detail. mapDbError()
      // translates known Postgres error codes to a safe, specific message;
      // anything unrecognized falls through to a generic 500.
      var mapped = writes.mapDbError(err);
      sendJson(res, mapped.status, { error: mapped.error });
    });
  });
}

if (require.main === module) {
  var port = parseInt(process.env.IDAUTO_API_PORT || '3001', 10);
  createServer().listen(port, '127.0.0.1', function () {
    console.log('ID Auto API listening on 127.0.0.1:' + port);
  });
}

module.exports = {
  createServer: createServer,
  parseMultipartBuffer: parseMultipartBuffer,
  ingestHttpStatus: ingestHttpStatus,
  retryAfterSeconds: retryAfterSeconds
};
