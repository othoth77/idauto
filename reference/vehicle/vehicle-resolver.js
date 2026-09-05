'use strict';
// =====================================================
// IDauto — IDA-V12 — VehicleResolver
// reference/vehicle/vehicle-resolver.js
//
//   resolveByPlate(raw, opts)           → { status, plate, vehicle?, candidate?, source, ... }
//   resolveByVIN(raw, opts)             → same shape
//   resolveByManualSelection(sel, opts) → same shape
//   confirm(confirmation, actor)        → the confirmed Vehicle record
//
// ORDER, ALWAYS: cache → local database → trusted providers (in configured
// order) → not found. The frontend and the workshop service never see a
// provider; they see this. Swapping a provider is a change to the
// `providers` array and nothing else.
//
// STATUSES a caller can receive:
//   needs_confirmation  the OCR read is below the threshold — nothing was
//                       looked up, the human confirms or corrects first
//   resolved            a vehicle IDauto already holds (source local/cache)
//   candidate           a provider (or a manual selection) proposed an
//                       identification that is NOT yet recorded as truth;
//                       the caller shows it and calls confirm()
//   not_found           nothing anywhere; the caller offers VIN / manual
// Provider failures never fail the request when the local database could
// still answer; they are reported in provider_errors and in the metrics.
//
// TRUTH IS WRITTEN ONLY BY confirm(). A provider answer lives in the cache
// (TTL) until a human confirms it — the rule "never record a low-confidence
// or unconfirmed identification as truth" applies to providers too.
// =====================================================

var plateNormalizer = require('./plate-normalizer.js');
var vinModule = require('./vin.js');
var errors = require('./errors.js');
var cacheModule = require('./resolution-cache.js');
var observability = require('../observability.js');
var localProvider = require('./providers/local-vehicle-resolver.js');
var httpProvider = require('./providers/http-vehicle-provider.js');

