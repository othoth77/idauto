'use strict';
// =====================================================
// IDauto — the client of the MYTHOS AUTO control plane. OFF UNLESS CONFIGURED.
// reference/auto/auto-client.js
//
// The ecosystem rule (othoth77/agents docs/AUTO-INTEGRATION.md): an AUTO application asks AUTO for a
// capability; AUTO forwards it to AGENTS, which resolves the agent, admits the job (HYBRID resource
// guard included) and dispatches it. IDauto never calls AGENTS, LENS or a model provider for agent work
// through this path. This file is the only place IDauto talks to AUTO.
//
// The wire contract is AUTO API v1 (othoth77/auto docs/API.md), and nothing beyond it:
//   POST /api/v1/capability-requests            { schema_version:'1', capability, input, idempotency_key,
//                                                 correlation_id?, deadline_s? } → 201 new / 200 duplicate
//   GET  /api/v1/capability-requests/<req-…>    current state (AUTO refreshes it from AGENTS)
//   POST /api/v1/capability-requests/<req-…>/cancel
//   POST /api/v1/workflow-runs                  { workflow, input, idempotency_key, correlation_id? } → 202 / 200
//   GET  /api/v1/workflow-runs/<run-…>          step states and the aggregated result
//   POST /api/v1/workflow-runs/<run-…>/cancel
//   GET  /api/v1/capabilities                   what AUTO accepts, and from whom
// Every call carries X-Auto-Caller: idauto and Authorization: Bearer <token>. Errors are FICHES v1 bodies
// { error: { code, message, retryable, … } }; `retryable` says whether the SAME request with the SAME
// idempotency key can succeed.
//
// What this client does NOT do: upload a document. AUTO capabilities take a LENS file reference
// ({ file_id, sha256 }); there is no document hand-off for a service caller in AUTO API v1 or in the
// AUTO ↔ AGENTS contract v1 (§5, AGENTS gap AG-4). See docs/AUTO_CLIENT.md.
//
// Configuration (server environment, never in Git):
//   IDAUTO_AUTO_URL          https://… ; plain http:// only on loopback (a tailnet listener is reached over https,
//                            e.g. `tailscale serve`), so the bearer never leaves this host unencrypted
//   IDAUTO_AUTO_TOKEN_FILE   IDauto's caller token for AUTO: a regular file, mode 0600 or tighter, ≥ 16 characters,
//                            read on every call (rotation needs no restart) and never logged
// Without both, enabled() is false and every call fails with AUTO_NOT_CONFIGURED before any network use.
// =====================================================

var fs = require('fs');
var http = require('http');
var https = require('https');
var crypto = require('crypto');

var CALLER = 'idauto';
var SCHEMA_VERSION = '1';
var IDEMPOTENCY_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;          // AUTO src/gateway.mjs
var CORRELATION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/; // AUTO src/gateway.mjs
var REQUEST_ID_RE = /^req-[0-9a-f]{32}$/;
var RUN_ID_RE = /^run-[0-9a-f]{32}$/;
var CAPABILITY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
var WORKFLOW_RE = /^[a-z][a-z0-9-]{1,63}$/;
var TERMINAL = ['completed', 'failed', 'cancelled'];
var MAX_RESPONSE_BYTES = 1024 * 1024;

var DEFAULTS = { timeoutMs: 10000, attempts: 3, backoffMs: 500, maxBackoffMs: 5000, pollMs: 2000 };

function AutoClientError(code, message, extra) {
  var e = new Error(message || code);
  e.name = 'AutoClientError';
  e.code = code;
  e.httpStatus = extra && extra.httpStatus || 0;
  e.retryable = !!(extra && extra.retryable);
  if (extra && extra.details) e.details = extra.details;
  if (extra && extra.requestId) e.requestId = extra.requestId;
  return e;
}

// Plain http only on loopback: the bearer never leaves this host unencrypted. Every other host needs https.
function allowedUrl(raw) {
  var u;
  try { u = new URL(String(raw || '')); } catch (e) { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.protocol === 'https:') return u;
  if (u.protocol !== 'http:') return null;
  var h = u.hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ? u : null;
}

