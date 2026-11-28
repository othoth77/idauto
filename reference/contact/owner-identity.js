'use strict';
// =====================================================
// IDauto — CONTACT integration — vehicle owner identity
// reference/contact/owner-identity.js
//
// CONTACT (https://github.com/othoth77/contact) is the Mythos master contact
// registry: the single owner of person / organisation identity (CNT1
// ids). This module is IDauto's one seam towards it for VEHICLE OWNERS. It
// talks to CONTACT only through the vendored SDK (./contact-client.js).
//
// Mode — env IDAUTO_CONTACT_MODE (anything else, or unset, is 'off'):
//   off            Legacy behaviour, today's state. No CONTACT call at all.
//   shadow         The local owner store (idauto_vehicle_owner_contacts) stays
//                  authoritative. AFTER the local write has committed, the
//                  owner is resolved in CONTACT and the returned CNT is saved on
//                  the row (contact_id). If CONTACT is unavailable the request
//                  still succeeds: the row is marked contact_sync_pending = TRUE
//                  for a later drainPending(). Never blocks, never throws.
//   authoritative  NOT ENABLED ANYWHERE. Registration / owner save resolves the
//                  owner in CONTACT BEFORE the transaction and the row stores
//                  only contact_id (no local name / phone / e-mail / address).
//                  CONTACT unavailable → the request fails with
//                  CONTACT_UNAVAILABLE (503). No id is ever fabricated.
//
// Configuration: CONTACT_BASE_URL (https only, loopback http for tests),
// CONTACT_TOKEN (<project>.<secret>, never logged), CONTACT_TIMEOUT_MS,
// CONTACT_RETRIES — read by the SDK's configFromEnv(). Tests inject a fake
// transport with configure({ fetch }) (mirrors http-vehicle-provider.js).
//
// Rules (docs/PRIVACY_ARCHITECTURE.md §1a): no remote call inside a database
// transaction; log lines and audit rows carry the internal vehicle id, the
// mode and the outcome only — never a name, phone, e-mail, address or CNT.
// =====================================================

var sdk = require('./contact-client.js');
var errors = require('../vehicle/errors.js');

var MODES = ['off', 'shadow', 'authoritative'];
var state = { opts: {}, client: null, inflight: [] };

// Tests (and only tests) inject { env, mode, fetch, client, query, log }.
function configure(opts) { state.opts = opts || {}; state.client = null; state.inflight = []; }
function env() { return state.opts.env || process.env; }
function mode() {
  var m = String(state.opts.mode || env().IDAUTO_CONTACT_MODE || 'off').trim().toLowerCase();
  return MODES.indexOf(m) === -1 ? 'off' : m;
}
function log(line) { (state.opts.log || console.warn)('[idauto/contact] ' + line); }
function query(text, params) { return state.opts.query ? state.opts.query(text, params) : require('../db.js').query(text, params); }

function client() {
  if (state.opts.client) return state.opts.client;
  if (!state.client) {
    var cfg = sdk.configFromEnv(env());
    if (state.opts.fetch) cfg.fetch = state.opts.fetch;
    state.client = sdk.createClient(cfg);   // throws ContactConfigError when unconfigured
  }
  return state.client;
}

function orgOf(actor) { return actor && actor.principal && actor.principal.kind === 'organisation' ? actor.principal.org_id : null; }
function recordId(vehicleId, orgId) { return String(vehicleId) + '@' + (orgId ? String(orgId) : 'admin'); }

// owner = the output of owner-contacts.validate(): full_name, phone, email, address (notes stay out).
function resolveBody(owner, source) {
  var channels = [];
  if (owner.phone) channels.push({ kind: 'PHONE', value: owner.phone, label: 'mobile' });
  if (owner.email) channels.push({ kind: 'EMAIL', value: owner.email });
  if (owner.address) channels.push({ kind: 'ADDRESS', value: owner.address });
  var body = { entity_type: 'PERSON', full_name: owner.full_name, channels: channels, relationship_type: 'vehicle_owner', create_if_missing: true };
  if (source) body.source = source;
  return body;
}

// The error's kind only (TIMEOUT, UNREACHABLE, SERVER_ERROR, …): SDK messages carry no PII, but nothing else is needed.
function kindOf(err) { return (err && (err.kind || err.name)) || 'Error'; }
function track(p) {
  var settled = p.then(function () {}, function () {});
  state.inflight.push(settled);
  settled.then(function () { var i = state.inflight.indexOf(settled); if (i !== -1) state.inflight.splice(i, 1); });
  return settled;
}

// The current local row written for this owner (matched on its own values so a concurrent supersede is not stamped).
var MATCH_ROW = 'vehicle_id = $1 AND COALESCE(org_id, 0) = COALESCE($2::int, 0) AND superseded_at IS NULL AND full_name = $3 ' +
  'AND phone_normalized IS NOT DISTINCT FROM $4 AND email IS NOT DISTINCT FROM $5';

