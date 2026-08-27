'use strict';

/* IDA-V2 — public plate resolution. OWNER DECISION, 2026-08-27.
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
    doc: doc, plateForm: plateForm, submitButton: submitButton, message: message, result: result,
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
var PLATES = {};            // normalised plate -> ivid (or null for "no vehicle")
var dbPath = require.resolve(path.join(BASE, 'reference', 'db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async function (sql, params) {
    SQL.push({ sql: sql, params: params });
    if (/FROM idauto_plates p JOIN idauto_vehicles/.test(sql)) {
      var key = params[0];
      if (!Object.prototype.hasOwnProperty.call(PLATES, key)) return { rows: [] };
      return { rows: [{ plate_number: key, ivid: PLATES[key] }] };
    }
    if (/idauto_rate_limit_counters/i.test(sql)) { RATE_COUNT += 1; return { rows: [{ count: RATE_COUNT }] }; }
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

async function serverCases() {
  say('\nSERVER — GET /public/plates/:plate');
  PLATES['217 TUN 424'] = 'ivid:1:ABCDEFGHJKMNPQRS:AB';
  PLATES['220 TUN 4518'] = null;   // plate exists, linked to no vehicle

  // 1. valid plate -> vehicle found, 2. -> ivid returned
  SQL.length = 0;
  var found = await request('GET', '/public/plates/' + encodeURIComponent('217 TUN 424'));
  ok(found.status === 200, 'a known plate resolves — 200');
  ok(found.body && found.body.ivid === 'ivid:1:ABCDEFGHJKMNPQRS:AB', 'the response carries the vehicle IVID');
  ok(found.body && found.body.plate_number === '217 TUN 424', 'the response echoes the normalised plate');
  ok(Object.keys(found.body).length === 2, 'the response has EXACTLY two fields, nothing else');

  // 8. private data is not exposed
  ['internal_ref', 'vehicle_id', 'governorate', 'governorate_name', 'status', 'valid_from', 'valid_until',
   'vin', 'owner', 'format_code', 'id'].forEach(function (field) {
    ok(found.raw.indexOf('"' + field + '"') === -1, 'the plate response never carries ' + field);
  });

  // normalisation: same vehicle through lower case and extra spaces
  var lower = await request('GET', '/public/plates/' + encodeURIComponent('217 tun 424'));
  ok(lower.status === 200 && lower.body.ivid === found.body.ivid, 'a lower-case plate resolves to the same vehicle');
  var spaced = await request('GET', '/public/plates/' + encodeURIComponent('  217   TUN   424 '));
  ok(spaced.status === 200 && spaced.body.ivid === found.body.ivid, 'extra whitespace resolves to the same vehicle');

  // 5. unknown plate -> controlled result
  var unknown = await request('GET', '/public/plates/' + encodeURIComponent('999 TUN 9999'));
  ok(unknown.status === 404, 'a well-formed unknown plate is 404');

  // a plate with no linked vehicle is indistinguishable from unknown
  var orphan = await request('GET', '/public/plates/' + encodeURIComponent('220 TUN 4518'));
  ok(orphan.status === 404, 'a plate linked to no vehicle is 404');
  ok(orphan.raw === unknown.raw, 'unknown and unlinked plates return byte-identical bodies');

  // 6. invalid plate -> refused BEFORE any database touch
  SQL.length = 0;
  var malformed = await request('GET', '/public/plates/NOT-A-PLATE');
  ok(malformed.status === 404, 'a malformed plate is 404');
  ok(SQL.length === 0, 'a malformed plate issues ZERO database statements — format gate precedes the database');
  ok(malformed.raw === unknown.raw, 'malformed and unknown plates return byte-identical bodies');

  // method gate
  var posted = await request('POST', '/public/plates/' + encodeURIComponent('217 TUN 424'));
  ok(posted.status === 405 && posted.headers.allow === 'GET', 'a non-GET method is 405 with Allow: GET');

  // the rate limiter is consulted, on the shared public_resolution bucket
  SQL.length = 0;
  await request('GET', '/public/plates/' + encodeURIComponent('217 TUN 424'));
  ok(SQL.some(function (q) { return /idauto_rate_limit_counters/i.test(q.sql); }),
    'the plate route goes through the public_resolution limiter');

  // 7. IVID path still works
  var ividRoute = await request('GET', '/public/passport/ivid:1:ABCDEFGHJKMNPQRS:AB');
  ok(ividRoute.status !== 405 && ividRoute.status !== 401, 'the IVID passport route is still reachable anonymously');

  // the singular path asserted absent by ida4-option-c stays absent
  var singular = await request('GET', '/public/plate/217TUN424');
  ok(singular.status === 404, '/public/plate/... (singular) still does not exist');

  // 9. no secret in any response
  var all = [found.raw, unknown.raw, malformed.raw, posted.raw].join('\n');
  ok(!/Bearer|password|secret|token|ida_owner/i.test(all), 'no response carries a credential-shaped string');
}

async function phaseGateCases() {
  say('\nPHASE GATE — disabled means the route does not exist');
  // loadPublicResolutionConfig() caches for the life of the process, by
  // design, so this cannot be flipped in-process. A child process with a
  // disabled config is the honest way to assert it.
  var disabledPath = path.join(require('os').tmpdir(), 'ida-v2-off-' + crypto.randomBytes(6).toString('hex') + '.json');
  fs.writeFileSync(disabledPath, JSON.stringify({ public_resolution: { enabled: false } }));
  var script = [
    "var path=require('path');",
    "var dbPath=require.resolve('" + path.join(BASE, 'reference', 'db.js') + "');",
    "var n=0;",
    "require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async function(){n++;return {rows:[{count:1}]};}}};",
    "var api=require('" + path.join(BASE, 'reference', 'api.js') + "');",
    "var http=require('http');var s=api.createServer();",
    "s.listen(0,'127.0.0.1',function(){var port=s.address().port;",
    "  function go(m,cb){var r=http.request({hostname:'127.0.0.1',port:port,path:'/public/plates/'+encodeURIComponent('217 TUN 424'),method:m},function(res){res.resume();res.on('end',function(){cb(res.statusCode);});});r.end();}",
    "  go('GET',function(g){go('POST',function(p){console.log(JSON.stringify({get:g,post:p,queries:n}));s.close();});});",
    "});"
  ].join('\n');
  var out = require('child_process').execFileSync(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, { IDAUTO_PUBLIC_RESOLUTION_CONFIG_PATH: disabledPath }),
    encoding: 'utf8', timeout: 30000
  });
  var r = JSON.parse(out.trim().split('\n').pop());
  ok(r.get === 404, 'with public_resolution disabled, GET is 404');
  ok(r.post === 404, 'with public_resolution disabled, POST is 404 too — not 405');
  ok(r.queries === 0, 'with public_resolution disabled, zero database statements are issued');
  try { fs.unlinkSync(disabledPath); } catch (_) {}
}

// ------------------------------------------------------------------ UI ----

async function uiFoundCase() {
  say('\nUI — valid plate, vehicle found');
  var dom = buildDom();
  var r = run(dom, [
    { status: 200, body: { plate_number: '217 TUN 424', ivid: 'ivid:1:ABCDEFGHJKMNPQRS:AB' } },
    { status: 200, body: { vehicle: { ivid: 'ivid:1:ABCDEFGHJKMNPQRS:AB', summary: { make: 'Peugeot', model: '208', year: 2019 } } } }
  ]);
  typePlate(dom, '217', '424');
  var e = submit(dom);
  ok(e.defaultPrevented === true, 'the form never navigates on submit');
  await settle();

  ok(r.calls.length >= 1, 'a resolution request WAS made — the button is no longer inert');
  ok(r.calls[0].url.indexOf('/public/plates/') === 0, 'the request goes to the public plate route');
  ok(decodeURIComponent(r.calls[0].url).indexOf('217 TUN 424') !== -1, 'the canonical plate is what is sent');
  ok(!/Authorization/i.test(JSON.stringify(r.calls[0].options || {})), 'no Authorization header is ever sent');

  ok(r.calls.length === 2 && r.calls[1].url.indexOf('/public/passport/') === 0, 'the IVID is then used against the public passport route');

  var result = dom.doc.querySelector('[data-plate-result]');
  ok(result.hidden === false, 'the result panel is shown');
  ok(text('[data-result-ivid]', dom) === 'ivid:1:ABCDEFGHJKMNPQRS:AB', 'the IVID is displayed');
  ok(text('[data-result-plate]', dom) === '217 TUN 424', 'the plate is displayed');
  ok(/Peugeot 208 \(2019\)/.test(text('[data-result-summary]', dom)), 'the public identity is displayed');
  var link = dom.doc.querySelector('[data-result-passport]');
  ok(link.getAttribute('href') === '/passport?ivid=' + encodeURIComponent('ivid:1:ABCDEFGHJKMNPQRS:AB'), 'the passport link carries the IVID');
  ok(dom.doc.querySelector('[data-plate-message]').hidden === true, 'no error message is shown on success');
}

async function uiUnknownCase() {
  say('\nUI — valid plate, unknown vehicle');
  var dom = buildDom();
  var r = run(dom, [{ status: 404, body: { error: 'not found' } }]);
  typePlate(dom, '999', '9999');
  submit(dom);
  await settle();
  var msg = dom.doc.querySelector('[data-plate-message]');
  ok(msg.hidden === false, 'a controlled message is shown');
  ok(/Aucun véhicule/.test(text('[data-plate-message-title]', dom)), 'the message says no vehicle was found');
  ok(dom.doc.querySelector('[data-plate-result]').hidden === true, 'no result panel is shown');
  var shown = text('[data-plate-message-title]', dom) + text('[data-plate-message-body]', dom);
  ok(!/404|500|error|not found/i.test(shown), 'the visitor never sees a status code or a raw server error');
  ok(r.calls.length === 1, 'no passport request is made when the plate did not resolve');
}

async function uiInvalidCase() {
  say('\nUI — invalid plate');
  var dom = buildDom();
  var r = run(dom, []);
  typePlate(dom, '', '');
  var e = submit(dom);
  await settle();
  ok(e.defaultPrevented === true, 'the form does not navigate');
  ok(r.calls.length === 0, 'an invalid plate makes NO request');
  ok(dom.doc.querySelector('[data-plate-error]').hidden === false, 'a validation error is shown');
  ok(/incomplète ou invalide/.test(text('[data-plate-error]', dom)), 'the validation error names the rule');
}

async function uiServerErrorCase() {
  say('\nUI — server failure and rate limit stay opaque to the visitor');
  var dom = buildDom();
  run(dom, [{ status: 500, body: { error: 'db.js: connection refused at 127.0.0.1:5432' } }]);
  typePlate(dom, '217', '424');
  submit(dom);
  await settle();
  var shown = text('[data-plate-message-title]', dom) + ' ' + text('[data-plate-message-body]', dom);
  ok(dom.doc.querySelector('[data-plate-message]').hidden === false, 'a message is shown');
  ok(!/500|db\.js|5432|connection refused/i.test(shown), 'the raw server error is NEVER shown to the visitor');

  var dom2 = buildDom();
  run(dom2, [{ status: 429, body: { error: 'rate limit exceeded' } }]);
  typePlate(dom2, '217', '424');
  submit(dom2);
  await settle();
  ok(/Trop de recherches/.test(text('[data-plate-message-title]', dom2)), 'a rate-limited visitor gets a plain-language message');
  ok(!/429/.test(text('[data-plate-message-body]', dom2)), 'the status code is not shown');
}

function sourceCases() {
  say('\nSOURCE — what the citizen surface may and may not do');
  var homeJs = fs.readFileSync(path.join(WEB, 'citizen', 'home.js'), 'utf8');
  // Comments stripped: this file's own header discusses Authorization by name.
  var code = homeJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/\/public\/plates\//.test(code), 'home.js resolves plates through the PUBLIC route');
  ok(!/\/api\/plates/.test(code), 'home.js never calls the AUTHENTICATED plate route');
  ok(!/Authorization|Bearer/i.test(code), 'home.js sends no Authorization header — no key is ever asked of the visitor');
  ok(!/localStorage|sessionStorage|document\.cookie/.test(code), 'home.js stores nothing in the browser');
  ok(/data-plate-result/.test(code) && /data-result-ivid/.test(code), 'home.js renders the result panel');
  var markup = fs.readFileSync(path.join(WEB, 'citizen', 'index.html'), 'utf8');
  ok(markup.indexOf('data-plate-result') !== -1, 'index.html carries the result panel');
  ok(markup.indexOf('La consultation publique se fait par IVID') === -1, 'the withdrawn IVID-only notice is gone');
  ok(markup.indexOf('type="password"') === -1, 'the citizen page has no credential field');
}

async function main() {
  markupCases();
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  try {
    await serverCases();
    await phaseGateCases();
  } finally { server.close(); }
  await uiFoundCase();
  await uiUnknownCase();
  await uiInvalidCase();
  await uiServerErrorCase();
  sourceCases();
  try { fs.unlinkSync(CONFIG_PATH); } catch (_) {}
  console.log('\nIDA-V2 public plate resolution: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.error('FATAL: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
