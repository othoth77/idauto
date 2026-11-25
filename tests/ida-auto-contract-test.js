#!/usr/bin/env node
'use strict';
/* IDauto → AUTO → AGENTS, end to end on the real code (contract test).
 *
 *   IDauto's client (reference/auto/auto-client.js)
 *     → the real AUTO server (othoth77/auto src/server.mjs, its real registry: capabilities and workflows)
 *       → the real AGENTS server (othoth77/agents server/server.js) with service authentication and a service policy
 *         → a stand-in for the Haddad worker only, answering LENS jobs the way agents worker/lens.js does.
 *
 * Needs checkouts of othoth77/auto and othoth77/agents (AUTO_REPO / AGENTS_REPO, default: sibling directories)
 * with their dependencies installed. Without them the suite says SKIP and passes with 0 assertions, as AUTO's own
 * contract test does; set IDAUTO_REQUIRE_CONTRACT=1 to make their absence a failure. No network beyond 127.0.0.1,
 * no database, nothing sent to LENS or a model provider. */

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var url = require('url');
var BASE = path.join(__dirname, '..');
var A = require(path.join(BASE, 'reference', 'auto', 'auto-client.js'));
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log('\n' + m); }

var AUTO_REPO = process.env.AUTO_REPO || path.join(BASE, '..', 'auto');
var AGENTS_REPO = process.env.AGENTS_REPO || path.join(BASE, '..', 'agents');
function present() {
  try {
    return fs.existsSync(path.join(AUTO_REPO, 'src', 'server.mjs')) && fs.existsSync(path.join(AUTO_REPO, 'registry', 'capabilities.json')) &&
      fs.existsSync(path.join(AGENTS_REPO, 'server', 'server.js')) && /capability_routes/.test(fs.readFileSync(path.join(AGENTS_REPO, 'server', 'registry.js'), 'utf8')) &&
      fs.existsSync(path.join(AGENTS_REPO, 'tests', 'helpers.js'));
  } catch (e) { return false; }
}

var AGENTS_TOKEN = 'svc-auto-' + 'a'.repeat(40);      // AUTO's credential at AGENTS (32..512 characters)
var IDAUTO_TOKEN = 'idauto-at-auto-' + 'b'.repeat(30);  // IDauto's credential at AUTO (≥ 16 characters)
var FILE_ID = 'f_' + 'A'.repeat(22), SHA = 'c'.repeat(64);
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ida-auto-contract-'));
function secret(name, value) { var f = path.join(dir, name); fs.writeFileSync(f, value + '\n'); fs.chmodSync(f, 0o600); return f; }
var lensJob = 0, lensJobs = {};

// The Haddad worker, played here: health (with a HYBRID resource snapshot, as AUTO's contract test does) and the
// queue jobs the AGENTS capability routes resolve to. Results have the shape of agents worker/lens.js: a job id and a
// state, never a document value.
function workerStub(calls) {
  return function request(method, p, body) {
    calls.push({ method: method, path: p, job: body && body.job, input: body && body.input });
    if (p === '/v1/health') {
      return Promise.resolve({ statusCode: 200, body: { ok: true, worker: 'mythos-agents-worker/1', apply: { enabled: false }, memory: { enabled: true },
        resources: { source: 'hybrid', available: true, at: new Date().toISOString(), host: 'haddad', level: 'NORMAL', level_reasons: [], mem_total_mib: 15398, mem_available_mib: 5800,
          swap_total_mib: 23551, swap_free_mib: 21000, load1: 1, ncpu: 12, psi: { memory_some_avg60: 0.1, io_some_avg60: 0.5, cpu_some_avg60: 1 }, disks: [{ label: 'disk1', free_mib: 80000 }],
          hybrid: { active: 0, reserved_mib: 0, heavy_max: 1, gpu_slots: 1, queue_depth: 0, active_models: 0 } } } });
    }
    var job = body && body.job;
    if (job === 'vision.extract' || job === 'vision.inspect') {
      lensJob++;
      var id = 'j_' + String(lensJob).padStart(22, '0');
      var wf = job === 'vision.extract' ? 'extract_fields' : 'inspect';
      lensJobs[id] = wf;
      return Promise.resolve({ statusCode: 200, body: { status: 'completed', code: 'LENS_JOB_CREATED', summary: 'created ' + id + ' (' + wf + ', queued)', duration_ms: 4, data: { lens_job_id: id, workflow: wf, state: 'queued', created: true } } });
    }
    if (job === 'vision.status' && body.input && lensJobs[body.input.lens_job_id]) {
      // AGENTS follows the LENS job until it ends; here it has already succeeded.
      var jid = body.input.lens_job_id;
      return Promise.resolve({ statusCode: 200, body: { status: 'completed', code: 'LENS_JOB_STATUS', summary: jid + ' succeeded', duration_ms: 2,
        data: { lens_job_id: jid, workflow: lensJobs[jid], state: 'succeeded', attempts: 1, max_attempts: 3, deferrals: 0, cancel_requested: false, has_result: true, error_code: null, steps: [{ name: 'ocr', state: 'succeeded', attempt: 1 }] } } });
    }
    return Promise.resolve({ statusCode: 200, body: { status: 'failed', code: 'UNKNOWN_JOB', summary: 'not expected by this test', duration_ms: 1, data: null } });
  };
}

