'use strict';
// =====================================================
// IDauto — IDA-V12 — WorkshopVehicleService
// reference/workshop/workshop-vehicle-service.js
//
// The atelier journey as one service, so the UI and the tests drive the
// same code:
//
//   1. vehicle arrives           arrive({ plate | vin | selection, ... })
//   2. camera reads the plate    (client side; the OCR text + confidence come in)
//   3. OCR result                → resolver.resolveByPlate (needs_confirmation when weak)
//   4. confirmation/correction   confirmIdentification(visit, confirmation)
//   5. vehicle resolution        local → provider → manual
//   6. vehicle fiche             fiche(ref)
//   7. parts search              partsForVisit(visit) / searchParts
//   8. part selection            addOperation(visit, { part_id })
//   9. workshop operation        addOperation / closeVisit / createOrder
//
// Fallbacks are part of the contract, not an afterthought:
//   camera failed        → arrive with a typed plate (plate_read_method 'manual')
//   vehicle not found    → arrive / identify with a VIN
//   VIN not available    → identify with manufacturer / model / motorisation
// =====================================================

var errors = require('../vehicle/errors.js');
var vehicleRepository = require('../vehicle/vehicle-repository.js');
var workshopRepo = require('./workshop-repository.js');

function createWorkshopVehicleService(deps) {
  deps = deps || {};
  var resolver = deps.resolver;
  var catalog = deps.catalog;
  var repository = deps.repository || vehicleRepository;
  var repo = deps.workshopRepository || workshopRepo;
  if (!resolver || !catalog) throw new Error('WorkshopVehicleService needs a resolver and a catalog');

  // Runs the identification step for whatever the arrival carries. Never
  // writes truth: a candidate must be confirmed explicitly.
  async function identify(input, opts) {
    opts = opts || {};
    if (input.plate) return resolver.resolveByPlate(String(input.plate), { confidence: input.ocr_confidence, method: input.plate_read_method === 'camera_ocr' ? 'plate_ocr' : 'plate_manual', registrationType: input.registration_type, confirmed: !!input.plate_confirmed, includeVin: opts.includeVin });
    if (input.vin) return resolver.resolveByVIN(String(input.vin), { includeVin: opts.includeVin });
    if (input.selection) return resolver.resolveByManualSelection(input.selection, { includeVin: opts.includeVin });
    return { status: 'not_identified' };
  }

  // 1–5: open a visit and attempt identification in one call.
  async function arrive(input, actor, opts) {
    var identification = await identify(input, opts);
    var vehicleRow = identification.status === 'resolved' ? await repository.findByRef(identification.vehicle.id) : null;
    var visit = await repo.createVisit({
      org_id: input.org_id, customer_ref: input.customer_ref, reason: input.reason,
      plate_read: identification.plate ? identification.plate.canonical : (input.plate ? String(input.plate).slice(0, 20) : null),
      plate_read_method: input.plate ? (input.plate_read_method || 'manual') : 'none',
      plate_read_confidence: identification.plate ? identification.plate.confidence : null,
      identification_method: vehicleRow ? (input.plate ? 'plate' : input.vin ? 'vin' : 'manual_selection') : null
    }, actor, vehicleRow);
    return { visit: visit, identification: identification };
  }

  // 4–5: the human confirms/corrects; truth is written; the visit is linked.
  async function confirmIdentification(visitId, confirmation, actor, opts) {
    var vehicle = await resolver.confirm(confirmation, actor);
    var row = await repository.findByRef(vehicle.id);
    var method = confirmation.method === 'vin' ? 'vin' : (confirmation.method === 'manual_selection' ? 'manual_selection' : 'plate');
    var visit = await repo.attachVehicle(visitId, actor, row, method, confirmation);
    return { visit: visit, vehicle: vehicle };
  }

  // 6: the fiche.
  async function fiche(ref, opts) {
    var row = await repository.findByRef(ref);
    if (!row) throw errors.IdautoError('VEHICLE_NOT_FOUND');
    var record = await repository.record(row, { includeVin: !!(opts && opts.includeVin) });
    record.history = await repository.history(row.id);
    return record;
  }

  // 7: the parts that fit the visit's vehicle, catalogue + stock.
  async function partsForVisit(visitId, actor, opts) {
    var orgId = repo.orgFor(actor, opts);
    var visit = await repo.getVisit(visitId, orgId);
    if (!visit) throw errors.IdautoError('NOT_FOUND');
    if (!visit.vehicle) throw errors.IdautoError('VEHICLE_NOT_FOUND', { reason: 'visit_has_no_vehicle' });
    var row = await repository.findByRef(visit.vehicle.id);
    var vehicle = await repository.record(row);
    vehicle.local_id = row.id;
    return { visit_id: visit.id, vehicle: { id: vehicle.id, manufacturer: vehicle.manufacturer, model: vehicle.model, motorisation: vehicle.motorisation, tecdoc_car_id: vehicle.tecdoc_car_id },
      catalogue: await catalog.getCompatibleParts(vehicle, { orgId: orgId, category: opts && opts.category }) };
  }

  return {
    identify: identify, arrive: arrive, confirmIdentification: confirmIdentification, fiche: fiche, partsForVisit: partsForVisit,
    addOperation: repo.addOperation, setOperationStatus: repo.setOperationStatus, closeVisit: repo.closeVisit,
    createOrder: repo.createOrder, getOrder: repo.getOrder, setOrderStatus: repo.setOrderStatus, getVisit: repo.getVisit, listVisits: repo.listVisits
  };
}

module.exports = { createWorkshopVehicleService: createWorkshopVehicleService };
