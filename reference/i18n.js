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
  // French text → Arabic text, or the French text itself when the catalogue has nothing.
  function toArabic(fr) {
    var key = norm(fr);
    if (!key) return fr;
    if (Object.prototype.hasOwnProperty.call(STRINGS, key)) return STRINGS[key];
    for (var i = 0; i < TEMPLATES.length; i++) {
      var m = TEMPLATES[i].re.exec(key);
      if (m) {
        var t = TEMPLATES[i], out = t.ar;
        t.order.forEach(function (n, idx) { out = out.split('{' + n + '}').join(translateFragment(m[idx + 1])); });
        return out;
      }
    }
    return fr;
  }
  // A captured value is translated only if it is itself a known text (« Rattaché »), never an identifier.
  function translateFragment(v) { var k = norm(v); return Object.prototype.hasOwnProperty.call(STRINGS, k) ? STRINGS[k] : v; }
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
  if (lang === 'ar') { if (document.body) start(); else document.addEventListener('DOMContentLoaded', start); }
}(typeof self !== 'undefined' ? self : this));
