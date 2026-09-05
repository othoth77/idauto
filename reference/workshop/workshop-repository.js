'use strict';
// =====================================================
// IDauto — IDA-V12 — workshop repository
// reference/workshop/workshop-repository.js
//
// Visits, operations, orders and order lines, always scoped to ONE
// organisation: every read carries org_id in its WHERE clause and every
// write is audited through writes.withAudit(). An admin principal may act
// for an organisation by naming org_id explicitly; an organisation principal
// can only ever act for itself.
//
// Customer identity: idauto_workshop_customer_refs holds an opaque
// customer_ref only. Nothing here accepts a name, a phone or an address.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');

var CUSTOMER_REF_RE = /^[A-Za-z0-9._:@+-]{1,64}$/;
var VISIT_COLS = 'w.id, w.org_id, w.vehicle_id, w.customer_ref_id, w.status, w.plate_read, w.plate_read_method, w.plate_read_confidence, w.identification_method, w.reason, w.opened_by, w.opened_at, w.closed_at, w.updated_at';

function orgFor(actor, body) {
  if (actor.principal && actor.principal.kind === 'organisation') return actor.principal.org_id;
  var o = body && body.org_id ? parseInt(body.org_id, 10) : null;
  if (!o) throw errors.IdautoError('VALIDATION', { required: ['org_id (admin acting for an organisation)'] });
  return o;
}

async function ensureCustomerRef(client, orgId, ref) {
  if (!ref) return null;
  if (!CUSTOMER_REF_RE.test(ref)) throw errors.IdautoError('VALIDATION', { field: 'customer_ref', reason: 'opaque reference only (1–64 chars, no spaces)' });
  var res = await client.query('INSERT INTO idauto_workshop_customer_refs (org_id, customer_ref) VALUES ($1,$2) ON CONFLICT (org_id, customer_ref) DO UPDATE SET customer_ref = EXCLUDED.customer_ref RETURNING id', [orgId, ref]);
  return res.rows[0].id;
}

async function visitView(row, runner) {
  var q = runner || db;
  var v = null;
  if (row.vehicle_id) {
    var vr = await q.query('SELECT ivid, internal_ref, make, model, motorisation, year, tecdoc_car_id, identification_verified FROM idauto_vehicles WHERE id = $1', [row.vehicle_id]);
    if (vr.rows.length) v = { id: vr.rows[0].ivid, internal_ref: vr.rows[0].internal_ref, manufacturer: vr.rows[0].make, model: vr.rows[0].model, motorisation: vr.rows[0].motorisation, year: vr.rows[0].year, tecdoc_car_id: vr.rows[0].tecdoc_car_id, verified: !!vr.rows[0].identification_verified };
  }
  var cust = null;
  if (row.customer_ref_id) { var cr = await q.query('SELECT customer_ref FROM idauto_workshop_customer_refs WHERE id = $1', [row.customer_ref_id]); cust = cr.rows.length ? cr.rows[0].customer_ref : null; }
  var ops = await q.query('SELECT id, operation_type, description, part_id, quantity, status, created_by, created_at FROM idauto_workshop_operations WHERE visit_id = $1 ORDER BY id', [row.id]);
  var orders = await q.query('SELECT id, status, supplier_ref, created_at FROM idauto_workshop_orders WHERE visit_id = $1 ORDER BY id', [row.id]);
  return { id: row.id, org_id: row.org_id, status: row.status, vehicle: v, customer_ref: cust,
    plate_read: row.plate_read, plate_read_method: row.plate_read_method, plate_read_confidence: row.plate_read_confidence,
    identification_method: row.identification_method, reason: row.reason, opened_by: row.opened_by, opened_at: row.opened_at, closed_at: row.closed_at, updated_at: row.updated_at,
    operations: ops.rows.map(function (o) { return { id: o.id, operation_type: o.operation_type, description: o.description, part_id: o.part_id ? 'local:' + o.part_id : null, quantity: o.quantity, status: o.status, created_by: o.created_by, created_at: o.created_at }; }),
    orders: orders.rows };
}