async function bootAgents(policy, withWorker) {
  var H = require(path.join(AGENTS_REPO, 'tests', 'helpers.js'));
  var S = require(path.join(AGENTS_REPO, 'server', 'server.js'));
  var W = require(path.join(AGENTS_REPO, 'server', 'worker-client.js'));
  var d = H.tmpDir(), tokens = path.join(d, 'service-tokens'), calls = [];
  fs.mkdirSync(tokens, { mode: 0o700 });
  fs.writeFileSync(path.join(tokens, 'auto'), AGENTS_TOKEN + '\n'); fs.chmodSync(path.join(tokens, 'auto'), 0o600);
  var policyFile = path.join(d, 'service-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  var opts = { stateDir: path.join(d, 'state'), keyFile: H.writeKey(d, 'k-' + 'q'.repeat(40)), publicOrigin: 'https://agents.mythosprod.xyz',
    resolverDeps: { resolverFactory: H.fakeResolverFactory(H.OVH_TABLE) }, serviceTokensDir: tokens, servicePolicyFile: policyFile };
  if (withWorker) opts.worker = new W.WorkerClient({ url: 'http://127.0.0.1:8810', request: workerStub(calls) });
  var app = S.createApp(opts);
  await new Promise(function (r) { app.server.listen(0, '127.0.0.1', r); });
  return { url: 'http://127.0.0.1:' + app.server.address().port, calls: calls, stop: function () { return new Promise(function (r) { app.server.closeAllConnections(); app.server.close(r); }); } };
}

