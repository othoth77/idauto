'use strict';
// =====================================================
// IDauto — IDA-V12 — identification, catalogue and workshop routes
// reference/v12-routes.js
//
// Mounted by reference/api.js behind the SAME requireAuth() and the SAME
// organisation-scope gate as every other authenticated route. This file
// holds no SQL (the repositories do), no rate-limit machinery (rate-limit.js
// does) and no credential. Every handler answers errors through
// errors.toResponse(): a client only ever sees a stable code and a French
// sentence, never a driver message.
//
// SCOPES (organisation credentials; an admin holds '*'):
//   vehicle:resolve   POST /api/resolve/plate | /manual, POST .../identification/refresh
//   vin:search        POST /api/resolve/vin (audited, like the search criterion)
//   vehicle:write     POST /api/resolve/confirm, POST /api/workshop/visits/:id/identification
//   vehicle:read      GET /api/vehicles/:ref/fiche, .../identification/history
//   parts:read        GET /api/catalog/*, /api/parts/*, /api/vehicles/:ref/parts
//   parts:write       POST /api/parts, /api/parts/:id/compatibility
//   stock:write       PUT /api/parts/:id/stock
//   workshop:read     GET /api/workshop/*
//   workshop:write    POST /api/workshop/*
// Admin-only (absent from the scope table): GET /api/metrics, GET /api/resolution/providers.
// =====================================================

var fs = require('fs');
var path = require('path');
var errors = require('./vehicle/errors.js');
var vehicleResolverModule = require('./vehicle/vehicle-resolver.js');
var vehicleRepository = require('./vehicle/vehicle-repository.js');
var partsCatalogModule = require('./parts/parts-catalog.js');
var localParts = require('./parts/local-parts-catalog.js');
var workshopServiceModule = require('./workshop/workshop-vehicle-service.js');
var observabilityModule = require('./observability.js');
var writes = require('./writes.js');
var identity = require('./identity.js');

var WEB_ROOT = path.join(__dirname, '..', 'web');