async function getVisit(id, orgId) {
  var res = await db.query('SELECT ' + VISIT_COLS + ' FROM idauto_workshop_visits w WHERE w.id = $1 AND w.org_id = $2', [id, orgId]);
  return res.rows.length ? visitView(res.rows[0]) : null;
}

async function listVisits(orgId, opts) {
  opts = opts || {};
  var params = [orgId], where = ['w.org_id = $1'];
  if (opts.vehicleId) { params.push(opts.vehicleId); where.push('w.vehicle_id = $' + params.length); }
  if (opts.status) { params.push(opts.status); where.push('w.status = $' + params.length); }
  var res = await db.query('SELECT ' + VISIT_COLS + ' FROM idauto_workshop_visits w WHERE ' + where.join(' AND ') + ' ORDER BY w.opened_at DESC LIMIT 50', params);
  var out = [];
  for (var i = 0; i < res.rows.length; i++) out.push(await visitView(res.rows[i]));
  return out;
}

async function createVisit(body, actor, vehicleRow) {
  var orgId = orgFor(actor, body);
  var reason = body.reason ? String(body.reason).slice(0, 200) : null;
  var plateMethod = ['camera_ocr', 'manual', 'none'].indexOf(body.plate_read_method) !== -1 ? body.plate_read_method : (body.plate_read ? 'manual' : 'none');
  var identMethod = ['plate', 'vin', 'manual_selection'].indexOf(body.identification_method) !== -1 ? body.identification_method : null;
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.visit.create', target_type: 'idauto_workshop_visits', change_summary: 'Workshop visit opened' },
    actor.identity,
    async function (client) {
      var custId = await ensureCustomerRef(client, orgId, body.customer_ref ? String(body.customer_ref) : null);
      var res = await client.query(
        'INSERT INTO idauto_workshop_visits (org_id, vehicle_id, customer_ref_id, status, plate_read, plate_read_method, plate_read_confidence, identification_method, reason, opened_by) ' +
        "VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8,$9) RETURNING " + VISIT_COLS.replace(/w\./g, ''),
        [orgId, vehicleRow ? vehicleRow.id : null, custId, body.plate_read ? String(body.plate_read).slice(0, 20) : null, plateMethod,
          typeof body.plate_read_confidence === 'number' ? Math.max(0, Math.min(1, body.plate_read_confidence)) : null, identMethod, reason, actor.identity]);
      var view = await visitView(res.rows[0], client);
      return { record: view, auditTargetRef: res.rows[0].id };
    });
}

async function attachVehicle(visitId, actor, vehicleRow, identMethod, body) {
  var orgId = orgFor(actor, body);
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.visit.vehicle', target_type: 'idauto_workshop_visits', change_summary: 'Vehicle attached to visit ' + visitId },
    actor.identity,
    async function (client) {
      var res = await client.query('UPDATE idauto_workshop_visits SET vehicle_id = $1, identification_method = COALESCE($2, identification_method), status = CASE WHEN status = $5 THEN $6 ELSE status END, updated_at = NOW() WHERE id = $3 AND org_id = $4 RETURNING ' + VISIT_COLS.replace(/w\./g, ''),
        [vehicleRow.id, identMethod || null, visitId, orgId, 'open', 'in_progress']);
      if (!res.rows.length) throw errors.IdautoError('NOT_FOUND');
      return { record: await visitView(res.rows[0], client), auditTargetRef: visitId };
    });
}

