'use strict';

/* IDA-V1C — Bearer parsing, auth logging, and the admin UI's error path.
 *
 * The incident this suite exists for: a valid admin token was reported as
 * "refused" by /admin. It was not — a base64 token containing '/' and
 * ending with '=' had been truncated by a double-click selection, and
 * nothing on the host logged the denial, so the failure could not be told
 * apart from a broken server.
 *
 * The security property that matters most here is negative: NO credential,
 * whole or partial, may ever reach the log. That is asserted directly, by
 * capturing every line the module writes and searching it for the token.
 *
 * No database is reached. The dummy IDAUTO_DB_* point at a closed port. */

var http = require('http');
var crypto = require('crypto');
var path = require('path');
var fs = require('fs');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
// Reported through the REAL console.log: this suite swaps console.log out to
// capture what the module writes, and its own output must not land in the
// captured buffer (nor the buffer in its output).
var realLog = console.log;
function say(message) { realLog(message); }
function ok(value, label) { if (value) { pass++; realLog('  PASS ' + label); } else { fail++; realLog('  FAIL ' + label); } }

// A token shaped exactly like the real one: base64 of 32 bytes, so it can
// contain '/' and '+' and ends with '='. Regenerated until it contains a
// '/', because that character is the whole point of the truncation case.
var ADMIN_TOKEN;
do { ADMIN_TOKEN = crypto.randomBytes(32).toString('base64'); } while (ADMIN_TOKEN.indexOf('/') === -1);
var ADMIN_REF = 'usr_' + crypto.randomBytes(16).toString('hex');

process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify((function () { var m = {}; m[ADMIN_TOKEN] = ADMIN_REF; return m; })());
process.env.IDAUTO_DB_HOST = process.env.IDAUTO_DB_HOST || '127.0.0.1';
process.env.IDAUTO_DB_PORT = process.env.IDAUTO_DB_PORT || '1';
process.env.IDAUTO_DB_USER = process.env.IDAUTO_DB_USER || 'unused';
process.env.IDAUTO_DB_PASSWORD = process.env.IDAUTO_DB_PASSWORD || 'unused';
process.env.IDAUTO_DB_NAME = process.env.IDAUTO_DB_NAME || 'unused';

var api = require(path.join(BASE, 'reference', 'api.js'));

// ---- capture everything the module logs, for the whole run ----
var logLines = [];
function captureOn() { console.log = function () { logLines.push(Array.prototype.join.call(arguments, ' ')); }; }
function captureOff() { console.log = realLog; }

function parseStatic() {
  say('\nSTATIC — RFC-conformant Bearer parsing');
  var e = api._extractBearer;

  ok(e('Bearer ' + ADMIN_TOKEN) === ADMIN_TOKEN, 'a well-formed header yields the credential unchanged');
  ok(e('bearer ' + ADMIN_TOKEN) === ADMIN_TOKEN, 'the scheme is case-insensitive (RFC 7235 §2.1)');
  ok(e('BEARER ' + ADMIN_TOKEN) === ADMIN_TOKEN, 'an upper-case scheme is accepted');
  ok(e('Bearer   ' + ADMIN_TOKEN) === ADMIN_TOKEN, 'several spaces after the scheme are tolerated');
  ok(e('Bearer\t' + ADMIN_TOKEN) === ADMIN_TOKEN, 'a tab after the scheme is tolerated');
  ok(e('  Bearer ' + ADMIN_TOKEN + '  ') === ADMIN_TOKEN, 'surrounding whitespace is stripped');
  ok(e('Bearer ' + ADMIN_TOKEN + '\t') === ADMIN_TOKEN, 'a trailing tab is stripped');

  // The credential must survive byte for byte — this is the constraint that
  // keeps every existing token working.
  ok(e('Bearer ' + ADMIN_TOKEN).indexOf('/') !== -1, 'a "/" inside the credential is preserved');
  ok(e('Bearer ' + ADMIN_TOKEN).slice(-1) === '=', 'a trailing "=" is preserved');
  ok(e('Bearer aB/c+D=') === 'aB/c+D=', 'the full base64 alphabet survives parsing');
  ok(e('Bearer AbC') !== 'abc' && e('Bearer AbC') === 'AbC', 'the credential is NOT case-folded');

  ok(e('') === null, 'an empty header yields null');
  ok(e(undefined) === null, 'a missing header yields null');
  ok(e(null) === null, 'a null header yields null');
  ok(e('Bearer') === null, 'a scheme with no credential yields null');
  ok(e('Bearer ') === null, 'a scheme with only whitespace yields null');
  ok(e('Basic ' + ADMIN_TOKEN) === null, 'a non-Bearer scheme yields null');
  ok(e('Bearer a b') === null, 'a credential containing a space is a parse failure, not a truncation');
  ok(e(ADMIN_TOKEN) === null, 'a bare credential with no scheme yields null');
}

