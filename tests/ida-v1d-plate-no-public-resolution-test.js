'use strict';

/* IDA-V1D — a plate never resolves anything on the public surface.
 *
 * WHY THIS SUITE EXISTS. tests/ida4-ds-ui-test.js asserted the rule by
 * searching home.js for the STRING `publicNotice.hidden = false`. That
 * assertion stayed green while the observable behaviour was the opposite:
 * the notice was shown and then immediately re-hidden, because moving the
 * focus to #q-ivid blurred the plate input, and plate.js binds refresh() to
 * `blur`, and refresh() calls home.js's onChange, which hides the notice.
 * A source-text check cannot see a race between two files. This one runs
 * the real modules and observes what actually happens.
 *
 * WHAT IS ASSERTED, on both gestures (Enter and click):
 *   - #q-ivid stays EMPTY — the plate is never written into the IVID field
 *   - focus never moves to #q-ivid
 *   - no network call of any kind is made
 *   - the submit event is cancelled, so the form never navigates
 *   - the explanatory notice is visible afterwards
 *
 * THE DOM. Node has none, and this repo takes no test dependencies, so the
 * shim below implements only what home.js and plate.js touch: querySelector,
 * getElementById, addEventListener/dispatchEvent with cancellation and
 * bubbling, setAttribute/getAttribute, value, hidden, textContent, and a
 * focus() that moves activeElement and fires `blur` on the element it left —
 * that last detail is the whole mechanism of the bug, so it is modelled
 * faithfully rather than stubbed away.
 *
 * The element graph is built in code, not parsed from HTML. To stop it
 * drifting into a fiction, buildDom() asserts that every id, hook and
 * attribute it models is really present in web/citizen/index.html; if the
 * markup moves, this suite fails instead of testing something that no
 * longer exists. */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var BASE = path.join(__dirname, '..');
var WEB = path.join(BASE, 'web');

var pass = 0, fail = 0;
function ok(value, label) { if (value) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } }

// ------------------------------------------------------------------ DOM ---

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