var OP_TYPES = ['diagnosis', 'replacement', 'service', 'repair', 'inspection', 'other'];
async function addOperation(visitId, body, actor) {
  var orgId = orgFor(actor, body);
  if (OP_TYPES.indexOf(body.operation_type) === -1) throw errors.IdautoError('VALIDATION', { field: 'operation_type', allowed: OP_TYPES });
  var partId = null;
  if (body.part_id) { var m = /^local:(\d+)$/.exec(String(body.part_id)); if (!m) throw errors.IdautoError('VALIDATION', { field: 'part_id', reason: 'only local catalogue parts (local:<id>) can be attached to an operation' }); partId = parseInt(m[1], 10); }
  var qty = body.quantity !== undefined ? parseInt(body.quantity, 10) : 1;
  if (!isFinite(qty) || qty < 1) throw errors.IdautoError('VALIDATION', { field: 'quantity' });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.operation.create', target_type: 'idauto_workshop_operations', change_summary: body.operation_type + ' on visit ' + visitId },
    actor.identity,
    async function (client) {
      var v = await client.query('SELECT id, status FROM idauto_workshop_visits WHERE id = $1 AND org_id = $2', [visitId, orgId]);
      if (!v.rows.length) throw errors.IdautoError('NOT_FOUND');
      if (v.rows[0].status === 'closed' || v.rows[0].status === 'cancelled') throw errors.IdautoError('CONFLICT', { reason: 'visit_' + v.rows[0].status });
      if (partId) { var p = await client.query('SELECT id FROM idauto_parts WHERE id = $1 AND (org_id IS NULL OR org_id = $2)', [partId, orgId]); if (!p.rows.length) throw errors.IdautoError('NOT_FOUND', { part_id: body.part_id }); }
      var res = await client.query(
        "INSERT INTO idauto_workshop_operations (visit_id, operation_type, description, part_id, quantity, status, created_by) VALUES ($1,$2,$3,$4,$5,'planned',$6) RETURNING id, operation_type, description, part_id, quantity, status, created_at",
        [visitId, body.operation_type, body.description ? String(body.description).slice(0, 300) : null, partId, qty, actor.identity]);
      await client.query("UPDATE idauto_workshop_visits SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW() WHERE id = $1", [visitId]);
      var row = res.rows[0]; row.part_id = row.part_id ? 'local:' + row.part_id : null;
      return { record: row, auditTargetRef: row.id };
    });
}

async function setOperationStatus(visitId, opId, status, actor, body) {
  var orgId = orgFor(actor, body);
  if (['planned', 'done', 'cancelled'].indexOf(status) === -1) throw errors.IdautoError('VALIDATION', { field: 'status' });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.operation.status', target_type: 'idauto_workshop_operations', change_summary: 'operation ' + opId + ' → ' + status },
    actor.identity,
    async function (client) {
      var res = await client.query('UPDATE idauto_workshop_operations o SET status = $1 FROM idauto_workshop_visits w WHERE o.id = $2 AND o.visit_id = w.id AND w.id = $3 AND w.org_id = $4 RETURNING o.id, o.status', [status, opId, visitId, orgId]);
      if (!res.rows.length) throw errors.IdautoError('NOT_FOUND');
      return { record: res.rows[0], auditTargetRef: opId };
    });
}

async function closeVisit(visitId, actor, body, cancel) {
  var orgId = orgFor(actor, body);
  return writes.withAudit(
    { principal: actor.principal, event_type: cancel ? 'workshop.visit.cancel' : 'workshop.visit.close', target_type: 'idauto_workshop_visits', change_summary: (cancel ? 'Visit cancelled ' : 'Visit closed ') + visitId },
    actor.identity,
    async function (client) {
      var res = await client.query("UPDATE idauto_workshop_visits SET status = $1, closed_at = NOW(), updated_at = NOW() WHERE id = $2 AND org_id = $3 AND status IN ('open','in_progress') RETURNING " + VISIT_COLS.replace(/w\./g, ''), [cancel ? 'cancelled' : 'closed', visitId, orgId]);
      if (!res.rows.length) throw errors.IdautoError('CONFLICT', { reason: 'visit_not_open' });
      return { record: await visitView(res.rows[0], client), auditTargetRef: visitId };
    });
}

