'use strict';

/* IDA-V6 — the plate is public data, and the passport shows it however it was
 * reached. Owner decision, 2026-08-27.
 *
 * This REPLACES the A5-PLATE rule that withheld plate records from the
 * anonymous surface. The three access paths must all end with a visible
 * plate: by plate search, by IVID, and by QR — which is the same thing as by
 * IVID, since the QR encodes nothing else.
 *
 * WHAT MUST NOT MOVE, and is asserted harder here than before: the VIN and
 * every piece of owner PII stay off the public surface. 'vin' is still on the
 * fact deny-list and so is 'plate_number' — the plate now served publicly is
 * the AUTHORITATIVE idauto_plates row, while a community-submitted FACT keyed
 * plate_number is arbitrary text and stays excluded, so this decision cannot
 * be used to smuggle unverified strings onto a trusted-looking key.
 *
 * Original IDA-V5 header follows.
 *
 * IDA-V5 — the vehicle's plate, shown beside its IVID on the passport page.
 *
 * THE CONSTRAINT THAT SHAPED THIS. The anonymous passport does not carry
 * plate records, and that invariant is untouched: reference/public-surface-policy.js
 * still declares it, the deny-list still holds plate_number, and the public
 * route still selects no idauto_plates row. So the plate cannot come from the
 * passport response.
 *
 * It arrives as a HINT in the query string and is CONFIRMED against the
 * server before anything is drawn: GET /public/plates/:plate must return this
 * exact IVID. That is what makes it real vehicle data rather than
 * caller-supplied text — and it is the property this suite spends most of its
 * assertions on, because a plate drawn from an unconfirmed hint would be a
 * spoofing surface on a page people trust.
 *
 * No database is reached: fetch is scripted, the DOM is the shim introduced
 * for IDA-V2. */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var BASE = path.join(__dirname, '..');
var WEB = path.join(BASE, 'web');

var pass = 0, fail = 0;
var realLog = console.log;
function say(m) { realLog(m); }
function ok(v, l) { if (v) { pass++; realLog('  PASS ' + l); } else { fail++; realLog('  FAIL ' + l); } }

var IVID = 'ivid:1:W2JDKNJMK1REMHNP:BQ';
var OTHER = 'ivid:1:ABCDEFGHJKMNPQRS:AB';

// ------------------------------------------------------------------ DOM ---
function makeEvent(type, init) {
  init = init || {};
  return { type: type, bubbles: init.bubbles !== false, cancelable: !!init.cancelable,
    defaultPrevented: false, target: null,
    preventDefault: function () { if (this.cancelable) this.defaultPrevented = true; } };
}
function Doc() { this.activeElement = null; this._byId = {}; this._all = []; }
function El(tag, doc) {
  this.tagName = tag; this.ownerDocument = doc; this.children = []; this.parentNode = null;
  this.attributes = {}; this.listeners = {}; this.value = ''; this.textContent = '';
  this._hidden = false; doc._all.push(this);
}
Object.defineProperty(El.prototype, 'hidden', {
  get: function () { return this._hidden; }, set: function (v) { this._hidden = !!v; } });
El.prototype.setAttribute = function (n, v) { this.attributes[n] = String(v); };
El.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; };
El.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); };
El.prototype.append = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.appendChild = El.prototype.append;
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.dispatchEvent = function (e) {
  e.target = e.target || this; var n = this;
  while (n) { (n.listeners[e.type] || []).forEach(function (h) { h.call(n, e); }); n = e.bubbles ? n.parentNode : null; }
  return !e.defaultPrevented;
};
El.prototype.focus = function () { this.ownerDocument.activeElement = this; };
function matches(el, sel) {
  if (sel.charAt(0) === '#') return el.attributes.id === sel.slice(1);
  if (sel.charAt(0) === '.') return (el.attributes['class'] || '').split(/\s+/).indexOf(sel.slice(1)) !== -1;
  if (sel.charAt(0) === '[') return el.hasAttribute(sel.slice(1, -1));
  return el.tagName === sel;
}
function descendants(el, out) { out = out || []; el.children.forEach(function (c) { out.push(c); descendants(c, out); }); return out; }
El.prototype.querySelector = function (s) { var f = descendants(this).filter(function (e) { return matches(e, s); }); return f.length ? f[0] : null; };
Doc.prototype.getElementById = function (id) { return this._byId[id] || null; };
Doc.prototype.querySelector = function (s) { var f = this._all.filter(function (e) { return matches(e, s); }); return f.length ? f[0] : null; };
Doc.prototype.createElement = function (t) { return new El(t, this); };