async function bootAuto(agentsUrl) {
  var server = await import(url.pathToFileURL(path.join(AUTO_REPO, 'src', 'server.mjs')).href);
  var client = await import(url.pathToFileURL(path.join(AUTO_REPO, 'src', 'agents-client.mjs')).href);
  var tokensDir = path.join(dir, 'auto-callers-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(tokensDir, { mode: 0o700 });
  fs.writeFileSync(path.join(tokensDir, 'idauto'), IDAUTO_TOKEN + '\n'); fs.chmodSync(path.join(tokensDir, 'idauto'), 0o600);
  var agents = new client.AgentsClient({ baseUrl: agentsUrl, tokenFile: secret('agents-token-' + Math.random().toString(16).slice(2), AGENTS_TOKEN) });
  var app = server.createApp({ agents: agents, tokensDir: tokensDir, stateDir: null, pollMs: 20 });   // the real registry: loadRegistry()
  var srv = http.createServer(app.handler);
  await new Promise(function (r) { srv.listen(0, '127.0.0.1', r); });
  return { url: 'http://127.0.0.1:' + srv.address().port, agents: agents, app: app, stop: function () { return new Promise(function (r) { srv.closeAllConnections(); srv.close(r); }); } };
}

function idauto(autoUrl, token) {
  var logs = [];
  var c = A.createClient({ env: { IDAUTO_AUTO_URL: autoUrl, IDAUTO_AUTO_TOKEN_FILE: secret('idauto-' + Math.random().toString(16).slice(2), token || IDAUTO_TOKEN) },
    attempts: 2, backoffMs: 20, timeoutMs: 5000, pollMs: 20, log: function (e) { logs.push(e); } });
  c.logs = logs;
  return c;
}
async function caught(p) { try { await p; return null; } catch (e) { return e; } }

(async function main() {
  if (!present()) {
    var why = 'SKIP: no othoth77/auto and othoth77/agents checkouts implementing the v1 contracts (set AUTO_REPO and AGENTS_REPO)';
    console.log(why);
    if (process.env.IDAUTO_REQUIRE_CONTRACT === '1') { console.log('FAIL IDAUTO_REQUIRE_CONTRACT=1'); process.exit(1); }
    console.log('\nIDA-AUTO-CONTRACT: 0 passed, 0 failed (skipped)');
    process.exit(0);
  }
  var full = { auto: { capabilities: ['vision.ingest', 'data.extract'] } };

  say('1. WHAT AUTO OFFERS IDAUTO (AUTO\'s real registry)');
  var ag = await bootAgents(full, true), au = await bootAuto(ag.url), c = idauto(au.url);
  var caps = (await c.capabilities()).map(function (x) { return x.capability; }).sort();
  ok(JSON.stringify(caps) === JSON.stringify(['data.extract', 'vision.ingest']), 'AUTO grants idauto data.extract and vision.ingest (' + caps.join(', ') + ')');

  say('2. A CAPABILITY REQUEST: IDAUTO → AUTO → AGENTS → worker, AND BACK');
  var r = await c.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-contract-0001', correlationId: 'idauto-contract-0001', deadlineS: 600 });
  ok(['accepted', 'running', 'completed'].indexOf(r.state) !== -1 && /^req-[0-9a-f]{32}$/.test(r.request_id), 'AUTO accepted it: ' + r.state + ', ' + r.request_id);
  ok(r.agents && r.agents.agent_code === 'MY003' && r.agents.job === 'vision.extract', 'AGENTS resolved the capability to MY003 / vision.extract (AUTO names no agent)');
  var done = await c.waitForRequest(r.request_id, { timeoutMs: 10000, pollMs: 25 });
  ok(done.state === 'completed' && done.result && done.result.code === 'LENS_SUCCEEDED', 'it completed; AGENTS followed the LENS job and the verdict came back through AUTO (' + (done.result && done.result.code) + ')');
  var rd = done.result && done.result.data || {};
  ok(/^j_/.test(rd.lens_job_id) && rd.workflow === 'extract_fields' && rd.state === 'succeeded' && rd.has_result === true, 'the result names the LENS job, its workflow and state, and that a result exists in LENS');
  ok(!('fields' in rd) && !('values' in rd) && JSON.stringify(rd).indexOf('plate') === -1, 'no extracted value travels back: by AGENTS design the values stay in LENS (no service read path in the v1 contracts)');
  var task = await au.agents.get(r.agents.task_id);
  ok(task.caller === 'svc:auto' && task.capability === 'data.extract', 'at AGENTS the caller is svc:auto: IDauto has no AGENTS identity, AUTO is the control plane');
  ok(task.correlation_id === 'idauto-contract-0001', 'the correlation id IDauto chose reaches the AGENTS task');
  function starts(calls) { return calls.filter(function (x) { return x.path === '/v1/jobs' && (x.job === 'vision.extract' || x.job === 'vision.inspect'); }); }
  var jobs = starts(ag.calls);
  ok(jobs.length === 1 && jobs[0].job === 'vision.extract' && jobs[0].input.file_id === FILE_ID && jobs[0].input.sha256 === SHA && jobs[0].input.doctype === 'carte_grise', 'the worker received exactly one typed LENS job with the file reference and document type');

  say('3. IDEMPOTENCY ACROSS THE CHAIN');
  var again = await c.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-contract-0001', correlationId: 'idauto-contract-0001', deadlineS: 600 });
  ok(again.duplicate === true && again.request_id === r.request_id && again.agents.task_id === r.agents.task_id, 'the same key and input is a replay: same AUTO request, same AGENTS task');
  ok(starts(ag.calls).length === 1, 'the replay dispatched nothing new');
  var reused = await caught(c.requestCapability('data.extract', { file_id: FILE_ID, sha256: 'd'.repeat(64) }, { idempotencyKey: 'cg-contract-0001' }));
  ok(reused && reused.code === 'idempotency_key_reused' && reused.httpStatus === 409 && reused.retryable === false, 'the same key with another input → 409 idempotency_key_reused');

  say('4. AUTO REFUSES BEFORE AGENTS IS ASKED');
  var n = ag.calls.length;
  var bad = await caught(c.requestCapability('data.extract', { file_id: FILE_ID, sha256: 'not-a-hash' }, { idempotencyKey: 'cg-contract-0002' }));
  ok(bad && bad.code === 'validation_failed' && bad.details && bad.details.some(function (d) { return d.field === 'input.sha256'; }), 'invalid input → validation_failed with the field (FICHES details)');
  var ng = await caught(c.requestCapability('memory.status', {}, { idempotencyKey: 'cg-contract-0003' }));
  ok(ng && ng.httpStatus >= 400 && ng.httpStatus < 500 && ng.retryable === false, 'a capability AUTO does not grant idauto is refused (' + (ng && ng.code) + ')');
  var wrong = await caught(idauto(au.url, 'wrong-token-' + 'z'.repeat(20)).capabilities());
  ok(wrong === null, 'the capability list is public metadata (no credential needed)');
  var unauth = await caught(idauto(au.url, 'wrong-token-' + 'z'.repeat(20)).requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0004' }));
  ok(unauth && unauth.code === 'unauthenticated' && unauth.httpStatus === 401, 'a wrong IDauto credential → 401 unauthenticated');
  ok(ag.calls.length === n, 'none of these reached AGENTS');

  say('5. A REGISTERED WORKFLOW: vehicle-document-intake (inspect, then extract)');
  var run = await c.startWorkflow('vehicle-document-intake', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-run-0001', correlationId: 'idauto-run-0001' });
  ok(/^run-[0-9a-f]{32}$/.test(run.run_id) && run.steps.map(function (s) { return s.id; }).join(',') === 'inspect,extract', 'AUTO started the run with the registered steps');
  var fin = await c.waitForWorkflowRun(run.run_id, { timeoutMs: 15000, pollMs: 25 });
  ok(fin.state === 'completed' && fin.steps.every(function (s) { return s.state === 'completed'; }), 'the run completed: ' + fin.steps.map(function (s) { return s.id + '=' + s.state; }).join(', '));
  var wjobs = starts(ag.calls).slice(1).map(function (x) { return x.job; });
  ok(wjobs.join(',') === 'vision.inspect,vision.extract', 'AGENTS dispatched inspect before extract, in dependency order (' + wjobs.join(', ') + ')');
  var rerun = await c.startWorkflow('vehicle-document-intake', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-run-0001', correlationId: 'idauto-run-0001' });
  ok(rerun.duplicate === true && rerun.run_id === run.run_id, 'starting the same run again is a replay');
  var unknownWf = await caught(c.startWorkflow('no-such-flow', {}, { idempotencyKey: 'cg-run-0002' }));
  ok(unknownWf && unknownWf.code === 'unknown_workflow' && unknownWf.httpStatus === 404, 'an unregistered workflow → 404 unknown_workflow');
  ok(c.logs.length > 0 && JSON.stringify(c.logs).indexOf(IDAUTO_TOKEN) === -1, 'IDauto logged every AUTO call, never its token');
  await au.stop(); await ag.stop();

  say('6. AGENTS IS THE AUTHORITY: NON-EXECUTION COMES BACK, NOTHING RUNS');
  var ag2 = await bootAgents({ auto: { capabilities: ['vision.ingest'] } }, true), au2 = await bootAuto(ag2.url), c2 = idauto(au2.url);
  var refused = await caught(c2.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0101' }));
  ok(refused && refused.code === 'capability_not_granted' && refused.retryable === false, 'AGENTS policy does not grant AUTO data.extract → capability_not_granted reaches IDauto, not retried');
  ok(ag2.calls.filter(function (x) { return x.path === '/v1/jobs'; }).length === 0, 'nothing was dispatched');
  await au2.stop(); await ag2.stop();
  var ag3 = await bootAgents(full, false), au3 = await bootAuto(ag3.url), c3 = idauto(au3.url);
  var noWorker = await caught(c3.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0201' }));
  ok(noWorker && ['NOT_DISPATCHABLE', 'WORKER_NOT_CONFIGURED'].indexOf(noWorker.code) !== -1 && noWorker.httpStatus === 503, 'no Haddad worker → AGENTS answers ' + (noWorker && noWorker.code) + ' (HTTP 503 through AUTO): nothing executed, no fallback');
  await au3.stop(); await ag3.stop();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nIDA-AUTO-CONTRACT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
