#!/usr/bin/env node
'use strict';
/* IDauto → AUTO → AGENTS, end to end (contract test). Two modes, the same assertions:
 *
 * LIVE (wherever checkouts of othoth77/auto and othoth77/agents exist: AUTO_REPO / AGENTS_REPO, default sibling
 * directories). IDauto's client → the real AUTO server (its real registry) → the real AGENTS server (service
 * authentication and policy) → a stand-in for the Haddad worker only, answering LENS jobs as agents worker/lens.js does.
 * Every HTTP exchange between IDauto and AUTO, and every provider-side fact the assertions read (the AGENTS task, the
 * jobs the worker received), is recorded, normalised (no token, no volatile id or time) and compared with the committed
 * fixture tests/fixtures/auto-agents-contract-v1.json: if AUTO or AGENTS changed behaviour, this fails ("drift").
 * IDAUTO_CONTRACT_RECORD=1 rewrites the fixture instead, with the commits it was recorded against.
 *
 * REPLAY (everywhere else, CI included: both repositories are private and cannot be checked out there). The same
 * scenarios run IDauto's real client against a strict replay of that fixture: every request IDauto sends must equal the
 * recorded one (method, path, caller, credential, body), in order, and every recorded exchange must be used. The
 * provider-side assertions are evaluated on the recorded facts of the real providers at the pinned commits.
 * IDAUTO_CONTRACT_MODE=replay forces this mode where checkouts exist. No network beyond 127.0.0.1, no database. */

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

var FIXTURE = path.join(BASE, 'tests', 'fixtures', 'auto-agents-contract-v1.json');
var WRONG_TOKEN = 'wrong-token-' + 'z'.repeat(20);
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

// ---- normalisation: what makes a recording identical from one run to the next ---------------------------------
// Times become one fixed instant; AGENTS task ids and AUTO per-request ids (random) become stable placeholders of the
// same shape, numbered by first appearance. AUTO capability-request and workflow-run ids are hashes of the caller and
// the key, hence already stable. Tokens never enter a recording: the credential is recorded as a role.
function normaliser() {
  var tasks = {}, rqs = {};
  function str(v) {
    return v.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '2026-01-01T00:00:00.000Z')
      .replace(/\bt-\d{14}-[a-z0-9]{6}\b/g, function (m) { if (!tasks[m]) tasks[m] = 't-20260101000000-' + String(Object.keys(tasks).length + 1).padStart(6, '0'); return tasks[m]; })
      .replace(/\brq-[0-9a-z]+-[0-9a-f]{12}\b/g, function (m) { if (!rqs[m]) rqs[m] = 'rq-fixture-' + String(Object.keys(rqs).length + 1).padStart(4, '0'); return rqs[m]; });
  }
  function deep(v, key) {
    if (typeof v === 'string') return str(v);
    if (Array.isArray(v)) return v.map(function (x) { return deep(x); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = deep(v[k], k); }); return o; }
    if (typeof v === 'number' && (key === 'duration_ms' || key === 'ms')) return 0;
    return v;
  }
  return deep;
}
function role(auth) { var t = String(auth || '').replace(/^Bearer /, ''); return t === IDAUTO_TOKEN ? '<idauto-token>' : t === WRONG_TOKEN ? '<wrong-token>' : '<other>'; }
function readBody(req) { return new Promise(function (resolve) { var c = []; req.on('data', function (d) { c.push(d); }); req.on('end', function () { var t = Buffer.concat(c).toString('utf8'); var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; } resolve(j); }); }); }
function listen(handler) { var srv = http.createServer(handler); return new Promise(function (r) { srv.listen(0, '127.0.0.1', function () { r({ url: 'http://127.0.0.1:' + srv.address().port, stop: function () { return new Promise(function (z) { srv.closeAllConnections(); srv.close(z); }); } }); }); }); }

// Polling is timing: AUTO may still say "accepted" or already "running" on any given read. Consecutive reads of the
// same resource keep only the last one, the one that ended the wait.
function collapse(exchanges) {
  var out = [];
  exchanges.forEach(function (x) {
    var prev = out[out.length - 1];
    if (prev && prev.request.method === 'GET' && x.request.method === 'GET' && prev.request.path === x.request.path) out[out.length - 1] = x; else out.push(x);
  });
  return out;
}

