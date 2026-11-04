'use strict';
// =====================================================
// IDauto — IDA-CG2 — registration submission routes (carte grise V2)
// reference/cg2-routes.js
//
// Mounted by reference/api.js behind the SAME authenticate() and the SAME
// organisation-scope gate as every route (session cookie + header, or a
// service credential). No SQL here: reference/documents/registration-submissions.js.
//
//   POST /api/registration-submissions                          document:write   open a submission { two_sided, single_sided_reason }
//   GET  /api/registration-submissions                          document:read    the caller's organisation's submissions (admin: all), 50 newest
//   GET  /api/registration-submissions/:ref                     document:read
//   PUT  /api/registration-submissions/:ref/faces/:face         document:write   body = the ORIGINAL image bytes (JPEG/PNG/WebP, sniffed; ≤ 15 MB)
//   PUT  /api/registration-submissions/:ref/faces/:face/thumbnail document:write ≤ 512 KB
//   GET  /api/registration-submissions/:ref/faces/:face/image   document:read    ?variant=thumb &version=n — private, no-store, hash-checked
//   POST /api/registration-submissions/:ref/extraction          document:write   { faces:[{ face, image_sha256, text, confidence }] } — text parsed, never stored
//   POST /api/registration-submissions/:ref/review              document:write   { expected_version, actions:[{ key, action, value?, note? }] }
//   POST /api/registration-submissions/:ref/request-image       document:write   { face, reason }
//   POST /api/registration-submissions/:ref/match               vehicle:resolve  read only; a VIN search is audited
//   POST /api/registration-submissions/:ref/decision            vehicle:write    { action: link|create|reject, vehicle_ref?, expected_version, acknowledge_ambiguity?, reason? }
// =====================================================

var errors = require('./vehicle/errors.js');
var service = require('./documents/registration-submissions.js');
var rateLimit = require('./rate-limit.js');
var db = require('./db.js');

var LIMIT = { limit: parseInt(process.env.IDAUTO_DOCUMENT_UPLOADS_PER_10MIN || '60', 10), window_seconds: 600 };

