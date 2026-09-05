'use strict';
// =====================================================
// IDauto — IDA-V13 — signed-in user → principal
// reference/auth/principal.js
//
// Turns a Better Auth session (validated server-side on EVERY request) into
// the same principal shape the authorisation gate already understands:
//
//   admin      → { kind:'admin',        scopes:['*'] }              everything
//   manager    → { kind:'organisation', org_id, scopes: MANAGER }   its organisation, incl. VIN
//   technician → { kind:'organisation', org_id, scopes: TECHNICIAN } its organisation, no VIN
//
// The role and org_id come from the database row, never from the browser.
// A manager or technician without an organisation is refused: there is no
// scope such an account could safely hold.
//
// Two request shapes reach here:
//   • a PAGE load (/atelier, /admin): the cookie alone suffices;
//   • an API call (/api/*): the cookie AND the header `X-IDauto-Session: 1`.
//     A cross-site form or image cannot set that header, and a cross-site
//     fetch that tries becomes a CORS preflight this server never answers —
//     the same belt-and-braces the owner cookie (IDA-V1B) already uses, on
//     top of SameSite=Lax.
// =====================================================

var fromNodeHeaders = require('better-auth/node').fromNodeHeaders;
var toNodeHandler = require('better-auth/node').toNodeHandler;
var authModule = require('./auth.js');

var SESSION_HEADER = 'x-idauto-session';

var MANAGER_SCOPES = ['vehicle:read', 'vehicle:write', 'vehicle:search', 'vehicle:resolve', 'vin:search', 'plate:read', 'fact:read', 'fact:write',
  'observation:read', 'observation:write', 'passport:read', 'identity:resolve', 'parts:read', 'parts:write', 'stock:write', 'workshop:read', 'workshop:write'];
var TECHNICIAN_SCOPES = ['vehicle:read', 'vehicle:write', 'vehicle:search', 'vehicle:resolve', 'plate:read', 'fact:read',
  'observation:read', 'observation:write', 'passport:read', 'identity:resolve', 'parts:read', 'workshop:read', 'workshop:write'];

// The exact Better Auth routes the web UI may reach. Everything else under
// /api/auth (sign-up, social, password reset by e-mail, …) is 404.
var ALLOWED_AUTH_PATHS = { '/api/auth/sign-in/email': 'POST', '/api/auth/sign-out': 'POST', '/api/auth/get-session': 'GET',
  '/api/auth/change-password': 'POST', '/api/auth/list-sessions': 'GET', '/api/auth/revoke-session': 'POST',
  '/api/auth/revoke-sessions': 'POST', '/api/auth/revoke-other-sessions': 'POST' };

function principalFor(user) {
  var ref = 'user:' + String(user.id).slice(0, 59);
  if (user.role === 'admin') return { actor_ref: ref, org_id: null, scopes: ['*'], kind: 'admin', role: 'admin', user: publicUser(user) };
  if (user.role === 'manager' || user.role === 'technician') {
    if (!user.org_id) return null;
    return { actor_ref: ref, org_id: Number(user.org_id), scopes: (user.role === 'manager' ? MANAGER_SCOPES : TECHNICIAN_SCOPES).slice(), kind: 'organisation', role: user.role, user: publicUser(user) };
  }
  return null;
}
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, org_id: u.org_id === undefined ? null : u.org_id }; }

// → { principal, user, session } | null. Never throws to the caller: an
// auth-store failure is a "no session", logged by the caller as such.
async function resolveUserSession(req, opts) {
  opts = opts || {};
  if (opts.requireHeader && req.headers[SESSION_HEADER] !== '1') return null;
  var cookie = req.headers.cookie || '';
  if (cookie.indexOf(authModule.COOKIE_PREFIX + '.session_token=') === -1 && cookie.indexOf('__Secure-' + authModule.COOKIE_PREFIX + '.session_token=') === -1) return null;
  var result;
  try {
    result = await authModule.getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch (_) {
    return null;
  }
  if (!result || !result.user) return null;
  var principal = principalFor(result.user);
  if (!principal) return { principal: null, user: publicUser(result.user), session: result.session, reason: 'role_without_organisation' };
  return { principal: principal, user: principal.user, session: result.session };
}

var _handler = null;
// Forwards an allow-listed /api/auth/* request to Better Auth. Returns true
// when the request was handled (including a 404 for a non-listed path).
function handleAuthRoute(req, res, pathname) {
  if (pathname !== '/api/auth' && pathname.indexOf('/api/auth/') !== 0) return false;
  var allowed = ALLOWED_AUTH_PATHS[pathname];
  if (!allowed) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return true; }
  if (req.method !== allowed) { res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': allowed }); res.end(JSON.stringify({ error: 'method not allowed' })); return true; }
  if (!_handler) _handler = toNodeHandler(authModule.getAuth());
  _handler(req, res);
  return true;
}

module.exports = { resolveUserSession: resolveUserSession, handleAuthRoute: handleAuthRoute, principalFor: principalFor,
  SESSION_HEADER: SESSION_HEADER, MANAGER_SCOPES: MANAGER_SCOPES, TECHNICIAN_SCOPES: TECHNICIAN_SCOPES, ALLOWED_AUTH_PATHS: ALLOWED_AUTH_PATHS };
