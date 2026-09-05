'use strict';
// =====================================================
// IDauto — IDA-V12 — LocalPartsCatalog + organisation stock
// reference/parts/local-parts-catalog.js
//
// The parts the workshop itself knows: references it entered (or imported
// under its own licence), each with the vehicles it fits. CATALOGUE tables
// (idauto_parts, idauto_part_compatibility) say what a part is and what it
// fits; the STOCK table (idauto_org_stock) says what one organisation has
// and at what price. They are read together only when an org is named.
//
// Every write goes through writes.withAudit(). A shared entry (org_id NULL)
// can be created by an admin only; an organisation's entries are its own.
// =====================================================

var db = require('../db.js');
var writes = require('../writes.js');
var errors = require('../vehicle/errors.js');

var PART_COLS = 'p.id, p.reference, p.reference_normalized, p.brand, p.oe_reference, p.category, p.name, p.tecdoc_article_id, p.source, p.org_id, p.created_at, p.updated_at';

function normalizeReference(ref) { return String(ref || '').toUpperCase().replace(/[\s\-_.\/]/g, ''); }

function rowToPart(row, stock) {
  var out = { id: 'local:' + row.id, local_id: row.id, reference: row.reference, brand: row.brand, oe_reference: row.oe_reference,
    category: row.category, name: row.name, tecdoc_article_id: row.tecdoc_article_id, source: row.source, org_scope: row.org_id ? 'organisation' : 'shared' };
  // BIGINT comes back from pg as a string; the API speaks numbers.
  if (stock !== undefined) out.availability = stock ? { quantity: stock.quantity, in_stock: stock.quantity > 0, price_millimes: stock.price_millimes === null ? null : Number(stock.price_millimes), currency: stock.currency, updated_at: stock.updated_at } : null;
  return out;
}

// Visibility: shared entries + the caller's own organisation's entries.
function visibility(orgId, params) {
  if (orgId) { params.push(orgId); return '(p.org_id IS NULL OR p.org_id = $' + params.length + ')'; }
  return 'TRUE';
}

async function withStock(rows, orgId) {
  if (!orgId || !rows.length) return rows.map(function (r) { return rowToPart(r, orgId ? null : undefined); });
  var ids = rows.map(function (r) { return r.id; });
  var st = await db.query('SELECT part_id, quantity, price_millimes, currency, updated_at FROM idauto_org_stock WHERE org_id = $1 AND part_id = ANY($2::bigint[])', [orgId, ids]);
  var byId = {}; st.rows.forEach(function (s) { byId[s.part_id] = s; });
  return rows.map(function (r) { return rowToPart(r, byId[r.id] || null); });
}

async function getCompatibleParts(vehicle, opts) {
  opts = opts || {};
  var params = [], where = [];
  var vis = visibility(opts.orgId, params);
  var conds = [];
  if (vehicle.local_id) { params.push(vehicle.local_id); conds.push('c.vehicle_id = $' + params.length); }
  if (vehicle.tecdoc_car_id) { params.push(vehicle.tecdoc_car_id); conds.push('c.tecdoc_car_id = $' + params.length); }
  if (vehicle.manufacturer && vehicle.model) {
    params.push(vehicle.manufacturer); var pm = params.length; params.push(vehicle.model); var pmo = params.length;
    var attr = 'UPPER(c.make) = UPPER($' + pm + ') AND UPPER(c.model) = UPPER($' + pmo + ')';
    if (vehicle.motorisation) { params.push(vehicle.motorisation); attr += ' AND (c.motorisation IS NULL OR UPPER(c.motorisation) = UPPER($' + params.length + '))'; }
    else attr += ' AND c.motorisation IS NULL';
    if (vehicle.year) { params.push(vehicle.year); attr += ' AND (c.year_from IS NULL OR c.year_from <= $' + params.length + ') AND (c.year_to IS NULL OR c.year_to >= $' + params.length + ')'; }
    conds.push('(' + attr + ')');
  }
  if (!conds.length) return [];
  where.push(vis); where.push('(' + conds.join(' OR ') + ')');
  if (opts.category) { params.push(opts.category); where.push('p.category = $' + params.length); }
  var res = await db.query('SELECT DISTINCT ' + PART_COLS + ' FROM idauto_parts p JOIN idauto_part_compatibility c ON c.part_id = p.id WHERE ' + where.join(' AND ') + ' ORDER BY p.category, p.brand, p.reference LIMIT 200', params);
  return withStock(res.rows, opts.orgId);
}

async function searchParts(query, opts) {
  opts = opts || {};
  var q = String(query || '').trim().slice(0, 80);
  if (!q) return [];
  var params = [];
  var vis = visibility(opts.orgId, params);
  params.push(normalizeReference(q)); var pn = params.length;
  params.push('%' + q.toUpperCase() + '%'); var pl = params.length;
  var res = await db.query('SELECT ' + PART_COLS + ' FROM idauto_parts p WHERE ' + vis + ' AND (p.reference_normalized LIKE $' + pn + " || '%' OR UPPER(COALESCE(p.oe_reference,'')) LIKE $" + pl + ' OR UPPER(COALESCE(p.name,\'\')) LIKE $' + pl + ' OR UPPER(p.brand) LIKE $' + pl + ') ORDER BY p.brand, p.reference LIMIT 100', params);
  return withStock(res.rows, opts.orgId);
}

