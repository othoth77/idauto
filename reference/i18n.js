'use strict';
/* IDauto — IDA-UI-2 — French / Arabic interface (/admin/i18n.js, /atelier/i18n.js, /login/i18n.js, /assets/i18n.js).
 *
 * French is the source language: every page is written in French, and this
 * module translates what the person SEES into Arabic when the language is
 * Arabic. One catalogue (i18n-catalog-ar.js) maps each French text to its
 * Arabic text; sentences that carry a value (« Face 2 enregistrée (version 3) »)
 * are templates. The page is translated once on load and again whenever a
 * script adds or changes text (MutationObserver), so text built by the page
 * scripts is translated too, without a second copy of every page.
 *
 * Never translated: plates, IVIDs, VINs, codes and identifiers — anything in
 * <code>, <bdi>, .ida-plate, .ida-ivid, [translate="no"] or [data-i18n-skip].
 *
 * The language lives in the `ida_lang` cookie (fr | ar), never in browser
 * storage (the rule every authenticated page follows). The server reads it and
 * serves <html lang="ar" dir="rtl"> from the first byte, so an Arabic page is
 * laid out right to left before any script runs. Changing language writes the
 * cookie and reloads: the switch is immediate and applies to every route.
 */
(function (root) {
  var CATALOG = (typeof module !== 'undefined' && module.exports) ? require('./i18n-catalog-ar.js') : (root.IdAutoCatalogAr || { strings: {}, templates: [] });
  var STRINGS = CATALOG.strings || {};
  var TEMPLATES = (CATALOG.templates || []).map(function (t) {
    // « Face {0} enregistrée » → /^Face (.+?) enregistrée$/ ; the captures are re-inserted in the Arabic text.
    var parts = t[0].split(/(\{\d\})/), order = [];
    var re = '^' + parts.map(function (p) { var m = /^\{(\d)\}$/.exec(p); if (m) { order.push(+m[1]); return '(.+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('') + '$';
    return { re: new RegExp(re), ar: t[1], order: order };
  });

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  // Counters: a catalogue key may use « # » for a number (« # véhicule(s) · page # sur # »); the
  // numbers of the French text are put back, in order, where the Arabic has « # ».
  var NUM = /\d+(?:[.,]\d+)?(?:\s?%)?/g;
  var NUMBERED = {};
  Object.keys(STRINGS).forEach(function (k) { if (k.indexOf('#') !== -1) NUMBERED[k] = STRINGS[k]; });
  function numbered(key) {
    var nums = key.match(NUM);
    if (!nums) return null;
    var shape = key.replace(NUM, '#');
    if (!Object.prototype.hasOwnProperty.call(NUMBERED, shape)) return null;
    var i = 0;
    return NUMBERED[shape].replace(/#/g, function () { return nums[i++] || ''; });
  }
  // A line made of parts joined by « · » or « — » (counters, statuses) is translated part by part,
  // only when EVERY part is known — never a half-translated sentence.
  function byParts(key) {
    var sep = key.indexOf(' · ') !== -1 ? ' · ' : key.indexOf(' — ') !== -1 ? ' — ' : null;
    if (!sep) return null;
    var parts = key.split(sep), out = [];
    for (var i = 0; i < parts.length; i++) { var p = single(parts[i].trim()); if (p === null) { if (/[A-Za-zÀ-ÿ]{2}/.test(parts[i])) return null; p = parts[i].trim(); } out.push(p); }
    return out.join(sep);
  }
  // French text → Arabic text, or the French text itself when the catalogue has nothing.
  // One known text: exact, counter (« # »), or template; null when unknown.
  function single(key) {
    if (Object.prototype.hasOwnProperty.call(STRINGS, key)) return STRINGS[key];
    var n = numbered(key); if (n !== null) return n;
    for (var i = 0; i < TEMPLATES.length; i++) {
      var m = TEMPLATES[i].re.exec(key);
      if (m) {
        var t = TEMPLATES[i], out = t.ar;
        t.order.forEach(function (k, idx) { out = out.split('{' + k + '}').join(translateFragment(m[idx + 1])); });
        return out;
      }
    }
    return null;
  }
  function toArabic(fr) {
    var key = norm(fr);
    if (!key) return fr;
    var one = single(key); if (one !== null) return one;
    var parts = byParts(key); if (parts !== null) return parts;
    return fr;
  }
  // A captured value is translated only if it is itself a known text (« Rattaché »), never an identifier.
  // A captured value is translated only if it is itself known text (« Rattaché », « gestionnaire · …»), never an identifier.
  function translateFragment(v) { var k = norm(v); var one = single(k); if (one !== null) return one; var p = byParts(k); return p !== null ? p : v; }
  function has(fr) { var r = toArabic(fr); return r !== fr || !/[A-Za-zÀ-ÿ]{2}/.test(fr); }

  var LANGS = ['fr', 'ar'];
  function readCookieLang(cookie) { var m = /(?:^|;\s*)ida_lang=(fr|ar)(?:;|$)/.exec(cookie || ''); return m ? m[1] : 'fr'; }

  var api = { toArabic: toArabic, has: has, readCookieLang: readCookieLang, LANGS: LANGS, catalogSize: function () { return Object.keys(STRINGS).length + TEMPLATES.length; } };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if (typeof document === 'undefined') return;

  var lang = document.documentElement.getAttribute('lang') === 'ar' ? 'ar' : 'fr';
  function current() { return lang; }
  function t(fr) { return lang === 'ar' ? toArabic(fr) : fr; }
  // Dates and numbers in the page language; Western digits in both (the usage in Tunisia).
  var LOCALE = { fr: 'fr-TN', ar: 'ar-TN-u-nu-latn' };
  function date(v, opts) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString(LOCALE[lang], opts || { dateStyle: 'medium', timeStyle: 'short' }); }
  function day(v) { return date(v, { dateStyle: 'medium' }); }
  function number(n) { return typeof n === 'number' ? n.toLocaleString(LOCALE[lang]) : String(n); }

  function setLanguage(next) {
    if (LANGS.indexOf(next) === -1 || next === lang) return;
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = 'ida_lang=' + next + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
    location.reload();
  }

  // ---- DOM translation (Arabic only) ---------------------------------------
  var SKIP = 'script,style,code,bdi,kbd,samp,.ida-plate,.ida-ivid,[translate="no"],[data-i18n-skip]';
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'aria-description', 'data-label'];
  function skipped(node) { var e = node.nodeType === 1 ? node : node.parentElement; return !e || !!e.closest(SKIP); }
  function translateText(node) {
    var v = node.nodeValue;
    if (!v || !/[A-Za-zÀ-ÿ]/.test(v) || skipped(node)) return;
    var out = toArabic(v);
    if (out !== v) { var lead = /^\s*/.exec(v)[0], trail = /\s*$/.exec(v)[0]; node.nodeValue = lead + out + trail; }
  }
  function translateAttrs(el) {
    if (el.closest && el.closest(SKIP)) return;
    for (var i = 0; i < ATTRS.length; i++) { var a = el.getAttribute(ATTRS[i]); if (a && /[A-Za-zÀ-ÿ]/.test(a)) { var o = toArabic(a); if (o !== a) el.setAttribute(ATTRS[i], o); } }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) { var w = toArabic(el.value); if (w !== el.value) el.value = w; }
  }
  function walk(rootNode) {
    if (rootNode.nodeType === 3) { translateText(rootNode); return; }
    if (rootNode.nodeType !== 1) return;
    if (rootNode.matches && rootNode.matches(SKIP)) return;
    translateAttrs(rootNode);
    var tw = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) translateText(n); else translateAttrs(n); }
  }
  function start() {
    if (document.title) document.title = toArabic(document.title);
    walk(document.body);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === 'characterData') translateText(r.target);
        else if (r.type === 'attributes') translateAttrs(r.target);
        else r.addedNodes.forEach(walk);
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
  }
  root.IdAutoI18n = { lang: current, t: t, date: date, day: day, number: number, setLanguage: setLanguage, toArabic: toArabic };
  // A plain <select data-public-lang> (public pages, no shell) switches the language too.
  function wireSelects() { Array.prototype.forEach.call(document.querySelectorAll('select[data-public-lang]'), function (s) { s.value = lang; s.addEventListener('change', function () { setLanguage(s.value); }); }); }
  // Update 1.1 — the flag switcher: one button that shows the flag of the language it switches TO
  // (French active → 🇹🇳, Arabic active → 🇫🇷). Same cookie and reload as setLanguage().
  var FLAG = {
    ar: '<svg viewBox="0 0 30 20" width="26" height="18" aria-hidden="true" focusable="false"><rect width="30" height="20" fill="#E70013"/><circle cx="15" cy="10" r="5" fill="#fff"/><circle cx="15" cy="10" r="3.75" fill="#E70013"/><circle cx="16" cy="10" r="3" fill="#fff"/><polygon points="14.40,10.00 15.81,9.50 15.85,8.00 16.76,9.19 18.20,8.77 17.35,10.00 18.20,11.23 16.76,10.81 15.85,12.00 15.81,10.50" fill="#E70013"/></svg>',
    fr: '<svg viewBox="0 0 30 20" width="26" height="18" aria-hidden="true" focusable="false"><rect width="10" height="20" fill="#002654"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE1126"/></svg>'
  };
  var FLAG_LABEL = { ar: 'التونسي — بدّل للعربي', fr: 'Français — passer en français' };
  function wireFlags() {
    var next = lang === 'ar' ? 'fr' : 'ar';
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang-flag]'), function (b) {
      b.innerHTML = FLAG[next];
      b.setAttribute('data-next-lang', next);
      b.setAttribute('lang', next);
      b.setAttribute('aria-label', FLAG_LABEL[next]);
      b.setAttribute('title', FLAG_LABEL[next]);
      if (!b.__idaFlag) { b.__idaFlag = true; b.addEventListener('click', function () { setLanguage(b.getAttribute('data-next-lang')); }); }
    });
  }
  root.IdAutoI18n.wireFlags = wireFlags;
  function wireAll() { wireSelects(); wireFlags(); }
  if (document.readyState !== 'loading') wireAll(); else document.addEventListener('DOMContentLoaded', wireAll);
  if (lang === 'ar') { if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); }
}(typeof self !== 'undefined' ? self : this));