function noSecretsInLogs() {
  say('\nLOG SAFETY — no credential, whole or partial, may be written');
  var joined = logLines.join('\n');

  ok(logLines.length > 0, 'the run produced auth log lines to inspect (' + logLines.length + ')');
  ok(joined.indexOf(ADMIN_TOKEN) === -1, 'the full token never appears in the log');

  // A prefix or suffix is a piece of the secret. Assert no run of 8+
  // characters from the token appears anywhere in the log.
  var leaked = null;
  for (var i = 0; i + 8 <= ADMIN_TOKEN.length; i++) {
    var chunk = ADMIN_TOKEN.slice(i, i + 8);
    if (joined.indexOf(chunk) !== -1) { leaked = i; break; }
  }
  ok(leaked === null, 'no 8-character run of the token appears in the log');

  ok(joined.indexOf(process.env.IDAUTO_DB_PASSWORD) === -1 || process.env.IDAUTO_DB_PASSWORD === 'unused', 'no database password in the log');
  // The word "authorization" legitimately appears inside the reason code
  // `malformed_authorization`. What must never appear is a credential: the
  // scheme-plus-value form, or any token material.
  ok(!/Bearer\s/i.test(joined), 'no Authorization header VALUE is ever logged');

  // Every line must be one parseable JSON object with the expected shape.
  var authLines = logLines.filter(function (l) { return l.indexOf('"event":"auth"') !== -1; });
  ok(authLines.length > 0, 'auth decisions were logged (' + authLines.length + ')');
  var allParse = authLines.every(function (line) {
    try {
      var o = JSON.parse(line);
      return typeof o.at === 'string' && typeof o.result === 'string' &&
             typeof o.method === 'string' && typeof o.path === 'string';
    } catch (_) { return false; }
  });
  ok(allParse, 'every auth line is a single JSON object carrying at/result/method/path');

  var granted = authLines.map(JSON.parse).filter(function (o) { return o.result === 'granted'; });
  var denied = authLines.map(JSON.parse).filter(function (o) { return o.result === 'denied'; });
  ok(granted.length > 0 && denied.length > 0, 'both grants and denials were logged');
  ok(granted.every(function (o) { return o.credential_length === undefined; }), 'a GRANTED decision never records the credential length');
  ok(denied.some(function (o) { return typeof o.credential_length === 'number'; }), 'a DENIED decision records the rejected input length');
  ok(granted.every(function (o) { return o.actor === ADMIN_REF; }), 'a grant records the resolved actor_ref, which is an identity and not a secret');
  ok(authLines.map(JSON.parse).every(function (o) { return o.client === null || /^[a-f0-9]{16}$/.test(o.client); }), 'the client is a 16-hex hash prefix, never a raw IP');
}

// ---------------------------------------------------------------- HTTP ----

var server, port;