// The token file follows AUTO's own rule (src/util.mjs readSecretFile): regular file, no group/other bits, ≥ 16 chars.
function readToken(file) {
  try {
    var st = fs.statSync(file);
    if (!st.isFile() || (st.mode & 0o077) !== 0) return null;
    var t = fs.readFileSync(file, 'utf8').trim();
    return t.length >= 16 && !/\s/.test(t) ? t : null;
  } catch (e) { return null; }
}

function config(env) {
  env = env || process.env;
  var rawUrl = String(env.IDAUTO_AUTO_URL || '').trim(), tokenFile = String(env.IDAUTO_AUTO_TOKEN_FILE || '').trim();
  if (!rawUrl && !tokenFile) return { enabled: false, reason: 'not_configured' };
  var u = allowedUrl(rawUrl);
  if (!u) return { enabled: false, reason: rawUrl ? 'url_not_allowed' : 'url_missing' };
  if (!tokenFile) return { enabled: false, reason: 'token_file_missing' };
  return { enabled: true, reason: null, url: u.origin + u.pathname.replace(/\/+$/, ''), tokenFile: tokenFile };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---- Retry-After (RFC 9110 §10.2.3): delay-seconds, or an HTTP-date in any of the three forms §5.6.7 requires a
// recipient to accept. Returns the wait in milliseconds, capped at MAX_RETRY_AFTER_MS, or null when the header is
// absent or invalid (the caller then uses its own backoff). A date in the past means "now" (0). A server can never
// make IDauto wait longer than the cap, and the number of attempts is unchanged.
var MAX_RETRY_AFTER_MS = 60000;
var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
var RFC850_DATE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
var ASCTIME_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

// UTC milliseconds for a valid calendar date and time, or null (31 Feb, 25:00, a weekday that does not match…).
function utc(year, monthIndex, day, hh, mm, ss, weekday) {
  if (hh > 23 || mm > 59 || ss > 59 || day < 1) return null;
  var t = Date.UTC(year, monthIndex, day, hh, mm, ss), d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null;
  return d.getUTCDay() === weekday ? t : null;
}

function parseHttpDate(v, nowMs) {
  var m;
  if ((m = IMF_FIXDATE.exec(v))) return utc(+m[4], MONTHS.indexOf(m[3]), +m[2], +m[5], +m[6], +m[7], DAYS.indexOf(m[1]));
  if ((m = RFC850_DATE.exec(v))) {
    // Two-digit year: a date that would be more than 50 years in the future is in the previous century (§5.6.7).
    var year = 2000 + Number(m[4]);
    if (year > new Date(nowMs).getUTCFullYear() + 50) year -= 100;
    return utc(year, MONTHS.indexOf(m[3]), +m[2], +m[5], +m[6], +m[7], LONG_DAYS.indexOf(m[1]));
  }
  if ((m = ASCTIME_DATE.exec(v))) return utc(+m[7], MONTHS.indexOf(m[2]), +m[3].trim(), +m[4], +m[5], +m[6], DAYS.indexOf(m[1]));
  return null;
}

function parseRetryAfter(value, nowMs) {
  if (Array.isArray(value)) return null;               // several Retry-After headers: ambiguous, ignore
  if (typeof value !== 'string') return null;
  var v = value.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, MAX_RETRY_AFTER_MS);   // also caps "999999999999999999999"
  var t = parseHttpDate(v, nowMs);
  if (t === null) return null;                         // "-5", "1.5", "0x10", "soon", an impossible date…
  return Math.min(Math.max(0, t - nowMs), MAX_RETRY_AFTER_MS);
}

function newCorrelationId() { return 'idauto-' + crypto.randomUUID(); }

// One HTTP exchange. Resolves { status, json, retryAfterMs } or rejects with a transport error.
function exchange(cfg, method, path, body, timeoutMs, token, now) {
  return new Promise(function (resolve, reject) {
    var u = new URL(cfg.url + path);
    var mod = u.protocol === 'https:' ? https : http;
    var payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    var headers = { Accept: 'application/json', 'X-Auto-Caller': CALLER, Authorization: 'Bearer ' + token };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    var done = false;
    var req = mod.request({ method: method, hostname: u.hostname, port: u.port, path: u.pathname, headers: headers }, function (res) {
      var chunks = [], size = 0;
      res.on('data', function (c) { size += c.length; if (size > MAX_RESPONSE_BYTES) { req.destroy(new Error('response_too_large')); return; } chunks.push(c); });
      res.on('end', function () {
        if (done) return; done = true; clearTimeout(timer);
        var json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json: json, retryAfterMs: parseRetryAfter(res.headers['retry-after'], now()) });
      });
    });
    var timer = setTimeout(function () { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, timeoutMs);
    req.on('error', function (err) { if (done) return; done = true; clearTimeout(timer); reject(err); });
    if (payload) req.write(payload);
    req.end();
  });
}