// The atelier page: same origin, same static discipline as /admin (a map, no
// path concatenation), but with the citizen CSP because it runs the
// WebAssembly OCR engine. The admin CSP is untouched.
var ATELIER_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";
var ATELIER_ASSETS = {
  '/atelier': { file: 'atelier.html', contentType: 'text/html; charset=utf-8' },
  '/atelier/': { file: 'atelier.html', contentType: 'text/html; charset=utf-8' },
  '/atelier/atelier-ui.js': { file: 'atelier-ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/atelier/atelier.css': { file: 'atelier.css', contentType: 'text/css; charset=utf-8' },
  '/atelier/assets/tokens.css': { root: WEB_ROOT, file: 'design-system/tokens/tokens.css', contentType: 'text/css; charset=utf-8' },
  '/atelier/assets/base.css': { root: WEB_ROOT, file: 'design-system/css/base.css', contentType: 'text/css; charset=utf-8' },
  '/atelier/assets/components.css': { root: WEB_ROOT, file: 'design-system/css/components.css', contentType: 'text/css; charset=utf-8' },
  '/atelier/assets/ui.js': { root: WEB_ROOT, file: 'design-system/js/ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/atelier/assets/plate.js': { root: WEB_ROOT, file: 'design-system/js/plate.js', contentType: 'application/javascript; charset=utf-8' },
  '/atelier/assets/plate-scanner.js': { root: WEB_ROOT, file: 'citizen/plate-scanner.js', contentType: 'application/javascript; charset=utf-8' },
  '/atelier/assets/favicon.svg': { root: WEB_ROOT, file: 'citizen/favicon.svg', contentType: 'image/svg+xml' }
};
// The OCR engine files are the same vendored files the citizen page uses;
// plate-scanner.js loads them from /assets/tesseract/, which api.js serves
// only in the PUBLIC phase. The atelier page passes its own engine base so
// it works in either phase. Each path is listed explicitly.
['tesseract.min.js', 'worker.min.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm', 'eng.traineddata.gz'].forEach(function (f) {
  var ct = /\.wasm$/.test(f) ? 'application/wasm' : /\.gz$/.test(f) ? 'application/octet-stream' : 'application/javascript; charset=utf-8';
  ATELIER_ASSETS['/atelier/assets/tesseract/' + f] = { root: WEB_ROOT, file: 'vendor/tesseract/' + f, contentType: ct };
});

function createV12(ctx) {
  var sendJson = ctx.sendJson, readJsonBody = ctx.readJsonBody, requireScope = ctx.requireScope, decode = ctx.decodePathSegment;
  var obs = ctx.observability || observabilityModule.shared();
  var resolver = ctx.resolver || vehicleResolverModule.createVehicleResolver({ observability: obs });
  var catalog = ctx.catalog || partsCatalogModule.createPartsCatalog();
  var workshop = ctx.workshop || workshopServiceModule.createWorkshopVehicleService({ resolver: resolver, catalog: catalog });

  function actorOf(req) { return { identity: req.mythosIdentity, principal: req.principal }; }
  function orgOf(req) { return req.principal && req.principal.kind === 'organisation' ? req.principal.org_id : null; }
  function canSeeVin(req) { return identity.principalHasScope(req.principal, 'vin:search'); }
  function query(req) { return require('url').parse(req.url, true).query || {}; }
  function intParam(v) { var n = parseInt(v, 10); if (!isFinite(n) || n < 1) throw errors.IdautoError('NOT_FOUND'); return n; }

  function guard(fn) {
    return function (req, res, m) {
      return Promise.resolve().then(function () { return fn(req, res, m); }).catch(function (err) {
        if (res.headersSent) { req.socket.destroy(); return; }
        var mapped;
        if (err && err.isIdautoError) mapped = errors.toResponse(err);
        else if (err && err.httpStatus) mapped = errors.toResponse(err);
        else if (err && typeof err.code === 'string' && err.code.length === 5) { var m2 = writes.mapDbError(err); mapped = { status: m2.status, body: { error: 'database', message_fr: m2.status === 409 ? errors.CATALOG.CONFLICT.fr : 'Une erreur interne est survenue. Réessayez dans un instant.' } }; }
        else mapped = errors.toResponse(err);
        if (mapped.status >= 500) obs.event('route_error', { path: req.url.split('?')[0], code: (err && err.code) || 'unknown' });
        sendJson(res, mapped.status, mapped.body);
      });
    };
  }

  // Serves the atelier page and its assets. Called before requireAuth() —
  // static shells only; every data call the page makes carries a Bearer.
  function serveAtelierAsset(req, res, pathname) {
    var asset = ATELIER_ASSETS[pathname];
    if (!asset || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    fs.readFile(path.join(asset.root || __dirname, asset.file), function (err, content) {
      if (err) return sendJson(res, 500, { error: 'atelier UI unavailable' });
      res.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': ATELIER_CSP, 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
    return true;
  }

  /* ---------------- identification ---------------- */
  async function postResolvePlate(req, res) {
    var body = await readJsonBody(req);
    if (!body.plate) throw errors.IdautoError('INVALID_PLATE', { reason: 'empty' });
    var result = await resolver.resolveByPlate(String(body.plate), {
      confidence: body.ocr_confidence, registrationType: body.registration_type, confirmed: !!body.confirmed,
      method: body.method === 'camera_ocr' ? 'camera_ocr' : 'manual', includeVin: canSeeVin(req)
    });
    sendJson(res, 200, result);
  }
  async function postResolveVin(req, res) {
    if (!requireScope(req, res, 'vin:search')) return;
    var body = await readJsonBody(req);
    if (!body.vin) throw errors.IdautoError('INVALID_VIN', { reason: 'empty' });
    var result = await resolver.resolveByVIN(String(body.vin), { includeVin: true });
    // Same rule as the search criterion: audited before disclosure, fails closed.
    await writes.recordVinSearchAudit(req.principal, req.mythosIdentity, result.vin.vin, result.vehicle ? result.vehicle.id : null);
    sendJson(res, 200, result);
  }
  async function postResolveManual(req, res) {
    var body = await readJsonBody(req);
    sendJson(res, 200, await resolver.resolveByManualSelection(body, { includeVin: canSeeVin(req) }));
  }
  async function postResolveConfirm(req, res) {
    var body = await readJsonBody(req);
    var vehicle = await resolver.confirm(Object.assign({}, body, { includeVin: canSeeVin(req) }), actorOf(req));
    sendJson(res, 200, { status: 'confirmed', vehicle: vehicle });
  }
  async function getFiche(req, res, m) {
    var ref = decode(m[1]);
    var includeVin = canSeeVin(req);
    var fiche = await workshop.fiche(ref, { includeVin: includeVin });
    if (includeVin && fiche.vin) await writes.recordVinDisclosureAudit(req.principal, req.mythosIdentity, fiche.id);
    sendJson(res, 200, fiche);
  }
  async function getHistory(req, res, m) {
    var row = await vehicleRepository.findByRef(decode(m[1]));
    if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
    sendJson(res, 200, { vehicle: row.ivid, history: await vehicleRepository.history(row.id) });
  }
  async function postRefresh(req, res, m) {
    sendJson(res, 200, await resolver.refresh(decode(m[1]), { includeVin: canSeeVin(req) }));
  }
  async function getProviders(req, res) {
    sendJson(res, 200, { vehicle_providers: [{ name: 'local', kind: 'local' }].concat(resolver.providers()), catalogue: catalog.status(), cache: resolver.cache.snapshot() });
  }
  async function getMetrics(req, res) {
    sendJson(res, 200, obs.snapshot({ cache: resolver.cache.snapshot() }));
  }

  /* ---------------- catalogue / parts ---------------- */
  async function getCatalogStatus(req, res) { sendJson(res, 200, catalog.status()); }
  function tecdocProxy(fn) {
    return async function (req, res, m) {
      var t = catalog.tecdoc();
      if (!t || !t.isConfigured()) throw errors.IdautoError('CATALOG_NOT_CONFIGURED');
      sendJson(res, 200, { items: await fn(t, req, m) });
    };
  }
  async function getVehicleParts(req, res, m) {
    var row = await vehicleRepository.findByRef(decode(m[1]));
    if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
    var vehicle = await vehicleRepository.record(row); vehicle.local_id = row.id;
    var q = query(req);
    sendJson(res, 200, Object.assign({ vehicle: { id: vehicle.id, manufacturer: vehicle.manufacturer, model: vehicle.model, motorisation: vehicle.motorisation, tecdoc_car_id: vehicle.tecdoc_car_id } },
      await catalog.getCompatibleParts(vehicle, { orgId: orgOf(req) || (q.org_id ? intParam(q.org_id) : null), category: q.category ? String(q.category).slice(0, 80) : null })));
  }
  async function getPartsSearch(req, res) {
    var q = query(req);
    if (!q.q) throw errors.IdautoError('VALIDATION', { required: ['q'] });
    sendJson(res, 200, await catalog.searchParts(String(q.q), { orgId: orgOf(req) || (q.org_id ? intParam(q.org_id) : null) }));
  }
  async function getPart(req, res, m) {
    var q = query(req);
    sendJson(res, 200, await catalog.getPartDetails(decode(m[1]), { orgId: orgOf(req) || (q.org_id ? intParam(q.org_id) : null) }));
  }
  async function postPart(req, res) { sendJson(res, 201, await localParts.createPart(await readJsonBody(req), actorOf(req))); }
  async function postPartCompatibility(req, res, m) { sendJson(res, 201, await localParts.addCompatibility(intParam(decode(m[1])), await readJsonBody(req), actorOf(req))); }
  async function putPartStock(req, res, m) { sendJson(res, 200, await localParts.setStock(intParam(decode(m[1])), await readJsonBody(req), actorOf(req))); }

  /* ---------------- workshop ---------------- */
  async function postVisit(req, res) {
    var body = await readJsonBody(req);
    var out = await workshop.arrive(body, actorOf(req), { includeVin: canSeeVin(req) });
    sendJson(res, 201, out);
  }
  async function getVisits(req, res) {
    var q = query(req);
    var orgId = orgOf(req) || (q.org_id ? intParam(q.org_id) : null);
    if (!orgId) throw errors.IdautoError('VALIDATION', { required: ['org_id (admin)'] });
    var vehicleId = null;
    if (q.vehicle_ref) { var row = await vehicleRepository.findByRef(String(q.vehicle_ref)); if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND'); vehicleId = row.id; }
    sendJson(res, 200, { visits: await workshop.listVisits(orgId, { vehicleId: vehicleId, status: q.status ? String(q.status) : null }) });
  }
  async function getVisit(req, res, m) {
    var q = query(req);
    var orgId = orgOf(req) || (q.org_id ? intParam(q.org_id) : null);
    if (!orgId) throw errors.IdautoError('VALIDATION', { required: ['org_id (admin)'] });
    var v = await workshop.getVisit(intParam(decode(m[1])), orgId);
    if (!v) throw errors.IdautoError('NOT_FOUND');
    sendJson(res, 200, v);
  }
  async function postVisitIdentification(req, res, m) {
    if (!requireScope(req, res, 'vehicle:write')) return;
    var body = await readJsonBody(req);
    sendJson(res, 200, await workshop.confirmIdentification(intParam(decode(m[1])), Object.assign({}, body, { includeVin: canSeeVin(req) }), actorOf(req)));
  }
  async function getVisitParts(req, res, m) {
    var q = query(req);
    sendJson(res, 200, await workshop.partsForVisit(intParam(decode(m[1])), actorOf(req), { org_id: q.org_id, category: q.category ? String(q.category).slice(0, 80) : null }));
  }
  async function postOperation(req, res, m) { sendJson(res, 201, await workshop.addOperation(intParam(decode(m[1])), await readJsonBody(req), actorOf(req))); }
  async function postOperationStatus(req, res, m) { var b = await readJsonBody(req); sendJson(res, 200, await workshop.setOperationStatus(intParam(decode(m[1])), intParam(decode(m[2])), b.status, actorOf(req), b)); }
  async function postVisitClose(req, res, m) { sendJson(res, 200, await workshop.closeVisit(intParam(decode(m[1])), actorOf(req), await readJsonBody(req), false)); }
  async function postVisitCancel(req, res, m) { sendJson(res, 200, await workshop.closeVisit(intParam(decode(m[1])), actorOf(req), await readJsonBody(req), true)); }
  async function postOrder(req, res) { sendJson(res, 201, await workshop.createOrder(await readJsonBody(req), actorOf(req))); }
  async function getOrder(req, res, m) {
    var q = query(req);
    var orgId = orgOf(req) || (q.org_id ? intParam(q.org_id) : null);
    if (!orgId) throw errors.IdautoError('VALIDATION', { required: ['org_id (admin)'] });
    var o = await workshop.getOrder(intParam(decode(m[1])), orgId);
    if (!o) throw errors.IdautoError('NOT_FOUND');
    sendJson(res, 200, o);
  }
  async function postOrderStatus(req, res, m) { var b = await readJsonBody(req); sendJson(res, 200, await workshop.setOrderStatus(intParam(decode(m[1])), b.status, actorOf(req), b)); }

  var scopes = [
    { method: 'POST', pattern: /^\/api\/resolve\/plate$/,   scope: 'vehicle:resolve' },
    { method: 'POST', pattern: /^\/api\/resolve\/vin$/,     scope: 'vehicle:resolve' },
    { method: 'POST', pattern: /^\/api\/resolve\/manual$/,  scope: 'vehicle:resolve' },
    { method: 'POST', pattern: /^\/api\/resolve\/confirm$/, scope: 'vehicle:write' },
    { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+\/fiche$/,                  scope: 'vehicle:read' },
    { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+\/identification\/history$/, scope: 'vehicle:read' },
    { method: 'POST', pattern: /^\/api\/vehicles\/[^/]+\/identification\/refresh$/, scope: 'vehicle:resolve' },
    { method: 'GET',  pattern: /^\/api\/vehicles\/[^/]+\/parts$/, scope: 'parts:read' },
    { method: 'GET',  pattern: /^\/api\/catalog\/[^/]+(\/[^/]+)*$/, scope: 'parts:read' },
    { method: 'GET',  pattern: /^\/api\/parts\/search$/,      scope: 'parts:read' },
    { method: 'GET',  pattern: /^\/api\/parts\/[^/]+$/,       scope: 'parts:read' },
    { method: 'POST', pattern: /^\/api\/parts$/,              scope: 'parts:write' },
    { method: 'POST', pattern: /^\/api\/parts\/[^/]+\/compatibility$/, scope: 'parts:write' },
    { method: 'PUT',  pattern: /^\/api\/parts\/[^/]+\/stock$/, scope: 'stock:write' },
    { method: 'GET',  pattern: /^\/api\/workshop\/.*$/,       scope: 'workshop:read' },
    { method: 'POST', pattern: /^\/api\/workshop\/.*$/,       scope: 'workshop:write' }
  ];

  var routes = [
    { method: 'POST', pattern: /^\/api\/resolve\/plate$/, handler: guard(postResolvePlate) },
    { method: 'POST', pattern: /^\/api\/resolve\/vin$/, handler: guard(postResolveVin) },
    { method: 'POST', pattern: /^\/api\/resolve\/manual$/, handler: guard(postResolveManual) },
    { method: 'POST', pattern: /^\/api\/resolve\/confirm$/, handler: guard(postResolveConfirm) },
    { method: 'GET', pattern: /^\/api\/resolution\/providers$/, handler: guard(getProviders) },
    { method: 'GET', pattern: /^\/api\/metrics$/, handler: guard(getMetrics) },
    { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/fiche$/, handler: guard(getFiche) },
    { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/identification\/history$/, handler: guard(getHistory) },
    { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/identification\/refresh$/, handler: guard(postRefresh) },
    { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/parts$/, handler: guard(getVehicleParts) },
    { method: 'GET', pattern: /^\/api\/catalog\/status$/, handler: guard(getCatalogStatus) },
    { method: 'GET', pattern: /^\/api\/catalog\/manufacturers$/, handler: guard(tecdocProxy(function (t) { return t.getManufacturers(); })) },
    { method: 'GET', pattern: /^\/api\/catalog\/manufacturers\/([^/]+)\/models$/, handler: guard(tecdocProxy(function (t, req, m) { return t.getModels(decode(m[1])); })) },
    { method: 'GET', pattern: /^\/api\/catalog\/models\/([^/]+)\/vehicles$/, handler: guard(tecdocProxy(function (t, req, m) { return t.getSubmodels(decode(m[1])); })) },
    { method: 'GET', pattern: /^\/api\/catalog\/vehicles\/([^/]+)$/, handler: guard(tecdocProxy(function (t, req, m) { return t.getVehicleDetails(decode(m[1])); })) },
    { method: 'GET', pattern: /^\/api\/parts\/search$/, handler: guard(getPartsSearch) },
    { method: 'GET', pattern: /^\/api\/parts\/([^/]+)$/, handler: guard(getPart) },
    { method: 'POST', pattern: /^\/api\/parts$/, handler: guard(postPart) },
    { method: 'POST', pattern: /^\/api\/parts\/([^/]+)\/compatibility$/, handler: guard(postPartCompatibility) },
    { method: 'PUT', pattern: /^\/api\/parts\/([^/]+)\/stock$/, handler: guard(putPartStock) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits$/, handler: guard(postVisit) },
    { method: 'GET', pattern: /^\/api\/workshop\/visits$/, handler: guard(getVisits) },
    { method: 'GET', pattern: /^\/api\/workshop\/visits\/([^/]+)$/, handler: guard(getVisit) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits\/([^/]+)\/identification$/, handler: guard(postVisitIdentification) },
    { method: 'GET', pattern: /^\/api\/workshop\/visits\/([^/]+)\/parts$/, handler: guard(getVisitParts) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits\/([^/]+)\/operations$/, handler: guard(postOperation) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits\/([^/]+)\/operations\/([^/]+)\/status$/, handler: guard(postOperationStatus) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits\/([^/]+)\/close$/, handler: guard(postVisitClose) },
    { method: 'POST', pattern: /^\/api\/workshop\/visits\/([^/]+)\/cancel$/, handler: guard(postVisitCancel) },
    { method: 'POST', pattern: /^\/api\/workshop\/orders$/, handler: guard(postOrder) },
    { method: 'GET', pattern: /^\/api\/workshop\/orders\/([^/]+)$/, handler: guard(getOrder) },
    { method: 'POST', pattern: /^\/api\/workshop\/orders\/([^/]+)\/status$/, handler: guard(postOrderStatus) }
  ];

  return { routes: routes, scopes: scopes, serveAtelierAsset: serveAtelierAsset, resolver: resolver, catalog: catalog, workshop: workshop, observability: obs };
}

module.exports = { createV12: createV12, ATELIER_ASSETS: ATELIER_ASSETS, ATELIER_CSP: ATELIER_CSP };