// LIVE: a recording proxy in front of the real AUTO.
async function liveScenario(policy, withWorker) {
  var ag = await bootAgents(policy, withWorker), au = await bootAuto(ag.url), norm = normaliser(), exchanges = [], facts = [];
  var proxy = await listen(function (req, res) {
    readBody(req).then(function (body) {
      var payload = body === null ? null : Buffer.from(JSON.stringify(body));
      var u = new URL(au.url);
      var headers = { 'x-auto-caller': req.headers['x-auto-caller'] || '', authorization: req.headers.authorization || '', accept: 'application/json' };
      if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
      var f = http.request({ method: req.method, hostname: u.hostname, port: u.port, path: req.url, headers: headers }, function (r2) {
        var c = []; r2.on('data', function (d) { c.push(d); }); r2.on('end', function () {
          var text = Buffer.concat(c).toString('utf8'), json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          exchanges.push(norm({ request: { method: req.method, path: req.url, caller: req.headers['x-auto-caller'] || null, credential: role(req.headers.authorization), body: body },
            response: { status: r2.statusCode, retry_after: r2.headers['retry-after'] || null, body: json } }));
          var h = { 'content-type': 'application/json' }; if (r2.headers['retry-after']) h['retry-after'] = r2.headers['retry-after'];
          res.writeHead(r2.statusCode, h); res.end(text);
        });
      });
      f.on('error', function () { res.writeHead(502); res.end(); });
      if (payload) f.write(payload); f.end();
    });
  });
  return {
    url: proxy.url,
    fact: async function (kind, compute) { var v = norm(await compute({ agents: au.agents, calls: ag.calls })); facts.push({ kind: kind, value: v }); return v; },
    finish: async function () { await proxy.stop(); await au.stop(); await ag.stop(); return { exchanges: collapse(exchanges), facts: facts }; }
  };
}

// REPLAY: a strict replay of one recorded scenario.
async function replayScenario(rec) {
  var i = 0, f = 0, problems = [];
  var server = await listen(function (req, res) {
    readBody(req).then(function (body) {
      var got = { method: req.method, path: req.url, caller: req.headers['x-auto-caller'] || null, credential: role(req.headers.authorization), body: body };
      var want = rec.exchanges[i++];
      if (!want || JSON.stringify(normaliser()(got)) !== JSON.stringify(want.request)) {
        problems.push('exchange ' + i + ': sent ' + JSON.stringify(got).slice(0, 200) + (want ? ' / recorded ' + JSON.stringify(want.request).slice(0, 200) : ' / nothing recorded'));
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: 'replay_mismatch', message: 'request differs from the recorded contract', retryable: false } }));
      }
      var h = { 'content-type': 'application/json' }; if (want.response.retry_after) h['retry-after'] = want.response.retry_after;
      res.writeHead(want.response.status, h); res.end(JSON.stringify(want.response.body));
    });
  });
  return {
    url: server.url,
    fact: async function (kind) { var x = rec.facts[f++]; if (!x || x.kind !== kind) { problems.push('fact ' + f + ': expected ' + kind + ', recorded ' + (x && x.kind)); return null; } return x.value; },
    finish: async function () {
      await server.stop();
      ok(problems.length === 0, 'replay: every request IDauto sent equals the recorded exchange' + (problems.length ? ' — ' + problems.slice(0, 3).join(' | ') : ''));
      ok(i === rec.exchanges.length && f === rec.facts.length, 'replay: every recorded exchange (' + rec.exchanges.length + ') and provider fact (' + rec.facts.length + ') was used');
    }
  };
}

function gitHead(repo) {
  try {
    var cp = require('child_process');
    var sha = cp.execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    var dirty = cp.execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
    return { commit: sha, clean: !dirty };
  } catch (e) { return { commit: null, clean: false }; }
}

