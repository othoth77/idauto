'use strict';
// =====================================================
// IDauto — IDA-V12 — TecDocAdapter
// reference/parts/tecdoc-adapter.js
//
// The seam to a LICENSED TecDoc catalogue (TecAlliance). Interface:
//   status()                        → { configured, provider, message_fr }
//   getManufacturers()              → [{ id, name }]
//   getModels(manufacturerId)       → [{ id, name, year_from, year_to }]
//   getSubmodels(modelId)           → [{ id (carId), name, motorisation, engine_code, kw, year_from, year_to }]
//   getVehicleDetails(carId)        → { car_id, manufacturer, model, version, motorisation, engine_code, year_from, year_to }
//   getCompatibleParts(carId, opts) → [{ id:'tecdoc:<articleId>', reference, brand, oe_reference, category, name, source:'tecdoc' }]
//   searchParts(query)              → same shape
//   getPartDetails(articleId)       → one part + attributes
//
// NOT CONFIGURED is the normal state of this repository. Then status()
// reports it and every other method throws CATALOG_NOT_CONFIGURED, which the
// routes turn into « Catalogue fournisseur non configuré » while the local
// catalogue keeps working. NOTHING here invents a TecDoc reference: with no
// configured gateway there is no TecDoc data, and the UI says so.
//
// CONFIGURED means the operator set IDAUTO_TECDOC_BASE_URL (+ _API_KEY) for a
// TecDoc-style JSON gateway. TecAlliance licenses its API per reseller and
// the exact wire format differs by contract, so this adapter speaks a small,
// documented gateway contract (docs/TECDOC.md §3) that a reseller-specific
// mapping satisfies. The mapping is `options.map`; the default is identity.
// The real wire format has NOT been verified against a live account.
// =====================================================

var http = require('http');
var https = require('https');
var url = require('url');
var errors = require('../vehicle/errors.js');
var observability = require('../observability.js');

function fromEnv() {
  var base = process.env.IDAUTO_TECDOC_BASE_URL;
  if (!base) return null;
  return {
    baseUrl: base.replace(/\/+$/, ''),
    apiKey: process.env.IDAUTO_TECDOC_API_KEY || null,
    providerId: process.env.IDAUTO_TECDOC_PROVIDER_ID || null,
    timeoutMs: parseInt(process.env.IDAUTO_TECDOC_TIMEOUT_MS || '5000', 10),
    name: process.env.IDAUTO_TECDOC_PROVIDER_NAME || 'tecdoc'
  };
}

var NOT_CONFIGURED_FR = 'Catalogue fournisseur non configuré.';

