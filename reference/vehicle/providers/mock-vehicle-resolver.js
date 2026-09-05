'use strict';
// =====================================================
// IDauto — IDA-V12 — MockVehicleResolver (TESTS ONLY)
// reference/vehicle/providers/mock-vehicle-resolver.js
//
// A provider that answers from an in-memory fixture list and can be told to
// fail on demand (timeout / unavailable / network), so the resolver chain,
// the error path and the workshop flow are testable without any external
// service. It REFUSES to be constructed in production unless the operator
// sets IDAUTO_ALLOW_MOCK_PROVIDERS=1 explicitly, and it is never selected by
// vehicle-resolver.js's default provider list — a mock in the production
// path would present a fixture as a real identification.
// =====================================================

var errors = require('../errors.js');

function createMockVehicleResolver(options) {
  options = options || {};
  if (process.env.NODE_ENV === 'production' && process.env.IDAUTO_ALLOW_MOCK_PROVIDERS !== '1') {
    throw new Error('MockVehicleResolver refused: NODE_ENV=production without IDAUTO_ALLOW_MOCK_PROVIDERS=1');
  }
  var fixtures = (options.fixtures || []).map(function (f) { return Object.assign({}, f); });
  var mode = options.mode || 'ok';            // ok | timeout | unavailable | network
  var calls = [];
  var delayMs = options.delayMs || 0;

  function fail() {
    if (mode === 'timeout') throw errors.IdautoError('PROVIDER_TIMEOUT', { provider: 'mock' });
    if (mode === 'unavailable') throw errors.IdautoError('PROVIDER_UNAVAILABLE', { provider: 'mock' });
    if (mode === 'network') throw errors.IdautoError('NETWORK_FAILURE', { provider: 'mock' });
  }
  function wait() { return delayMs ? new Promise(function (r) { setTimeout(r, delayMs); }) : Promise.resolve(); }
  function toHit(f) {
    return {
      source: 'mock', confidence: f.confidence === undefined ? 0.9 : f.confidence, verified: false,
      candidate: {
        manufacturer: f.manufacturer, model: f.model, version: f.version || null, motorisation: f.motorisation || null,
        engine_code: f.engine_code || null, year: f.year || null, year_from: f.year_from || null, year_to: f.year_to || null,
        fuel_type: f.fuel_type || null, tecdoc_car_id: f.tecdoc_car_id || null, vin: f.vin || null
      }
    };
  }
  async function resolveByPlate(parsed) {
    calls.push({ by: 'plate', key: parsed.canonical }); await wait(); fail();
    var f = fixtures.filter(function (x) { return x.plate === parsed.canonical; })[0];
    return f ? toHit(f) : null;
  }
  async function resolveByVIN(vin) {
    calls.push({ by: 'vin', key: vin }); await wait(); fail();
    var f = fixtures.filter(function (x) { return x.vin === vin; })[0];
    return f ? toHit(f) : null;
  }
  return {
    name: 'mock', kind: 'mock', resolveByPlate: resolveByPlate, resolveByVIN: resolveByVIN,
    setMode: function (m) { mode = m; }, calls: calls, fixtures: fixtures
  };
}

module.exports = { createMockVehicleResolver: createMockVehicleResolver };