// createClient({ env, log, timeoutMs, attempts, backoffMs, pollMs }) — the client is cheap; config and the
// token are re-read on every call.
function createClient(opts) {
  opts = opts || {};
  var o = {};
  Object.keys(DEFAULTS).forEach(function (k) { o[k] = opts[k] !== undefined ? opts[k] : DEFAULTS[k]; });
  var log = typeof opts.log === 'function' ? opts.log : function () {};
  var wait = opts.sleep || sleep;
  var now = typeof opts.now === 'function' ? opts.now : Date.now;

  function current() {
    var cfg = config(opts.env);
    if (!cfg.enabled) throw AutoClientError('AUTO_NOT_CONFIGURED', 'AUTO is not configured for IDauto (' + cfg.reason + ')', { httpStatus: 503 });
    var token = readToken(cfg.tokenFile);
    if (!token) throw AutoClientError('AUTO_CREDENTIAL_UNREADABLE', 'the AUTO token file is missing, too open (needs 0600) or too short', { httpStatus: 503 });
    return { cfg: cfg, token: token };
  }

  // A call with bounded retries. Only failures that cannot have been the server's final answer are retried:
  // transport errors and timeouts, 429, 502/503/504, and any FICHES error marked retryable. POSTs that create
  // something always carry an idempotency key, so a retry after an unknown outcome is safe.
  async function call(op, method, path, body, correlationId) {
    var c = current(), lastErr = null;
    for (var attempt = 1; attempt <= o.attempts; attempt++) {
      var t0 = Date.now(), status = 0, code = null;
      try {
        var r = await exchange(c.cfg, method, path, body, o.timeoutMs, c.token, now);
        status = r.status;
        var err = r.json && r.json.error && typeof r.json.error === 'object' ? r.json.error : null;
        if (status >= 200 && status < 300 && r.json && !err) {
          log({ event: 'auto_call', op: op, status: status, attempt: attempt, ms: Date.now() - t0, correlation_id: correlationId || null });
          return { status: status, body: r.json };
        }
        code = err && typeof err.code === 'string' ? err.code : 'http_' + status;
        var retryable = err ? err.retryable === true : [429, 502, 503, 504].indexOf(status) !== -1;
        lastErr = AutoClientError(code, err && typeof err.message === 'string' ? err.message.slice(0, 300) : 'AUTO answered HTTP ' + status,
          { httpStatus: status, retryable: retryable, details: err && Array.isArray(err.details) ? err.details.slice(0, 20) : undefined, requestId: err && err.request_id });
        log({ event: 'auto_call', op: op, status: status, attempt: attempt, ms: Date.now() - t0, code: code, retryable: retryable, correlation_id: correlationId || null });
        if (!retryable) throw lastErr;
        if (attempt < o.attempts) await wait(r.retryAfterMs !== null ? r.retryAfterMs : backoff(attempt));
      } catch (e) {
        if (e && e.name === 'AutoClientError') { if (!e.retryable || attempt >= o.attempts) throw e; continue; }
        code = e && e.code === 'ETIMEDOUT' ? 'AUTO_TIMEOUT' : 'AUTO_UNREACHABLE';
        lastErr = AutoClientError(code, code === 'AUTO_TIMEOUT' ? 'AUTO did not answer in time; the outcome is unknown, retry with the same key' : 'AUTO could not be reached', { httpStatus: 503, retryable: true });
        log({ event: 'auto_call', op: op, status: 0, attempt: attempt, ms: Date.now() - t0, code: code, retryable: true, correlation_id: correlationId || null });
        if (attempt < o.attempts) await wait(backoff(attempt));
      }
    }
    throw lastErr;
  }

  function backoff(attempt) {
    var base = Math.min(o.maxBackoffMs, o.backoffMs * Math.pow(2, attempt - 1));
    return Math.round(base / 2 + Math.random() * base / 2);
  }

  function checkKey(key) {
    if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) {
      throw AutoClientError('AUTO_BAD_INPUT', 'idempotencyKey: 8..64 of a-z 0-9 - (keep the same key across retries)', { httpStatus: 400 });
    }
  }
  function checkCorrelation(id) {
    if (id !== undefined && id !== null && (typeof id !== 'string' || !CORRELATION_RE.test(id))) throw AutoClientError('AUTO_BAD_INPUT', 'correlationId: 8..128 of A-Z a-z 0-9 . _ : -', { httpStatus: 400 });
    return id || newCorrelationId();
  }
  function shapeRequest(b) {
    if (!b || b.schema_version !== SCHEMA_VERSION || typeof b.request_id !== 'string' || !REQUEST_ID_RE.test(b.request_id) || typeof b.state !== 'string') {
      throw AutoClientError('AUTO_BAD_ANSWER', 'AUTO answered without a valid capability request', { httpStatus: 502 });
    }
    return {
      request_id: b.request_id, correlation_id: b.correlation_id || null, capability: b.capability, state: b.state,
      terminal: TERMINAL.indexOf(b.state) !== -1, duplicate: b.duplicate === true,
      agents: b.agents && typeof b.agents === 'object' ? { task_id: b.agents.task_id || null, agent_code: b.agents.agent_code || null, job: b.agents.job || null, state: b.agents.state || null } : null,
      result: b.result === undefined ? null : b.result, error: b.error || null
    };
  }
  function shapeRun(b) {
    if (!b || b.schema_version !== SCHEMA_VERSION || typeof b.run_id !== 'string' || !RUN_ID_RE.test(b.run_id) || typeof b.state !== 'string' || !Array.isArray(b.steps)) {
      throw AutoClientError('AUTO_BAD_ANSWER', 'AUTO answered without a valid workflow run', { httpStatus: 502 });
    }
    return {
      run_id: b.run_id, workflow: b.workflow, state: b.state, terminal: TERMINAL.indexOf(b.state) !== -1, duplicate: b.duplicate === true,
      correlation_id: b.correlation_id || null,
      steps: b.steps.map(function (s) { return { id: s.id, capability: s.capability, state: s.state, attempt: s.attempt, error: s.error || null }; }),
      result: b.result === undefined ? null : b.result
    };
  }

  // ---- capability requests -------------------------------------------------------------------------------
  async function requestCapability(capability, input, ro) {
    ro = ro || {};
    if (typeof capability !== 'string' || !CAPABILITY_RE.test(capability)) throw AutoClientError('AUTO_BAD_INPUT', 'capability: a capability name such as data.extract', { httpStatus: 400 });
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw AutoClientError('AUTO_BAD_INPUT', 'input must be an object', { httpStatus: 400 });
    checkKey(ro.idempotencyKey);
    var cid = checkCorrelation(ro.correlationId);
    var body = { schema_version: SCHEMA_VERSION, capability: capability, input: input, idempotency_key: ro.idempotencyKey, correlation_id: cid };
    if (ro.deadlineS !== undefined) {
      if (!Number.isInteger(ro.deadlineS) || ro.deadlineS < 30) throw AutoClientError('AUTO_BAD_INPUT', 'deadlineS: integer ≥ 30', { httpStatus: 400 });
      body.deadline_s = ro.deadlineS;
    }
    var r = await call('capability.submit', 'POST', '/api/v1/capability-requests', body, cid);
    return shapeRequest(r.body);
  }
  async function getRequest(requestId) {
    if (!REQUEST_ID_RE.test(String(requestId))) throw AutoClientError('AUTO_BAD_INPUT', 'requestId: req-<32 hex>', { httpStatus: 400 });
    return shapeRequest((await call('capability.get', 'GET', '/api/v1/capability-requests/' + requestId)).body);
  }
  async function cancelRequest(requestId) {
    if (!REQUEST_ID_RE.test(String(requestId))) throw AutoClientError('AUTO_BAD_INPUT', 'requestId: req-<32 hex>', { httpStatus: 400 });
    return shapeRequest((await call('capability.cancel', 'POST', '/api/v1/capability-requests/' + requestId + '/cancel', {})).body);
  }

  // ---- workflow runs -------------------------------------------------------------------------------------
  async function startWorkflow(workflow, input, ro) {
    ro = ro || {};
    if (typeof workflow !== 'string' || !WORKFLOW_RE.test(workflow)) throw AutoClientError('AUTO_BAD_INPUT', 'workflow: a registered workflow id', { httpStatus: 400 });
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw AutoClientError('AUTO_BAD_INPUT', 'input must be an object', { httpStatus: 400 });
    checkKey(ro.idempotencyKey);
    var cid = checkCorrelation(ro.correlationId);
    var r = await call('workflow.start', 'POST', '/api/v1/workflow-runs', { workflow: workflow, input: input, idempotency_key: ro.idempotencyKey, correlation_id: cid }, cid);
    return shapeRun(r.body);
  }
  async function getWorkflowRun(runId) {
    if (!RUN_ID_RE.test(String(runId))) throw AutoClientError('AUTO_BAD_INPUT', 'runId: run-<32 hex>', { httpStatus: 400 });
    return shapeRun((await call('workflow.get', 'GET', '/api/v1/workflow-runs/' + runId)).body);
  }
  async function cancelWorkflowRun(runId) {
    if (!RUN_ID_RE.test(String(runId))) throw AutoClientError('AUTO_BAD_INPUT', 'runId: run-<32 hex>', { httpStatus: 400 });
    return shapeRun((await call('workflow.cancel', 'POST', '/api/v1/workflow-runs/' + runId + '/cancel', {})).body);
  }

  // ---- waiting (polling is the v1 result contract; there are no callbacks) --------------------------------
  // Resolves the terminal state, or throws AUTO_WAIT_TIMEOUT (retryable: the work continues in AUTO; ask again
  // with the same id). A transient error while polling is retried by call() and does not end the wait.
  async function waitFor(get, id, wo) {
    wo = wo || {};
    var deadline = Date.now() + (wo.timeoutMs !== undefined ? wo.timeoutMs : 60000), pollMs = wo.pollMs !== undefined ? wo.pollMs : o.pollMs, last = null;
    for (;;) {
      last = await get(id);
      if (last.terminal) return last;
      if (Date.now() + pollMs > deadline) {
        throw Object.assign(AutoClientError('AUTO_WAIT_TIMEOUT', 'still ' + last.state + ' when the wait ended; the work continues in AUTO', { httpStatus: 504, retryable: true }), { last: last });
      }
      await wait(pollMs);
    }
  }

  async function capabilities() {
    var r = await call('capabilities', 'GET', '/api/v1/capabilities');
    var list = r.body && Array.isArray(r.body.capabilities) ? r.body.capabilities : null;
    if (!list) throw AutoClientError('AUTO_BAD_ANSWER', 'AUTO answered without a capability list', { httpStatus: 502 });
    return list.filter(function (c) { return c && Array.isArray(c.callers) && c.callers.indexOf(CALLER) !== -1; })
      .map(function (c) { return { capability: c.capability, status: c.status || [], input: c.input || {} }; });
  }

  return {
    enabled: function () { return config(opts.env).enabled; },
    status: function () { var c = config(opts.env); return { enabled: c.enabled, reason: c.reason }; },
    capabilities: capabilities,
    requestCapability: requestCapability, getRequest: getRequest, cancelRequest: cancelRequest,
    waitForRequest: function (id, wo) { return waitFor(getRequest, id, wo); },
    startWorkflow: startWorkflow, getWorkflowRun: getWorkflowRun, cancelWorkflowRun: cancelWorkflowRun,
    waitForWorkflowRun: function (id, wo) { return waitFor(getWorkflowRun, id, wo); }
  };
}

module.exports = { createClient: createClient, config: config, allowedUrl: allowedUrl, readToken: readToken, AutoClientError: AutoClientError,
  parseRetryAfter: parseRetryAfter, MAX_RETRY_AFTER_MS: MAX_RETRY_AFTER_MS,
  CALLER: CALLER, TERMINAL: TERMINAL, IDEMPOTENCY_RE: IDEMPOTENCY_RE, CORRELATION_RE: CORRELATION_RE };
