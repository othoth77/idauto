#!/usr/bin/env node
'use strict';
// IDauto — the Haddad copy of IDauto photographs and documents (Update 3.1), with the monthly archive (Update 4).
//
// Files are kept by their SHA-256, exactly like the media store of idauto.tn, so the same key names the same bytes on
// both servers. Reached only over the private network (tailscale serve, path /idauto-media), and only with the bearer
// token shared with the idauto.tn server.
//
//   PUT    /objects/<sha256>            store (the body must hash to the key; idempotent) → 201 new, 200 already there
//   HEAD   /objects/<sha256>            200 present, 404 absent
//   DELETE /objects/<sha256>            remove the file AND its archive entries (an expired anonymous photograph) → 204 / 404
//   POST   /objects/<sha256>/archive    { category, uploaded_at, … } → the file appears in the monthly archive:
//                                        <root>/<YYYY>/<MM>/<category>/<YYYYMMDDTHHMMSSZ>_<sha16>.<ext>  (a HARD LINK to the
//                                        stored file: same bytes, no copy, integrity unchanged) + the same name + ".json"
//                                        (the metadata). Idempotent per (file, category): a second call rewrites the .json
//                                        only. → 200 { path } — the path RELATIVE to the archive root, never an absolute one.
//   GET    /objects/<sha256>/lens       the LENS analysis of a carte grise: { status, document_type, fields } — technical
//                                        fields only (never the holder's name, CIN or address)
//   GET    /health                      { ok, objects, archived, bytes } — no file content is ever served
//
// Categories: vehicle-photos, carte-grise. The month is the month of `uploaded_at` (UTC) — the moment IDauto received the
// file, which is always known; the capture date is in the .json.
//
// LENS (optional): a carte grise is submitted to the local LENS service (127.0.0.1) — LENS is never exposed beyond this host.
//   IDAUTO_LENS_URL          e.g. http://127.0.0.1:8830
//   IDAUTO_LENS_TOKEN_FILE   LENS's api.token (read here, never logged)
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
var MAX = 25 * 1024 * 1024, MAX_META = 8192;
var CATEGORIES = ['vehicle-photos', 'carte-grise'];
var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
// what may leave LENS for IDauto: the technical fields of a carte grise — never the holder (name, CIN, address)
var LENS_FIELDS = ['plate_tn', 'vin', 'date_premiere_circulation', 'marque', 'type_commercial', 'genre', 'energie', 'puissance_fiscale', 'places_assises'];

function boot() {
  if (TOKEN.length < 32 || !ROOT) { console.error('IDAUTO_MEDIA_RECEIVER_TOKEN (≥32) and IDAUTO_MEDIA_RECEIVER_ROOT are required'); process.exit(2); }
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(ROOT, '.archive-index'), { recursive: true, mode: 0o700 });
}

function fileOf(key) { return path.join(ROOT, key.slice(0, 2), key.slice(2, 4), key); }
function indexOf(key, category) { return path.join(ROOT, '.archive-index', key + '.' + category + '.json'); }
function authorised(req) {
  var h = String(req.headers.authorization || ''), want = 'Bearer ' + TOKEN;
  return h.length === want.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(want));
}
function send(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body ? JSON.stringify(body) : ''); }
function log(o) { console.log(JSON.stringify(Object.assign({ at: new Date().toISOString() }, o))); }
function writeAtomic(f, data) { var tmp = f + '.tmp-' + process.pid + '-' + Date.now(); fs.writeFileSync(tmp, data, { mode: 0o600 }); fs.renameSync(tmp, f); }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

