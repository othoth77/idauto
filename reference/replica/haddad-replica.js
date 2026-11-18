'use strict';
// =====================================================
// IDauto — Update 3.1 — a second copy of every stored photograph on the Haddad server.
// reference/replica/haddad-replica.js
//
// The private media store on THIS server stays the primary copy (it is the one the nightly
// off-host backup takes). Every photograph file is also copied to Haddad, over the private
// network, to a small receiver (ops/haddad/idauto-media-receiver.js) that keeps files by
// their SHA-256 — the same content-addressed key as here.
//
//   enqueue(key)    records that `key` must exist on Haddad (idempotent); tries at once, without waiting
//   status(keys)    → { key: 'stored' | 'pending' | 'failed' | 'not_configured' }
//   start()         a background pass every 30 s: pending and failed copies, with back-off
//
// A copy that fails is never silent: its row says 'failed' with the reason, the page shows
// it, and it is retried. A failed copy never removes the local file.
//
// Configuration (server environment; nothing here is in Git):
//   IDAUTO_HADDAD_MEDIA_URL     e.g. https://<haddad tailnet name>/idauto-media
//   IDAUTO_HADDAD_MEDIA_ADDR    optional: the address to connect to (when the name does not resolve here)
//   IDAUTO_HADDAD_MEDIA_TOKEN   the receiver's bearer token
// Without them: status 'not_configured' — visible, nothing attempted.
// =====================================================

var https = require('https');
var http = require('http');
var fs = require('fs');
var path = require('path');
var db = require('../db.js');

var TARGET = 'haddad', BATCH = 10, MAX_BYTES = 25 * 1024 * 1024;

function config(env) {
  env = env || process.env;
  var url = env.IDAUTO_HADDAD_MEDIA_URL || '', token = env.IDAUTO_HADDAD_MEDIA_TOKEN || '';
  var ok = /^https?:\/\/[^\s]+$/.test(url) && token.length >= 32;
  return { enabled: ok, url: url.replace(/\/+$/, ''), addr: env.IDAUTO_HADDAD_MEDIA_ADDR || '', token: token };
}
function filePath(key) {
  var root = process.env.IDAUTO_MEDIA_STORAGE_PATH;
  if (!root || !/^[a-f0-9]{64}$/.test(key)) return null;
  return path.join(root, key.slice(0, 2), key.slice(2, 4), key);
}

