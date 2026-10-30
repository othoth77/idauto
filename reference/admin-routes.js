'use strict';
// =====================================================
// IDauto — IDA-ADMIN-1 — operator console read routes
// reference/admin-routes.js
//
//   GET /api/admin/overview                  counts for the console dashboard
//   GET /api/admin/vehicles                  the registry: filtered, sorted, paged
//   GET /api/admin/vehicles/:ref/dossier     one identity and everything recorded against it
//   GET /api/admin/maintenance               workshop visits / service events, every organisation
//   GET /api/admin/organisations             ateliers: identity, status, accounts, integration, activity
//   GET /api/admin/sources                   capture sources, identification providers, parts catalogue
//   GET /api/admin/quality                   data quality: identities with an open issue, review backlog
//
// ADMIN ONLY, TWICE. These routes are in no scope table (api.js ROUTE_SCOPES,
// v12/v14 scopes), so api.js answers 403 to every organisation credential —
// manager, technician or service — before a handler runs; that is the
// documented default for a route absent from the table. Each handler then
// checks the admin scope itself, so a future edit to the central gate cannot
// silently open them. The owner cookie of IDA-V1B reaches none of them: it is
// honoured only on its two read routes (api.js OWNER_SESSION_ROUTES).
//
// READ ONLY. No route here writes anything. Mutations the console offers are
// the existing audited endpoints (review decisions, merge/split, VIN
// disclosure through the fiche) — never a new write path.
// =====================================================

var identity = require('./identity.js');
var vehicleRepository = require('./vehicle/vehicle-repository.js');
var adminRepository = require('./admin/admin-repository.js');

function createAdminRoutes(ctx) {
  var sendJson = ctx.sendJson, decode = ctx.decodePathSegment;
  var resolver = ctx.resolver, catalog = ctx.catalog;

  function isAdmin(req) { return !!(req.principal && identity.principalHasScope(req.principal, identity.ADMIN_SCOPE)); }
  function query(req) { return require('url').parse(req.url, true).query || {}; }

  function adminOnly(fn) {
    return function (req, res, m) {
      if (!isAdmin(req)) {
        return sendJson(res, 403, { error: 'forbidden — the operator console is reserved to administrators', message_fr: 'Accès réservé aux administrateurs.' });
      }
      return Promise.resolve().then(function () { return fn(req, res, m); }).catch(function (err) {
        if (res.headersSent) { req.socket.destroy(); return; }
        if (err && err.httpStatus === 400) {
          return sendJson(res, 400, { error: err.message, details: err.details, message_fr: 'Filtre invalide : ' + err.message });
        }
        throw err;   // api.js maps anything else to a safe status, never the driver message
      });
    };
  }

  async function getOverview(req, res) {
    var out = await adminRepository.overview();
    var providers = resolver ? resolver.providers() : [];
    var supplier = catalog ? catalog.status().supplier : null;
    out.health = {
      database: 'ok',   // overview() above ran its queries; a failure never reaches this line
      vehicle_providers_configured: providers.length,
      parts_supplier_configured: !!(supplier && supplier.configured)
    };
    out.generated_at = new Date().toISOString();
    sendJson(res, 200, out);
  }

  async function getVehicles(req, res) {
    var filter = adminRepository.parseRegistryQuery(query(req));
    sendJson(res, 200, await adminRepository.listVehicles(filter));
  }

  async function getDossier(req, res, m) {
    var ref = decode(m[1]);
    if (typeof ref !== 'string' || !ref || ref.length > 64 || ref.indexOf('\u0000') !== -1) {
      return sendJson(res, 404, { error: 'VEHICLE_NOT_FOUND', message_fr: 'Véhicule introuvable.' });
    }
    var row = await vehicleRepository.findByRef(ref);   // follows merges to the canonical record
    if (!row) return sendJson(res, 404, { error: 'VEHICLE_NOT_FOUND', message_fr: 'Véhicule introuvable.' });
    var record = await vehicleRepository.record(row, { includeVin: false });
    var out = await adminRepository.dossier(row, record);
    if (ref !== row.ivid && ref !== row.internal_ref) out.requested_alias = ref;
    sendJson(res, 200, out);
  }

  // IDA-ADMIN-2 — maintenance history across every organisation.
  async function getMaintenance(req, res) {
    var filter = adminRepository.parseMaintenanceQuery(query(req));
    sendJson(res, 200, await adminRepository.listMaintenance(filter));
  }

  // IDA-ADMIN-3 — ateliers (organisations) and data sources.
  async function getOrganisations(req, res) {
    var filter = adminRepository.parseOrganisationQuery(query(req));
    sendJson(res, 200, await adminRepository.listOrganisations(filter, identity.credentialSummary()));
  }
  async function getSources(req, res) {
    var cred = identity.credentialSummary();
    var supplier = catalog ? catalog.status().supplier : null;
    sendJson(res, 200, {
      capture_sources: await adminRepository.dataSources(),
      vehicle_providers: [{ name: 'local', kind: 'local' }].concat(resolver ? resolver.providers() : []),
      parts_catalogue: { local: true, supplier: supplier ? { configured: !!supplier.configured, provider: supplier.provider || null, message_fr: supplier.message_fr || null } : null },
      service_credentials: { admin_credentials: cred.admin_credentials, organisation_credentials: cred.organisations.reduce(function (n, o) { return n + o.credentials; }, 0),
        organisations: cred.organisations.length, invalid_entries: cred.invalid_entries }
    });
  }

  // IDA-ADMIN-4 — data quality. Decisions stay on the existing audited review
  // routes (/api/review/*); this route only reports.
  async function getQuality(req, res) {
    var filter = adminRepository.parseQualityQuery(query(req));
    sendJson(res, 200, await adminRepository.qualityReport(filter));
  }

  var routes = [
    { method: 'GET', pattern: /^\/api\/admin\/overview$/, handler: adminOnly(getOverview) },
    { method: 'GET', pattern: /^\/api\/admin\/vehicles$/, handler: adminOnly(getVehicles) },
    { method: 'GET', pattern: /^\/api\/admin\/vehicles\/([^/]+)\/dossier$/, handler: adminOnly(getDossier) },
    { method: 'GET', pattern: /^\/api\/admin\/maintenance$/, handler: adminOnly(getMaintenance) },
    { method: 'GET', pattern: /^\/api\/admin\/organisations$/, handler: adminOnly(getOrganisations) },
    { method: 'GET', pattern: /^\/api\/admin\/sources$/, handler: adminOnly(getSources) },
    { method: 'GET', pattern: /^\/api\/admin\/quality$/, handler: adminOnly(getQuality) }
  ];

  return { routes: routes };
}

module.exports = { createAdminRoutes: createAdminRoutes };
