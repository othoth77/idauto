'use strict';

/* IDA-V3 — unknown vehicle workflow. OWNER DECISION, 2026-08-27.
 *
 * A plate that resolves to nothing stops being a dead end. Two things must
 * hold, and both are asserted here by running the code:
 *
 *   - NOTHING is created when the visitor supplies nothing. No vehicle, no
 *     plate row, no fact, no observation — only one append-only audit row
 *     recording that the search happened.
 *   - The registration path is the EXISTING audited entry surface, reached
 *     with the plate already carried over. No second vehicle store, no second
 *     creation path, and no way for a human or a URL to choose the IVID.
 *
 * The database is stubbed, so the found/miss paths are deterministic and no
 * real database is touched. Every statement is captured — which is how "no
 * vehicle row was written" is proved rather than assumed.
 *
 * (This file reuses the harness introduced for IDA-V2.)
 * ------------------------------------------------------------------------
 * Original IDA-V2 header follows.
 *
 * IDA-V2 — public plate resolution. OWNER DECISION, 2026-08-27.
 *
 * This suite encodes the NEW rule and replaces
 * tests/ida-v1d-plate-no-public-resolution-test.js, which encoded the old
 * A5-PLATE rule that a plate must never resolve publicly. That rule is
 * withdrawn by the owner; both paths are now real:
 *
 *   PLATE → GET /public/plates/:plate  → IVID → passport
 *   IVID  → GET /public/passport/:ivid → passport
 *
 * WHAT DID NOT CHANGE, and is asserted here so it cannot drift: the plate
 * route returns exactly two fields and no vehicle attribute; internal_ref,
 * vehicle_id, governorate, plate status and validity dates stay behind the
 * authenticated route; the phase gate, the format-before-database gate and
 * the shared public_resolution rate-limit bucket all still apply; and the
 * page never shows a raw server error or a status code to the visitor.
 *
 * The database is STUBBED (the pattern tests/ida-3e-review-queue-test.js
 * already uses) so the found/not-found paths are deterministic and no real
 * database is touched. Every SQL statement the route issues is captured and
 * asserted — including that a malformed plate issues none at all. */

var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var BASE = path.join(__dirname, '..');
var WEB = path.join(BASE, 'web');

var pass = 0, fail = 0;
var realLog = console.log;
function say(message) { realLog(message); }
function ok(value, label) { if (value) { pass++; realLog('  PASS ' + label); } else { fail++; realLog('  FAIL ' + label); } }
function makeEvent(type, init) {
  init = init || {};
  return {
    type: type,
    bubbles: init.bubbles !== false,
    cancelable: !!init.cancelable,
    defaultPrevented: false,
    target: null,
    preventDefault: function () { if (this.cancelable) this.defaultPrevented = true; }
  };
}

function Doc() {
  this.activeElement = null;
  this._byId = {};
  this._all = [];
}

function El(tag, doc) {
  this.tagName = tag;
  this.ownerDocument = doc;
  this.children = [];
  this.parentNode = null;
  this.attributes = {};
  this.listeners = {};
  this.value = '';
  this.textContent = '';
  this._hidden = false;
  doc._all.push(this);
}

Object.defineProperty(El.prototype, 'hidden', {
  get: function () { return this._hidden; },
  set: function (v) { this._hidden = !!v; }
});

El.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
El.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};
El.prototype.hasAttribute = function (name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); };
El.prototype.append = function (child) { child.parentNode = this; this.children.push(child); return child; };

El.prototype.addEventListener = function (type, fn) {
  (this.listeners[type] = this.listeners[type] || []).push(fn);
};

El.prototype.dispatchEvent = function (event) {
  event.target = event.target || this;
  var node = this;
  while (node) {
    var handlers = node.listeners[event.type] || [];
    for (var i = 0; i < handlers.length; i++) handlers[i].call(node, event);
    node = event.bubbles ? node.parentNode : null;
  }
  return !event.defaultPrevented;
};

/* The mechanism under test: focusing an element blurs the one that had
 * focus, and a real browser fires `blur` on it. plate.js listens for that. */