var markup = fs.readFileSync(path.join(WEB, 'citizen', 'passport.html'), 'utf8');

function buildDom() {
  var doc = new Doc();
  var body = new El('body', doc);
  doc.body = body;
  function el(tag, attrs, parent) {
    var e = new El(tag, doc);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (attrs && attrs.id) doc._byId[attrs.id] = e;
    (parent || body).append(e); return e;
  }
  var form = el('form', { 'data-ivid-form': '', 'class': 'ida-stack' });
  el('input', { id: 'pp-ivid', 'class': 'ida-input ida-id' }, form);
  el('p', { 'data-ivid-error': '', 'class': 'ida-error-msg' }, form);

  var block = el('div', { 'data-plate-block': '', 'class': 'ida-stack' });
  block.hidden = true;
  var plate = el('p', { 'data-plate-display': '', 'class': 'ida-plate', dir: 'ltr' }, block);
  el('span', { 'data-plate-serie': '' }, plate);
  el('span', { 'class': 'ida-plate-word', 'data-plate-word': '' }, plate).textContent = 'تونس';
  el('span', { 'data-plate-numero': '' }, plate);

  el('div', { 'data-passport-loading': '', 'class': 'ida-card' }).hidden = true;
  el('div', { 'data-passport-error': '', 'class': 'ida-error-state' }).hidden = true;
  el('p', { 'data-passport-error-title': '' });
  el('p', { 'data-passport-error-detail': '' });
  el('div', { 'data-passport-result': '' }).hidden = true;
  return { doc: doc, block: block };
}

function run(dom, search, responses) {
  var calls = [];
  var queue = (responses || []).slice();
  function fakeFetch(url) {
    calls.push(url);
    var n = queue.shift();
    if (!n) return Promise.reject(new Error('no scripted response'));
    if (n.networkError) return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: n.status >= 200 && n.status < 300, status: n.status,
      json: function () { return Promise.resolve(n.body); } });
  }
  var sandbox = {
    document: dom.doc,
    window: { location: { href: 'https://idauto.tn/passport' + search, pathname: '/passport', search: search } },
    console: { log: function () {}, error: function () {} },
    Event: function (t, i) { return makeEvent(t, i); },
    URL: URL, URLSearchParams: URLSearchParams,
    fetch: fakeFetch, _calls: calls
  };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['design-system/js/ivid-client.js', 'vendor/qrcodegen.js', 'citizen/passport-render.js', 'citizen/passport.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(WEB, rel), 'utf8'), sandbox, { filename: rel });
  });
  return { sandbox: sandbox, calls: calls };
}
function settle() { return new Promise(function (r) { var i = 0; (function tick() { if (++i > 8) return r(); setImmediate(tick); })(); }); }
function passportBody() { return { vehicle: { ivid: IVID, summary: { make: 'SSANGYONG' } }, facts: [], plates: [], qr: { payload: IVID }, trust_summary: {} }; }
function txt(dom, sel) { var e = dom.doc.querySelector(sel); return e ? e.textContent : ''; }

