'use strict';
// =====================================================
// IDauto — Update 3.1 — public vehicle photo analysis (homepage scanner)
// reference/public/photo-analysis-routes.js
//
// The PUBLIC door to the Update 3 analysis. It reuses the same modules
// (recognition/vehicle-vision.js, photos/tn-geo.js); it adds no service, no
// table and no storage. What it can do, and nothing else:
//
//   GET  /public/vehicle-analysis          is the vehicle analysis configured?  → { enabled }
//   POST /public/vehicle-analysis          one JPEG → make, model, version, colour, body type, view,
//                                          a reading of the plate — as the vision model sees them
//   GET  /public/geo/tn                    governorates and delegations (manual location)
//   GET  /public/geo/resolve?lat&lon       offline: nearest known place, governorate (approximate)
//
// What it never does: it creates or changes no record, stores no image, reads no
// vehicle, owner, document or plate from the database, and returns nothing about
// a registration number. Looking a plate up stays the existing public plate route
// (/public/plates/:plate → IVID only, public-surface policy), which the page calls
// separately and only when the person asks.
//
// Abuse protection: per-client budgets (hashed IP, the same database counter as
// the public plate route, separate buckets); JPEG only, by magic bytes; 1.5 MB at
// most, refused from the declared length before the body is read; the image is
// held in memory for the request only. The provider key is never sent or logged.
// =====================================================

var vision = require('../recognition/vehicle-vision.js');
var geo = require('../photos/tn-geo.js');
// Update 3.1 (final) — storing an ANONYMOUS visitor's photograph, and letting them save or attach a vehicle,
// exists but is OFF unless IDAUTO_PUBLIC_SCAN_STORE=1 on the server (owner decision 2026-11-16: legal gates
// L01/L02 in docs/IDA4_LEGAL_GATE_MATRIX.md are open). With it off, these routes answer 403 and the page offers
// the analysis without storage, exactly as before.
var scans = require('../photos/scan-service.js');
var registration = require('../workspace/registration-service.js');
var STORE_LIMIT = { limit: 20, window_seconds: 3600 }, WRITE_LIMIT = { limit: 5, window_seconds: 3600 };
function storeEnabled() { return process.env.IDAUTO_PUBLIC_SCAN_STORE === '1'; }

var ANALYSIS_LIMIT = { limit: parseInt(process.env.IDAUTO_PUBLIC_ANALYSIS_PER_10MIN || '10', 10), window_seconds: 600 };   // each one is a paid provider call when enabled
var GEO_LIMIT = { limit: 120, window_seconds: 600 };

