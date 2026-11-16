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

  // → true when the path belongs here (answered), false otherwise
  async function handle(req, res, pathname) {
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