// ---------------------------------------------------------------- CASES ---
function markupCases() {
  say('\nMARKUP — the block exists, and reuses PlateDisplay');
  ok(markup.indexOf('data-plate-block') !== -1, 'passport.html carries the plate block');
  ok(/class="ida-plate"/.test(markup), 'it uses the Design System PlateDisplay component (.ida-plate)');
  ok(!/ida-plate-input/.test(markup), 'it does NOT use the editable PlateInput');
  ok(markup.indexOf('ida-plate-word') !== -1, 'the تونس word element is the component\'s own');
  ok(markup.indexOf('تونس') !== -1, 'the Arabic word is present');
  ok(!/drapeau|flag|<img/i.test(markup.slice(markup.indexOf('data-plate-block'), markup.indexOf('data-plate-block') + 700)), 'no flag and no image in the plate block');
  ok(!/\bTN\b/.test(markup.slice(markup.indexOf('data-plate-block'), markup.indexOf('data-plate-block') + 700)), 'no country band');
  ok(/dir="ltr"/.test(markup), 'the plate is explicitly LTR so série/numéro keep their order around تونس');
  ok(/ida-grid ida-grid-2/.test(markup), 'the two blocks share an existing 2-column grid utility — no new layout CSS');
  ok(markup.indexOf('Plaque d\'immatriculation') !== -1, 'the block is labelled');

  var css = fs.readFileSync(path.join(WEB, 'design-system', 'css', 'components.css'), 'utf8');
  ok(/\.ida-plate \{/.test(css), 'PlateDisplay already existed — nothing was added to the Design System');
  var grid = fs.readFileSync(path.join(WEB, 'design-system', 'css', 'base.css'), 'utf8');
  ok(/\.ida-grid-2/.test(grid), 'the grid utility already existed too');
}

function passportBodyWithPlate() {
  var b = passportBody();
  b.plates = [{ protocol_version: '0.1.0-draft', id: '1', subject_ivid: IVID, plate_number: '217 TUN 424', format_code: 'TUN_STD', valid_from: '2026-01-01T00:00:00.000Z' }];
  return b;
}

async function byIvidCase() {
  say('\nCAS 2 & 3 — IVID (and therefore QR) → passport → plate visible');
  var dom = buildDom();
  var r = run(dom, '?ivid=' + encodeURIComponent(IVID), [{ status: 200, body: passportBodyWithPlate() }]);
  await settle();
  ok(r.calls.length === 1, 'ONE request — the passport carries the plate, nothing extra is fetched');
  ok(r.calls[0].indexOf('/public/passport/') === 0, 'and it is the public passport route');
  ok(dom.block.hidden === false, 'the plate block is shown when the page is opened by IVID alone');
  ok(txt(dom, '[data-plate-serie]') === '217', 'série rendered');
  ok(txt(dom, '[data-plate-numero]') === '424', 'numéro rendered');
  ok(dom.doc.querySelector('[data-plate-display]').getAttribute('class') === 'ida-plate', 'rendered inside PlateDisplay');
}

async function byPlateCase() {
  say('\nCAS 1 — arriving from a plate search ends the same way');
  var dom = buildDom();
  // The homepage now links with ?ivid= only; the passport is what carries the
  // plate, so the path taken to get here cannot change what is displayed.
  var r = run(dom, '?ivid=' + encodeURIComponent(IVID), [{ status: 200, body: passportBodyWithPlate() }]);
  await settle();
  ok(dom.block.hidden === false, 'the plate is shown, identically to the IVID path');
  ok(txt(dom, '[data-plate-serie]') + txt(dom, '[data-plate-numero]') === '217424', 'and shows the same plate');
  var home = fs.readFileSync(path.join(WEB, 'citizen', 'home.js'), 'utf8');
  ok(home.indexOf('&plate=') === -1, 'the homepage no longer needs to pass a plate hint');
}

async function noPlateCase() {
  say('\nNO PLATE ON RECORD — the block stays away rather than showing something empty');
  var dom = buildDom();
  run(dom, '?ivid=' + encodeURIComponent(IVID), [{ status: 200, body: passportBody() }]);
  await settle();
  ok(dom.block.hidden === true, 'a vehicle with no plate shows no plate block');
  ok(txt(dom, '[data-plate-serie]') === '', 'and nothing is written into the component');
}

async function noUrlInfluenceCase() {
  say('\nTHE URL CANNOT INFLUENCE THE PLATE');
  var dom = buildDom();
  run(dom, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('999 TUN 9999'),
    [{ status: 200, body: passportBodyWithPlate() }]);
  await settle();
  ok(txt(dom, '[data-plate-serie]') === '217' && txt(dom, '[data-plate-numero]') === '424',
    'a plate in the query string is IGNORED — the served plate wins');
  var js = fs.readFileSync(path.join(WEB, 'citizen', 'passport.js'), 'utf8');
  var code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/renderPlate[\s\S]{0,400}location\.search/.test(code), 'the renderer never reads the query string');
  ok(!/get\("plate"\)/.test(code), 'no code path reads a plate parameter at all');
}

