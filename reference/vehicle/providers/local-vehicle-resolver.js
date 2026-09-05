'use strict';
// =====================================================
// IDauto — IDA-V12 — LocalVehicleResolver
// reference/vehicle/providers/local-vehicle-resolver.js
//
// The first and always-present provider: the IDauto database itself. Every
// vehicle a workshop has ever confirmed is answered from here, before any
// external call. Implements the provider contract (see vehicle-resolver.js):
//   name, resolveByPlate(parsedPlate) → hit | null, resolveByVIN(vin) → hit | null
// A hit is { vehicle: <repository row>, source: 'local', confidence, verified }.
// =====================================================

function createLocalVehicleResolver(repository) {
  async function resolveByPlate(parsed) {
    var found = await repository.findByPlate(parsed.canonical);
    if (!found) return null;
    return hit(found.vehicle);
  }
  async function resolveByVIN(vin) {
    var row = await repository.findByVin(vin);
    return row ? hit(row) : null;
  }
  function hit(row) {
    return {
      vehicle: row, source: 'local',
      confidence: row.identification_confidence === null || row.identification_confidence === undefined ? (row.identification_verified ? 1.0 : 0.8) : row.identification_confidence,
      verified: !!row.identification_verified
    };
  }
  return { name: 'local', kind: 'local', resolveByPlate: resolveByPlate, resolveByVIN: resolveByVIN };
}

module.exports = { createLocalVehicleResolver: createLocalVehicleResolver };
