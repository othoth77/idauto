'use strict';
// =====================================================
// IDauto — IDA-UI-3 — workspace API: registration, dossier, owner contact,
// lists, overview, notifications, global search
// reference/workspace-routes.js
//
// Every route below names its scope in `scopes` (the organisation gate in
// api.js refuses an organisation principal without it); routes absent from
// `scopes` are admin-only. Every read is filtered by organisation in SQL
// (workspace/workspace-repository.js); owner contacts are audited on read.
//
//   GET    /api/search?q=                       vehicle:read     grouped: vehicles · owners* · interventions · parts (30/min per account)
//   GET    /api/notifications                   vehicle:read     real counts, each with its page
//   GET    /api/workspace/overview              vehicle:read     dashboard numbers for this account
//   GET    /api/workspace/vehicles?q&page       vehicle:read     this workshop's vehicles (admin: all)
//   POST   /api/vehicles/register               vehicle:write    manual registration (vehicle + plate + VIN + owner, one transaction)
//   GET    /api/vehicles/:ref/dossier           vehicle:read     identity, plates, documents, maintenance history
//   GET    /api/vehicles/:ref/owner             owner:read       the owner's contact — AUDITED
//   PUT    /api/vehicles/:ref/owner             owner:write      record / replace (history kept)
//   DELETE /api/vehicles/:ref/owner             owner:write      remove (superseded, history kept)
//   GET    /api/workspace/documents             document:read    vehicles with carte grise photos
//   GET    /api/workspace/interventions         workshop:read    interventions with their operations and parts
//   GET    /api/workspace/parts-used?source&q&org workshop:read fitted parts, declared source, totals per source
//   GET    /api/workspace/technicians           team:read        the workshop's people (manager, admin)
//   PUT    /api/vehicles/:ref/details           vehicle:write    edit make, model, year, mileage, the workshop's note (IDA-UI-4)
//   DELETE /api/vehicles/:ref                   vehicle:delete   delete = archive a record entered by mistake (kept; refused with interventions)
//   POST   /api/workspace/interventions         workshop:write   record an intervention with its parts, one transaction (IDA-UI-4)
//   PUT    /api/workspace/interventions/:id     workshop:write   edit it (parts: update / cancel / add)
//   DELETE /api/workspace/interventions/:id     workshop:write   cancel it (the record is kept)
//   POST   /api/workspace/scans                 document:write   « Scanner la plaque »: the photograph, saved at capture (Update 3.1) → { scan: { token, … } }
//   GET|PUT /api/workspace/scans/:token          document:write   its state (incl. the Haddad copy) / the analysis, view, location, confirmation
//   POST   /api/workspace/scans/:token/attach   document:write   { vehicle: ivid } → the same file becomes a photograph of that vehicle
//   POST   /api/workspace/scans/:token/vehicle  vehicle:write    the registration form's body → vehicle created (existing rules) and the photograph attached
//   GET    /api/vehicles/:ref/photos            document:read    the vehicle's photographs: view, date, location, analysis (Update 3)
//   POST   /api/vehicles/:ref/photos            document:write   one image (body) + its metadata (header) → stored once, private store
//   PUT    /api/vehicles/:ref/photos/:id        document:write   correct the view, the location, the confirmation
//   DELETE /api/vehicles/:ref/photos/:id        document:delete
//   GET    /api/vehicles/:ref/photos/:id/image  document:read    the bytes, to a signed-in account of the owning workshop
//   GET    /api/workspace/geo/tn                vehicle:read     governorates and delegations (manual location)
//   GET    /api/workspace/geo/resolve?lat&lon   vehicle:read     offline: nearest known place and governorate (approximate)
//   GET    /api/workspace/vehicle-recognition   vehicle:write    is the vehicle analysis configured? (Update 2)
//   POST   /api/workspace/vehicle-recognition   vehicle:write    one JPEG → make, model, colour, body type seen by the vision model (12/min per account; not stored)
//   GET    /api/admin/roles                     admin            the role → scope matrix the server applies
// =====================================================

var errors = require('./vehicle/errors.js');
var db = require('./db.js');
var rateLimit = require('./rate-limit.js');
var principalModule = require('./auth/principal.js');
var repo = require('./workspace/workspace-repository.js');
var registration = require('./workspace/registration-service.js');
var owners = require('./workspace/owner-contacts.js');
var details = require('./workspace/vehicle-details.js');
var interventions = require('./workspace/intervention-service.js');
var vision = require('./recognition/vehicle-vision.js');
var photos = require('./photos/photo-service.js');
var scans = require('./photos/scan-service.js');
var geo = require('./photos/tn-geo.js');
var writes = require('./writes.js');

