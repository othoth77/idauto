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
//   POST   /api/workspace/interventions         workshop:write   record an intervention with its parts, one transaction (IDA-UI-4)
//   PUT    /api/workspace/interventions/:id     workshop:write   edit it (parts: update / cancel / add)
//   DELETE /api/workspace/interventions/:id     workshop:write   cancel it (the record is kept)
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

var SEARCH_LIMIT = { limit: 30, window_seconds: 60 };

function createWorkspace(ctx) {
  var sendJson = ctx.sendJson, readJsonBody = ctx.readJsonBody, decode = ctx.decodePathSegment;
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
  async function getDossier(req, res, m) { sendJson(res, 200, await repo.dossier(decode(m[1]), actorOf(req))); }
  async function getOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, { vehicle: v.ivid, contacts: await owners.current(v, actorOf(req), 'dossier') }); }
  async function putOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, await owners.put(v, await readJsonBody(req), actorOf(req))); }
  async function deleteOwner(req, res, m) { var v = await repo.vehicleOr404(decode(m[1])); sendJson(res, 200, await owners.remove(v, actorOf(req))); }
  async function getDocuments(req, res) { sendJson(res, 200, await repo.listDocuments(actorOf(req), { page: query(req).get('page') })); }
  async function getInterventions(req, res) { var q = query(req); sendJson(res, 200, await repo.listInterventions(actorOf(req), { status: q.get('status'), vehicle: q.get('vehicle'), org_id: q.get('org_id'), id: q.get('id'), q: q.get('q') })); }
  async function getPartsUsed(req, res) { var q = query(req); sendJson(res, 200, await repo.listPartsUsed(actorOf(req), { source: q.get('source'), org_id: q.get('org'), q: q.get('q') })); }
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
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/dossier$'), handler: guard(getDossier) },
    { method: 'GET', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(getOwner) },
    { method: 'PUT', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(putOwner) },
    { method: 'DELETE', pattern: new RegExp('^' + VEH + '\\/owner$'), handler: guard(deleteOwner) },
    { method: 'GET', pattern: /^\/api\/workspace\/documents$/, handler: guard(getDocuments) },
    { method: 'GET', pattern: /^\/api\/workspace\/interventions$/, handler: guard(getInterventions) },
    { method: 'GET', pattern: /^\/api\/workspace\/parts-used$/, handler: guard(getPartsUsed) },
    { method: 'GET', pattern: /^\/api\/workspace\/technicians$/, handler: guard(getTechnicians) },
    { method: 'PUT', pattern: new RegExp('^' + VEH + '\\/details$'), handler: guard(putDetails) },
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
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/dossier$/, scope: 'vehicle:read' },
    { method: 'GET', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:read' },
    { method: 'PUT', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:write' },
    { method: 'DELETE', pattern: /^\/api\/vehicles\/[^/]+\/owner$/, scope: 'owner:write' },
    { method: 'GET', pattern: /^\/api\/workspace\/documents$/, scope: 'document:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/interventions$/, scope: 'workshop:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/parts-used$/, scope: 'workshop:read' },
    { method: 'GET', pattern: /^\/api\/workspace\/technicians$/, scope: 'team:read' },
    { method: 'PUT', pattern: /^\/api\/vehicles\/[^/]+\/details$/, scope: 'vehicle:write' },
    { method: 'POST', pattern: /^\/api\/workspace\/interventions$/, scope: 'workshop:write' },
    { method: 'PUT', pattern: /^\/api\/workspace\/interventions\/\d{1,9}$/, scope: 'workshop:write' },
    { method: 'DELETE', pattern: /^\/api\/workspace\/interventions\/\d{1,9}$/, scope: 'workshop:write' }
  ];
  return { routes: routes, scopes: scopes };
}

module.exports = { createWorkspace: createWorkspace };