function matches(el, selector) {
  if (selector.charAt(0) === '#') return el.attributes.id === selector.slice(1);
  if (selector.charAt(0) === '.') return (el.attributes['class'] || '').split(/\s+/).indexOf(selector.slice(1)) !== -1;
  if (selector.charAt(0) === '[') {
    var name = selector.slice(1, -1);
    return el.hasAttribute(name);
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

  var notice = el('div', { 'data-plate-public-notice': '', 'class': 'ida-alert ida-alert--info' });
  notice.hidden = true;

  var ividForm = el('form', { 'data-ivid-form': '', 'class': 'ida-search' });
  el('input', { id: 'q-ivid', 'class': 'ida-input ida-id' }, ividForm);
  el('p', { 'data-ivid-error': '', 'class': 'ida-error-msg' }, ividForm);

  el('p', { id: 'ida-live' });

  return {
    doc: doc, plateForm: plateForm, submitButton: submitButton, notice: notice,
    serie: doc.getElementById('plate-serie'), numero: doc.getElementById('plate-numero'),
    ivid: doc.getElementById('q-ivid')
  };
}

/* Load the REAL plate.js, ivid-client.js and home.js into one context. The
 * bug lived in the seam between plate.js and home.js, so neither may be
 * stubbed. Any network API present in the context records a call and throws
 * — the suite asserts none is ever reached. */
function run(dom) {
  var calls = [];
  function forbidden(name) {
    return function () { calls.push(name); throw new Error('network call attempted: ' + name); };
  }
  var sandbox = {
    document: dom.doc,
    window: { location: { href: '/', pathname: '/', search: '' } },
    console: { log: function () {}, error: function () {} },
    Event: function (type, init) { return makeEvent(type, init); },
    fetch: forbidden('fetch'),
    XMLHttpRequest: forbidden('XMLHttpRequest'),
    navigator: { sendBeacon: forbidden('sendBeacon') },
    EventSource: forbidden('EventSource'),
    WebSocket: forbidden('WebSocket'),
    _networkCalls: calls
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
  dom.serie.focus();
  dom.serie.value = serie;
  dom.serie.dispatchEvent(makeEvent('input'));
  dom.numero.focus();
  dom.numero.value = numero;
  dom.numero.dispatchEvent(makeEvent('input'));
}

// ---------------------------------------------------------------- CASES ---

function markupCases() {
  console.log('\nMARKUP — the shim models what really exists');
  requireInMarkup('data-plate-form', 'the plate form hook');
  requireInMarkup('data-ivid-form', 'the IVID form hook');
  requireInMarkup('data-plate-public-notice', 'the IVID-only notice hook');
  requireInMarkup('id="plate-serie"', '#plate-serie');
  requireInMarkup('id="plate-numero"', '#plate-numero');
  requireInMarkup('id="q-ivid"', '#q-ivid');
  requireInMarkup('ida-plate-input', 'the PlateInput root class');
  requireInMarkup('data-plate-format="TUN_STD"', 'the TUN_STD format binding');
}

function gestureCases(label, submit) {
  console.log('\nGESTURE — ' + label);
  var dom = buildDom();
  var run1 = run(dom);

  typePlate(dom, '220', '4518');
  ok(dom.ivid.value === '', 'before submit, #q-ivid is empty');

  var event = submit(dom);

  ok(dom.ivid.value === '', '#q-ivid is STILL EMPTY — the plate was never written into it');
  ok(dom.doc.activeElement !== dom.ivid, 'focus did NOT move to #q-ivid');
  ok(dom.doc.activeElement === dom.numero, 'focus stayed on the plate field the visitor was using');
  ok(run1.calls.length === 0, 'no network call was attempted (fetch, XHR, beacon, EventSource, WebSocket)');
  ok(event.defaultPrevented === true, 'the submit event was cancelled — the form never navigates');
  ok(dom.notice.hidden === false, 'the explanatory notice is VISIBLE after submit');
  ok(dom.serie.value === '220' && dom.numero.value === '4518', 'the plate the visitor typed is left intact for display');
}

function enterGesture(dom) {
  dom.numero.focus();
  dom.numero.dispatchEvent(makeEvent('keydown', { bubbles: true }));
  var event = makeEvent('submit', { bubbles: true, cancelable: true });
  dom.plateForm.dispatchEvent(event);
  return event;
}

function clickGesture(dom) {
  dom.submitButton.dispatchEvent(makeEvent('click', { bubbles: true, cancelable: true }));
  var event = makeEvent('submit', { bubbles: true, cancelable: true });
  dom.plateForm.dispatchEvent(event);
  return event;
}

function regressionGuard() {
  console.log('\nREGRESSION GUARD — the exact line that caused this');
  var homeJs = fs.readFileSync(path.join(WEB, 'citizen', 'home.js'), 'utf8');
  var code = homeJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok(!/getElementById\(\s*["']q-ivid["']\s*\)\s*\.?\s*[\s\S]{0,40}\.focus\s*\(/.test(code),
    'home.js does not focus #q-ivid');
  ok(!/q-ivid[\s\S]{0,80}\.value\s*=/.test(code), 'home.js never assigns to #q-ivid');
  ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon/.test(code), 'home.js makes no request of any kind');
  ok(!/\/api\/plates|plate.*resolve|resolvePlate/i.test(code), 'home.js references no plate-resolution route');
  ok(/publicNotice\.hidden = false/.test(code), 'home.js still shows the IVID-only notice');
}

function invalidPlateCase() {
  console.log('\nINVALID PLATE — still no leak toward the IVID field');
  var dom = buildDom();
  var r = run(dom);
  typePlate(dom, '', '');
  var event = makeEvent('submit', { bubbles: true, cancelable: true });
  dom.plateForm.dispatchEvent(event);
  ok(dom.ivid.value === '', 'an invalid plate writes nothing into #q-ivid');
  ok(dom.doc.activeElement !== dom.ivid, 'an invalid plate does not move focus to #q-ivid');
  ok(r.calls.length === 0, 'an invalid plate makes no request');
  ok(event.defaultPrevented === true, 'an invalid plate still cancels the submit');
}

markupCases();
gestureCases('Enter, focus in the plate field', enterGesture);
gestureCases('click on "Consulter l\'identité"', clickGesture);
invalidPlateCase();
regressionGuard();

console.log('\nIDA-V1D plate never resolves publicly: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