var SEARCH_LIMIT = { limit: 30, window_seconds: 60 };
var VISION_LIMIT = { limit: 12, window_seconds: 60 };
var PHOTO_LIMIT = { limit: 60, window_seconds: 600 };      // photographs stored per account per 10 minutes     // each analysis is a paid call to the provider

function createWorkspace(ctx) {
  var sendJson = ctx.sendJson, readJsonBody = ctx.readJsonBody, decode = ctx.decodePathSegment, readBinaryBody = ctx.readBinaryBody;
  function actorOf(req) { return { identity: req.mythosIdentity, principal: req.principal }; }
  function query(req) { return new URL(req.url, 'http://x').searchParams; }
  function guard(fn) {
    return function (req, res, m) {
      return Promise.resolve().then(function () { return fn(req, res, m); }).catch(function (err) {
        if (res.headersSent) { req.socket.destroy(); return; }
        var mapped = errors.toResponse(err);
        sendJson(res, mapped.status, mapped.body);
      });
    };
  }
  function isAdmin(req) { return !!(req.principal && req.principal.kind !== 'organisation'); }

  async function getSearch(req, res) {
    var r = await rateLimit.enforcePublicResolution(db, 'search:' + (req.mythosIdentity || 'anonymous'), SEARCH_LIMIT);
    if (!r.allowed) return sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop de recherches : patientez un instant.', retry_at: r.retry_at });
    sendJson(res, 200, await repo.search(query(req).get('q'), actorOf(req)));
  }
  async function getNotifications(req, res) { sendJson(res, 200, await repo.notifications(actorOf(req))); }
  async function getOverview(req, res) { sendJson(res, 200, await repo.overview(actorOf(req))); }
  async function getVehicles(req, res) { var q = query(req); sendJson(res, 200, await repo.listVehicles(actorOf(req), { q: q.get('q'), page: q.get('page')})); }
  async function postRegister(req, res) {
    var actor = actorOf(req);
    // A refused duplicate says whether a plate or VIN exists: rate-limited like the search.
    var rl = await rateLimit.enforcePublicResolution(db, 'register:' + (req.mythosIdentity || 'anonymous'), SEARCH_LIMIT);
    if (!rl.allowed) return sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop de tentatives : patientez un instant.', retry_at: rl.retry_at });
    if (!isAdmin(req) && !(req.principal && req.principal.org_id)) throw errors.IdautoError('FORBIDDEN');
    sendJson(res, 201, await registration.register(await readJsonBody(req), actor));
  }
  // Update 2 — vehicle visual recognition. The page sends ONE JPEG of the frame it captured; the answer is
  // what a vision model sees (make, model, colour, body type), each value marked `source: 'vision'`.
  // Off unless the operator configured a provider (recognition/vehicle-vision.js): then every field is
  // unknown and nothing leaves this server. The photo is never stored; the audit row carries no image.
  async function getRecognitionStatus(req, res) { var c = vision.config(); sendJson(res, 200, { vehicle_analysis: { enabled: c.enabled, provider: c.enabled ? c.provider : null } }); }
  async function postRecognition(req, res) {
    var actor = actorOf(req);
    if (!isAdmin(req) && !(req.principal && req.principal.org_id)) throw errors.IdautoError('FORBIDDEN');
    var rl = await rateLimit.enforcePublicResolution(db, 'vision:' + (req.mythosIdentity || 'anonymous'), VISION_LIMIT);
    if (!rl.allowed) return sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop d\'analyses : patientez un instant.', retry_at: rl.retry_at });
    if (!/^image\/jpeg\b/i.test(String(req.headers['content-type'] || ''))) return sendJson(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE', message_fr: 'Une image JPEG est attendue.' });
    var declared = Number(req.headers['content-length'] || 0);
    if (declared > vision.MAX_IMAGE_BYTES) return sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE', message_fr: 'Image trop volumineuse.' });
    var bytes = await readBinaryBody(req);
    if (bytes.length > vision.MAX_IMAGE_BYTES || !vision.isJpeg(bytes)) return sendJson(res, 400, { error: 'INVALID_IMAGE', message_fr: 'L\'image n\'a pas pu être lue.' });
    var out = await vision.analyse(bytes);
    if (out.enabled) await writes.withAudit({ principal: actor.principal, event_type: 'vehicle.recognition.vision', target_type: 'idauto_vehicles',
      change_summary: 'Vehicle photo analysed by ' + out.provider + (out.error ? ' — ' + out.error : '') + ' (' + bytes.length + ' bytes, not stored)' }, actor.identity, async function () { return { record: { bytes: bytes.length, stored: false, provider: out.provider, model: out.model || null, error: out.error || null }, auditTargetRef: 'vehicle-photo' }; });
    sendJson(res, 200, { vehicle_analysis: out });
  }
  // Update 3 — vehicle photographs (reference/photos/photo-service.js). The image is the request body; what the
  // page knows about it (view, capture date, location and its source, what was recognised) travels in one header,
  // base64url JSON, and is rebuilt field by field by the service. Images are served to signed-in accounts only.
  function photoMeta(req) {
    var h = req.headers['x-idauto-photo-meta'];
    if (typeof h !== 'string' || !h || h.length > 12000) return {};
    try { return JSON.parse(Buffer.from(h, 'base64url').toString('utf8')); } catch (e) { return {}; }
  }
  // Update 3.1 — « Scanner la plaque » for a signed-in workshop: the photograph is saved when it is taken
  // (photos/scan-service.js), then analysed, then saved as a vehicle or attached to an existing one.
  async function postScan(req, res) {
    var rl = await rateLimit.enforcePublicResolution(db, 'scan:' + (req.mythosIdentity || 'anonymous'), PHOTO_LIMIT);
    if (!rl.allowed) return sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop d\'envois en peu de temps. Patientez quelques minutes.', retry_at: rl.retry_at });
    sendJson(res, 201, { scan: await scans.create(await readBinaryBody(req), photoMeta(req), actorOf(req)) });
  }
  async function getScan(req, res, m) { sendJson(res, 200, { scan: await scans.get(m[1], actorOf(req)) }); }
  async function putScan(req, res, m) { sendJson(res, 200, { scan: await scans.update(m[1], await readJsonBody(req), actorOf(req)) }); }
  async function postScanAttach(req, res, m) { var b = await readJsonBody(req); sendJson(res, 200, await scans.attach(m[1], b.vehicle, actorOf(req))); }
  async function postScanVehicle(req, res, m) {
    var actor = actorOf(req);
    if (!isAdmin(req) && !(req.principal && req.principal.org_id)) throw errors.IdautoError('FORBIDDEN');
    var created = await registration.register(await readJsonBody(req), actor);      // the existing registration: one vehicle per plate (409 otherwise)
    var att = await scans.attach(m[1], created.ivid, actor);
    sendJson(res, 201, { ivid: created.ivid, plate: created.plate, attached: att.attached });
  }
  async function getPhotos(req, res, m) { sendJson(res, 200, await photos.list(decode(m[1]), actorOf(req))); }
  async function postPhoto(req, res, m) {
    var rl = await rateLimit.enforcePublicResolution(db, 'photo:' + (req.mythosIdentity || 'anonymous'), PHOTO_LIMIT);
    if (!rl.allowed) return sendJson(res, 429, { error: 'RATE_LIMITED', message_fr: 'Trop d\'envois en peu de temps. Patientez quelques minutes.', retry_at: rl.retry_at });
    var out = await photos.add(decode(m[1]), await readBinaryBody(req), photoMeta(req), actorOf(req));
    sendJson(res, out.duplicate ? 200 : 201, out);
  }
  async function putPhoto(req, res, m) { sendJson(res, 200, await photos.update(decode(m[1]), m[2], await readJsonBody(req), actorOf(req))); }
  async function deletePhoto(req, res, m) { sendJson(res, 200, await photos.remove(decode(m[1]), m[2], actorOf(req))); }
  async function getPhotoImage(req, res, m) {
    var out = await photos.image(decode(m[1]), m[2], actorOf(req));
    res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'ETag': '"' + out.sha256.slice(0, 32) + '"' });
    res.end(out.bytes);
  }
  // Tunisia's governorates and delegations (manual location), and the offline answer for a GPS position.
  async function getGeo(req, res) { sendJson(res, 200, { country: 'Tunisie', governorates: geo.governorates() }); }
  async function getGeoResolve(req, res) {
    var q = query(req), lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (!geo.validCoords(lat, lon)) return sendJson(res, 400, { error: 'VALIDATION', message_fr: 'Coordonnées invalides.' });
    sendJson(res, 200, { latitude: lat, longitude: lon, resolved: geo.resolve(lat, lon) });
  }
  async function getDossier(req, res, m) { sendJson(res, 200, await repo.dossier(decode(m[1]), actorOf(req))); }
  async function getOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, { vehicle: v.ivid, contacts: await owners.current(v, actorOf(req), 'dossier') }); }
  async function putOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, await owners.put(v, await readJsonBody(req), actorOf(req))); }
  async function deleteOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, await owners.remove(v, actorOf(req))); }
  async function getDocuments(req, res) { sendJson(res, 200, await repo.listDocuments(actorOf(req), { page: query(req).get('page') })); }
  async function getInterventions(req, res) { var q = query(req); sendJson(res, 200, await repo.listInterventions(actorOf(req), { status: q.get('status'), vehicle: q.get('vehicle'), org_id: q.get('org_id'), id: q.get('id'), q: q.get('q') })); }
  async function getPartsUsed(req, res) { var q = query(req); sendJson(res, 200, await repo.listPartsUsed(actorOf(req), { source: q.get('source'), org_id: q.get('org'), q: q.get('q') })); }
  async function deleteVehicle(req, res, m) { sendJson(res, 200, await details.remove(decode(m[1]), actorOf(req))); }
  async function putDetails(req, res, m) { sendJson(res, 200, await details.update(decode(m[1]), await readJsonBody(req), actorOf(req))); }
  async function postIntervention(req, res) { sendJson(res, 201, await interventions.create(await readJsonBody(req), actorOf(req))); }
  async function putIntervention(req, res, m) { sendJson(res, 200, await interventions.update(decode(m[1]), await readJsonBody(req), actorOf(req))); }
  async function deleteIntervention(req, res, m) { sendJson(res, 200, await interventions.cancel(decode(m[1]), actorOf(req))); }
  async function getTechnicians(req, res) { sendJson(res, 200, await repo.listTechnicians(actorOf(req))); }
  async function getRoles(req, res) {
    if (!isAdmin(req)) throw errors.IdautoError('FORBIDDEN');
    sendJson(res, 200, { roles: [
      { role: 'admin', scopes: ['*'], note: 'every route, every organisation' },
      { role: 'manager', scopes: principalModule.MANAGER_SCOPES.slice() },
      { role: 'technician', scopes: principalModule.TECHNICIAN_SCOPES.slice() }] });
  }

  var VEH = '\\/api\\/vehicles\\/([^/]+)';
  var routes = [
    { method: 'GET', pattern: /^\/api\/search$/, handler: guard(getSearch) },
    { method: 'GET', pattern: /^\/api\/notifications$/, handler: guard(getNotifications) },
    { method: 'GET', pattern: /^\/api\/workspace\/overview$/, handler: guard(getOverview) },
    { method: 'GET', pattern: /^\/api\/workspace\/vehicles$/, handler: guard(getVehicles) },
    { method: 'POST', pattern: /^\/api\/vehicles\/register$/, handler: guard(postRegister) },
    { method: 'GET', pattern: /^\/api\/workspace\/vehicle-recognition$/, handler: guard(getRecognitionStatus) },
    { method: 'POST', pattern: /^\/api\/workspace\/vehicle-recognition$/, handler: guard(postRecognition) },
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/dossier$'), handler: guard(getDossier) },
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/photos$'), handler: guard(getPhotos) },
    { method: 'POST', pattern: /^\/api\/workspace\/scans$/, handler: guard(postScan) },
    { method: 'GET', pattern: /^\/api\/workspace\/scans\/([A-Za-z0-9_-]{32})$/, handler: guard(getScan) },
    { method: 'PUT', pattern: /^\/api\/workspace\/scans\/([A-Za-z0-9_-]{32})$/, handler: guard(putScan) },
    { method: 'POST', pattern: /^\/api\/workspace\/scans\/([A-Za-z0-9_-]{32})\/attach$/, handler: guard(postScanAttach) },
    { method: 'POST', pattern: /^\/api\/workspace\/scans\/([A-Za-z0-9_-]{32})\/vehicle$/, handler: guard(postScanVehicle) },
    { method: 'POST', pattern: new RegExp('^' + VEH + '\\/photos$'), handler: guard(postPhoto) },
    { method: 'PUT', pattern: new RegExp('^' + VEH + '\\/photos\\/(\\d{1,18})$'), handler: guard(putPhoto) },
    { method: 'DELETE', pattern: new RegExp('^' + VEH + '\\/photos\\/(\\d{1,18})$'), handler: guard(deletePhoto) },
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/photos\\/(\\d{1,18})\\/image$'), handler: guard(getPhotoImage) },
    { method: 'GET', pattern: /^\/api\/workspace\/geo\/tn$/, handler: guard(getGeo) },
    { method: 'GET', pattern: /^\/api\/workspace\/geo\/resolve$/, handler: guard(getGeoResolve) },
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(getOwner) },
    { method: 'PUT', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(putOwner) },
    { method: 'DELETE', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(deleteOwner) },
    { method: 'GET', pattern: /^\/api\/workspace\/documents$/, handler: guard(getDocuments) },
    { method: 'GET', pattern: /^\/api\/workspace\/interventions$/, handler: guard(getInterventions) },
    { method: 'GET', pattern: /^\/api\/workspace\/parts-used$/, handler: guard(getPartsUsed) },
    { method: 'GET', pattern: /^\/api\/workspace\/technicians$/, handler: guard(getTechnicians) },
    { method: 'PUT', pattern: new RegExp('^' + VEH + '\\/details$'), handler: guard(putDetails) },
    { method: 'DELETE', pattern: new RegExp('^' + VEH + '$'), handler: guard(deleteVehicle) },
    { method: 'POST', pattern: /^\/api\/workspace\/interventions$/, handler: guard(postIntervention) },
    { method: 'PUT', pattern: /^\/api\/workspace\/interventions\/(\d{1,9})$/, handler: guard(putIntervention) },
    { method: 'DELETE', pattern: /^\/api\/workspace\/interventions\/(\d{1,9})$/, handler: guard(deleteIntervention) },
    { method: 'GET', pattern: /^\/api\/admin\/roles$/, handler: guard(getRoles) }
  ];
  var scopes = [
    { method: 'GET', pattern: /^\/api\/search$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/notifications$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/overview$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/vehicles$/, scope: 'vehicle:read' },
    { method: 'POST', pattern: /^\/api\/vehicles\/register$/, scope: 'vehicle:write' },
    { method: 'GET', pattern: /^\/api\/workspace\/vehicle-recognition$/, scope: 'vehicle:write' },
    { method: 'POST', pattern: /^\/api\/workspace\/vehicle-recognition$/, scope: 'vehicle:write' },
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/dossier$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/photos$/, scope: 'document:read' },
    { method: 'POST', pattern: /^\/api\/workspace\/scans$/, scope: 'document:write' },
    { method: 'GET', pattern: /^\/api\/workspace\/scans\/[A-Za-z0-9_-]{32}$/, scope: 'document:write' },
    { method: 'PUT', pattern: /^\/api\/workspace\/scans\/[A-Za-z0-9_-]{32}$/, scope: 'document:write' },
    { method: 'POST', pattern: /^\/api\/workspace\/scans\/[A-Za-z0-9_-]{32}\/attach$/, scope: 'document:write' },
    { method: 'POST', pattern: /^\/api\/workspace\/scans\/[A-Za-z0-9_-]{32}\/vehicle$/, scope: 'vehicle:write' },
    { method: 'POST', pattern: /^\/api\/vehicles\/[^/]+\/photos$/, scope: 'document:write' },
    { method: 'PUT', pattern: /^\/api\/vehicles\/[^/]+\/photos\/\d{1,18}$/, scope: 'document:write' },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/[^/]+\/photos\/\d{1,18}$/, scope: 'document:delete' },
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/photos\/\d{1,18}\/image$/, scope: 'document:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/geo\/tn$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/geo\/resolve$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:read' },
    { method: 'PUT', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:write' },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:write' },
    { method: 'GET', pattern: /^\/api\/workspace\/documents$/, scope: 'document:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/interventions$/, scope: 'workshop:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/parts-used$/, scope: 'workshop:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/technicians$/, scope: 'team:read' },
    { method: 'PUT', pattern: /^\/api\/vehicles\/[^/]+\/details$/, scope: 'vehicle:write' },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/[^/]+$/, scope: 'vehicle:delete' },
    { method: 'POST', pattern: /^\/api\/workspace\/interventions$/, scope: 'workshop:write' },
    { method: 'PUT', pattern: /^\/api\/workspace\/interventions\/\d{1,9}$/, scope: 'workshop:write' },
    { method: 'DELETE', pattern: /^\/api\/workspace\/interventions\/\d{1,9}$/, scope: 'workshop:write' }
  ];
  return { routes: routes, scopes: scopes };
}

module.exports = { createWorkspace: createWorkspace };
