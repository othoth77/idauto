'use strict';
// IDauto — IDA-UI-2 — serve each HTML page in the reader's language.
// The page files are written in French with <html lang="fr">. When the `ida_lang`
// cookie says Arabic, the page is served as <html lang="ar" dir="rtl"> so it is
// laid out right to left from the first byte; i18n.js then translates the text.
// Only that one attribute pair changes: the file, its CSP and its scripts do not.
var i18n = require('./i18n.js');

function langOf(req) { return i18n.readCookieLang(req && req.headers && req.headers.cookie); }

function localize(content, contentType, req) {
  if (!/^text\/html/.test(contentType || '') || langOf(req) !== 'ar') return content;
  var s = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return Buffer.from(s.replace(/<html lang="fr"( dir="ltr")?(?=[ >])/, '<html lang="ar" dir="rtl"'), 'utf8');
}

module.exports = { localize: localize, langOf: langOf };