El.prototype.focus = function () {
  var doc = this.ownerDocument;
  var previous = doc.activeElement;
  if (previous === this) return;
  doc.activeElement = this;
  if (previous) previous.dispatchEvent(makeEvent('blur', { bubbles: false }));
};

/* Supports the selector forms home.js and plate.js actually use:
 * #id, .class, [attr], tag, and tag[attr=value] / tag[attr="value"]. */
function matches(el, selector) {
  if (selector.charAt(0) === '#') return el.attributes.id === selector.slice(1);
  if (selector.charAt(0) === '.') return (el.attributes['class'] || '').split(/\s+/).indexOf(selector.slice(1)) !== -1;
  if (selector.charAt(0) === '[') return el.hasAttribute(selector.slice(1, -1));
  var compound = /^([a-zA-Z]+)\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(selector);
  if (compound) {
    if (el.tagName !== compound[1]) return false;
    if (!el.hasAttribute(compound[2])) return false;
    return compound[3] === undefined || el.getAttribute(compound[2]) === compound[3];
  }
  return el.tagName === selector;
}

function descendants(el, out) {
  out = out || [];
  for (var i = 0; i < el.children.length; i++) { out.push(el.children[i]); descendants(el.children[i], out); }
  return out;
}

El.prototype.querySelector = function (selector) {
  var found = descendants(this).filter(function (e) { return matches(e, selector); });
  return found.length ? found[0] : null;
};

Doc.prototype.getElementById = function (id) { return this._byId[id] || null; };
Doc.prototype.querySelector = function (selector) {
  var found = this._all.filter(function (e) { return matches(e, selector); });
  return found.length ? found[0] : null;
};

// ---------------------------------------------------------------- BUILD ---

var markup = fs.readFileSync(path.join(WEB, 'citizen', 'index.html'), 'utf8');

function requireInMarkup(needle, label) {
  ok(markup.indexOf(needle) !== -1, 'index.html really contains ' + label);
}

function buildDom() {
  var doc = new Doc();
  var body = new El('body', doc);

  function el(tag, attrs, parent) {
    var e = new El(tag, doc);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (attrs && attrs.id) doc._byId[attrs.id] = e;
    (parent || body).append(e);
    return e;
  }

  var plateForm = el('form', { 'data-plate-form': '', 'class': 'ida-search' });
  var plateRoot = el('div', { 'class': 'ida-plate-input', 'data-plate-format': 'TUN_STD', 'data-state': 'empty' }, plateForm);
  el('input', { id: 'plate-serie', 'class': 'ida-plate-serie', maxlength: '3' }, plateRoot);
  el('input', { id: 'plate-numero', 'class': 'ida-plate-numero', maxlength: '4' }, plateRoot);
  el('p', { 'data-plate-error': '', 'class': 'ida-error-msg' }, plateForm);
  var submitButton = el('button', { type: 'submit' }, plateForm);

  var message = el('div', { 'data-plate-message': '', 'class': 'ida-alert ida-alert--info' });
  message.hidden = true;
  el('p', { 'data-plate-message-title': '', 'class': 'ida-alert-title' }, message);
  el('p', { 'data-plate-message-body': '', 'class': 'ida-small' }, message);

  var unknown = el('div', { 'data-plate-unknown': '', 'class': 'ida-card ida-stack' });
  unknown.hidden = true;
  el('p', { 'data-unknown-plate': '', 'class': 'ida-h4' }, unknown);
  el('a', { 'data-unknown-register': '', 'class': 'ida-btn ida-btn--primary', href: '#' }, unknown);

  var result = el('div', { 'data-plate-result': '', 'class': 'ida-card ida-stack' });
  result.hidden = true;
  el('p', { 'data-result-summary': '', 'class': 'ida-h4' }, result);
  el('dd', { 'data-result-plate': '', 'class': 'ida-id' }, result);
  el('dd', { 'data-result-ivid': '', 'class': 'ida-id' }, result);
  el('a', { 'data-result-passport': '', 'class': 'ida-btn ida-btn--primary', href: '#' }, result);

  var ividForm = el('form', { 'data-ivid-form': '', 'class': 'ida-search' });
  el('input', { id: 'q-ivid', 'class': 'ida-input ida-id' }, ividForm);
  el('p', { 'data-ivid-error': '', 'class': 'ida-error-msg' }, ividForm);

  el('p', { id: 'ida-live' });

  return {
    doc: doc, plateForm: plateForm, submitButton: submitButton, message: message, result: result, unknown: unknown,
    serie: doc.getElementById('plate-serie'), numero: doc.getElementById('plate-numero'),
    ivid: doc.getElementById('q-ivid')
  };
}