async function getPartDetails(localId, opts) {
  opts = opts || {};
  var params = [localId];
  var vis = visibility(opts.orgId, params);
  var res = await db.query('SELECT ' + PART_COLS + ' FROM idauto_parts p WHERE p.id = $1 AND ' + vis, params);
  if (!res.rows.length) return null;
  var parts = await withStock(res.rows, opts.orgId);
  var compat = await db.query('SELECT id, tecdoc_car_id, vehicle_id, make, model, motorisation, year_from, year_to, source FROM idauto_part_compatibility WHERE part_id = $1 ORDER BY id', [localId]);
  parts[0].compatibility = compat.rows;
  return parts[0];
}

function orgOf(actor) { return actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }

async function createPart(body, actor) {
  if (!body || !body.reference || !body.brand) throw errors.IdautoError('VALIDATION', { required: ['reference', 'brand'] });
  var orgId = orgOf(actor);
  var source = body.source === 'import' ? 'import' : 'local';
  return writes.withAudit(
    { principal: actor.principal, event_type: 'part.create', target_type: 'idauto_parts', change_summary: 'Catalogue part entered (' + source + ')' },
    actor.identity,
    async function (client) {
      var res = await client.query(
        'INSERT INTO idauto_parts (reference, reference_normalized, brand, oe_reference, category, name, source, org_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, reference, brand, oe_reference, category, name, source, org_id',
        [String(body.reference).trim().slice(0, 60), normalizeReference(body.reference), String(body.brand).trim().slice(0, 80),
          body.oe_reference ? String(body.oe_reference).trim().slice(0, 60) : null, body.category ? String(body.category).trim().slice(0, 80) : null,
          body.name ? String(body.name).trim().slice(0, 200) : null, source, orgId, actor.identity]);
      var row = res.rows[0];
      return { record: rowToPart(row), auditTargetRef: row.id };
    });
}

async function addCompatibility(localId, body, actor) {
  body = body || {};
  var orgId = orgOf(actor);
  var vehicleId = null;
  if (body.vehicle_ref) {
    var v = await db.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1 OR ivid = $1', [String(body.vehicle_ref)]);
    if (!v.rows.length) throw errors.IdautoError('VEHICLE_NOT_FOUND');
    vehicleId = v.rows[0].id;
  }
  var tecdoc = body.tecdoc_car_id ? parseInt(body.tecdoc_car_id, 10) : null;
  if (!vehicleId && !tecdoc && !body.manufacturer) throw errors.IdautoError('VALIDATION', { required_one_of: ['vehicle_ref', 'tecdoc_car_id', 'manufacturer+model'] });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'part.compatibility.create', target_type: 'idauto_part_compatibility', change_summary: 'Compatibility added to part ' + localId },
    actor.identity,
    async function (client) {
      var own = await client.query('SELECT id, org_id FROM idauto_parts WHERE id = $1', [localId]);
      if (!own.rows.length) throw errors.IdautoError('NOT_FOUND');
      if (orgId && own.rows[0].org_id && own.rows[0].org_id !== orgId) throw errors.IdautoError('FORBIDDEN');
      var res = await client.query(
        'INSERT INTO idauto_part_compatibility (part_id, tecdoc_car_id, vehicle_id, make, model, motorisation, year_from, year_to, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, tecdoc_car_id, vehicle_id, make, model, motorisation, year_from, year_to, source',
        [localId, isFinite(tecdoc) ? tecdoc : null, vehicleId, body.manufacturer ? String(body.manufacturer).slice(0, 80) : null, body.model ? String(body.model).slice(0, 80) : null,
          body.motorisation ? String(body.motorisation).slice(0, 80) : null, body.year_from ? parseInt(body.year_from, 10) : null, body.year_to ? parseInt(body.year_to, 10) : null, 'local', actor.identity]);
      return { record: res.rows[0], auditTargetRef: res.rows[0].id };
    });
}

async function setStock(localId, body, actor) {
  var orgId = orgOf(actor) || (body && body.org_id ? parseInt(body.org_id, 10) : null);
  if (!orgId) throw errors.IdautoError('VALIDATION', { required: ['org_id (admin) or an organisation credential'] });
  var qty = body && body.quantity !== undefined ? parseInt(body.quantity, 10) : 0;
  if (!isFinite(qty) || qty < 0) throw errors.IdautoError('VALIDATION', { field: 'quantity' });
  var price = body && body.price_millimes !== undefined && body.price_millimes !== null ? parseInt(body.price_millimes, 10) : null;
  if (price !== null && (!isFinite(price) || price < 0)) throw errors.IdautoError('VALIDATION', { field: 'price_millimes' });
  return writes.withAudit(
    { principal: actor.principal, event_type: 'stock.set', target_type: 'idauto_org_stock', change_summary: 'Stock set for part ' + localId },
    actor.identity,
    async function (client) {
      var res = await client.query(
        'INSERT INTO idauto_org_stock (org_id, part_id, quantity, price_millimes, currency, updated_by) VALUES ($1,$2,$3,$4,$5,$6) ' +
        'ON CONFLICT (org_id, part_id) DO UPDATE SET quantity = EXCLUDED.quantity, price_millimes = EXCLUDED.price_millimes, currency = EXCLUDED.currency, updated_by = EXCLUDED.updated_by, updated_at = NOW() ' +
        'RETURNING org_id, part_id, quantity, price_millimes, currency, updated_at',
        [orgId, localId, qty, price, (body && body.currency ? String(body.currency).toUpperCase().slice(0, 3) : 'TND'), actor.identity]);
      var st = res.rows[0]; st.price_millimes = st.price_millimes === null ? null : Number(st.price_millimes);
      return { record: st, auditTargetRef: orgId + ':' + localId };
    });
}

module.exports = { getCompatibleParts: getCompatibleParts, searchParts: searchParts, getPartDetails: getPartDetails,
  createPart: createPart, addCompatibility: addCompatibility, setStock: setStock, normalizeReference: normalizeReference };