// one HTTP call to the receiver: PUT (store) or DELETE; resolves { status } or rejects
function call(cfg, method, key, body) {
  return new Promise(function (resolve, reject) {
    var u = new URL(cfg.url + '/objects/' + key), lib = u.protocol === 'https:' ? https : http;
    var opts = { method: method, hostname: cfg.addr || u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Host': u.host, 'Content-Length': body ? body.length : 0, 'Content-Type': 'application/octet-stream' }, timeout: 30000 };
    if (u.protocol === 'https:') opts.servername = u.hostname;          // the certificate is the name's, even when connecting by address
    var req = lib.request(opts, function (res) { res.resume(); res.on('end', function () { resolve({ status: res.statusCode }); }); });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Update 4 — a JSON call to the receiver (archive metadata, LENS status): resolves { status, json }
function request(cfg, method, p, body) {
  return new Promise(function (resolve, reject) {
    var u = new URL(cfg.url + p), lib = u.protocol === 'https:' ? https : http, data = body ? Buffer.from(JSON.stringify(body)) : null;
    var opts = { method: method, hostname: cfg.addr || u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Host': u.host, 'Content-Length': data ? data.length : 0, 'Content-Type': 'application/json' }, timeout: 30000 };
    if (u.protocol === 'https:') opts.servername = u.hostname;
    var req = lib.request(opts, function (res) {
      var c = [], size = 0; res.on('data', function (d) { size += d.length; if (size <= 65536) c.push(d); });
      res.on('end', function () { var j = null; try { j = JSON.parse(Buffer.concat(c).toString('utf8')); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function attempt(cfg, row) {
  var key = row.object_key, err = null, ok = false;
  try {
    if (row.status === 'delete_pending') {
      var d = await call(cfg, 'DELETE', key, null);
      ok = d.status === 200 || d.status === 204 || d.status === 404;
      if (!ok) err = 'HTTP ' + d.status;
    } else {
      var p = filePath(key);
      if (!p || !fs.existsSync(p)) err = 'local file missing';
      else {
        var bytes = await fs.promises.readFile(p);           // never block the API's event loop
        if (bytes.length > MAX_BYTES) err = 'file too large for the receiver';
        else { var r = await call(cfg, 'PUT', key, bytes); ok = r.status === 200 || r.status === 201; if (!ok) err = 'HTTP ' + r.status; }
      }
    }
  } catch (e) { err = String(e && e.message || e).slice(0, 160); }
  var next = ok ? null : row.status === 'delete_pending' ? 'delete_pending' : 'failed';
  if (ok && row.status === 'delete_pending') await require('../archive/archive-service.js').removed(key).catch(function () {});
  if (ok) await db.query("UPDATE idauto_media_replicas SET status = $3, attempts = attempts + 1, last_error = NULL, replicated_at = NOW(), updated_at = NOW() WHERE object_key = $1 AND target = $2", [key, TARGET, row.status === 'delete_pending' ? 'deleted' : 'stored']);
  else await db.query("UPDATE idauto_media_replicas SET status = $3, attempts = attempts + 1, last_error = $4, next_try_at = NOW() + make_interval(secs => LEAST(3600, 30 * power(2, LEAST(attempts, 7))::int)), updated_at = NOW() WHERE object_key = $1 AND target = $2", [key, TARGET, next, err]);
  return ok;
}

var inFlight = Object.create(null);
async function enqueue(key) {
  if (!/^[a-f0-9]{64}$/.test(String(key || ''))) return;
  await db.query("INSERT INTO idauto_media_replicas (object_key, target) VALUES ($1, $2) ON CONFLICT (object_key, target) DO UPDATE SET status = CASE WHEN idauto_media_replicas.status IN ('deleted', 'delete_pending') THEN 'pending' ELSE idauto_media_replicas.status END, next_try_at = CASE WHEN idauto_media_replicas.status = 'stored' THEN idauto_media_replicas.next_try_at ELSE NOW() END, updated_at = NOW()", [key, TARGET]);
  var cfg = config();
  if (!cfg.enabled || inFlight[key]) return;
  inFlight[key] = true;
  // at once, without making the caller wait: the answer the person sees does not depend on Haddad
  setImmediate(function () {
    db.query("SELECT object_key, status FROM idauto_media_replicas WHERE object_key = $1 AND target = $2 AND status IN ('pending', 'failed')", [key, TARGET])
      .then(function (r) { return r.rows[0] ? attempt(cfg, r.rows[0]) : null; })
      .catch(function () {}).then(function () { delete inFlight[key]; });
  });
}
async function forget(key) {
  if (!/^[a-f0-9]{64}$/.test(String(key || ''))) return;
  await db.query("UPDATE idauto_media_replicas SET status = 'delete_pending', next_try_at = NOW(), updated_at = NOW() WHERE object_key = $1 AND target = $2 AND status <> 'deleted'", [key, TARGET]);
}
async function status(keys) {
  var out = {}, cfg = config();
  (keys || []).forEach(function (k) { out[k] = cfg.enabled ? 'pending' : 'not_configured'; });
  if (!keys || !keys.length) return out;
  var rows = (await db.query('SELECT object_key, status, last_error FROM idauto_media_replicas WHERE target = $1 AND object_key = ANY($2::text[])', [TARGET, keys])).rows;
  rows.forEach(function (r) { out[r.object_key] = !cfg.enabled && r.status !== 'stored' ? 'not_configured' : r.status === 'delete_pending' || r.status === 'deleted' ? 'deleted' : r.status; });
  return out;
}
async function pass() {
  var cfg = config();
  if (!cfg.enabled) return 0;
  var rows = (await db.query("SELECT object_key, status FROM idauto_media_replicas WHERE target = $1 AND status IN ('pending', 'failed', 'delete_pending') AND next_try_at <= NOW() ORDER BY next_try_at LIMIT $2", [TARGET, BATCH])).rows, n = 0;
  for (var i = 0; i < rows.length; i++) { if (inFlight[rows[i].object_key]) continue; inFlight[rows[i].object_key] = true; try { if (await attempt(cfg, rows[i])) n++; } finally { delete inFlight[rows[i].object_key]; } }
  return n;
}
var timer = null;
function start() {
  if (timer) return;
  timer = setInterval(function () {
    db.query("SELECT to_regclass('public.idauto_media_replicas') IS NOT NULL t").then(function (r) {
      if (!r.rows[0].t) return 0;
      // expired anonymous photographs are removed here too, whether or not public storage is still on
      return require('../photos/scan-service.js').purgeExpired().catch(function () {}).then(pass)
        .then(function () { return require('../archive/archive-service.js').pass().catch(function () {}); });   // Update 4 — the monthly archive
    }).catch(function () {});
  }, 30000);
  if (timer.unref) timer.unref();
}

module.exports = { request: request, enqueue: enqueue, forget: forget, status: status, pass: pass, start: start, config: config, TARGET: TARGET };