function createVehicleResolver(deps) {
  deps = deps || {};
  var repository = deps.repository || require('./vehicle-repository.js');
  var cache = deps.cache || cacheModule.createResolutionCache();
  var obs = deps.observability || observability.shared();
  var local = localProvider.createLocalVehicleResolver(repository);
  // External providers: explicit list, or the env-configured HTTP adapter if
  // present, or none. Mocks are never added here.
  var providers = deps.providers !== undefined ? deps.providers : [httpProvider.createHttpVehicleProvider()].filter(Boolean);
  var confirmThreshold = deps.confirmThreshold !== undefined ? deps.confirmThreshold : plateNormalizer.DEFAULT_CONFIRM_THRESHOLD;

  function timer() { var t0 = Date.now(); return function () { return Date.now() - t0; }; }

  async function hitToResult(hit, extra, opts) {
    if (hit.vehicle) {
      return Object.assign({ status: 'resolved', source: hit.source, confidence: hit.confidence, verified: hit.verified,
        vehicle: await repository.record(hit.vehicle, { includeVin: !!(opts && opts.includeVin) }) }, extra);
    }
    return Object.assign({ status: 'candidate', source: hit.source, confidence: hit.confidence, verified: false, candidate: hit.candidate }, extra);
  }

  async function chain(kind, key, cacheKey, callProvider, extra, opts) {
    var elapsed = timer();
    obs.inc('resolution_total'); obs.inc('cache_lookups');
    var cached = cache.get(cacheKey);
    if (cached !== undefined) {
      obs.inc('cache_hit');
      if (cached === null) { obs.inc('resolution_not_found'); return Object.assign({ status: 'not_found', source: 'cache', latency_ms: elapsed() }, extra); }
      // A cached local hit is re-read so a fresh confirmation is visible.
      if (cached.source === 'local') {
        var again = await callProvider(local);
        if (again) { obs.inc('resolution_success'); return await hitToResult(again, Object.assign({ latency_ms: elapsed(), cache: 'hit' }, extra), opts); }
      } else {
        obs.inc('resolution_success');
        return await hitToResult(cached, Object.assign({ latency_ms: elapsed(), cache: 'hit' }, extra), opts);
      }
    }

    var localHit = await callProvider(local);
    if (localHit) {
      cache.set(cacheKey, { source: 'local' });
      obs.inc('resolution_success'); obs.observe('resolution_latency_ms', elapsed());
      obs.event('vehicle_resolved', { by: kind, source: 'local', ivid: localHit.vehicle.ivid, verified: localHit.verified });
      return await hitToResult(localHit, Object.assign({ latency_ms: elapsed(), cache: 'miss' }, extra), opts);
    }

    var providerErrors = [];
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      var fn = kind === 'vin' ? p.resolveByVIN : p.resolveByPlate;
      if (typeof fn !== 'function') continue;
      obs.inc('provider_calls');
      try {
        var hit = await fn.call(p, key);
        if (hit) {
          cache.set(cacheKey, hit);
          obs.inc('resolution_success'); obs.observe('resolution_latency_ms', elapsed());
          obs.event('vehicle_resolved', { by: kind, source: hit.source, confidence: hit.confidence, verified: false });
          return await hitToResult(hit, Object.assign({ latency_ms: elapsed(), cache: 'miss', provider_errors: providerErrors }, extra), opts);
        }
      } catch (err) {
        obs.inc('provider_error');
        var typed = err && err.isIdautoError ? err : errors.fromNetwork(err, p.name);
        providerErrors.push({ provider: p.name, error: typed.code });
        obs.event('plate_resolution_failed', { by: kind, provider: p.name, error: typed.code });
      }
    }

    // Nothing anywhere. Cache the miss briefly ONLY if no provider failed —
    // a failure is not a "no such vehicle" and must be retried.
    if (!providerErrors.length) cache.set(cacheKey, null, true);
    obs.inc('resolution_not_found'); obs.observe('resolution_latency_ms', elapsed());
    return Object.assign({ status: 'not_found', source: null, latency_ms: elapsed(), cache: 'miss', provider_errors: providerErrors }, extra);
  }

  async function resolveByPlate(raw, opts) {
    opts = opts || {};
    obs.event('plate_resolution_started', { method: opts.method || 'manual', has_confidence: opts.confidence !== undefined });
    var parsed = plateNormalizer.parsePlate(raw, { confidence: opts.confidence, confirmThreshold: confirmThreshold, registrationType: opts.registrationType });
    if (!parsed.ok) {
      obs.event('plate_resolution_failed', { reason: parsed.reason });
      var code = parsed.reason === 'ambiguous' ? 'PLATE_AMBIGUOUS' : parsed.reason === 'partial' ? 'PLATE_PARTIAL' : 'INVALID_PLATE';
      throw errors.IdautoError(code, { reason: parsed.reason, series: parsed.series || null, number: parsed.number || null, raw_digits: parsed.raw_digits || null });
    }
    if (parsed.confidence !== null) obs.observe('ocr_confidence', parsed.confidence);
    if (parsed.requires_confirmation && !opts.confirmed) {
      obs.event('plate_resolution_failed', { reason: 'low_confidence', confidence: parsed.confidence });
      return { status: 'needs_confirmation', plate: parsed };
    }
    var result = await chain('plate', parsed, cacheModule.plateKey(parsed.canonical),
      function (p) { return p.resolveByPlate(parsed); }, { plate: parsed }, opts);
    obs.event(result.status === 'not_found' ? 'plate_resolution_failed' : 'plate_resolution_success', { status: result.status, source: result.source, plate: parsed.canonical });
    return result;
  }

  async function resolveByVIN(raw, opts) {
    opts = opts || {};
    var v = vinModule.validate(raw);
    if (!v.ok) throw errors.IdautoError('INVALID_VIN', { reason: v.reason });
    var result = await chain('vin', v.vin, cacheModule.vinKey(v.vin), function (p) { return p.resolveByVIN(v.vin); }, { vin: v }, opts);
    return result;
  }

  // Manual selection: make / model / motorisation (+ year, tecdoc_car_id).
  // An existing local record with the same axes is returned as `resolved`;
  // otherwise the selection becomes a candidate awaiting confirm().
  async function resolveByManualSelection(sel, opts) {
    opts = opts || {};
    var fields = repository.cleanIdentFields(sel || {});
    if (!fields.make || !fields.model) throw errors.IdautoError('VALIDATION', { required: ['manufacturer', 'model'] });
    var elapsed = timer();
    obs.inc('resolution_total');
    var rows = await repository.findByAttributes({ manufacturer: fields.make, model: fields.model, motorisation: fields.motorisation, year: fields.year, tecdoc_car_id: fields.tecdoc_car_id });
    if (rows.length === 1) {
      obs.inc('resolution_success');
      return { status: 'resolved', source: 'local', confidence: rows[0].identification_confidence, verified: !!rows[0].identification_verified,
        vehicle: await repository.record(rows[0], { includeVin: !!opts.includeVin }), latency_ms: elapsed() };
    }
    obs.inc('resolution_success');
    return { status: 'candidate', source: 'manual', confidence: 1.0, verified: false, latency_ms: elapsed(),
      candidate: { manufacturer: fields.make, model: fields.model, version: fields.variant || null, motorisation: fields.motorisation || null,
        engine_code: fields.engine_code || null, year: fields.year || null, year_from: fields.year_from || null, year_to: fields.year_to || null,
        fuel_type: fields.fuel_type || null, tecdoc_car_id: fields.tecdoc_car_id || null },
      alternatives: rows.length > 1 ? await Promise.all(rows.map(function (r) { return repository.record(r); })) : [] };
  }

  // confirm(): the ONLY path that writes an identification as truth.
  //   { vehicle_ref?, plate?, registration_type?, vin?, candidate: {...}, source?, method }
  // With vehicle_ref: updates that vehicle (edit/confirm). Without: creates.
  async function confirm(input, actor) {
    if (!actor || !actor.identity) throw errors.IdautoError('FORBIDDEN');
    var parsedPlate = null, vin = null;
    if (input.plate) {
      parsedPlate = plateNormalizer.parsePlate(String(input.plate), { registrationType: input.registration_type });
      if (!parsedPlate.ok) throw errors.IdautoError('INVALID_PLATE', { reason: parsedPlate.reason });
    }
    if (input.vin) {
      var v = vinModule.validate(String(input.vin));
      if (!v.ok) throw errors.IdautoError('INVALID_VIN', { reason: v.reason });
      vin = v.vin;
    }
    var method = ['plate_ocr', 'plate_manual', 'vin', 'manual_selection', 'provider', 'admin'].indexOf(input.method) !== -1 ? input.method : 'manual_selection';
    var prov = { method: method, source: input.source || (method === 'provider' ? 'provider' : 'manual'), confidence: typeof input.confidence === 'number' ? input.confidence : 1.0 };
    var fields = Object.assign({}, input.candidate || {}, { plate: parsedPlate, vin: vin });
    var row;
    if (input.vehicle_ref) {
      row = await repository.findByRef(String(input.vehicle_ref));
      if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
      row = await repository.saveIdentification(row, fields, actor, prov, input.action === 'edit' ? 'edited' : 'confirmed', true);
    } else {
      // Guard: a plate or VIN already attached to a vehicle means confirm THAT
      // one rather than minting a duplicate identity.
      var existing = parsedPlate ? await repository.findByPlate(parsedPlate.canonical) : null;
      var existingRow = existing ? existing.vehicle : (vin ? await repository.findByVin(vin) : null);
      if (existingRow) row = await repository.saveIdentification(existingRow, fields, actor, prov, 'confirmed', true);
      else row = await repository.createIdentifiedVehicle(fields, actor, prov, true);
    }
    if (parsedPlate) cache.invalidate(cacheModule.plateKey(parsedPlate.canonical));
    if (vin) cache.invalidate(cacheModule.vinKey(vin));
    (await repository.platesOf(row.id)).forEach(function (p) { cache.invalidate(cacheModule.plateKey(p.plate_number)); });
    obs.inc('vehicle_confirmed');
    obs.event('vehicle_confirmed', { ivid: row.ivid, method: method, source: prov.source, actor_type: actor.principal && actor.principal.kind });
    return repository.record(row, { includeVin: !!input.includeVin });
  }

  // Re-run the providers for a known vehicle and return what they say now,
  // without writing anything. The caller decides whether to confirm.
  async function refresh(ref, opts) {
    var row = await repository.findByRef(ref);
    if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
    var plates = await repository.platesOf(row.id);
    var vin = await repository.vinOf(row.id);
    var proposals = [], providerErrors = [];
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      try {
        obs.inc('provider_calls');
        var hit = null;
        if (plates.length && typeof p.resolveByPlate === 'function') hit = await p.resolveByPlate(plateNormalizer.parsePlate(plates[0].plate_number));
        if (!hit && vin && typeof p.resolveByVIN === 'function') hit = await p.resolveByVIN(vin);
        if (hit) proposals.push({ source: hit.source, confidence: hit.confidence, candidate: hit.candidate });
      } catch (err) {
        obs.inc('provider_error');
        var typed = err && err.isIdautoError ? err : errors.fromNetwork(err, p.name);
        providerErrors.push({ provider: p.name, error: typed.code });
      }
    }
    return { status: proposals.length ? 'candidate' : 'no_change', vehicle: await repository.record(row, { includeVin: !!(opts && opts.includeVin) }), proposals: proposals, provider_errors: providerErrors, providers_configured: providers.length };
  }

  return {
    resolveByPlate: resolveByPlate, resolveByVIN: resolveByVIN, resolveByManualSelection: resolveByManualSelection,
    confirm: confirm, refresh: refresh,
    providers: function () { return providers.map(function (p) { return { name: p.name, kind: p.kind }; }); },
    // TEST HOOK. Replaces the provider list at runtime so a suite can inject a
    // mock or a failing provider. Refused in production: the provider list
    // there comes from configuration only.
    setProviders: function (list) {
      if (process.env.NODE_ENV === 'production') throw new Error('setProviders is a test hook');
      providers = (list || []).slice(); cache.clear();
    },
    cache: cache
  };
}

module.exports = { createVehicleResolver: createVehicleResolver };