/* SHADOW — after the local commit. Never throws. */
async function syncShadow(vehicleId, orgId, owner) {
  var key = [vehicleId, orgId, owner.full_name, owner.phone_normalized || null, owner.email || null];
  try {
    var r = await client().resolve(resolveBody(owner, { ref_kind: 'vehicle_owner', record_id: recordId(vehicleId, orgId) }));
    if (r && sdk.isContactId(r.contact_id)) {
      await query('UPDATE idauto_vehicle_owner_contacts SET contact_id = $6, contact_sync_pending = FALSE WHERE ' + MATCH_ROW, key.concat([r.contact_id]));
      log('shadow vehicle=' + vehicleId + ' linked decision=' + r.decision);
      return { linked: true };
    }
    // review / ambiguous / not_found: a human decides in CONTACT; the row stays unlinked and is not retried.
    await query('UPDATE idauto_vehicle_owner_contacts SET contact_sync_pending = FALSE WHERE ' + MATCH_ROW, key);
    log('shadow vehicle=' + vehicleId + ' unlinked decision=' + (r && r.decision));
    return { linked: false, decision: r && r.decision };
  } catch (err) {
    var permanent = err && err.name === 'ContactValidationError';
    try { await query('UPDATE idauto_vehicle_owner_contacts SET contact_sync_pending = $6 WHERE ' + MATCH_ROW, key.concat([!permanent])); }
    catch (_) { /* the marker is best effort; the local owner row is already committed */ }
    log('shadow vehicle=' + vehicleId + ' ' + (permanent ? 'rejected' : 'pending') + ' error=' + kindOf(err));
    return { linked: false, pending: !permanent };
  }
}

/* AUTHORITATIVE — before the transaction. Returns { contact_id } from CONTACT, or throws. */
async function resolveOwner(owner, actor, source) {
  var r;
  try {
    r = await client().resolve(resolveBody(owner, source || null));
  } catch (err) {
    log('authoritative refused error=' + kindOf(err));
    if (err && err.name === 'ContactValidationError') throw errors.IdautoError('VALIDATION', { field: 'owner', reason: 'rejected_by_contact' });
    throw errors.IdautoError('CONTACT_UNAVAILABLE', { reason: 'contact_unavailable' });
  }
  if (!r || !sdk.isContactId(r.contact_id)) {
    log('authoritative review decision=' + (r && r.decision));
    throw errors.IdautoError('CONTACT_REVIEW_REQUIRED', { reason: (r && r.decision) || 'unresolved' });
  }
  return { contact_id: r.contact_id };
}

/* AUTHORITATIVE — after the commit: link the CNT to this vehicle record in CONTACT. Best effort, never throws. */
async function associate(vehicleId, orgId, contactId) {
  try {
    await client().associate(contactId, { relationship_type: 'vehicle_owner', source_record_ref: recordId(vehicleId, orgId) });
  } catch (err) {
    log('authoritative vehicle=' + vehicleId + ' association pending error=' + kindOf(err));
  }
}

// Called once the local owner write has COMMITTED. Off: nothing. Returns a promise that never rejects
// (the request does not wait for it; tests and shutdown use settle()).
function afterOwnerWrite(vehicleId, actor, owner, link) {
  var m = mode();
  if (m === 'shadow' && owner) return track(syncShadow(vehicleId, orgOf(actor), owner));
  if (m === 'authoritative' && link && link.contact_id) return track(associate(vehicleId, orgOf(actor), link.contact_id));
  return Promise.resolve();
}

function settle() { return Promise.all(state.inflight.slice()); }

// Shadow catch-up for rows marked contact_sync_pending (e.g. from an ops script once CONTACT is back).
async function drainPending(limit) {
  if (mode() !== 'shadow') return { attempted: 0, linked: 0 };
  var rows = (await query('SELECT vehicle_id, org_id, full_name, phone, phone_normalized, email, address FROM idauto_vehicle_owner_contacts ' +
    'WHERE contact_sync_pending AND contact_id IS NULL AND superseded_at IS NULL ORDER BY id LIMIT $1', [limit || 50])).rows;
  var linked = 0;
  for (var i = 0; i < rows.length; i++) {
    var res = await syncShadow(rows[i].vehicle_id, rows[i].org_id, rows[i]);
    if (res.linked) linked++;
    else if (res.pending) break;   // still down: stop, keep order
  }
  return { attempted: rows.length, linked: linked };
}

module.exports = { MODES: MODES, configure: configure, mode: mode, resolveOwner: resolveOwner, afterOwnerWrite: afterOwnerWrite,
  settle: settle, drainPending: drainPending, recordId: recordId, _syncShadow: syncShadow };