async function createOrder(body, actor) {
  var orgId = orgFor(actor, body);
  var lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw errors.IdautoError('VALIDATION', { required: ['lines[] with part_id and quantity'] });
  var parsedLines = lines.map(function (l) {
    var m = /^local:(\d+)$/.exec(String(l.part_id || ''));
    var q = parseInt(l.quantity, 10);
    if (!m || !isFinite(q) || q < 1) throw errors.IdautoError('VALIDATION', { field: 'lines', reason: 'each line needs part_id local:<id> and quantity ≥ 1' });
    var price = l.unit_price_millimes !== undefined && l.unit_price_millimes !== null ? parseInt(l.unit_price_millimes, 10) : null;
    return { part_id: parseInt(m[1], 10), quantity: q, unit_price_millimes: price !== null && isFinite(price) && price >= 0 ? price : null };
  });
  var visitId = body.visit_id ? parseInt(body.visit_id, 10) : null;
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.order.create', target_type: 'idauto_workshop_orders', change_summary: 'Parts order (' + parsedLines.length + ' lines)' },
    actor.identity,
    async function (client) {
      if (visitId) { var v = await client.query('SELECT id FROM idauto_workshop_visits WHERE id = $1 AND org_id = $2', [visitId, orgId]); if (!v.rows.length) throw errors.IdautoError('NOT_FOUND', { visit_id: visitId }); }
      var o = await client.query("INSERT INTO idauto_workshop_orders (org_id, visit_id, status, supplier_ref, created_by) VALUES ($1,$2,'draft',$3,$4) RETURNING id, status, supplier_ref, created_at",
        [orgId, visitId, body.supplier_ref ? String(body.supplier_ref).slice(0, 120) : null, actor.identity]);
      var order = o.rows[0]; order.lines = [];
      for (var i = 0; i < parsedLines.length; i++) {
        var p = await client.query('SELECT id FROM idauto_parts WHERE id = $1 AND (org_id IS NULL OR org_id = $2)', [parsedLines[i].part_id, orgId]);
        if (!p.rows.length) throw errors.IdautoError('NOT_FOUND', { part_id: 'local:' + parsedLines[i].part_id });
        var l = await client.query('INSERT INTO idauto_workshop_order_lines (order_id, part_id, quantity, unit_price_millimes) VALUES ($1,$2,$3,$4) RETURNING id, part_id, quantity, unit_price_millimes', [order.id, parsedLines[i].part_id, parsedLines[i].quantity, parsedLines[i].unit_price_millimes]);
        order.lines.push({ id: l.rows[0].id, part_id: 'local:' + l.rows[0].part_id, quantity: l.rows[0].quantity, unit_price_millimes: l.rows[0].unit_price_millimes === null ? null : Number(l.rows[0].unit_price_millimes) });
      }
      order.visit_id = visitId; order.org_id = orgId;
      return { record: order, auditTargetRef: order.id };
    });
}

async function getOrder(id, orgId) {
  var o = await db.query('SELECT id, org_id, visit_id, status, supplier_ref, created_by, created_at, updated_at FROM idauto_workshop_orders WHERE id = $1 AND org_id = $2', [id, orgId]);
  if (!o.rows.length) return null;
  var lines = await db.query('SELECT l.id, l.part_id, l.quantity, l.unit_price_millimes, p.reference, p.brand FROM idauto_workshop_order_lines l JOIN idauto_parts p ON p.id = l.part_id WHERE l.order_id = $1 ORDER BY l.id', [id]);
  var order = o.rows[0];
  order.lines = lines.rows.map(function (l) { return { id: l.id, part_id: 'local:' + l.part_id, reference: l.reference, brand: l.brand, quantity: l.quantity, unit_price_millimes: l.unit_price_millimes === null ? null : Number(l.unit_price_millimes) }; });
  return order;
}

async function setOrderStatus(id, status, actor, body) {
  var orgId = orgFor(actor, body);
  if (['draft', 'placed', 'received', 'cancelled'].indexOf(status) === -1) throw errors.IdautoError('VALIDATION', { field: 'status' });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'workshop.order.status', target_type: 'idauto_workshop_orders', change_summary: 'order ' + id + ' → ' + status },
    actor.identity,
    async function (client) {
      var res = await client.query('UPDATE idauto_workshop_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id, status', [status, id, orgId]);
      if (!res.rows.length) throw errors.IdautoError('NOT_FOUND');
      return { record: res.rows[0], auditTargetRef: id };
    });
}

module.exports = { orgFor: orgFor, getVisit: getVisit, listVisits: listVisits, createVisit: createVisit, attachVehicle: attachVehicle,
  addOperation: addOperation, setOperationStatus: setOperationStatus, closeVisit: closeVisit, createOrder: createOrder, getOrder: getOrder, setOrderStatus: setOrderStatus, OP_TYPES: OP_TYPES };