function createCg2(ctx) {
  var sendJson = ctx.sendJson, readJsonBody = ctx.readJsonBody, readBinaryBody = ctx.readBinaryBody, decode = ctx.decodePathSegment;

  function actorOf(req) { return { identity: req.mythosIdentity, principal: req.principal }; }
  function guard(fn) {
    return function (req, res, m) {
      return Promise.resolve().then(function () { return fn(req, res, m); }).catch(function (err) {
        if (res.headersSent) { req.socket.destroy(); return; }
        var mapped = errors.toResponse(err);
        if (err && err.isIdautoError && err.httpStatus === 413) mapped.body.message_fr = 'Image trop volumineuse (maximum ' + Math.round(service.LIMITS.max_bytes / 1024 / 1024) + ' Mo).';
        if (err && err.isIdautoError && err.httpStatus === 415) mapped.body.message_fr = 'Le fichier n\'est pas une image JPEG, PNG ou WebP.';
        sendJson(res, mapped.status, mapped.body);
      });
    };
  }
  async function throttle(req, res, what) {
    var r = await rateLimit.enforcePublicResolution(db, 'cg2_' + what + ':' + (req.mythosIdentity || 'anonymous'), LIMIT);
    if (!r.allowed) { sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop d\'envois en peu de temps. Patientez quelques minutes.' }); return false; }
    return true;
  }
  async function jsonBody(req) { var b = await readJsonBody(req); if (!b || typeof b !== 'object' || Array.isArray(b)) throw errors.IdautoError('VALIDATION', { reason: 'json_object_required' }); return b; }
  function qualityHeader(req) { var h = req.headers['x-idauto-quality']; if (typeof h !== 'string' || h.length > 400) return null; try { return JSON.parse(h); } catch (e) { return null; } }

  async function postCreate(req, res) { sendJson(res, 201, await service.create(await jsonBody(req), actorOf(req))); }
  async function getList(req, res) { var s = /[?&]status=([a-z_]{1,30})(&|$)/.exec(req.url); sendJson(res, 200, await service.list(actorOf(req), { status: s ? s[1] : null })); }
  async function getOne(req, res, m) { sendJson(res, 200, await service.get(decode(m[1]), actorOf(req))); }
  async function putFace(req, res, m) {
    if (!(await throttle(req, res, 'upload'))) return;
    var bytes = await readBinaryBody(req);
    sendJson(res, 201, await service.putFace(decode(m[1]), decode(m[2]), bytes, { quality: qualityHeader(req) }, actorOf(req)));
  }
  async function putThumb(req, res, m) {
    if (!(await throttle(req, res, 'upload'))) return;
    sendJson(res, 200, await service.putThumbnail(decode(m[1]), decode(m[2]), await readBinaryBody(req), actorOf(req)));
  }
  async function getImage(req, res, m) {
    var variant = /[?&]variant=thumb(&|$)/.test(req.url) ? 'thumb' : 'archive';
    var v = /[?&]version=(\d{1,4})(&|$)/.exec(req.url);
    var out = await service.image(decode(m[1]), decode(m[2]), variant, v ? v[1] : null, actorOf(req));
    res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'ETag': '"' + out.sha256.slice(0, 32) + '"' });
    res.end(out.bytes);
  }
  async function postExtraction(req, res, m) {
    if (!(await throttle(req, res, 'ocr'))) return;
    sendJson(res, 200, await service.extract(decode(m[1]), await jsonBody(req), actorOf(req)));
  }
  async function postReview(req, res, m) { sendJson(res, 200, await service.review(decode(m[1]), await jsonBody(req), actorOf(req))); }
  async function postRequestImage(req, res, m) { sendJson(res, 200, await service.requestBetterImage(decode(m[1]), await jsonBody(req), actorOf(req))); }
  async function postMatch(req, res, m) {
    if (!(await throttle(req, res, 'ocr'))) return;
    var out = await service.match(decode(m[1]), actorOf(req));
    // A VIN that was searched is audited BEFORE the answer leaves (fails closed), like every VIN search.
    if (out.vin_searched) {
      var hit = out.result.candidates.filter(function (c) { return c.vin_check === 'match'; });
      await require('./writes.js').recordVinSearchAudit(req.principal, req.mythosIdentity, out.vin_for_audit, hit.length === 1 ? hit[0].ivid : null);
    }
    delete out.vin_for_audit;
    sendJson(res, 200, out);
  }
  async function postDecision(req, res, m) { sendJson(res, 200, await service.decide(decode(m[1]), await jsonBody(req), actorOf(req))); }

  var R = '\\/api\\/registration-submissions';
  function re(s) { return new RegExp('^' + R + s + '$'); }
  var scopes = [
    { method: 'POST', pattern: re(''), scope: 'document:write' },
    { method: 'GET', pattern: re(''), scope: 'document:read' },
    { method: 'GET', pattern: re('\\/[^/]+'), scope: 'document:read' },
    { method: 'PUT', pattern: re('\\/[^/]+\\/faces\\/[^/]+'), scope: 'document:write' },
    { method: 'PUT', pattern: re('\\/[^/]+\\/faces\\/[^/]+\\/thumbnail'), scope: 'document:write' },
    { method: 'GET', pattern: re('\\/[^/]+\\/faces\\/[^/]+\\/image'), scope: 'document:read' },
    { method: 'POST', pattern: re('\\/[^/]+\\/extraction'), scope: 'document:write' },
    { method: 'POST', pattern: re('\\/[^/]+\\/review'), scope: 'document:write' },
    { method: 'POST', pattern: re('\\/[^/]+\\/request-image'), scope: 'document:write' },
    { method: 'POST', pattern: re('\\/[^/]+\\/match'), scope: 'vehicle:resolve' },
    { method: 'POST', pattern: re('\\/[^/]+\\/decision'), scope: 'vehicle:write' }
  ];
  var routes = [
    { method: 'POST', pattern: re(''), handler: guard(postCreate) },
    { method: 'GET', pattern: re(''), handler: guard(getList) },
    { method: 'GET', pattern: re('\\/([^/]+)\\/faces\\/([^/]+)\\/image'), handler: guard(getImage) },
    { method: 'PUT', pattern: re('\\/([^/]+)\\/faces\\/([^/]+)\\/thumbnail'), handler: guard(putThumb) },
    { method: 'PUT', pattern: re('\\/([^/]+)\\/faces\\/([^/]+)'), handler: guard(putFace) },
    { method: 'POST', pattern: re('\\/([^/]+)\\/extraction'), handler: guard(postExtraction) },
    { method: 'POST', pattern: re('\\/([^/]+)\\/review'), handler: guard(postReview) },
    { method: 'POST', pattern: re('\\/([^/]+)\\/request-image'), handler: guard(postRequestImage) },
    { method: 'POST', pattern: re('\\/([^/]+)\\/match'), handler: guard(postMatch) },
    { method: 'POST', pattern: re('\\/([^/]+)\\/decision'), handler: guard(postDecision) },
    { method: 'GET', pattern: re('\\/([^/]+)'), handler: guard(getOne) }
  ];
  return { routes: routes, scopes: scopes, service: service };
}

module.exports = { createCg2: createCg2 };