function createPublicPhotoAnalysis(ctx) {
  var db = ctx.db, rateLimit = ctx.rateLimit, ipHash = ctx.clientIpHash, retryAfter = ctx.retryAfterSeconds, observability = ctx.observability;

  function json(res, status, body, extra) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {}));
    res.end(JSON.stringify(body));
  }
  async function budget(req, res, bucket, limits) {
    var r = await rateLimit.enforcePublicResolution(db, bucket + ':' + ipHash(req), limits);
    if (r.allowed) return true;
    json(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop de demandes en peu de temps. Patientez quelques minutes.' }, { 'Retry-After': String(retryAfter(r.retry_at)) });
    return false;
  }
  function readCapped(req, max) {
    return new Promise(function (resolve, reject) {
      var chunks = [], size = 0, over = false;
      req.on('data', function (c) { size += c.length; if (size > max) { over = true; chunks = []; } else if (!over) chunks.push(c); });
      req.on('end', function () { resolve(over ? null : Buffer.concat(chunks)); });
      req.on('error', reject);
    });
  }
  function publicView(out) {
    // Only what the model saw on the photograph. No provider name, no model id, no error detail beyond a code.
    return { enabled: !!out.enabled, available: !!(out.enabled && !out.error), error: out.error ? 'analysis_unavailable' : null,
      vehicle_visible: out.vehicle_visible === undefined ? null : out.vehicle_visible, view: out.view || 'unknown', plate: out.plate || null, fields: out.fields };
  }

  function publicActor(req) { var h = ipHash(req); return { identity: 'public:' + h.slice(0, 16), principal: { kind: 'public', scopes: [] } }; }
  function readJson(req) { return readCapped(req, 16 * 1024).then(function (b) { if (!b) throw Object.assign(new Error('too large'), { httpStatus: 413 }); try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error('bad json'), { httpStatus: 400 }); } }); }
  function fail(res, err) {
    var known = { VALIDATION: 400, NOT_FOUND: 404, VEHICLE_NOT_FOUND: 404, CONFLICT: 409 };
    var code = err && err.httpStatus ? err.httpStatus : err && err.code && known[err.code] ? known[err.code] : 500;
    var body = { error: code === 409 ? 'CONFLICT' : code === 404 ? 'NOT_FOUND' : code >= 500 ? 'request could not be processed' : 'INVALID_REQUEST' };
    if (code === 409 && err.details && err.details.reason === 'vehicle_already_registered') body.reason = 'vehicle_already_registered';
    json(res, code, body);
  }
  async function handleScans(req, res, pathname) {
    var m = /^\/public\/scans(?:\/([A-Za-z0-9_-]{32})(\/(?:attach|vehicle))?)?$/.exec(pathname);
    if (!m) return false;
    if (pathname === '/public/scans' && req.method === 'GET') { json(res, 200, { store: storeEnabled() }); return true; }
    if (!storeEnabled()) { req.resume(); json(res, 403, { error: 'DISABLED', message_fr: 'L\'enregistrement des photos n\'est pas activé sur ce service.' }); return true; }
    var actor = publicActor(req);
    try {
      if (!m[1] && req.method === 'POST') {
        if (!(await budget(req, res, 'public_scan_store', STORE_LIMIT))) { req.resume(); return true; }
        var declared = Number(req.headers['content-length'] || 0);
        if (declared > scans.LIMITS.max_bytes) { req.resume(); json(res, 413, { error: 'PAYLOAD_TOO_LARGE' }); return true; }
        var bytes = await readCapped(req, scans.LIMITS.max_bytes);
        if (!bytes) { json(res, 413, { error: 'PAYLOAD_TOO_LARGE' }); return true; }
        var metaH = req.headers['x-idauto-photo-meta'], meta = {};
        if (typeof metaH === 'string' && metaH.length < 12000) { try { meta = JSON.parse(Buffer.from(metaH, 'base64url').toString('utf8')); } catch (e) { meta = {}; } }
        json(res, 201, { scan: await scans.create(bytes, meta, actor, { ip_hash: ipHash(req) }) }); return true;
      }
      if (m[1] && !m[2] && req.method === 'GET') { json(res, 200, { scan: await scans.get(m[1], actor) }); return true; }
      if (m[1] && !m[2] && req.method === 'PUT') { json(res, 200, { scan: await scans.update(m[1], await readJson(req), actor) }); return true; }
      if (m[1] && m[2] && req.method === 'POST') {
        if (!(await budget(req, res, 'public_scan_write', WRITE_LIMIT))) { req.resume(); return true; }
        var body = await readJson(req);
        var po = await scans.plateOwner(body.serie, body.numero);
        if (m[2] === '/attach') {
          // attach only to the vehicle that carries this registration; nothing about it is returned but its public IVID
          if (!po.vehicle) { json(res, 404, { error: 'NOT_FOUND' }); return true; }
          var a = await scans.attach(m[1], po.vehicle.ivid, actor);
          json(res, 200, { attached: true, ivid: a.vehicle }); return true;
        }
        // create: plate + the values the visitor confirmed; existing registration → 409 (never a second vehicle)
        var created = await registration.register({ plate: po.plate, make: body.make, model: body.model, colour: body.colour, body_type: body.body_type, year: body.year }, actor);
        var att = await scans.attach(m[1], created.ivid, actor);
        json(res, 201, { created: true, ivid: created.ivid, attached: att.attached }); return true;
      }
      json(res, 405, { error: 'method not allowed' }); return true;
    } catch (err) { fail(res, err); return true; }
  }

  // → true when the path belongs here (answered), false otherwise
  async function handle(req, res, pathname) {
    if (pathname === '/public/scans' || pathname.indexOf('/public/scans/') === 0) return handleScans(req, res, pathname);
    if (pathname === '/public/vehicle-analysis') {
      if (req.method === 'GET') { json(res, 200, { enabled: vision.config().enabled }); return true; }
      if (req.method !== 'POST') { json(res, 405, { error: 'method not allowed' }, { 'Allow': 'GET, POST' }); return true; }
      if (!/^image\/jpeg\b/i.test(String(req.headers['content-type'] || ''))) { json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message_fr: 'Une image JPEG est attendue.' }); return true; }
      var declared = Number(req.headers['content-length'] || 0);
      if (declared > vision.MAX_IMAGE_BYTES) { req.resume(); json(res, 413, { error: 'PAYLOAD_TOO_LARGE', message_fr: 'Image trop volumineuse.' }); return true; }
      // Analysis OFF: nothing is sent anywhere, so nothing is counted — the page is simply told.
      if (!vision.config().enabled) { req.resume(); json(res, 200, { vehicle_analysis: publicView({ enabled: false, fields: vision.normalise({}).fields }) }); return true; }
      if (!(await budget(req, res, 'public_vision', ANALYSIS_LIMIT))) { req.resume(); return true; }
      var bytes = await readCapped(req, vision.MAX_IMAGE_BYTES);
      if (!bytes) { json(res, 413, { error: 'PAYLOAD_TOO_LARGE', message_fr: 'Image trop volumineuse.' }); return true; }
      if (!vision.isJpeg(bytes)) { json(res, 400, { error: 'INVALID_IMAGE', message_fr: 'L\'image n\'a pas pu être lue.' }); return true; }
      var out = await vision.analyse(bytes);
      if (observability) observability.shared().event('public_vehicle_analysis', { bytes: bytes.length, ok: !out.error, error: out.error || null });
      json(res, 200, { vehicle_analysis: publicView(out) });
      return true;
    }
    if (pathname === '/public/geo/tn' || pathname === '/public/geo/resolve') {
      if (req.method !== 'GET') { json(res, 405, { error: 'method not allowed' }, { 'Allow': 'GET' }); return true; }
      if (pathname === '/public/geo/tn') { json(res, 200, { country: 'Tunisie', governorates: geo.governorates() }, { 'Cache-Control': 'public, max-age=86400' }); return true; }
      if (!(await budget(req, res, 'public_geo', GEO_LIMIT))) return true;
      var q = new URL(req.url, 'http://x').searchParams, lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
      if (!geo.validCoords(lat, lon)) { json(res, 400, { error: 'VALIDATION', message_fr: 'Coordonnées invalides.' }); return true; }
      json(res, 200, { resolved: geo.resolve(lat, lon) });
      return true;
    }
    return false;
  }
  return { handle: handle, ANALYSIS_LIMIT: ANALYSIS_LIMIT, GEO_LIMIT: GEO_LIMIT };
}

module.exports = { createPublicPhotoAnalysis: createPublicPhotoAnalysis };
