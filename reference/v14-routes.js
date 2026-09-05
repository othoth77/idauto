'use strict';
// =====================================================
// IDauto — IDA-V14 — registration document (carte grise) routes
// reference/v14-routes.js
//
// Mounted by reference/api.js behind the SAME authenticate() and the SAME
// organisation-scope gate as everything else (session cookie + header, or a
// service credential). No SQL here, no filesystem here, no path from the
// client: the service generates keys and sniffs bytes.
//
//   GET    /api/vehicles/:ref/registration-document                  document:read
//   PUT    /api/vehicles/:ref/registration-document/:face            document:write  (image bytes; replaces)
//   PUT    /api/vehicles/:ref/registration-document/:face/thumbnail  document:write  (small image bytes)
//   GET    /api/vehicles/:ref/registration-document/:face/image      document:read   (?variant=thumb)
//   DELETE /api/vehicles/:ref/registration-document/:face            document:delete
//   POST   /api/vehicles/:ref/registration-document/ocr              document:write  (raw OCR text → technical fields, comparison)
//   POST   /api/vehicles/:ref/registration-document/confirm          vehicle:write   (→ resolver.confirm(), the single write path)
//   POST   /api/identify/registration-document                        vehicle:resolve (homepage search: OCR reads → VIN | plate | make+model; writes nothing)
//
// Anti-abuse: 60 uploads and 60 OCR runs per actor per 10 minutes, on the
// same database-backed counter the public limiter uses; 6 MB per image,
// 512 KB per thumbnail, 400–5000 px edges, JPEG / PNG / WebP by magic bytes.
// =====================================================

var errors = require('./vehicle/errors.js');
var service = require('./documents/document-service.js');
var rateLimit = require('./rate-limit.js');
var db = require('./db.js');

var UPLOAD_LIMIT = { limit: parseInt(process.env.IDAUTO_DOCUMENT_UPLOADS_PER_10MIN || '60', 10), window_seconds: 600 };