/* The element graph below is built in code. These assertions keep it from
 * drifting into a fiction: every id, hook and attribute the shim models must
 * really exist in web/citizen/index.html. */
function requireInMarkup(needle, label) {
  ok(markup.indexOf(needle) !== -1, 'index.html really contains ' + label);
}

function markupCases() {
  say('\nMARKUP — the shim models what really exists');
  requireInMarkup('data-plate-form', 'the plate form hook');
  requireInMarkup('data-ivid-form', 'the IVID form hook');
  requireInMarkup('data-plate-result', 'the result panel hook');
  requireInMarkup('data-plate-unknown', 'the unregistered-vehicle surface hook');
  requireInMarkup('data-unknown-plate', 'the carried-over plate output');
  requireInMarkup('data-unknown-register', 'the registration link');
  requireInMarkup('data-plate-message', 'the user-message hook');
  requireInMarkup('data-result-ivid', 'the IVID output');
  requireInMarkup('data-result-plate', 'the plate output');
  requireInMarkup('data-result-passport', 'the passport link');
  requireInMarkup('id="plate-serie"', '#plate-serie');
  requireInMarkup('id="plate-numero"', '#plate-numero');
  requireInMarkup('id="q-ivid"', '#q-ivid');
  requireInMarkup('data-plate-format="TUN_STD"', 'the TUN_STD format binding');
}

/* Load the REAL plate.js, ivid-client.js and home.js into one context, with
 * a fetch that records every call and answers from a scripted queue. Nothing
 * is stubbed in the modules themselves. */
function run(dom, responses) {
  var calls = [];
  var queue = (responses || []).slice();
  function fakeFetch(url, options) {
    calls.push({ url: url, options: options || {} });
    var next = queue.shift();
    if (!next) return Promise.reject(new Error('no scripted response'));
    if (next.networkError) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: function () { return Promise.resolve(next.body); }
    });
  }
  var sandbox = {
    document: dom.doc,
    window: { location: { href: '/', pathname: '/', search: '' } },
    console: { log: function () {}, error: function () {} },
    Event: function (type, init) { return makeEvent(type, init); },
    fetch: fakeFetch,
    _calls: calls
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['design-system/js/plate.js', 'design-system/js/ivid-client.js', 'citizen/home.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(WEB, rel), 'utf8'), sandbox, { filename: rel });
  });
  return { sandbox: sandbox, calls: calls };
}

function typePlate(dom, serie, numero) {
  dom.serie.focus(); dom.serie.value = serie; dom.serie.dispatchEvent(makeEvent('input'));
  dom.numero.focus(); dom.numero.value = numero; dom.numero.dispatchEvent(makeEvent('input'));
}
function submit(dom) {
  var e = makeEvent('submit', { bubbles: true, cancelable: true });
  dom.plateForm.dispatchEvent(e);
  return e;
}
function settle() { return new Promise(function (r) { setImmediate(function () { setImmediate(function () { setImmediate(r); }); }); }); }
function text(sel, dom) { var e = dom.doc.querySelector(sel); return e ? e.textContent : ''; }

// -------------------------------------------------------------- SERVER ----
// db.js is stubbed before api.js is required, so no real database exists for
// this process to reach. Every statement is recorded.