function createTecDocAdapter(config, options) {
  options = options || {};
  config = config === undefined ? fromEnv() : config;
  var obs = options.observability || observability.shared();
  var configured = !!(config && config.baseUrl);
  var name = (config && config.name) || 'tecdoc';
  var transport = options.transport || null;

  function status() {
    return configured
      ? { configured: true, provider: name, message_fr: 'Catalogue fournisseur configuré (' + name + ').' }
      : { configured: false, provider: null, message_fr: NOT_CONFIGURED_FR };
  }
  function notConfigured() { return errors.IdautoError('CATALOG_NOT_CONFIGURED'); }

  function request(pathname, query) {
    var target = config.baseUrl + pathname + (query ? '?' + Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&') : '');
    if (transport) return transport(target, { timeoutMs: config.timeoutMs });
    var parsed = url.parse(target);
    var loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      return Promise.reject(errors.IdautoError('CATALOG_UNAVAILABLE', { reason: 'insecure_catalog_url' }));
    }
    var lib = parsed.protocol === 'https:' ? https : http;
    return new Promise(function (resolve, reject) {
      var headers = { Accept: 'application/json' };
      if (config.apiKey) headers['X-Api-Key'] = config.apiKey;
      if (config.providerId) headers['X-Provider-Id'] = String(config.providerId);
      var req = lib.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.path, method: 'GET', headers: headers, timeout: config.timeoutMs }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
          resolve({ status: res.statusCode, json: json });
        });
      });
      req.on('timeout', function () { req.destroy(Object.assign(new Error('timeout'), { code: 'IDAUTO_TIMEOUT' })); });
      req.on('error', reject);
      req.end();
    });
  }

  async function call(what, pathname, query, map) {
    if (!configured) throw notConfigured();
    obs.inc('tecdoc_calls'); obs.event('tecdoc_lookup_started', { what: what });
    var res;
    try { res = await request(pathname, query); } catch (err) {
      obs.inc('tecdoc_error'); obs.event('tecdoc_lookup_failed', { what: what, reason: (err && err.code) || 'network' });
      if (err && err.isIdautoError) throw err;
      var net = errors.fromNetwork(err, name);
      throw errors.IdautoError(net.code === 'PROVIDER_TIMEOUT' ? 'CATALOG_UNAVAILABLE' : 'CATALOG_UNAVAILABLE', { provider: name, reason: net.code });
    }
    if (res.status === 404) { obs.event('tecdoc_lookup_success', { what: what, empty: true }); return map(null); }
    if (res.status !== 200 || !res.json) {
      obs.inc('tecdoc_error'); obs.event('tecdoc_lookup_failed', { what: what, status: res.status });
      throw errors.IdautoError('CATALOG_UNAVAILABLE', { provider: name, reason: 'status_' + res.status });
    }
    obs.event('tecdoc_lookup_success', { what: what });
    return map(options.map ? options.map(what, res.json) : res.json);
  }

  var list = function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []); };
  function part(a) {
    return { id: 'tecdoc:' + a.article_id, tecdoc_article_id: a.article_id, reference: a.reference, brand: a.brand,
      oe_reference: a.oe_reference || null, category: a.category || null, name: a.name || null, source: 'tecdoc',
      compatibility: a.compatibility || null, attributes: a.attributes || null };
  }

  return {
    name: name,
    status: status,
    isConfigured: function () { return configured; },
    getManufacturers: function () { return call('manufacturers', '/manufacturers', null, function (j) { return list(j).map(function (m) { return { id: m.id, name: m.name }; }); }); },
    getModels: function (manufacturerId) { return call('models', '/manufacturers/' + encodeURIComponent(manufacturerId) + '/models', null, function (j) { return list(j).map(function (m) { return { id: m.id, name: m.name, year_from: m.year_from || null, year_to: m.year_to || null }; }); }); },
    getSubmodels: function (modelId) { return call('submodels', '/models/' + encodeURIComponent(modelId) + '/vehicles', null, function (j) { return list(j).map(function (v) { return { id: v.car_id || v.id, name: v.name, motorisation: v.motorisation || null, engine_code: v.engine_code || null, kw: v.kw || null, year_from: v.year_from || null, year_to: v.year_to || null }; }); }); },
    getVehicleDetails: function (carId) { return call('vehicle', '/vehicles/' + encodeURIComponent(carId), null, function (j) { return j ? { car_id: j.car_id || carId, manufacturer: j.manufacturer, model: j.model, version: j.version || null, motorisation: j.motorisation || null, engine_code: j.engine_code || null, year_from: j.year_from || null, year_to: j.year_to || null, fuel_type: j.fuel_type || null } : null; }); },
    getCompatibleParts: function (carId, opts) { return call('parts', '/vehicles/' + encodeURIComponent(carId) + '/articles', opts && opts.category ? { category: opts.category } : null, function (j) { return list(j).map(part); }); },
    searchParts: function (query) { return call('search', '/articles', { q: String(query).slice(0, 80) }, function (j) { return list(j).map(part); }); },
    getPartDetails: function (articleId) { return call('article', '/articles/' + encodeURIComponent(articleId), null, function (j) { return j ? part(j) : null; }); }
  };
}

module.exports = { createTecDocAdapter: createTecDocAdapter, fromEnv: fromEnv, NOT_CONFIGURED_FR: NOT_CONFIGURED_FR };
