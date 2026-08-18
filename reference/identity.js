'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2E-PRE — minimal Mythos identity stub
// reference/identity.js
//
// NOT the `mythos_auth` integration contract described in
// docs/ARCHITECTURE.md §4.1 (JWT/opaque-ref tokens issued by a real
// Mythos OS auth service) — that service does not exist anywhere in this
// codebase (confirmed by direct search before this stage began: the main
// app's only "auth" is a single shared client-side password with no
// per-user identity at all — see the IDA-2E blocker record in
// docs/AI_HANDOVER.md). Full `mythos_auth` integration remains blocked
// until a real Mythos OS identity service exists to integrate with.
//
// This is a deliberately minimal, honestly-labeled stopgap: a small,
// explicit, config-defined map of admin bearer tokens to stable identity
// strings. It replaces IDA-2C/2D's single undifferentiated placeholder
// token, so audit records can finally say WHO performed an action (not
// just "some admin, unspecified") — without pretending this is a real
// multi-user authentication system. No login flow, no session, no JWT,
// no user table. Tokens are still static, operator-provisioned secrets,
// not user-chosen credentials.
// =====================================================

// Parses IDAUTO_ADMIN_IDENTITIES once per process. Format: JSON object,
// { "<bearer token>": "<stable identity string>", ... }. Never logs the
// raw env var value — a parse failure only reports that it failed, not
// the (secret-containing) input.
var _identities = null;

function loadIdentities() {
  if (_identities !== null) return _identities;
  var raw = process.env.IDAUTO_ADMIN_IDENTITIES;
  if (!raw) {
    _identities = {};
    return _identities;
  }
  try {
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      _identities = parsed;
    } else {
      _identities = {};
    }
  } catch (e) {
    _identities = {};
  }
  return _identities;
}

// Returns the identity string for a raw bearer token, or null if the
// token is not a recognized admin identity. Callers must never store or
// log the token itself alongside the identity — only the identity string
// is safe to persist (e.g. into idauto_audit_log.actor_ref).
function resolveIdentity(token) {
  if (!token) return null;
  var identities = loadIdentities();
  return Object.prototype.hasOwnProperty.call(identities, token) ? identities[token] : null;
}

// Test/ops helper — forces a re-parse on the next resolveIdentity() call.
// Mirrors db.js's closePool()/writes.js's cache-free design: nothing here
// is cached in a way tests can't reset between runs.
function clearIdentityCache() {
  _identities = null;
}

module.exports = {
  resolveIdentity: resolveIdentity,
  clearIdentityCache: clearIdentityCache
};