var SQL = [];
var RATE_COUNT = 0;
var AUDIT_FAILS = false;
var PLATES = {};            // normalised plate -> ivid (or null for "no vehicle")
var dbPath = require.resolve(path.join(BASE, 'reference', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async function (sql, params) {
    SQL.push({ sql: sql, params: params });
    // IDA-V8: the plate lookup became a recursive CTE so a plate on a merged
    // record resolves to the canonical vehicle. The stub matches the table
    // pair either way, and returns a row that is already canonical.
    if (/idauto_plates p[\s\S]*idauto_vehicles v/.test(sql)) {
      var key = params[0];
      if (!Object.prototype.hasOwnProperty.call(PLATES, key)) return { rows: [] };
      return { rows: [{ plate_number: key, ivid: PLATES[key] }] };
    }
    if (/idauto_rate_limit_counters/i.test(sql)) { RATE_COUNT += 1; return { rows: [{ count: RATE_COUNT }] }; }
    if (/INSERT INTO idauto_audit_log/.test(sql)) {
      if (AUDIT_FAILS) throw Object.assign(new Error('audit store unavailable'), { code: '53300' });
      return { rows: [] };
    }
    return { rows: [] };
  },
  getClientForTransaction: async function () {
    return { release: function () {}, query: async function () { return { rows: [] }; } };
  }
} };

var CONFIG_PATH = path.join(require('os').tmpdir(), 'ida-v2-config-' + crypto.randomBytes(6).toString('hex') + '.json');
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ public_resolution: { enabled: true, rate_limit: { limit: 30, window_seconds: 60 } } }));
process.env.IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH = CONFIG_PATH;
var ADMIN_TOKEN = 'tok-' + crypto.randomBytes(8).toString('hex');
var identityMap = {}; identityMap[ADMIN_TOKEN] = 'usr_test';
process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identityMap);

var api = require(path.join(BASE, 'reference', 'api.js'));

var server, port;
function request(method, requestPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method,
      headers: Object.assign({ 'Content-Length': 0 }, headers || {}) }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject); req.end();
  });
}


// ------------------------------------------------------- SEARCH HISTORY ---

function auditRows() {
  return SQL.filter(function (q) { return /INSERT INTO idauto_audit_log/.test(q.sql); });
}

async function knownPlateCase() {
  say('\n1. KNOWN PLATE — resolves, and writes no miss event');
  PLATES['217 TUN 424'] = 'ivid:1:ABCDEFGHJKMNPQRS:AB';
  SQL.length = 0;
  var r = await request('GET', '/public/plates/' + encodeURIComponent('217 TUN 424'));
  ok(r.status === 200 && r.body.ivid === 'ivid:1:ABCDEFGHJKMNPQRS:AB', 'a known plate still resolves to its IVID');
  ok(auditRows().length === 0, 'a successful lookup writes no miss event');
}

async function unknownPlateCase() {
  say('\n2 & 6. UNKNOWN PLATE — no vehicle is created, a search event is');
  SQL.length = 0;
  var r = await request('GET', '/public/plates/' + encodeURIComponent('999 TUN 9999'));
  ok(r.status === 404, 'an unknown plate is still 404 to the caller');

  var rows = auditRows();
  ok(rows.length === 1, 'exactly one audit row is written');
  var p = rows[0].params;
  ok(p[0] === 'public_plate_lookup_miss', 'event_type marks a public plate lookup miss');
  ok(p[1] === 'anonymous', 'an anonymous caller is recorded as anonymous');
  ok(p[2] === null, 'no actor_ref is invented for an anonymous caller');
  ok(p[3] === 'plate' && p[4] === '999 TUN 9999', 'the searched plate is the audit target');
  ok(p[5] === 'vehicle not registered', 'the status says the vehicle is not registered');
  ok(/^[a-f0-9]{64}$/.test(p[6]), 'the caller is recorded as a client hash, never a raw IP');

  // 6. no data was created — the ONLY write is the audit row
  var writes = SQL.filter(function (q) { return /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql); });
  var vehicleWrites = writes.filter(function (q) { return /idauto_vehicles|idauto_plates|idauto_vehicle_facts|idauto_observations/i.test(q.sql); });
  ok(vehicleWrites.length === 0, 'NO vehicle, plate, fact or observation row is created when nothing was supplied');
}

