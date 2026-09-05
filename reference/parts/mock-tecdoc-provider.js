'use strict';
// =====================================================
// IDauto — IDA-V12 — MockTecDocProvider (TESTS ONLY)
// reference/parts/mock-tecdoc-provider.js
//
// Same interface as TecDocAdapter, answered from fixtures. Refuses to exist
// in production without IDAUTO_ALLOW_MOCK_PROVIDERS=1 and is never picked
// by default. Every part it returns is labelled source:'mock' so a test
// report can never mistake it for catalogue data.
// =====================================================

var errors = require('../vehicle/errors.js');

function createMockTecDocProvider(options) {
  options = options || {};
  if (process.env.NODE_ENV === 'production' && process.env.IDAUTO_ALLOW_MOCK_PROVIDERS !== '1') {
    throw new Error('MockTecDocProvider refused: NODE_ENV=production without IDAUTO_ALLOW_MOCK_PROVIDERS=1');
  }
  var f = options.fixtures || {};
  var manufacturers = f.manufacturers || [];
  var models = f.models || {};       // manufacturerId → [...]
  var submodels = f.submodels || {}; // modelId → [...]
  var vehicles = f.vehicles || {};   // carId → details
  var articles = f.articles || [];   // [{ article_id, reference, brand, oe_reference, category, name, car_ids:[...] }]
  var mode = options.mode || 'ok';
  function fail() { if (mode === 'unavailable') throw errors.IdautoError('CATALOG_UNAVAILABLE', { provider: 'mock' }); }
  function part(a) { return { id: 'tecdoc:' + a.article_id, tecdoc_article_id: a.article_id, reference: a.reference, brand: a.brand, oe_reference: a.oe_reference || null, category: a.category || null, name: a.name || null, source: 'mock', compatibility: a.car_ids || null, attributes: a.attributes || null }; }
  return {
    name: 'mock-tecdoc',
    status: function () { return { configured: true, provider: 'mock-tecdoc', mock: true, message_fr: 'Catalogue de TEST (mock) — aucune donnée fournisseur réelle.' }; },
    isConfigured: function () { return true; },
    setMode: function (m) { mode = m; },
    getManufacturers: async function () { fail(); return manufacturers.slice(); },
    getModels: async function (id) { fail(); return (models[id] || []).slice(); },
    getSubmodels: async function (id) { fail(); return (submodels[id] || []).map(function (v) { return { id: v.car_id || v.id, name: v.name, motorisation: v.motorisation || null, engine_code: v.engine_code || null, kw: v.kw || null, year_from: v.year_from || null, year_to: v.year_to || null }; }); },
    getVehicleDetails: async function (carId) { fail(); return vehicles[carId] ? Object.assign({ car_id: Number(carId) }, vehicles[carId]) : null; },
    getCompatibleParts: async function (carId, opts) { fail(); return articles.filter(function (a) { return (a.car_ids || []).indexOf(Number(carId)) !== -1 && (!opts || !opts.category || a.category === opts.category); }).map(part); },
    searchParts: async function (q) { fail(); var s = String(q).toUpperCase(); return articles.filter(function (a) { return String(a.reference).toUpperCase().indexOf(s) !== -1 || String(a.oe_reference || '').toUpperCase().indexOf(s) !== -1 || String(a.name || '').toUpperCase().indexOf(s) !== -1; }).map(part); },
    getPartDetails: async function (id) { fail(); var a = articles.filter(function (x) { return String(x.article_id) === String(id); })[0]; return a ? part(a) : null; }
  };
}

module.exports = { createMockTecDocProvider: createMockTecDocProvider };
