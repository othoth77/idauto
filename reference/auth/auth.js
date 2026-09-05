'use strict';
// =====================================================
// IDauto — IDA-V13 — Better Auth instance
// reference/auth/auth.js
//
// The ONE place the authentication library is configured. Better Auth owns
// users, password hashing (scrypt), sessions, sign-in, sign-out, password
// change, expiry, revocation and the sign-in rate limit, on the existing
// PostgreSQL pool. IDauto adds two user fields it reads SERVER-SIDE only:
// role (admin | manager | technician) and org_id.
//
// SIGN-UP IS NOT A PUBLIC ROUTE. api.js forwards only an allow-list of
// Better Auth paths (sign-in/email, sign-out, get-session, change-password,
// list/revoke sessions); users are provisioned with ops/auth-users.js.
//
// SECRET. IDAUTO_AUTH_SECRET (≥ 32 chars, from the EnvironmentFile) signs
// the session cookie. Rotating it signs every user out.
// =====================================================

var betterAuth = require('better-auth').betterAuth;
var db = require('../db.js');

var COOKIE_PREFIX = 'idauto';
var SESSION_SECONDS = parseInt(process.env.IDAUTO_SESSION_TTL_SECONDS || String(12 * 3600), 10);
var ROLES = ['admin', 'manager', 'technician'];

var _auth = null;
function secret() {
  var s = process.env.IDAUTO_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('IDAUTO_AUTH_SECRET is required (32+ random characters, openssl rand -base64 32)');
  return s;
}
function isSecure() { return process.env.IDAUTO_COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'; }

function getAuth() {
  if (_auth) return _auth;
  var baseURL = process.env.IDAUTO_AUTH_BASE_URL || undefined;   // https://idauto.tn in production; inferred from the request otherwise
  _auth = betterAuth({
    appName: 'IDauto',
    baseURL: baseURL,
    basePath: '/api/auth',
    secret: secret(),
    database: db.getPool(),
    trustedOrigins: baseURL ? [baseURL] : [],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false, requireEmailVerification: false },
    user: {
      modelName: 'idauto_auth_user',
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'technician', input: false },
        org_id: { type: 'number', required: false, input: false }
      }
    },
    session: {
      modelName: 'idauto_auth_session',
      expiresIn: SESSION_SECONDS,
      updateAge: Math.min(3600, SESSION_SECONDS),
      cookieCache: { enabled: false }          // every request is validated against the database
    },
    account: { modelName: 'idauto_auth_account' },
    verification: { modelName: 'idauto_auth_verification' },
    rateLimit: {
      enabled: true, storage: 'database', modelName: 'idauto_auth_rate_limit',
      window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/change-password': { window: 60, max: 5 } }
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: isSecure(),
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, path: '/' }
    },
    logger: { level: 'warn', disabled: false }
  });
  return _auth;
}

module.exports = { getAuth: getAuth, ROLES: ROLES, COOKIE_PREFIX: COOKIE_PREFIX, SESSION_SECONDS: SESSION_SECONDS, isSecure: isSecure };