async function repeatedSearchCase() {
  say('\n7. REPEATED SEARCH — every attempt is kept');
  SQL.length = 0;
  await request('GET', '/public/plates/' + encodeURIComponent('999 TUN 9999'));
  await request('GET', '/public/plates/' + encodeURIComponent('999 TUN 9999'));
  await request('GET', '/public/plates/' + encodeURIComponent('888 TUN 1'));
  var rows = auditRows();
  ok(rows.length === 3, 'three searches produce three audit rows — history is appended, never replaced');
  ok(rows[0].params[4] === '999 TUN 9999' && rows[2].params[4] === '888 TUN 1', 'each row carries the plate that was searched');
  ok(!SQL.some(function (q) { return /UPDATE idauto_audit_log|DELETE FROM idauto_audit_log/i.test(q.sql); }),
    'the audit log is append-only — nothing updates or deletes a previous search');
}

async function malformedNoEventCase() {
  say('\nMALFORMED PLATE — refused before the database, so no event either');
  SQL.length = 0;
  var r = await request('GET', '/public/plates/NOT-A-PLATE');
  ok(r.status === 404, 'a malformed plate is 404');
  ok(SQL.length === 0, 'a malformed plate writes nothing at all — not even a search event');
}

async function auditFailureCase() {
  say('\nAUDIT WRITE FAILURE — the visitor still gets an answer');
  AUDIT_FAILS = true;
  SQL.length = 0;
  var r = await request('GET', '/public/plates/' + encodeURIComponent('777 TUN 77'));
  ok(r.status === 404, 'a failed audit insert does not break the lookup');
  ok(r.body && r.body.error, 'the 404 body is unchanged');
  AUDIT_FAILS = false;
}

// ------------------------------------------------------------------ UI ----

async function uiUnknownSurfaceCase() {
  say('\n3. UNKNOWN PLATE → registration surface, plate carried over');
  var dom = buildDom();
  var r = run(dom, [{ status: 404, body: { error: 'not found' } }]);
  typePlate(dom, '217', '424');
  submit(dom);
  await settle();

  var panel = dom.doc.querySelector('[data-plate-unknown]');
  ok(panel.hidden === false, 'the "Véhicule non enregistré" surface opens immediately');
  ok(dom.doc.querySelector('[data-plate-result]').hidden === true, 'no identity panel is shown');
  ok(/217/.test(text('[data-unknown-plate]', dom)) && /424/.test(text('[data-unknown-plate]', dom)),
    'the searched plate is displayed, already filled in');

  var link = dom.doc.querySelector('[data-unknown-register]').getAttribute('href');
  ok(link.indexOf('/admin?plate=') === 0, 'the registration path is the existing audited entry surface');
  ok(decodeURIComponent(link).indexOf('217 TUN 424') !== -1, 'the plate is carried through to it');
  ok(link.indexOf('ivid') === -1, 'no IVID is proposed or carried — IDauto issues it');
  ok(r.calls.length === 1, 'nothing is created by opening the surface');

  var shown = text('[data-unknown-plate]', dom) + dom.doc.querySelector('[data-plate-unknown]').textContent;
  ok(!/404|error|not found/i.test(shown), 'the visitor sees no status code and no raw error');
}