// ---- the metadata a caller may give, rebuilt field by field (nothing else is written to disk) --------------------------
function iso(v) { if (typeof v !== 'string' || v.length > 40) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
function str(v, max, re) { if (v === null || v === undefined) return null; var s = String(v).replace(/[\u0000-\u001f]/g, ' ').trim(); if (!s || s.length > max) return null; return re && !re.test(s) ? null : s; }
function num(v, lo, hi) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) || n < lo || n > hi ? null : n; }
function cleanMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var category = CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : null, uploaded = iso(raw.uploaded_at);
  if (!category || !uploaded) return null;
  var lat = num(raw.latitude, -90, 90), lon = num(raw.longitude, -180, 180);
  if (lat === null || lon === null) lat = lon = null;
  var src = ['exif', 'browser', 'manual'].indexOf(raw.location_source) !== -1 ? raw.location_source : null;
  return {
    category: category, uploaded_at: uploaded, captured_at: iso(raw.captured_at),
    latitude: lat, longitude: lon, location_source: lat === null && src !== 'manual' ? null : src,
    place_name: str(raw.place_name, 160), mime_type: EXT[raw.mime_type] ? raw.mime_type : null,
    original_filename: str(raw.original_filename, 255) ? path.basename(str(raw.original_filename, 255)) : null,
    source: ['public_scanner', 'admin', 'workshop'].indexOf(raw.source) !== -1 ? raw.source : null,
    uploaded_by: str(raw.uploaded_by, 80),
    vehicle: raw.vehicle && typeof raw.vehicle === 'object' ? { ivid: str(raw.vehicle.ivid, 80, /^ivid:[0-9a-z:._-]+$/i), vin: str(raw.vehicle.vin, 17, /^[A-HJ-NPR-Z0-9]{17}$/) } : null,
    record: raw.record && typeof raw.record === 'object' ? { kind: str(raw.record.kind, 30, /^[a-z_]+$/), id: str(raw.record.id, 40, /^[A-Za-z0-9_-]+$/), version: num(raw.record.version, 1, 100000) } : null
  };
}
function monthPath(meta, key) {
  var d = new Date(meta.uploaded_at), p2 = function (n) { return String(n).padStart(2, '0'); };
  var y = String(d.getUTCFullYear()), mo = p2(d.getUTCMonth() + 1);
  var stamp = y + mo + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  return path.join(y, mo, meta.category, stamp + '_' + key.slice(0, 16) + '.' + (EXT[meta.mime_type] || 'bin'));
}

// ---- archive: one hard link + one .json per (file, category) ---------------------------------------------------------
function archive(key, meta) {
  var f = fileOf(key);
  if (!fs.existsSync(f)) return { code: 404, body: { error: 'file not stored yet' } };
  var idx = indexOf(key, meta.category), known = readJson(idx), rel = known && known.path ? known.path : monthPath(meta, key);
  if (known && known.uploaded_at) meta.uploaded_at = known.uploaded_at;             // the first upload fixes the place in the archive
  var abs = path.join(ROOT, rel);
  if (path.relative(ROOT, abs).startsWith('..')) return { code: 400, body: { error: 'bad path' } };   // cannot happen: every piece is generated here
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(abs)) fs.linkSync(f, abs);
  var lens = known && known.lens ? known.lens : null;
  writeAtomic(abs + '.json', JSON.stringify(Object.assign({ sha256: key, file: path.basename(rel) }, meta, { lens: lens ? { job_id: lens.job_id, status: lens.status } : null }), null, 1));
  writeAtomic(idx, JSON.stringify({ path: rel, uploaded_at: meta.uploaded_at, lens: lens }));
  return { code: 200, body: { path: rel, created: !known } };
}
function unarchive(key) {
  CATEGORIES.forEach(function (c) {
    var idx = indexOf(key, c), known = readJson(idx);
    if (!known || !known.path) return;
    var abs = path.join(ROOT, known.path);
    [abs, abs + '.json'].forEach(function (x) { try { fs.unlinkSync(x); } catch (e) {} });
    try { fs.unlinkSync(idx); } catch (e) {}
  });
}

