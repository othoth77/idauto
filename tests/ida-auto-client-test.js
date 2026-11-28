#!/usr/bin/env node
'use strict';
/* IDauto — the MYTHOS AUTO client (reference/auto/auto-client.js).
 *
 * Offline: no database. AUTO is played by a small HTTP server on 127.0.0.1 inside this file, so every failure
 * can be produced on demand (timeouts, refused connections, retryable and final errors, malformed answers).
 * The real AUTO and AGENTS code is exercised by tests/ida-auto-contract-test.js.
 *
 * Section 9 is the guard for the ecosystem rule "applications reach agents only through AUTO": it pins the
 * places where IDauto still talks to a model provider or to LENS directly, so a new direct path fails here. */

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var BASE = path.join(__dirname, '..');
var A = require(path.join(BASE, 'reference', 'auto', 'auto-client.js'));
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

var TOKEN = 'idauto-token-' + 'x'.repeat(30);
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ida-auto-'));
function tokenFile(name, value, mode) { var f = path.join(dir, name); fs.writeFileSync(f, value + '\n'); fs.chmodSync(f, mode); return f; }
var GOOD = tokenFile('good', TOKEN, 0o600);

function reqBody(state, extra) {
  return Object.assign({ schema_version: '1', request_id: 'req-' + '0'.repeat(32), correlation_id: 'corr-12345678', capability: 'data.extract', state: state,
    agents: { task_id: 't_1', agent_code: 'MY003', job: 'vision.extract', state: state }, result: null, error: null, duplicate: false }, extra || {});
}
function runBody(state) {
  return { schema_version: '1', run_id: 'run-' + 'a'.repeat(32), workflow: 'vehicle-document-intake', state: state, correlation_id: 'corr-12345678',
    steps: [{ id: 'inspect', capability: 'vision.ingest', state: state, attempt: 1, error: null }], result: state === 'completed' ? { completed: ['inspect'] } : null, duplicate: false };
}

// A scripted AUTO: `script` is a queue of answers ({ status, body, headers, hang, raw }); every request is recorded.
function fakeAuto() {
  var seen = [], script = [];
  var server = http.createServer(function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      var text = Buffer.concat(chunks).toString('utf8'), body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body });
      var a = script.length ? script.shift() : { status: 500, body: { error: { code: 'unscripted', message: 'no answer scripted', retryable: false } } };
      if (a.hang) return;                                          // never answers: the client must time out
      res.writeHead(a.status, Object.assign({ 'content-type': 'application/json' }, a.headers || {}));
      res.end(a.raw !== undefined ? a.raw : JSON.stringify(a.body));
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ url: 'http://127.0.0.1:' + server.address().port, seen: seen, script: script, close: function () { server.closeAllConnections(); return new Promise(function (r) { server.close(r); }); } });
    });
  });
}

function client(env, extra) {
  var sleeps = [], logs = [];
  var c = A.createClient(Object.assign({ env: env, attempts: 3, timeoutMs: 400, sleep: function (ms) { sleeps.push(ms); return Promise.resolve(); }, log: function (e) { logs.push(e); } }, extra || {}));
  c.sleeps = sleeps; c.logs = logs;
  return c;
}
async function rejects(p, code) { try { await p; return null; } catch (e) { return e && e.code === code ? e : (console.log('    got ' + (e && e.code) + ' ' + (e && e.message)), null); } }