function createV14(ctx) {
  var sendJson = ctx.sendJson, readJsonBody = ctx.readJsonBody, readBinaryBody = ctx.readBinaryBody, requireScope = ctx.requireScope, decode = ctx.decodePathSegment;
  var resolver = ctx.resolver;

  function actorOf(req) { return { identity: req.mythosIdentity, principal: req.principal }; }
  function guard(fn) {
    return function (req, res, m) {
      return Promise.resolve().then(function () { return fn(req, res, m); }).catch(function (err) {
        if (res.headersSent) { req.socket.destroy(); return; }
        var mapped = err && err.isIdautoError ? errors.toResponse(err) : err && err.httpStatus ? { status: err.httpStatus, body: { error: 'request_error', message_fr: err.httpStatus === 413 ? 'Image trop volumineuse.' : 'La demande n\'a pas pu être traitée.' } } : errors.toResponse(err);
        if (err && err.isIdautoError && err.httpStatus === 413) mapped.body.message_fr = 'Image trop volumineuse (maximum ' + Math.round(service.LIMITS.max_bytes / 1024 / 1024) + ' Mo après optimisation).';
        if (err && err.isIdautoError && err.httpStatus === 415) mapped.body.message_fr = 'Le fichier n\'est pas une image JPEG, PNG ou WebP.';
        sendJson(res, mapped.status, mapped.body);
      });
    };
  }
  async function throttle(req, res, what) {
    var key = 'document_' + what + ':' + (req.mythosIdentity || 'anonymous');
    var r = await rateLimit.enforcePublicResolution(db, key, UPLOAD_LIMIT);
    if (!r.allowed) { sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop d\'envois en peu de temps. Patientez quelques minutes.' }); return false; }
    return true;
  }
  function header(req, name) { var v = req.headers[name]; return typeof v === 'string' ? v : undefined; }

  async function getDocument(req, res, m) { sendJson(res, 200, await service.list(decode(m[1]), actorOf(req))); }
  async function putFace(req, res, m) {
    if (!(await throttle(req, res, 'upload'))) return;
    var bytes = await readBinaryBody(req);
    var originalBytes = parseInt(header(req, 'x-idauto-original-bytes') || '', 10);
    var out = await service.store(decode(m[1]), decode(m[2]), bytes, null, {
      original_byte_size: isFinite(originalBytes) ? originalBytes : null,
      capture: { detection: header(req, 'x-idauto-capture'), quality: parseFloat(header(req, 'x-idauto-quality') || '') || null, max_edge: parseInt(header(req, 'x-idauto-max-edge') || '', 10) || null }
    }, actorOf(req));
    sendJson(res, out.replaced ? 200 : 201, out);
  }
  async function putThumbnail(req, res, m) {
    if (!(await throttle(req, res, 'upload'))) return;
    var bytes = await readBinaryBody(req);
    sendJson(res, 200, await service.setThumbnail(decode(m[1]), decode(m[2]), bytes, actorOf(req)));
  }
  async function getImage(req, res, m) {
    var variant = /[?&]variant=thumb(&|$)/.test(req.url) ? 'thumb' : 'archive';
    var out = await service.image(decode(m[1]), decode(m[2]), variant, actorOf(req));
    res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'ETag': '"' + out.sha256.slice(0, 32) + '"' });
    res.end(out.bytes);
  }
  async function deleteFace(req, res, m) { sendJson(res, 200, await service.remove(decode(m[1]), decode(m[2]), actorOf(req))); }
  async function postOcr(req, res, m) {
    if (!(await throttle(req, res, 'ocr'))) return;
    var body = await readJsonBody(req);
    sendJson(res, 200, await service.ocr(decode(m[1]), body, actorOf(req)));
  }
  // The proposal, confirmed by a person, goes through the ONE identification write path.
  async function postConfirm(req, res, m) {
    var body = await readJsonBody(req);
    var ref = decode(m[1]);
    var vehicle = await resolver.confirm({
      vehicle_ref: ref, action: 'edit', method: 'carte_grise_ocr', source: 'carte_grise_ocr',
      confidence: typeof body.confidence === 'number' ? body.confidence : 0.8,
      candidate: body.candidate || {}, plate: body.plate || undefined, registration_type: body.registration_type, vin: body.vin || undefined,
      includeVin: false
    }, actorOf(req));
    await service.markConfirmed(ref, actorOf(req));
    sendJson(res, 200, { status: 'confirmed', vehicle: vehicle });
  }

  // Homepage « Rechercher par carte grise »: identification only, no storage.
  async function postIdentify(req, res) {
    if (!(await throttle(req, res, 'ocr'))) return;
    var body = await readJsonBody(req);
    var allowVin = require('./identity.js').principalHasScope(req.principal, 'vin:search');
    var out = await service.identify(body, actorOf(req), { resolver: resolver, allowVin: allowVin, includeVin: allowVin });
    // A VIN lookup is a VIN search: audited like the search criterion (fails closed, before disclosure).
    if (out.tried.indexOf('vin') !== -1) await require('./writes.js').recordVinSearchAudit(req.principal, req.mythosIdentity, body.faces && body.faces.length ? (out.ocr.vin || '') : '', out.identified_by === 'vin' && out.vehicle ? out.vehicle.id : null);
    sendJson(res, 200, out);
  }

  var scopes = [
    { method: 'GET',    pattern: /^\/api\/vehicles\/[^/]+\/registration-document$/,                 scope: 'document:read' },
    { method: 'GET',    pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/[^/]+\/image$/,   scope: 'document:read' },
    { method: 'PUT',    pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/[^/]+$/,          scope: 'document:write' },
    { method: 'PUT',    pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/[^/]+\/thumbnail$/, scope: 'document:write' },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/[^/]+$/,          scope: 'document:delete' },
    { method: 'POST',   pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/ocr$/,            scope: 'document:write' },
    { method: 'POST',   pattern: /^\/api\/vehicles\/[^/]+\/registration-document\/confirm$/,        scope: 'vehicle:write' },
    { method: 'POST',   pattern: /^\/api\/identify\/registration-document$/,                             scope: 'vehicle:resolve' }
  ];
  var routes = [
    { method: 'POST', pattern: /^\/api\/identify\/registration-document$/, handler: guard(postIdentify) },
    { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document$/, handler: guard(getDocument) },
    { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/ocr$/, handler: guard(postOcr) },
    { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/confirm$/, handler: guard(postConfirm) },
    { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/([^/]+)\/image$/, handler: guard(getImage) },
    { method: 'PUT', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/([^/]+)\/thumbnail$/, handler: guard(putThumbnail) },
    { method: 'PUT', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/([^/]+)$/, handler: guard(putFace) },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/([^/]+)\/registration-document\/([^/]+)$/, handler: guard(deleteFace) }
  ];
  return { routes: routes, scopes: scopes, service: service };
}

module.exports = { createV14: createV14 };