// ---- LENS (local only) --------------------------------------------------------------------------------------------------
function lensConfig() {
  var url = process.env.IDAUTO_LENS_URL || '', tf = process.env.IDAUTO_LENS_TOKEN_FILE || '';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !tf) return null;                 // LENS is reached on this host only
  try { var t = fs.readFileSync(tf, 'utf8').trim(); return t ? { url: url, token: t } : null; } catch (e) { return null; }
}
function lensCall(cfg, method, p, body, headers) {
  return new Promise(function (resolve, reject) {
    var u = new URL(cfg.url + p), h = Object.assign({ Authorization: 'Bearer ' + cfg.token, Host: u.host }, headers || {});
    if (body) h['Content-Length'] = body.length;
    var req = http.request({ method: method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: h, timeout: 30000 }, function (res) {
      var c = []; res.on('data', function (d) { c.push(d); }); res.on('end', function () { var t = Buffer.concat(c).toString('utf8'); var j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); }); req.on('error', reject);
    if (body) req.write(body); req.end();
  });
}
async function lensSubmit(key, meta) {
  var cfg = lensConfig(), idx = indexOf(key, 'carte-grise'), known = readJson(idx) || {};
  if (!cfg) { known.lens = { status: 'not_configured' }; writeAtomic(idx, JSON.stringify(known)); return; }
  if (known.lens && known.lens.job_id) return;                                        // submitted once per file
  try {
    var bytes = fs.readFileSync(fileOf(key));
    var up = await lensCall(cfg, 'POST', '/v1/files', bytes, { 'Content-Type': 'application/octet-stream', 'X-Lens-Kind': 'scan', 'X-Lens-Filename': 'carte-grise.' + (EXT[meta.mime_type] || 'bin') });
    if (up.status !== 201 && up.status !== 200 || !up.json || !up.json.file_id) throw new Error('upload HTTP ' + up.status);
    var job = { schema_version: 'lens.job-request/1', job_id: 'idauto-cg-' + key.slice(0, 24), workflow: 'extract_fields', inputs: [{ file_id: up.json.file_id, sha256: up.json.sha256 }],
      destination_profile_id: null, requested_at: new Date().toISOString(), requested_languages: ['fr', 'ar'], idempotency_key: 'idauto-cg-' + key.slice(0, 40), data_policy: 'local_only' };
    var jr = await lensCall(cfg, 'POST', '/v1/jobs', Buffer.from(JSON.stringify(job)), { 'Content-Type': 'application/json' });
    if (jr.status !== 201 && jr.status !== 200 || !jr.json) throw new Error('job HTTP ' + jr.status);
    known.lens = { job_id: jr.json.job_id || job.job_id, status: jr.json.state || 'queued' };
    log({ event: 'lens_submitted', key: key, job: known.lens.job_id });
  } catch (e) { known.lens = { status: 'submit_failed', error: String(e.message || e).slice(0, 120) }; log({ event: 'lens_submit_failed', key: key }); }
  writeAtomic(idx, JSON.stringify(known));
}
async function lensStatus(key) {
  var cfg = lensConfig(), idx = indexOf(key, 'carte-grise'), known = readJson(idx);
  if (!known) return { code: 404, body: { error: 'not archived as carte-grise' } };
  var l = known.lens || { status: 'not_submitted' };
  if (!cfg || !l.job_id) return { code: 200, body: { status: l.status } };
  var j = await lensCall(cfg, 'GET', '/v1/jobs/' + encodeURIComponent(l.job_id));
  var state = j.json && (j.json.state || j.json.status) || 'unknown', out = { status: state, job_id: l.job_id };
  if (['succeeded', 'needs_review', 'failed'].indexOf(state) !== -1 && state !== 'failed') {
    var r = await lensCall(cfg, 'GET', '/v1/jobs/' + encodeURIComponent(l.job_id) + '/result');
    var res = r.json || {};
    out.document_type = res.document_type || null;
    out.fields = (res.fields || []).filter(function (f) { return LENS_FIELDS.indexOf(f.field_key) !== -1; })
      .map(function (f) { return { key: f.field_key, value: f.normalized_value !== null && f.normalized_value !== undefined ? String(f.normalized_value).slice(0, 80) : null, state: f.state, confidence: typeof f.confidence === 'number' ? f.confidence : null }; });
  }
  known.lens = { job_id: l.job_id, status: state }; writeAtomic(idx, JSON.stringify(known));
  return { code: 200, body: out };
}

function readBody(req, max, cb) {
  var chunks = [], size = 0, over = false;
  req.on('data', function (c) { size += c.length; if (size > max) over = true; else chunks.push(c); });
  req.on('end', function () { cb(over, Buffer.concat(chunks)); });
}

function handler(req, res) {
  var p = req.url.split('?')[0].replace(/^\/idauto-media/, '');          // with or without the mount path
  if (p === '/health' && req.method === 'GET') {
    if (!authorised(req)) return send(res, 401, { error: 'unauthorised' });
    var n = 0, a = 0, bytes = 0;
    (function walk(d, depth, top) { try { fs.readdirSync(d).forEach(function (f) { if (depth === 0 && f === '.archive-index') return; var x = path.join(d, f), st = fs.statSync(x); if (st.isDirectory()) walk(x, depth + 1, depth === 0 ? f : top); else if (/^[0-9a-f]{2}$/.test(top)) { n++; bytes += st.size; } else if (!/\.json$/.test(f)) a++; }); } catch (e) {} }(ROOT, 0, ''));
    return send(res, 200, { ok: true, objects: n, archived: a, bytes: bytes, lens: !!lensConfig() });
  }
  var m = /^\/objects\/([a-f0-9]{64})(\/archive|\/lens)?$/.exec(p);
  if (!m) return send(res, 404, { error: 'not found' });
  if (!authorised(req)) { req.resume(); log({ event: 'refused', method: req.method }); return send(res, 401, { error: 'unauthorised' }); }
  var key = m[1], f = fileOf(key), sub = m[2] || '';
  if (sub === '/archive') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return readBody(req, MAX_META, function (over, body) {
      if (over) return send(res, 413, { error: 'metadata too large' });
      var raw; try { raw = JSON.parse(body.toString('utf8')); } catch (e) { return send(res, 400, { error: 'invalid JSON' }); }
      var meta = cleanMeta(raw);
      if (!meta) return send(res, 400, { error: 'category and uploaded_at are required' });
      var out = archive(key, meta);
      if (out.code === 200) { log({ event: 'archived', key: key, category: meta.category }); if (meta.category === 'carte-grise') lensSubmit(key, meta).catch(function () {}); }
      send(res, out.code, out.body);
    });
  }
  if (sub === '/lens') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    return lensStatus(key).then(function (o) { send(res, o.code, o.body); }, function () { send(res, 502, { status: 'lens_unreachable' }); });
  }
  if (req.method === 'HEAD') return send(res, fs.existsSync(f) ? 200 : 404);
  if (req.method === 'DELETE') {
    if (!fs.existsSync(f)) { unarchive(key); return send(res, 404); }
    unarchive(key); fs.unlinkSync(f); log({ event: 'deleted', key: key }); return send(res, 204);
  }
  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' });
  readBody(req, MAX, function (over, body) {
    if (over) return send(res, 413, { error: 'too large' });
    var sha = crypto.createHash('sha256').update(body).digest('hex');
    if (sha !== key) { log({ event: 'hash_mismatch', key: key }); return send(res, 400, { error: 'content does not match its key' }); }
    if (fs.existsSync(f)) return send(res, 200, { stored: true, already: true });
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeAtomic(f, body);
    log({ event: 'stored', key: key, bytes: body.length });
    send(res, 201, { stored: true });
  });
}

if (require.main === module) { boot(); http.createServer(handler).listen(PORT, '127.0.0.1', function () { log({ event: 'listening', port: PORT }); }); }
module.exports = { handler: handler, cleanMeta: cleanMeta, monthPath: monthPath, LENS_FIELDS: LENS_FIELDS, CATEGORIES: CATEGORIES };
