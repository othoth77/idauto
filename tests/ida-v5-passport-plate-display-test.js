'use strict';

/* IDA-V5 — the vehicle's plate, shown beside its IVID on the passport page.
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
  el('span', { 'class': 'ida-plate-word' }, plate).textContent = 'تونس';
  el('span', { 'data-plate-numero': '' }, plate);
  el('p', { 'data-plate-caption': '', 'class': 'ida-caption' }, block);

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

async function confirmedCase() {
  say('\nCONFIRMED PLATE — drawn only after the server agrees');
  var dom = buildDom();
  var r = run(dom, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('217 TUN 424'),
    [{ status: 200, body: passportBody() }, { status: 200, body: { plate_number: '217 TUN 424', ivid: IVID } }]);
  await settle();
  realLog('    [debug] appels=' + JSON.stringify(r.calls));
  ok(r.calls.length === 2, 'two requests: the passport, then the plate confirmation');
  ok(r.calls[1].indexOf('/public/plates/') === 0, 'the confirmation goes to the public plate route');
  ok(decodeURIComponent(r.calls[1]).indexOf('217 TUN 424') !== -1, 'it asks about the plate from the hint');
  ok(dom.block.hidden === false, 'the plate block is shown');
  ok(txt(dom, '[data-plate-serie]') === '217', 'série rendered');
  ok(txt(dom, '[data-plate-numero]') === '424', 'numéro rendered');
  ok(dom.doc.querySelector('[data-plate-display]').getAttribute('class') === 'ida-plate', 'rendered inside PlateDisplay');
}

async function mismatchCase() {
  say('\nUNCONFIRMED — a hint that does not belong to this vehicle draws NOTHING');
  var dom = buildDom();
  run(dom, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('999 TUN 9999'),
    [{ status: 200, body: passportBody() }, { status: 200, body: { plate_number: '999 TUN 9999', ivid: OTHER } }]);
  await settle();
  ok(dom.block.hidden === true, 'a plate resolving to a DIFFERENT ivid is not drawn — no spoofing surface');
  ok(txt(dom, '[data-plate-serie]') === '', 'nothing is written into the component');

  var dom2 = buildDom();
  run(dom2, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('123 TUN 4567'),
    [{ status: 200, body: passportBody() }, { status: 404, body: { error: 'not found' } }]);
  await settle();
  ok(dom2.block.hidden === true, 'an unknown plate is not drawn');

  var dom3 = buildDom();
  run(dom3, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('123 TUN 4567'),
    [{ status: 200, body: passportBody() }, { networkError: true }]);
  await settle();
  ok(dom3.block.hidden === true, 'a failed confirmation is not drawn');

  var dom4 = buildDom();
  var r4 = run(dom4, '?ivid=' + encodeURIComponent(IVID) + '&plate=' + encodeURIComponent('<script>x</script>'),
    [{ status: 200, body: passportBody() }]);
  await settle();
  ok(dom4.block.hidden === true, 'a malformed hint is refused at the format gate');
  ok(r4.calls.length === 1, 'and costs no request at all');
}

async function noHintCase() {
  say('\nNO HINT — opened straight from a QR');
  var dom = buildDom();
  var r = run(dom, '?ivid=' + encodeURIComponent(IVID), [{ status: 200, body: passportBody() }]);
  await settle();
  ok(dom.block.hidden === true, 'no plate block when the page is opened by IVID alone');
  ok(r.calls.length === 1, 'and no confirmation request is made');
}

function untouchedCases() {
  say('\nUNTOUCHED — IVID, QR, passport and the public surface');
  var js = fs.readFileSync(path.join(WEB, 'citizen', 'passport.js'), 'utf8');
  var code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/GET|fetch\("\/public\/passport\//.test(code) || /public\/passport\//.test(code), 'the passport is still loaded by IVID from the public route');
  ok(!/qr/i.test(code.replace(/qrcodegen/gi, '')), 'passport.js touches no QR logic');
  // The IVID path is unchanged: the passport is still fetched by IVID alone,
  // and the plate confirmation is a separate call that gates nothing.
  ok(/fetch\("\/public\/passport\/" \+ encodeURIComponent\(ivid\)\)/.test(code), 'the passport is still fetched by IVID alone');
  ok(!/showConfirmedPlate[\s\S]{0,200}return[\s\S]{0,40}resultHost/.test(code), 'the plate confirmation gates nothing in the passport path');

  var render = fs.readFileSync(path.join(WEB, 'citizen', 'passport-render.js'), 'utf8');
  ok(!/data-plate-block/.test(render), 'the passport renderer itself is untouched');

  var policy = require(path.join(BASE, 'reference', 'public-surface-policy.js'));
  ok(policy.deniedFactKeys().indexOf('plate_number') !== -1, 'plate_number is STILL on the anonymous deny-list');
  ok(policy.ANONYMOUS_SURFACE_NEVER_INCLUDES_PLATE_RECORDS === true, 'the anonymous surface still carries no plate record — the plate is confirmed, never served in the passport');
  var api = fs.readFileSync(path.join(BASE, 'reference', 'api.js'), 'utf8');
  // Bounded to the handler's own body — the file also contains the
  // authenticated plate routes, which legitimately read idauto_plates.
  var start = api.indexOf('async function handlePublicPassportRoute');
  var body = api.slice(start, api.indexOf('\nasync function', start + 40));
  ok(body.length > 400, 'the public passport handler body was located');
  ok(!/idauto_plates/.test(body), 'the public passport handler selects no plate row');
  ok(!/current_plate_ref/.test(body), 'and sets no current_plate_ref');

  var home = fs.readFileSync(path.join(WEB, 'citizen', 'home.js'), 'utf8');
  ok(/&plate=/.test(home), 'the homepage passes the plate as a hint');
  ok(/ivid=/.test(home), 'the IVID remains what opens the passport');
}

async function main() {
  markupCases();
  await confirmedCase();
  await mismatchCase();
  await noHintCase();
  untouchedCases();
  realLog('\nIDA-V5 passport plate display: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
