'use strict';
// =====================================================
// IDauto — IDA-V12 — PartsCatalog
// reference/parts/parts-catalog.js
//
// What the frontend and the workshop service call. It merges the LOCAL
// catalogue (always present) with the TecDoc adapter (when configured), and
// labels every item with its `source` so nothing local is ever presented as
// supplier data, and nothing from a mock is ever presented as either.
//
//   status()                             → { local: true, supplier: <adapter.status()> }
//   getCompatibleParts(vehicle, opts)    → { parts: [...], sources: {...}, supplier_error? }
//   searchParts(query, opts)             → same
//   getPartDetails(id, opts)             → 'local:<n>' | 'tecdoc:<articleId>'
//
// A supplier failure never hides local results: it is reported beside them.
// =====================================================

var local = require('./local-parts-catalog.js');
var tecdocModule = require('./tecdoc-adapter.js');
var errors = require('../vehicle/errors.js');

function createPartsCatalog(deps) {
  deps = deps || {};
  var tecdoc = deps.tecdoc !== undefined ? deps.tecdoc : tecdocModule.createTecDocAdapter();
  var localCatalog = deps.local || local;

  function supplierStatus() { return tecdoc ? tecdoc.status() : { configured: false, provider: null, message_fr: tecdocModule.NOT_CONFIGURED_FR }; }

  async function supplier(fn) {
    if (!tecdoc || !tecdoc.isConfigured()) return { items: [], error: 'CATALOG_NOT_CONFIGURED', message_fr: tecdocModule.NOT_CONFIGURED_FR };
    try { return { items: await fn(tecdoc), error: null }; }
    catch (err) {
      var typed = err && err.isIdautoError ? err : errors.IdautoError('CATALOG_UNAVAILABLE');
      return { items: [], error: typed.code, message_fr: typed.message_fr };
    }
  }

  async function getCompatibleParts(vehicle, opts) {
    opts = opts || {};
    var localParts = await localCatalog.getCompatibleParts(vehicle, opts);
    var sup = vehicle.tecdoc_car_id ? await supplier(function (t) { return t.getCompatibleParts(vehicle.tecdoc_car_id, opts); }) : { items: [], error: tecdoc && tecdoc.isConfigured() ? 'NO_TECDOC_CAR_ID' : 'CATALOG_NOT_CONFIGURED', message_fr: tecdoc && tecdoc.isConfigured() ? 'Ce véhicule n\'a pas encore d\'identifiant catalogue.' : tecdocModule.NOT_CONFIGURED_FR };
    return { parts: localParts.concat(sup.items), sources: { local: localParts.length, supplier: sup.items.length }, supplier: { status: supplierStatus(), error: sup.error, message_fr: sup.message_fr || null } };
  }

  async function searchParts(query, opts) {
    opts = opts || {};
    var localParts = await localCatalog.searchParts(query, opts);
    var sup = await supplier(function (t) { return t.searchParts(query); });
    return { parts: localParts.concat(sup.items), sources: { local: localParts.length, supplier: sup.items.length }, supplier: { status: supplierStatus(), error: sup.error, message_fr: sup.message_fr || null } };
  }

  async function getPartDetails(id, opts) {
    var m = /^(local|tecdoc):(.+)$/.exec(String(id || ''));
    if (!m) throw errors.IdautoError('NOT_FOUND');
    if (m[1] === 'local') {
      var n = parseInt(m[2], 10);
      if (!isFinite(n)) throw errors.IdautoError('NOT_FOUND');
      var p = await localCatalog.getPartDetails(n, opts);
      if (!p) throw errors.IdautoError('NOT_FOUND');
      return p;
    }
    if (!tecdoc || !tecdoc.isConfigured()) throw errors.IdautoError('CATALOG_NOT_CONFIGURED');
    var d = await tecdoc.getPartDetails(m[2]);
    if (!d) throw errors.IdautoError('NOT_FOUND');
    return d;
  }

  return {
    status: function () { return { local: true, supplier: supplierStatus() }; },
    getCompatibleParts: getCompatibleParts, searchParts: searchParts, getPartDetails: getPartDetails,
    tecdoc: function () { return tecdoc; },
    // TEST HOOK. Swaps the supplier adapter (e.g. for the mock). Refused in
    // production for the same reason as the resolver's setProviders().
    setTecDoc: function (adapter) {
      if (process.env.NODE_ENV === 'production') throw new Error('setTecDoc is a test hook');
      tecdoc = adapter;
    }
  };
}

module.exports = { createPartsCatalog: createPartsCatalog };