async function malformedPlateCase() {
  say('\nA PLATE THAT IS NOT TUN_STD IS SHOWN WHOLE, NOT GUESSED AT');
  var dom = buildDom();
  var body = passportBody();
  body.plates = [{ plate_number: 'RS 123 TN', subject_ivid: IVID }];
  run(dom, '?ivid=' + encodeURIComponent(IVID), [{ status: 200, body: body }]);
  await settle();
  ok(dom.block.hidden === false, 'it is still displayed');
  ok(txt(dom, '[data-plate-serie]') === 'RS 123 TN', 'shown whole, in the same component');
  ok(txt(dom, '[data-plate-numero]') === '', 'and no numéro is invented for it');
}

function untouchedCases() {
  say('\nUNTOUCHED — IVID, QR and the passport itself');
  var js = fs.readFileSync(path.join(WEB, 'citizen', 'passport.js'), 'utf8');
  var code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/fetch\("\/public\/passport\/" \+ encodeURIComponent\(ivid\)\)/.test(code), 'the passport is still fetched by IVID alone');
  ok(!/qr/i.test(code.replace(/qrcodegen/gi, '')), 'passport.js touches no QR logic');
  var render = fs.readFileSync(path.join(WEB, 'citizen', 'passport-render.js'), 'utf8');
  ok(!/data-plate-block/.test(render), 'the passport renderer itself is untouched');
  ok(fs.readdirSync(path.join(WEB, 'design-system', 'css')).length === 2, 'the Design System stylesheet set is unchanged');
}

function privacyCases() {
  say('\nPRIVACY — what the plate decision did NOT open');
  var policy = require(path.join(BASE, 'reference', 'public-surface-policy.js'));
  ok(policy.deniedFactKeys().indexOf('vin') !== -1, 'vin is STILL on the anonymous-surface deny-list');
  ok(policy.deniedFactKeys().indexOf('plate_number') !== -1,
    'plate_number STAYS on the FACT deny-list — the public plate is the authoritative record, not somebody typed text');
  ok(policy.ANONYMOUS_SURFACE_INCLUDES_AUTHORITATIVE_PLATE_RECORD === true, 'the withdrawn invariant is replaced, not silently deleted');

  var api = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  var start = api.indexOf('async function handlePublicPassportRoute');
  var bodyRaw = api.slice(start, api.indexOf('\nasync function', start + 40));
  // Comments stripped: the handler's own notes name the governorate and the
  // VIN in order to explain why neither is selected. A prohibition must be
  // checked against code.
  var body = bodyRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(body.length > 400, 'the public passport handler body was located');
  ok(/FROM idauto_plates/.test(body), 'the public route now reads the authoritative plate');
  ok(/plate_number/.test(body) && /format_code/.test(body), 'and selects what renders a plate');
  ok(!/governorate/.test(body), 'it does NOT select the governorate — a coarse location nobody asked to publish');
  ok(!/valid_until/.test(body) && !/p\.status,/.test(body), 'nor the validity dates or administrative status');
  ok(/deniedFactKeys\(\)/.test(body), 'the fact deny-list is still applied on the same route');
  ok(/access_scope = \$2/.test(body), 'and facts are still filtered by scope in SQL');
  ok(!/\bvin\b/.test(body.replace(/vehicle_ivid|subject_ivid|ivid/g, '')), 'the handler selects no VIN column');

  // The private routes must not have been widened by any of this.
  ok(/requireAuth/.test(api), 'the authenticated gate is still in place');
  var v = fs.readFileSync(path.join(BASE, 'reference', 'writes.js'), 'utf8');
  ok(/refusing to write without an attributable audit actor/.test(v), 'writes still refuse an unattributable actor');
}

async function main() {
  markupCases();
  await byIvidCase();
  await byPlateCase();
  await noPlateCase();
  await noUrlInfluenceCase();
  await malformedPlateCase();
  untouchedCases();
  privacyCases();
  realLog('\nIDA-V6 public plate on the passport: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