function adminPrefillCases() {
  say('\n4 & 8. ADMIN ENTRY SURFACE — prefilled, and cannot carry an IVID');
  var adminUi = fs.readFileSync(path.join(BASE, 'reference', 'admin-ui.js'), 'utf8');
  var adminHtml = fs.readFileSync(path.join(BASE, 'reference', 'admin.html'), 'utf8');
  var code = adminUi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok(/URLSearchParams/.test(code) && /params\.get\('plate'\)/.test(code), 'admin-ui reads the plate from the query string');
  ok(/\^\\d\{1,3\} TUN \\d\{1,4\}\$/.test(code), 'only the canonical plate form is accepted from the URL');
  ok(/form\.elements\.plate_number/.test(code), 'it prefills the existing plate field');
  ok(!/params\.get\('ivid'\)|params\.get\("ivid"\)/.test(code), 'no IVID can be seeded from the URL');
  // HTML comments stripped: admin.html's IDA-V1B note mentions IVID by name
  // in order to explain the owner-session grant. What must not exist is a
  // FIELD — an input, select or textarea a human could type an IVID into.
  var adminMarkup = adminHtml.replace(/<!--[\s\S]*?-->/g, '');
  ok(!/<(input|select|textarea)[^>]*ivid/i.test(adminMarkup),
    'the entry form has no IVID field — the vehicle id is never chosen by a human');
  ok(!/name=["']ivid["']|id=["']ivid["']/i.test(adminMarkup), 'no element is named or identified as ivid');

  // 4. Carte Grise / document: the existing form already carries it
  ok(/name="media" type="file"/.test(adminHtml), 'the entry form accepts a document or photo (Carte Grise)');
  ok(/media_type/.test(adminHtml) && /media_access_scope/.test(adminHtml), 'the document carries its type and access scope');

  // 9 & 10. provenance and audit come from the existing write path
  var writes = fs.readFileSync(path.join(BASE, 'reference', 'writes.js'), 'utf8');
  ok(/refusing to write without an attributable audit actor/.test(writes),
    'the write path still refuses to create anything without an attributable actor');
  ok(/INSERT INTO idauto_audit_log/.test(writes), 'creation is audited by the existing write path');
  ok(/evidence_type/.test(adminHtml), 'provenance (evidence type) is captured on the fact');
  ok(/capture method is fixed by the API/i.test(adminHtml), 'the capture method is server-set, not caller-set');
}

function noSecondStoreCases() {
  say('\nNO SECOND STORE, NO INVENTED DATA');
  var apiJs = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  ok(!/CREATE\s+TABLE|ALTER\s+TABLE/i.test(apiJs), 'no schema change is introduced');
  // The SQL moved into writes.js, which owns every mutation in this codebase.
  // api.js must carry no write verb at all — the same property
  // tests/ida-2c-readonly-api-test.js enforces, asserted here too so the
  // search-event path cannot quietly reintroduce one.
  ok(!/INSERT\s+INTO|UPDATE\s+idauto_|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE/i.test(apiJs),
    'api.js contains no SQL write verb — the search event is written through writes.js');
  var writesJs = fs.readFileSync(path.join(BASE, 'reference', 'writes.js'), 'utf8');
  ok(/function recordAnonymousAuditEvent/.test(writesJs), 'writes.js owns the anonymous audit-event insert');
  ok((writesJs.match(/INSERT INTO idauto_audit_log/g) || []).length >= 1, 'and it is the module that carries the SQL');
  ok(/writes\.recordAnonymousAuditEvent/.test(apiJs), 'api.js calls it rather than issuing SQL itself');
  var homeCode = fs.readFileSync(path.join(WEB, 'citizen', 'home.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/POST|method:\s*['"]POST/.test(homeCode), 'the public page never writes — it only reads and hands off');
  // The page DISPLAYS make/model/year — read from the server's response, which
  // is exactly its job. What it must never do is AUTHOR one: no vehicle
  // attribute may be assigned a literal anywhere in this file.
  ok(!/(make|model|variant|colour|year|vin)\s*[:=]\s*["'][^"']/i.test(homeCode),
    'the public page never assigns a literal value to a vehicle attribute — it only renders what the server returned');
  ok(/passport\.vehicle|vehicle\.summary|s\.make/.test(homeCode),
    'the attributes it shows are read from the server response');
}

async function main() {
  markupCases();
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  try {
    await knownPlateCase();
    await unknownPlateCase();
    await repeatedSearchCase();
    await malformedNoEventCase();
    await auditFailureCase();
  } finally { server.close(); }
  await uiUnknownSurfaceCase();
  adminPrefillCases();
  noSecondStoreCases();
  try { fs.unlinkSync(CONFIG_PATH); } catch (_) {}
  console.log('\nIDA-V3 unknown vehicle workflow: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
