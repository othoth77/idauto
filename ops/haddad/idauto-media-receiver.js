#!/usr/bin/env node
'use strict';
// IDauto — Update 3.1 — the Haddad copy of IDauto photographs.
//
// A tiny receiver: it keeps files by their SHA-256, exactly like the media store of idauto.tn, so the
// same key names the same bytes on both servers. Reached only over the private network (tailscale serve,
// path /idauto-media), and only with the bearer token shared with the idauto.tn server.
//
//   PUT    /objects/<sha256>   store (the body must hash to the key; idempotent) → 201 new, 200 already there
//   HEAD   /objects/<sha256>   200 present, 404 absent
//   DELETE /objects/<sha256>   remove (an expired anonymous photograph) → 204, or 404
//   GET    /health             { ok, objects, bytes } — no file content is ever served
//
// Environment (EnvironmentFile, mode 0600, never in Git):
//   IDAUTO_MEDIA_RECEIVER_TOKEN   ≥ 32 characters
//   IDAUTO_MEDIA_RECEIVER_ROOT    e.g. /srv/hybrid/idauto-media
//   IDAUTO_MEDIA_RECEIVER_PORT    default 8853 (bound to 127.0.0.1 only)

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var TOKEN = process.env.IDAUTO_MEDIA_RECEIVER_TOKEN || '';
var ROOT = process.env.IDAUTO_MEDIA_RECEIVER_ROOT || '';
var PORT = parseInt(process.env.IDAUTO_MEDIA_RECEIVER_PORT || '8853', 10);
var MAX = 25 * 1024 * 1024;
if (TOKEN.length < 32 || !ROOT) { console.error('IDAUTO_MEDIA_RECEIVER_TOKEN (≥32) and IDAUTO_MEDIA_RECEIVER_ROOT are required'); process.exit(2); }
fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });

function fileOf(key) { return path.join(ROOT, key.slice(0, 2), key.slice(2, 4), key); }
function authorised(req) {
  var h = String(req.headers.authorization || ''), want = 'Bearer ' + TOKEN;
  return h.length === want.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(want));
}
function send(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body ? JSON.stringify(body) : ''); }
function log(o) { console.log(JSON.stringify(Object.assign({ at: new Date().toISOString() }, o))); }

http.createServer(function (req, res) {
  var p = req.url.split('?')[0].replace(/^\/idauto-media/, '');          // with or without the mount path
  if (p === '/health' && req.method === 'GET') {
    if (!authorised(req)) return send(res, 401, { error: 'unauthorised' });
    var n = 0, bytes = 0;
    (function walk(d) { try { fs.readdirSync(d).forEach(function (f) { var x = path.join(d, f), st = fs.statSync(x); if (st.isDirectory()) walk(x); else { n++; bytes += st.size; } }); } catch (e) {} }(ROOT));
    return send(res, 200, { ok: true, objects: n, bytes: bytes });
  }
  var m = /^\/objects\/([a-f0-9]{64})$/.exec(p);
  if (!m) return send(res, 404, { error: 'not found' });
  if (!authorised(req)) { req.resume(); log({ event: 'refused', method: req.method }); return send(res, 401, { error: 'unauthorised' }); }
  var key = m[1], f = fileOf(key);
  if (req.method === 'HEAD') return send(res, fs.existsSync(f) ? 200 : 404);
  if (req.method === 'DELETE') {
    if (!fs.existsSync(f)) return send(res, 404);
    fs.unlinkSync(f); log({ event: 'deleted', key: key }); return send(res, 204);
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
  var chunks = [], size = 0, over = false;
  req.on('data', function (c) { size += c.length; if (size > MAX) over = true; else chunks.push(c); });
  req.on('end', function () {
    if (over) return send(res, 413, { error: 'too large' });
    var body = Buffer.concat(chunks), sha = crypto.createHash('sha256').update(body).digest('hex');
    if (sha !== key) { log({ event: 'hash_mismatch', key: key }); return send(res, 400, { error: 'content does not match its key' }); }
    if (fs.existsSync(f)) return send(res, 200, { stored: true, already: true });
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    var tmp = f + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, body, { mode: 0o600 }); fs.renameSync(tmp, f);
    log({ event: 'stored', key: key, bytes: body.length });
    send(res, 201, { stored: true });
  });
}).listen(PORT, '127.0.0.1', function () { log({ event: 'listening', port: PORT, root: ROOT }); });