function request(method, requestPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: '127.0.0.1', port: port, path: requestPath, method: method,
      headers: Object.assign({ 'Content-Length': 0 }, headers || {})
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function httpCases() {
  say('\nHTTP — the incident, reproduced and distinguished');

  // /health queries the database, which is deliberately unreachable here, so
  // a granted request lands on a handler error rather than 200. What is
  // asserted is the AUTH outcome: anything other than 401 means the gate
  // passed. The log assertions below confirm the grant independently.
  var okResp = await request('GET', '/health', { Authorization: 'Bearer ' + ADMIN_TOKEN });
  ok(okResp.status !== 401, 'the exact token is accepted (status ' + okResp.status + ')');

  var lower = await request('GET', '/health', { Authorization: 'bearer ' + ADMIN_TOKEN });
  ok(lower.status !== 401, 'a lower-case scheme is now accepted (was 401 before this change)');

  var doubleSpace = await request('GET', '/health', { Authorization: 'Bearer  ' + ADMIN_TOKEN });
  ok(doubleSpace.status !== 401, 'a double space after the scheme is now accepted (was 401)');

  // The reported incident: a truncated paste. Still refused — correctly.
  var truncatedAtSlash = await request('GET', '/health', { Authorization: 'Bearer ' + ADMIN_TOKEN.slice(ADMIN_TOKEN.lastIndexOf('/') + 1) });
  ok(truncatedAtSlash.status === 401, 'a paste truncated at "/" is still refused');
  ok(truncatedAtSlash.body.reason === 'invalid_credentials', 'a truncated paste reports invalid_credentials');

  var noEquals = await request('GET', '/health', { Authorization: 'Bearer ' + ADMIN_TOKEN.replace(/=+$/, '') });
  ok(noEquals.status === 401, 'a paste missing the trailing "=" is still refused');

  var folded = await request('GET', '/health', { Authorization: 'Bearer ' + ADMIN_TOKEN.toLowerCase() });
  ok(folded.status === 401, 'a lower-cased CREDENTIAL is still refused — no token was weakened');

  var none = await request('GET', '/health');
  ok(none.status === 401, 'no credential is refused');
  ok(none.body.reason === 'no_credentials', 'a missing credential is reported as no_credentials, not invalid');

  var basic = await request('GET', '/health', { Authorization: 'Basic ' + ADMIN_TOKEN });
  ok(basic.status === 401, 'a non-Bearer scheme is refused');

  var spaced = await request('GET', '/health', { Authorization: 'Bearer a b' });
  ok(spaced.status === 401, 'a credential containing a space is refused');

  // The response body must stay free of any hint about the real token.
  var bodies = [truncatedAtSlash.raw, noEquals.raw, none.raw, folded.raw].join('\n');
  ok(bodies.indexOf(ADMIN_TOKEN) === -1, 'no 401 body echoes the token');
  ok(!/\b44\b|length/i.test(bodies), 'no 401 body reveals the expected token length');

  // Public surface untouched.
  var pub = await request('GET', '/public/passport/ivid:1:ABCDEFGHJKMNPQRS:AB');
  ok(pub.status !== 401, 'the anonymous public route still needs no credential');
  var home = await request('GET', '/');
  ok(home.status === 200, 'the citizen homepage is still served without credentials');
}

function adminUiCases() {
  say('\nADMIN UI — the error path, without echoing anything');
  var source = fs.readFileSync(path.join(BASE, 'reference', 'admin-ui.js'), 'utf8');

  ok(/getElementById\('admin-token'\)\.value\.trim\(\)/.test(source), 'the token field is trimmed before use');
  ok(!/getElementById\('admin-token'\)\.value(?!\.trim)/.test(source), 'the token field is never read untrimmed');
  ok(/triple-clic/i.test(source), 'the 401 message tells the operator to select the whole line');
  ok(/response\.status === 401/.test(source), 'a 401 is handled distinctly from other failures');
  ok(/no_credentials/.test(source), 'the UI distinguishes "nothing sent" from "not a token"');
  ok(/function tokenProblem/.test(source), 'a local shape check runs before any request is spent');

  // The UI must never render the credential back to the page.
  ok(!/textContent\s*=\s*[^;]*\btoken\b/.test(source), 'no message interpolates the token into the DOM');
  ok(!/console\.(log|error|warn)\s*\([^)]*token/i.test(source), 'the UI never logs the token to the browser console');
}

async function main() {
  parseStatic();

  server = api.createServer();
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  captureOn();
  try {
    await httpCases();
  } finally {
    captureOff();
    server.close();
  }

  adminUiCases();
  noSecretsInLogs();

  say('\nIDA-V1C auth diagnostics: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
  captureOff();
  console.error('FATAL: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