(async function main() {
  var live = present() && process.env.IDAUTO_CONTRACT_MODE !== 'replay';
  var fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
  if (!live && !fixture) { console.log('FAIL no fixture ' + FIXTURE + ' and no live providers'); process.exit(1); }
  console.log(live ? 'MODE live: real AUTO at ' + AUTO_REPO + ', real AGENTS at ' + AGENTS_REPO
    : 'MODE replay: recorded against auto ' + fixture.provenance.auto.commit + ' and agents ' + fixture.provenance.agents.commit);
  var recorded = {};
  async function scenario(name, policy, withWorker) {
    return live ? liveScenario(policy, withWorker) : replayScenario(fixture.scenarios[name]);
  }
  async function end(name, s) { var out = await s.finish(); if (live) recorded[name] = out; }
  var full = { auto: { capabilities: ['vision.ingest', 'data.extract'] } };
  function starts(calls) { return calls.filter(function (x) { return x.path === '/v1/jobs' && (x.job === 'vision.extract' || x.job === 'vision.inspect'); }).map(function (x) { return { job: x.job, file_id: x.input.file_id, sha256: x.input.sha256, doctype: x.input.doctype || null }; }); }

  say('1. WHAT AUTO OFFERS IDAUTO (AUTO\'s real registry)');
  var s1 = await scenario('main', full, true), c = idauto(s1.url);
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
  var task = await s1.fact('agents-task', async function (p) { var t = await p.agents.get(r.agents.task_id); return { caller: t.caller, capability: t.capability, correlation_id: t.correlation_id }; }) || {};
  ok(task.caller === 'svc:auto' && task.capability === 'data.extract', 'at AGENTS the caller is svc:auto: IDauto has no AGENTS identity, AUTO is the control plane');
  ok(task.correlation_id === 'idauto-contract-0001', 'the correlation id IDauto chose reaches the AGENTS task');
  var jobs = await s1.fact('worker-starts', function (p) { return starts(p.calls); }) || [];
  ok(jobs.length === 1 && jobs[0].job === 'vision.extract' && jobs[0].file_id === FILE_ID && jobs[0].sha256 === SHA && jobs[0].doctype === 'carte_grise', 'the worker received exactly one typed LENS job with the file reference and document type');

  say('3. IDEMPOTENCY ACROSS THE CHAIN');
  var again = await c.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-contract-0001', correlationId: 'idauto-contract-0001', deadlineS: 600 });
  ok(again.duplicate === true && again.request_id === r.request_id && again.agents.task_id === r.agents.task_id, 'the same key and input is a replay: same AUTO request, same AGENTS task');
  ok((await s1.fact('worker-starts', function (p) { return starts(p.calls); }) || []).length === 1, 'the replay dispatched nothing new');
  var reused = await caught(c.requestCapability('data.extract', { file_id: FILE_ID, sha256: 'd'.repeat(64) }, { idempotencyKey: 'cg-contract-0001', correlationId: 'idauto-contract-0002' }));
  ok(reused && reused.code === 'idempotency_key_reused' && reused.httpStatus === 409 && reused.retryable === false, 'the same key with another input → 409 idempotency_key_reused');

  say('4. AUTO REFUSES BEFORE AGENTS IS ASKED');
  var n = await s1.fact('worker-calls', function (p) { return p.calls.filter(function (x) { return x.path === '/v1/jobs'; }).length; });
  var bad = await caught(c.requestCapability('data.extract', { file_id: FILE_ID, sha256: 'not-a-hash' }, { idempotencyKey: 'cg-contract-0002', correlationId: 'idauto-contract-0003' }));
  ok(bad && bad.code === 'validation_failed' && bad.details && bad.details.some(function (d) { return d.field === 'input.sha256'; }), 'invalid input → validation_failed with the field (FICHES details)');
  var ng = await caught(c.requestCapability('memory.status', {}, { idempotencyKey: 'cg-contract-0003', correlationId: 'idauto-contract-0004' }));
  ok(ng && ng.httpStatus >= 400 && ng.httpStatus < 500 && ng.retryable === false, 'a capability AUTO does not grant idauto is refused (' + (ng && ng.code) + ')');
  var wrong = await caught(idauto(s1.url, WRONG_TOKEN).capabilities());
  ok(wrong === null, 'the capability list is public metadata (no credential needed)');
  var unauth = await caught(idauto(s1.url, WRONG_TOKEN).requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0004', correlationId: 'idauto-contract-0005' }));
  ok(unauth && unauth.code === 'unauthenticated' && unauth.httpStatus === 401, 'a wrong IDauto credential → 401 unauthenticated');
  ok(await s1.fact('worker-calls', function (p) { return p.calls.filter(function (x) { return x.path === '/v1/jobs'; }).length; }) === n, 'none of these reached AGENTS');

  say('5. A REGISTERED WORKFLOW: vehicle-document-intake (inspect, then extract)');
  var run = await c.startWorkflow('vehicle-document-intake', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-run-0001', correlationId: 'idauto-run-0001' });
  ok(/^run-[0-9a-f]{32}$/.test(run.run_id) && run.steps.map(function (s) { return s.id; }).join(',') === 'inspect,extract', 'AUTO started the run with the registered steps');
  var fin = await c.waitForWorkflowRun(run.run_id, { timeoutMs: 15000, pollMs: 25 });
  ok(fin.state === 'completed' && fin.steps.every(function (s) { return s.state === 'completed'; }), 'the run completed: ' + fin.steps.map(function (s) { return s.id + '=' + s.state; }).join(', '));
  var wjobs = (await s1.fact('worker-starts', function (p) { return starts(p.calls); }) || []).slice(1).map(function (x) { return x.job; });
  ok(wjobs.join(',') === 'vision.inspect,vision.extract', 'AGENTS dispatched inspect before extract, in dependency order (' + wjobs.join(', ') + ')');
  var rerun = await c.startWorkflow('vehicle-document-intake', { file_id: FILE_ID, sha256: SHA, doctype: 'carte_grise' }, { idempotencyKey: 'cg-run-0001', correlationId: 'idauto-run-0001' });
  ok(rerun.duplicate === true && rerun.run_id === run.run_id, 'starting the same run again is a replay');
  var unknownWf = await caught(c.startWorkflow('no-such-flow', {}, { idempotencyKey: 'cg-run-0002', correlationId: 'idauto-run-0002' }));
  ok(unknownWf && unknownWf.code === 'unknown_workflow' && unknownWf.httpStatus === 404, 'an unregistered workflow → 404 unknown_workflow');
  ok(c.logs.length > 0 && JSON.stringify(c.logs).indexOf(IDAUTO_TOKEN) === -1, 'IDauto logged every AUTO call, never its token');
  await end('main', s1);

  say('6. AGENTS IS THE AUTHORITY: NON-EXECUTION COMES BACK, NOTHING RUNS');
  var s2 = await scenario('agents-refuses', { auto: { capabilities: ['vision.ingest'] } }, true), c2 = idauto(s2.url);
  var refused = await caught(c2.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0101', correlationId: 'idauto-contract-0101' }));
  ok(refused && refused.code === 'capability_not_granted' && refused.retryable === false, 'AGENTS policy does not grant AUTO data.extract → capability_not_granted reaches IDauto, not retried');
  ok(await s2.fact('worker-calls', function (p) { return p.calls.filter(function (x) { return x.path === '/v1/jobs'; }).length; }) === 0, 'nothing was dispatched');
  await end('agents-refuses', s2);
  var s3 = await scenario('no-worker', full, false), c3 = idauto(s3.url);
  var noWorker = await caught(c3.requestCapability('data.extract', { file_id: FILE_ID, sha256: SHA }, { idempotencyKey: 'cg-contract-0201', correlationId: 'idauto-contract-0201' }));
  ok(noWorker && ['NOT_DISPATCHABLE', 'WORKER_NOT_CONFIGURED'].indexOf(noWorker.code) !== -1 && noWorker.httpStatus === 503, 'no Haddad worker → AGENTS answers ' + (noWorker && noWorker.code) + ' (HTTP 503 through AUTO): nothing executed, no fallback');
  await end('no-worker', s3);

  if (live) {
    var provenance = { auto: gitHead(AUTO_REPO), agents: gitHead(AGENTS_REPO), contract: 'AUTO API v1 + AUTO-AGENTS v1' };
    if (process.env.IDAUTO_CONTRACT_RECORD === '1') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify({ schema: 'idauto.auto-contract-fixture/1', note: 'Recorded by tests/ida-auto-contract-test.js against the real AUTO and AGENTS at the commits below (only the Haddad worker is a stand-in). Regenerate with IDAUTO_CONTRACT_RECORD=1; never edit by hand.', provenance: provenance, scenarios: recorded }, null, 1) + '\n');
      console.log('  recorded ' + FIXTURE + ' (auto ' + provenance.auto.commit + ', agents ' + provenance.agents.commit + ')');
    } else {
      var same = fixture && JSON.stringify(fixture.scenarios) === JSON.stringify(recorded);
      var diff = '';
      if (!same && fixture) {
        Object.keys(recorded).some(function (k) {
          var a = (fixture.scenarios[k] || { exchanges: [], facts: [] }), b = recorded[k];
          for (var j = 0; j < Math.max(a.exchanges.length, b.exchanges.length); j++) if (JSON.stringify(a.exchanges[j]) !== JSON.stringify(b.exchanges[j])) { diff = k + ' exchange ' + (j + 1) + ': ' + JSON.stringify(b.exchanges[j]).slice(0, 240); return true; }
          for (var q = 0; q < Math.max(a.facts.length, b.facts.length); q++) if (JSON.stringify(a.facts[q]) !== JSON.stringify(b.facts[q])) { diff = k + ' fact ' + (q + 1); return true; }
          return false;
        });
      }
      ok(same, 'the committed fixture still describes the live AUTO (' + provenance.auto.commit + ') and AGENTS (' + provenance.agents.commit + ')' + (same ? '' : ' — DRIFT at ' + (diff || 'no fixture') + '; re-record with IDAUTO_CONTRACT_RECORD=1 after review'));
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nIDA-AUTO-CONTRACT (' + (live ? 'live' : 'replay') + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