(async function main() {
  var auto = await fakeAuto();
  var env = { IDAUTO_AUTO_URL: auto.url, IDAUTO_AUTO_TOKEN_FILE: GOOD };
  var KEY = 'cg-intake-0001';

  say('1. OFF UNLESS CONFIGURED');
  var off = client({});
  ok(off.enabled() === false && off.status().reason === 'not_configured', 'no environment → disabled, reason not_configured');
  ok(await rejects(off.requestCapability('data.extract', { file_id: 'f_x' }, { idempotencyKey: KEY }), 'AUTO_NOT_CONFIGURED'), 'a call when disabled → AUTO_NOT_CONFIGURED');
  ok(await rejects(off.capabilities(), 'AUTO_NOT_CONFIGURED'), 'capabilities() when disabled → AUTO_NOT_CONFIGURED');
  ok(auto.seen.length === 0, 'disabled: nothing reached the network');

  say('2. WHERE THE BEARER MAY GO');
  ok(A.config({ IDAUTO_AUTO_URL: 'https://auto.example.tn', IDAUTO_AUTO_TOKEN_FILE: GOOD }).enabled, 'https to any host is allowed');
  ok(A.config({ IDAUTO_AUTO_URL: 'https://192.0.2.10:8760', IDAUTO_AUTO_TOKEN_FILE: GOOD }).enabled, 'https to an address is allowed (TEST-NET-1 documentation address)');
  // Plain http only where the bearer cannot leave this host: the whole loopback range, localhost, ::1.
  ['http://127.0.0.1:8760', 'http://127.255.255.254:8760', 'http://localhost:8760', 'http://[::1]:8760']
    .forEach(function (u) { ok(A.config({ IDAUTO_AUTO_URL: u, IDAUTO_AUTO_TOKEN_FILE: GOOD }).enabled, 'http on loopback is allowed: ' + u); });
  // Everything else over plain http is refused, private networks and documentation addresses included; so are other
  // schemes, credentials in the URL, a query or fragment, a host that only looks like loopback, and garbage.
  ['http://auto.example.tn', 'http://10.0.0.5:8760', 'http://172.16.0.1:8760', 'http://192.168.1.5:8760', 'http://192.0.2.10:8760',
    'http://198.51.100.7:8760', 'http://203.0.113.9:8760', 'http://127.0.0.1.example.tn', 'ftp://127.0.0.1', 'https://user:password@auto.example.tn',
    'https://auto.example.tn/?x=1', 'https://auto.example.tn/#frag', 'not a url']
    .forEach(function (u) { ok(A.config({ IDAUTO_AUTO_URL: u, IDAUTO_AUTO_TOKEN_FILE: GOOD }).reason === 'url_not_allowed', 'refused: ' + u); });
  ok(A.config({ IDAUTO_AUTO_URL: auto.url }).reason === 'token_file_missing', 'a URL without a token file is not enabled');
  ok(A.config({ IDAUTO_AUTO_TOKEN_FILE: GOOD }).reason === 'url_missing', 'a token file without a URL is not enabled');

  say('3. THE TOKEN FILE');
  var open = client({ IDAUTO_AUTO_URL: auto.url, IDAUTO_AUTO_TOKEN_FILE: tokenFile('open', TOKEN, 0o644) });
  ok(await rejects(open.capabilities(), 'AUTO_CREDENTIAL_UNREADABLE'), 'a group/world-readable token file is refused');
  var short = client({ IDAUTO_AUTO_URL: auto.url, IDAUTO_AUTO_TOKEN_FILE: tokenFile('short', 'tooshort', 0o600) });
  ok(await rejects(short.capabilities(), 'AUTO_CREDENTIAL_UNREADABLE'), 'a token shorter than 16 characters is refused');
  var missing = client({ IDAUTO_AUTO_URL: auto.url, IDAUTO_AUTO_TOKEN_FILE: path.join(dir, 'none') });
  ok(await rejects(missing.capabilities(), 'AUTO_CREDENTIAL_UNREADABLE'), 'a missing token file is refused');
  ok(auto.seen.length === 0, 'none of these reached the network');

  say('4. THE WIRE: HEADERS AND BODY (AUTO API v1)');
  var c = client(env);
  auto.script.push({ status: 201, body: reqBody('accepted') });
  var r = await c.requestCapability('data.extract', { file_id: 'f_' + 'a'.repeat(22), sha256: 'b'.repeat(64), doctype: 'carte_grise' }, { idempotencyKey: KEY, correlationId: 'corr-12345678', deadlineS: 600 });
  var s = auto.seen[auto.seen.length - 1];
  ok(s.method === 'POST' && s.url === '/api/v1/capability-requests', 'POST /api/v1/capability-requests');
  ok(s.headers['x-auto-caller'] === 'idauto', 'X-Auto-Caller: idauto');
  ok(s.headers.authorization === 'Bearer ' + TOKEN, 'Authorization: Bearer <token from the file>');
  ok(JSON.stringify(Object.keys(s.body).sort()) === JSON.stringify(['capability', 'correlation_id', 'deadline_s', 'idempotency_key', 'input', 'schema_version']), 'body carries exactly the v1 fields');
  ok(s.body.schema_version === '1' && s.body.idempotency_key === KEY && s.body.deadline_s === 600 && s.body.correlation_id === 'corr-12345678', 'schema_version, key, deadline and correlation id as given');
  ok(r.request_id === 'req-' + '0'.repeat(32) && r.state === 'accepted' && r.terminal === false && r.agents.agent_code === 'MY003', 'the answer is shaped: request id, state, AGENTS task');
  auto.script.push({ status: 201, body: reqBody('accepted') });
  await c.requestCapability('data.extract', { file_id: 'f_x' }, { idempotencyKey: KEY });
  ok(/^idauto-[0-9a-f-]{36}$/.test(auto.seen[auto.seen.length - 1].body.correlation_id), 'without a correlation id, one is generated (idauto-<uuid>)');
  auto.script.push({ status: 200, body: reqBody('accepted', { duplicate: true }) });
  ok((await c.requestCapability('data.extract', { file_id: 'f_x' }, { idempotencyKey: KEY })).duplicate === true, '200 duplicate:true is reported as a replay');

  say('5. INPUT REFUSED BEFORE THE NETWORK');
  var before = auto.seen.length;
  ok(await rejects(c.requestCapability('data.extract', {}, {}), 'AUTO_BAD_INPUT'), 'no idempotency key → refused (retries would not be safe)');
  ok(await rejects(c.requestCapability('data.extract', {}, { idempotencyKey: 'Bad Key!' }), 'AUTO_BAD_INPUT'), 'malformed idempotency key → refused');
  ok(await rejects(c.requestCapability('../tasks', {}, { idempotencyKey: KEY }), 'AUTO_BAD_INPUT'), 'malformed capability → refused');
  ok(await rejects(c.requestCapability('data.extract', [], { idempotencyKey: KEY }), 'AUTO_BAD_INPUT'), 'non-object input → refused');
  ok(await rejects(c.requestCapability('data.extract', {}, { idempotencyKey: KEY, deadlineS: 5 }), 'AUTO_BAD_INPUT'), 'deadline under 30 s → refused');
  ok(await rejects(c.requestCapability('data.extract', {}, { idempotencyKey: KEY, correlationId: 'x' }), 'AUTO_BAD_INPUT'), 'malformed correlation id → refused');
  ok(await rejects(c.getRequest('t_1'), 'AUTO_BAD_INPUT') && await rejects(c.getWorkflowRun('../x'), 'AUTO_BAD_INPUT'), 'malformed request / run ids → refused');
  ok(auto.seen.length === before, 'none of these reached the network');

  say('6. FINAL ERRORS ARE NOT RETRIED');
  var finals = [[409, 'idempotency_key_reused'], [403, 'capability_not_granted'], [422, 'validation_failed'], [401, 'unauthenticated'], [404, 'unknown_capability']];
  for (var i = 0; i < finals.length; i++) {
    var n0 = auto.seen.length, cf = client(env);
    auto.script.push({ status: finals[i][0], body: { error: { code: finals[i][1], message: 'm', retryable: false, request_id: 'rq-12345678', details: [{ field: 'input.sha256', issue: 'invalid' }] } } });
    var e = await rejects(cf.requestCapability('data.extract', {}, { idempotencyKey: KEY }), finals[i][1]);
    ok(e && e.httpStatus === finals[i][0] && e.retryable === false && auto.seen.length === n0 + 1 && cf.sleeps.length === 0, finals[i][0] + ' ' + finals[i][1] + ': one attempt, error code and status kept');
    if (i === 2) ok(e && e.details && e.details[0].field === 'input.sha256', 'FICHES details are kept');
  }
  var cn = client(env);
  auto.script.push({ status: 503, body: { error: { code: 'NOT_DISPATCHABLE', message: 'agent planned', retryable: false } } });
  var nd = await rejects(cn.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'NOT_DISPATCHABLE');
  ok(nd && nd.retryable === false && cn.sleeps.length === 0, '503 marked retryable:false (non-execution) → not retried');

  say('7. TRANSIENT FAILURES ARE RETRIED WITH THE SAME KEY');
  var ct = client(env), n1 = auto.seen.length;
  auto.script.push({ status: 503, body: { error: { code: 'QUEUE_FULL', message: 'busy', retryable: true } }, headers: { 'retry-after': '3' } });
  auto.script.push({ status: 502, raw: 'bad gateway' });
  auto.script.push({ status: 201, body: reqBody('accepted') });
  var got = await ct.requestCapability('data.extract', { file_id: 'f_x' }, { idempotencyKey: KEY });
  var tries = auto.seen.slice(n1);
  ok(got.state === 'accepted' && tries.length === 3, 'retryable 503, then a bare 502, then 201: three attempts, success');
  ok(tries.every(function (t) { return t.body.idempotency_key === KEY && t.body.correlation_id === tries[0].body.correlation_id; }), 'every attempt carries the same idempotency key and correlation id');
  ok(ct.sleeps[0] === 3000 && ct.sleeps.length === 2, 'Retry-After (3 s) is honoured; then exponential backoff');
  var cx = client(env), n2 = auto.seen.length;
  auto.script.push({ status: 503, body: { error: { code: 'QUEUE_UNAVAILABLE', message: 'x', retryable: true } } }, { status: 503, body: { error: { code: 'QUEUE_UNAVAILABLE', message: 'x', retryable: true } } }, { status: 503, body: { error: { code: 'QUEUE_UNAVAILABLE', message: 'x', retryable: true } } });
  var ex = await rejects(cx.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'QUEUE_UNAVAILABLE');
  ok(ex && ex.retryable === true && auto.seen.length - n2 === 3, 'bounded: after 3 attempts the retryable error is returned to the caller');
  var cto = client(env), n3 = auto.seen.length;
  auto.script.push({ hang: true }, { hang: true }, { status: 201, body: reqBody('accepted') });
  ok((await cto.requestCapability('data.extract', {}, { idempotencyKey: KEY })).state === 'accepted' && auto.seen.length - n3 === 3, 'two timeouts, then an answer: the request is not duplicated, it is retried with its key');
  var cto2 = client(env);
  auto.script.push({ hang: true }, { hang: true }, { hang: true });
  var te = await rejects(cto2.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'AUTO_TIMEOUT');
  ok(te && te.retryable === true, 'only timeouts → AUTO_TIMEOUT, retryable (outcome unknown)');
  var dead = client({ IDAUTO_AUTO_URL: 'http://127.0.0.1:9', IDAUTO_AUTO_TOKEN_FILE: GOOD });
  var de = await rejects(dead.capabilities(), 'AUTO_UNREACHABLE');
  ok(de && de.retryable === true && dead.sleeps.length === 2, 'connection refused → AUTO_UNREACHABLE after bounded retries');

  say('7b. RETRY-AFTER: DELAY-SECONDS AND HTTP-DATE (RFC 9110 §10.2.3, §5.6.7)');
  var NOW = Date.UTC(2026, 10, 25, 21, 0, 0);                       // Wed, 25 Nov 2026 21:00:00 GMT
  [['3', 3000], ['0', 0], [' 7 ', 7000], ['60', 60000], ['61', 60000], ['999999999999999999999', 60000],
    ['Wed, 25 Nov 2026 21:00:10 GMT', 10000], ['Wednesday, 25-Nov-26 21:00:05 GMT', 5000], ['Wed Nov 25 21:00:20 2026', 20000],
    ['Wed, 25 Nov 2026 20:59:00 GMT', 0], ['Wed Nov  4 21:00:20 2026', 0], ['Wed, 25 Nov 2026 23:00:00 GMT', 60000],
    ['-5', null], ['1.5', null], ['0x10', null], ['1e3', null], ['', null], ['   ', null], ['soon', null], [undefined, null], [['1', '2'], null],
    ['Thu, 25 Nov 2026 21:00:10 GMT', null], ['Wed, 31 Feb 2026 21:00:10 GMT', null], ['Wed, 25 Nov 2026 25:00:10 GMT', null],
    ['Wed, 25 Nov 2026 21:00:10 UTC', null], ['2026-11-25T21:00:10Z', null], ['wed, 25 nov 2026 21:00:10 gmt', null]]
    .forEach(function (t) {
      var got = A.parseRetryAfter(t[0], NOW);
      ok(got === t[1], 'Retry-After ' + JSON.stringify(t[0]) + ' → ' + (t[1] === null ? 'invalid, own backoff' : t[1] + ' ms') + (got === t[1] ? '' : ' (got ' + got + ')'));
    });
  ok(A.MAX_RETRY_AFTER_MS === 60000, 'the longest wait a server can impose is 60 s');
  var clock = function () { return NOW; };
  var busy = { status: 503, body: { error: { code: 'QUEUE_FULL', message: 'busy', retryable: true } } };
  function withHeader(v) { return Object.assign({}, busy, { headers: { 'retry-after': v } }); }
  var c1 = client(env, { now: clock });
  auto.script.push(withHeader('Wed, 25 Nov 2026 21:00:05 GMT'), { status: 201, body: reqBody('accepted') });
  ok((await c1.requestCapability('data.extract', {}, { idempotencyKey: KEY })).state === 'accepted' && c1.sleeps.join() === '5000', 'an HTTP-date 5 s ahead → the retry waits exactly 5000 ms');
  var c2 = client(env, { now: clock });
  auto.script.push(withHeader('Wed, 25 Nov 2026 20:00:00 GMT'), { status: 201, body: reqBody('accepted') });
  await c2.requestCapability('data.extract', {}, { idempotencyKey: KEY });
  ok(c2.sleeps.join() === '0', 'an HTTP-date already past → retry at once (0 ms)');
  var c3 = client(env, { now: clock });
  auto.script.push(withHeader('Fri, 25 Dec 2026 21:00:00 GMT'), { status: 201, body: reqBody('accepted') });
  await c3.requestCapability('data.extract', {}, { idempotencyKey: KEY });
  ok(c3.sleeps.join() === '60000', 'an HTTP-date a month ahead → capped at 60000 ms');
  var c4 = client(env, { now: clock });
  auto.script.push(withHeader('-5'), withHeader('soon'), { status: 201, body: reqBody('accepted') });
  await c4.requestCapability('data.extract', {}, { idempotencyKey: KEY });
  ok(c4.sleeps.length === 2 && c4.sleeps[0] >= 250 && c4.sleeps[0] <= 500 && c4.sleeps[1] >= 500 && c4.sleeps[1] <= 1000, 'invalid values ("-5", "soon") are ignored: exponential backoff instead (' + c4.sleeps.join(', ') + ' ms)');
  var c5 = client(env, { now: clock }), n5 = auto.seen.length;
  auto.script.push(withHeader('5'), withHeader('Wed, 25 Nov 2026 21:00:02 GMT'), withHeader('1'));
  var e5 = await rejects(c5.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'QUEUE_FULL');
  ok(e5 && e5.retryable === true && auto.seen.length - n5 === 3 && c5.sleeps.join() === '5000,2000', 'Retry-After never adds attempts: 3 attempts, 2 waits (5000, 2000 ms), then the retryable error');
  var c6 = client(env, { now: clock }), n6 = auto.seen.length;
  auto.script.push({ status: 409, body: { error: { code: 'idempotency_key_reused', message: 'm', retryable: false } }, headers: { 'retry-after': '1' } });
  ok(await rejects(c6.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'idempotency_key_reused') && auto.seen.length - n6 === 1 && c6.sleeps.length === 0, 'Retry-After on a final error does not make it retryable');

  say('8. MALFORMED ANSWERS');
  var cb = client(env);
  var n4 = auto.seen.length;
  auto.script.push({ status: 201, raw: 'not json' });
  ok(await rejects(cb.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'http_201') && auto.seen.length === n4 + 1, 'a 2xx that is not JSON is never taken as success (and not retried)');
  auto.script.push({ status: 201, body: { schema_version: '2', request_id: 'req-' + '0'.repeat(32), state: 'accepted' } });
  ok(await rejects(cb.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'AUTO_BAD_ANSWER'), 'another schema_version → AUTO_BAD_ANSWER');
  auto.script.push({ status: 201, body: { schema_version: '1', request_id: 'nope', state: 'accepted' } });
  ok(await rejects(cb.requestCapability('data.extract', {}, { idempotencyKey: KEY }), 'AUTO_BAD_ANSWER'), 'an invalid request id → AUTO_BAD_ANSWER');

  say('9. WAITING, WORKFLOWS, CAPABILITIES');
  var cw = client(env);
  auto.script.push({ status: 200, body: reqBody('accepted') }, { status: 200, body: reqBody('running') }, { status: 200, body: reqBody('completed', { result: { code: 'LENS_JOB_CREATED' } }) });
  var done = await cw.waitForRequest('req-' + '0'.repeat(32), { timeoutMs: 5000, pollMs: 10 });
  ok(done.state === 'completed' && done.terminal && done.result.code === 'LENS_JOB_CREATED' && cw.sleeps.length === 2, 'waitForRequest polls GET until a terminal state');
  auto.script.push({ status: 200, body: reqBody('running') }, { status: 200, body: reqBody('running') });
  var wt = await rejects(cw.waitForRequest('req-' + '0'.repeat(32), { timeoutMs: 0, pollMs: 10 }), 'AUTO_WAIT_TIMEOUT');
  ok(wt && wt.retryable === true && wt.last && wt.last.state === 'running', 'a wait that ends early → AUTO_WAIT_TIMEOUT with the last state (the work continues in AUTO)');
  auto.script.length = 0;
  auto.script.push({ status: 202, body: runBody('pending') });
  var run = await cw.startWorkflow('vehicle-document-intake', { file_id: 'f_x', sha256: 'b'.repeat(64) }, { idempotencyKey: KEY });
  var ws = auto.seen[auto.seen.length - 1];
  ok(ws.url === '/api/v1/workflow-runs' && ws.body.workflow === 'vehicle-document-intake' && ws.body.idempotency_key === KEY && run.run_id === 'run-' + 'a'.repeat(32) && run.steps[0].id === 'inspect', 'startWorkflow: POST /api/v1/workflow-runs, run shaped with its steps');
  auto.script.push({ status: 200, body: runBody('cancelled') });
  var cr = await cw.cancelWorkflowRun(run.run_id);
  ok(auto.seen[auto.seen.length - 1].url === '/api/v1/workflow-runs/' + run.run_id + '/cancel' && cr.terminal, 'cancelWorkflowRun: POST …/cancel');
  auto.script.push({ status: 200, body: reqBody('cancelled') });
  ok((await cw.cancelRequest('req-' + '0'.repeat(32))).state === 'cancelled' && auto.seen[auto.seen.length - 1].url === '/api/v1/capability-requests/req-' + '0'.repeat(32) + '/cancel', 'cancelRequest: POST …/cancel');
  auto.script.push({ status: 200, body: { schema_version: '1', capabilities: [{ capability: 'vision.ingest', callers: ['idauto'], status: ['implemented'], input: {} }, { capability: 'memory.status', callers: ['other'], status: [], input: {} }] } });
  var caps = await cw.capabilities();
  ok(caps.length === 1 && caps[0].capability === 'vision.ingest', 'capabilities(): only those AUTO grants to idauto');

  say('10. OBSERVABILITY WITHOUT SECRETS');
  var allLogs = [c, ct, cx, cto, cw].reduce(function (a, k) { return a.concat(k.logs); }, []);
  var text = JSON.stringify(allLogs);
  ok(allLogs.length > 10 && allLogs.every(function (l) { return l.event === 'auto_call' && typeof l.op === 'string' && typeof l.ms === 'number' && typeof l.attempt === 'number'; }), 'every call is logged: op, status, attempt, duration');
  ok(text.indexOf(TOKEN) === -1 && text.indexOf('Bearer') === -1, 'logs never contain the token');
  ok(text.indexOf('f_' + 'a'.repeat(22)) === -1 && text.indexOf('b'.repeat(64)) === -1, 'logs never contain the request input');
  ok(allLogs.some(function (l) { return l.correlation_id === 'corr-12345678'; }), 'logs carry the correlation id');
  var rot = tokenFile('rot', TOKEN, 0o600), crot = client({ IDAUTO_AUTO_URL: auto.url, IDAUTO_AUTO_TOKEN_FILE: rot });
  auto.script.push({ status: 200, body: { schema_version: '1', capabilities: [] } }, { status: 200, body: { schema_version: '1', capabilities: [] } });
  await crot.capabilities();
  fs.writeFileSync(rot, 'rotated-token-' + 'y'.repeat(30) + '\n');
  await crot.capabilities();
  ok(auto.seen[auto.seen.length - 1].headers.authorization === 'Bearer rotated-token-' + 'y'.repeat(30), 'the token file is re-read on every call (rotation without restart)');

  say('11. GUARD: DIRECT PROVIDER AND LENS PATHS');
  // The ecosystem rule: agent work goes IDauto → AUTO → AGENTS. These are the places that still bypass it, each with a
  // reason recorded in docs/AUTO_CLIENT.md §4. A new file on this list must be argued there first.
  var KNOWN = {
    anthropic: ['reference/recognition/vehicle-vision.js'],          // IDA-G1: no AUTO/AGENTS capability for vehicle-photo recognition
    lens: ['ops/haddad/idauto-media-receiver.js']                     // IDA-G2: no service document hand-off (AG-4), no field-read path
  };
  function walk(d, out) {
    fs.readdirSync(path.join(BASE, d), { withFileTypes: true }).forEach(function (e) {
      if (['node_modules', '.git', 'tests', 'docs'].indexOf(e.name) !== -1) return;
      var p = d ? d + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(p);
    });
    return out;
  }
  var files = walk('', []), found = { anthropic: [], lens: [] };
  files.forEach(function (f) {
    var src = fs.readFileSync(path.join(BASE, f), 'utf8');
    if (/@anthropic-ai\/sdk|api\.anthropic\.com/.test(src)) found.anthropic.push(f);
    if (/['"]\/v1\/(files|jobs)\b/.test(src) || /IDAUTO_LENS_URL/.test(src)) found.lens.push(f);
  });
  ok(JSON.stringify(found.anthropic.sort()) === JSON.stringify(KNOWN.anthropic), 'model-provider calls only in ' + KNOWN.anthropic.join(', ') + ' (found: ' + found.anthropic.join(', ') + ')');
  ok(JSON.stringify(found.lens.sort()) === JSON.stringify(KNOWN.lens), 'direct LENS calls only in ' + KNOWN.lens.join(', ') + ' (found: ' + found.lens.join(', ') + ')');
  var clientSrc = fs.readFileSync(path.join(BASE, 'reference', 'auto', 'auto-client.js'), 'utf8');
  ok(!/\/api\/tasks|\/api\/lens|\/v1\/jobs|\/v1\/files|anthropic/i.test(clientSrc.replace(/\/\/.*$/gm, '')), 'the AUTO client itself never addresses AGENTS, LENS or a provider');
  ok(require(path.join(BASE, 'reference', 'lens', 'lens-adapter.js')).enabled() === false, 'lens-adapter is still the inactive stub (owner decision 2026-11-18 unchanged)');

  await auto.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nIDA-AUTO-CLIENT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
