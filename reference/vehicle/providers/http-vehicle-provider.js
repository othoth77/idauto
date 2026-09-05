'use strict';
// =====================================================
// IDauto — IDA-V12 — HttpVehicleProvider (generic, licensed-provider adapter)
// reference/vehicle/providers/http-vehicle-provider.js
//
// The seam for a future LICENSED plate/VIN → vehicle provider. No such
// provider is configured today (docs/VEHICLE_RESOLUTION.md §Sources): this
// adapter is disabled unless the operator sets IDAUTO_VEHICLE_PROVIDER_URL.
//
// CONTRACT it expects from the remote (documented, provider-agnostic):
//   GET <url with {plate} or {vin} substituted>   Authorization: Bearer <token>
//   200 { "found": true, "vehicle": { manufacturer, model, version, motorisation,
//                                     engine_code, year, year_from, year_to, fuel_type,
//                                     tecdoc_car_id, vin }, "confidence": 0..1 }
//   200 { "found": false }  or  404              → no result
//   anything else / timeout / socket error       → typed provider error
// A commercial provider with a different shape gets a small mapping function
// passed as options.map(json) → the shape above. Nothing else in the system
// changes when the provider changes — that is the whole point.
//
// WHAT IT NEVER DOES: no captcha handling, no session replay, no credential
// that is not the operator's own (the token comes from the environment, is
// never logged, never echoed). URLs are fixed by configuration; the caller
// only ever contributes a validated plate or VIN, so no SSRF surface exists.
// Only https is accepted, except loopback for tests.
// =====================================================

var http = require('http');
var https = require('https');
var url = require('url');
var errors = require('../errors.js');

function fromEnv() {
  var base = process.env.IDAUTO_VEHICLE_PROVIDER_URL;
  if (!base) return null;
  return {
    name: process.env.IDAUTO_VEHICLE_PROVIDER_NAME || 'provider',
    plateUrl: process.env.IDAUTO_VEHICLE_PROVIDER_PLATE_URL || base,
    vinUrl: process.env.IDAUTO_VEHICLE_PROVIDER_VIN_URL || null,
    token: process.env.IDAUTO_VEHICLE_PROVIDER_TOKEN || null,
    timeoutMs: parseInt(process.env.IDAUTO_VEHICLE_PROVIDER_TIMEOUT_MS || '4000', 10)
  };
}

function createHttpVehicleProvider(config) {
  config = config || fromEnv();
  if (!config || !config.plateUrl) return null;
  var name = config.name || 'provider';
  var timeoutMs = config.timeoutMs || 4000;
  var map = config.map || function (j) { return j; };
  var transport = config.transport || null;   // tests inject a fake

  function checkUrl(u) {
    var parsed = url.parse(u);
    var loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw errors.IdautoError('PROVIDER_UNAVAILABLE', { provider: name, reason: 'insecure_provider_url' });
    }
    return parsed;
  }

  function fetchJson(target) {
    if (transport) return transport(target, { timeoutMs: timeoutMs });
    var parsed = checkUrl(target);
    var lib = parsed.protocol === 'https:' ? https : http;
    return new Promise(function (resolve, reject) {
      var headers = { Accept: 'application/json' };
      if (config.token) headers.Authorization = 'Bearer ' + config.token;
      var req = lib.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.path, method: 'GET', headers: headers, timeout: timeoutMs }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf8'), json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch (_) { json = null; }
          resolve({ status: res.statusCode, json: json });
        });
      });
      req.on('timeout', function () { req.destroy(Object.assign(new Error('timeout'), { code: 'IDAUTO_TIMEOUT' })); });
      req.on('error', reject);
      req.end();
    });
  }

  async function call(template, key, value) {
    var target = template.replace('{' + key + '}', encodeURIComponent(value));
    var res;
    try { res = await fetchJson(target); } catch (err) { throw errors.fromNetwork(err, name); }
    if (res.status === 404) return null;
    if (res.status === 429) throw errors.IdautoError('PROVIDER_UNAVAILABLE', { provider: name, reason: 'rate_limited' });
    if (res.status !== 200 || !res.json) throw errors.IdautoError('PROVIDER_UNAVAILABLE', { provider: name, reason: 'status_' + res.status });
    var j = map(res.json);
    if (!j || j.found === false || !j.vehicle) return null;
    var v = j.vehicle;
    return {
      source: 'provider:' + name, verified: false,
      confidence: typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0.7,
      candidate: {
        manufacturer: v.manufacturer || v.make || null, model: v.model || null, version: v.version || v.variant || null,
        motorisation: v.motorisation || null, engine_code: v.engine_code || null, year: v.year || null,
        year_from: v.year_from || null, year_to: v.year_to || null, fuel_type: v.fuel_type || null,
        tecdoc_car_id: v.tecdoc_car_id || null, vin: v.vin || null
      }
    };
  }

  return {
    name: name, kind: 'http',
    resolveByPlate: function (parsed) { return call(config.plateUrl, 'plate', parsed.normalized); },
    resolveByVIN: config.vinUrl ? function (vin) { return call(config.vinUrl, 'vin', vin); } : null
  };
}

module.exports = { createHttpVehicleProvider: createHttpVehicleProvider, fromEnv: fromEnv };
