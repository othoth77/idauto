'use strict';

/* IDA-ADMIN-4 — DATA QUALITY.
 *
 * GET /api/admin/quality, /admin/quality, and the French /admin/review.
 * What this suite proves:
 *   - admin only (anonymous 401; service, manager, technician 403; the
 *     handler refuses an organisation principal on its own); read only;
 *   - every issue is the data: each fixture identity lands in exactly the
 *     issues it has, and each register total moves by exactly what the
 *     fixtures add;
 *   - a disagreement left on a record merged into an identity is reported on
 *     that identity;
 *   - never returned: a VIN (by key, in any case, whatever its scope) or a
 *     restricted fact — not as a value, not as a count, not as a disagreement;
 *     the review detail no longer returns a VIN written with a public scope;
 *   - the review page is French and keeps its audited decision path.
 *
 * Refuses any database not named idauto_scratch_*.
 */

var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var ORG = 'org-' + crypto.randomBytes(10).toString('hex');
var identities = {};
identities[ADMIN] = 'usr_admin_quality_' + crypto.randomBytes(4).toString('hex');
identities[ORG] = { actor_ref: 'svc_quality_' + crypto.randomBytes(4).toString('hex'), org_id: 0, scopes: ['workshop:read', 'vehicle:read'] };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body ? JSON.stringify(opts.body) : null;
    var headers = Object.assign({ 'Content-Length': payload ? Buffer.byteLength(payload) : 0 }, opts.headers || {});
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () {
        var raw = Buffer.concat(c).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function asAdmin(method, p, body) { return request(method, p, { token: ADMIN, body: body }); }
function cookieOf(res) { var sc = res.headers['set-cookie']; if (!sc) return null; var c = [].concat(sc).map(function (x) { return x.split(';')[0]; }).filter(function (x) { return /session_token=/.test(x) && !/=;?$/.test(x); }); return c.length ? c.join('; ') : null; }
var ipBlock = crypto.randomInt(1, 250), ipCounter = 10;
function login(email, password) {
  return request('POST', '/api/auth/sign-in/email', { body: { email: email, password: password }, headers: { Origin: 'http://127.0.0.1:' + port, 'X-Real-IP': '10.97.' + ipBlock + '.' + (ipCounter++ % 250) } });
}
function withSession(cookie) { return { cookie: cookie, headers: { 'X-IDauto-Session': '1' } }; }
function strip(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

async function unusedPlate() {
  for (;;) {
    var p = crypto.randomInt(100, 999) + ' TUN ' + crypto.randomInt(1000, 9999);
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [p])).rows.length) return p;
  }
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);

  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var TAG = 'QLT' + run;
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ($1,'garage','active') RETURNING id", ['Garage ' + TAG])).rows[0].id;
  identities[ORG].org_id = org;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  var authModule = require(path.join(BASE, 'reference', 'auth', 'auth.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  process.env.IDAUTO_AUTH_BASE_URL = 'http://127.0.0.1:' + port;
  var auth = authModule.getAuth();
  var PW = 'Qlt-Horse-' + run + '-2026';
  var users = { manager: 'qlt-manager-' + run.toLowerCase() + '@idauto.test', tech: 'qlt-tech-' + run.toLowerCase() + '@idauto.test' };
  async function provision(email, role) {
    var created = await auth.api.signUpEmail({ body: { email: email, password: PW, name: 'Qlt ' + role } });
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2 WHERE "id" = $3', [role, org, created.user.id]);
  }
  await provision(users.manager, 'manager');
  await provision(users.tech, 'technician');

  /* ===================================================================== */
  say('\n0. STRUCTURE');
  var repoSrc = fs.readFileSync(path.join(BASE, 'reference', 'admin', 'admin-repository.js'), 'utf8');
  ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|CREATE)\b/.test(repoSrc), 'the read model contains no SQL write verb');
  var seg = strip((repoSrc.split('IDA-ADMIN-4 — DATA QUALITY')[1] || '').replace(/^[\s\S]*?\*\//, ''));
  var factFroms = (seg.match(/FROM idauto_vehicle_facts f/g) || []).length;
  // Each fact read: the text from its FROM up to its GROUP BY must apply the guard.
  var guarded = seg.split('FROM idauto_vehicle_facts f').slice(1).filter(function (c) { return c.split('GROUP BY')[0].indexOf('FACT_GUARD') !== -1; }).length;
  ok(/var FACT_GUARD = "f\.access_scope <> 'mythos_private' AND " \+ NOT_VIN;/.test(seg) && factFroms === 4 && guarded === factFroms, 'every fact read in the section excludes restricted facts and the VIN (' + guarded + '/' + factFroms + ')');
  ok(!/capture_time|plate_candidate|ocr_confidence|ip_hash|o\.created_at|min\(created_at\)/.test(seg), 'no observation timestamp or capture detail is read');
  var ui = strip(fs.readFileSync(path.join(BASE, 'reference', 'admin-quality-ui.js'), 'utf8'));
  ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(ui) && !/localStorage|sessionStorage|Authorization|Bearer/.test(ui), 'the page script renders no markup from strings, stores nothing, sends no token');
  ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(ui) && !/\/api\/review\//.test(ui), 'the page script sends no write and calls no decision route');
  var html = fs.readFileSync(path.join(BASE, 'reference', 'admin-quality.html'), 'utf8');
  ok(!/<script>|<script [^>]*>[^<]|onclick=|style="/.test(html) && /lang="fr"/.test(html) && /href="\/admin\/quality" aria-current="page"/.test(html), 'the page: no inline code, French, « Qualité » current in the nav');
  var pages = ['admin.html', 'review.html', 'admin-vehicles.html', 'admin-vehicle.html', 'admin-maintenance.html', 'admin-sources.html', 'admin-quality.html'];
  ok(pages.every(function (f) { var h = fs.readFileSync(path.join(BASE, 'reference', f), 'utf8'); return (h.match(/<li><a href="\/admin\/quality"/g) || []).length === 1 && (h.match(/aria-current="page"/g) || []).length === 1; }),
    'all ' + pages.length + ' console pages carry « Qualité » once and one current entry');
  var review = fs.readFileSync(path.join(BASE, 'reference', 'review.html'), 'utf8');
  var reviewUi = strip(fs.readFileSync(path.join(BASE, 'reference', 'review-ui.js'), 'utf8'));
  ok(/lang="fr"/.test(review) && review.indexOf('File de revue') !== -1 && !/Review queue|Load queue|Pending observations|Select an observation|Skip to content/.test(review), 'the review page is French');
  ok(!/'(Accept|Reject|Loading queue…|Queue is empty\.|No visible facts\.|Saving decision…)'/.test(reviewUi) && reviewUi.indexOf("'Accepter'") !== -1 && reviewUi.indexOf("'Rejeter'") !== -1, 'the review script is French');
  ok(/\/api\/review\/observations\/' \+ encodeURIComponent\(id\) \+ '\/decision'/.test(reviewUi), 'its decisions still go through the audited decision route');

  /* ===================================================================== */
  say('\n1. ACCESS');
  var R = '/api/admin/quality';
  var managerCookie = cookieOf(await login(users.manager, PW));
  var techCookie = cookieOf(await login(users.tech, PW));
  ok(!!managerCookie && !!techCookie, 'manager and technician sign in');
  ok((await request('GET', R)).status === 401, 'anonymous -> 401');
  ok((await request('GET', R, { token: ORG })).status === 403, 'organisation service credential -> 403');
  ok((await request('GET', R, withSession(managerCookie))).status === 403, 'manager session -> 403');
  ok((await request('GET', R, withSession(techCookie))).status === 403, 'technician session -> 403');
  ok((await request('POST', R, { token: ADMIN, body: {} })).status === 405, 'POST -> 405');
  var inner = require(path.join(BASE, 'reference', 'admin-routes.js')).createAdminRoutes({
    sendJson: function (res, status, body) { res.status = status; res.body = body; }, decodePathSegment: decodeURIComponent, resolver: null, catalog: null });
  var h = inner.routes.filter(function (x) { return x.pattern.test(R); })[0];
  var fr = {};
  await h.handler({ url: R, principal: { kind: 'organisation', org_id: org, scopes: identities[ORG].scopes } }, fr, ['']);
  ok(fr.status === 403, 'the handler refuses an organisation principal on its own');

  /* ===================================================================== */
  say('\n2. FIXTURES — through the real identification, fact, observation and merge routes');
  var before = (await asAdmin('GET', R)).body;
  ok(!!before && !!before.totals, 'totals read before the fixtures');

  var VIN = 'VF1' + crypto.randomBytes(7).toString('hex').toUpperCase().slice(0, 14);
  var SECRET = 'SECRET-' + run;
  var LONG = 'Bleu <img src=x onerror=alert(1)> ' + 'x'.repeat(100);
  async function confirm(model, year) {
    var r = await asAdmin('POST', '/api/resolve/confirm', { plate: await unusedPlate(), method: 'admin', candidate: { manufacturer: TAG, model: model, year: year } });
    return r.body.vehicle;
  }
  async function fact(ref, body) { return (await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(ref) + '/facts', body)).status; }
  async function bare(model) {
    var v = (await asAdmin('POST', '/api/vehicles', { make: TAG, model: model })).body;
    v.ivid = (await db.query('SELECT ivid FROM idauto_vehicles WHERE internal_ref = $1', [v.internal_ref])).rows[0].ivid;
    return v;
  }

  // V1: complete, plated; two colours disagree; a third repeats one of them
  // in another case; a pending_review fact; a public-scoped VIN keyed « Vin »
  // twice with different values; a restricted key with two values.
  var V1 = await confirm('UN', 2019);
  ok([await fact(V1.id, { fact_key: 'colour', fact_value: 'Rouge', access_scope: 'public' }),
    await fact(V1.id, { fact_key: 'colour', fact_value: LONG, access_scope: 'public' }),
    await fact(V1.id, { fact_key: 'colour', fact_value: ' ROUGE ', access_scope: 'public' }),
    await fact(V1.id, { fact_key: 'seats', fact_value: '5', access_scope: 'public', verification_status: 'pending_review' }),
    await fact(V1.id, { fact_key: ' Vin ', fact_value: VIN, access_scope: 'public' }),
    await fact(V1.id, { fact_key: 'VIN', fact_value: VIN + 'X', access_scope: 'public' }),
    await fact(V1.id, { fact_key: 'category_code', fact_value: SECRET, access_scope: 'mythos_private' }),
    await fact(V1.id, { fact_key: 'category_code', fact_value: SECRET + '-2', access_scope: 'mythos_private', verification_status: 'pending_review' })
  ].every(function (s) { return s === 201; }), 'V1: 8 facts written through POST /api/vehicles/:ref/facts');
  // V3: a duplicate record with a fuel type that disagrees with V1's, merged into V1.
  ok(await fact(V1.id, { fact_key: 'fuel_type', fact_value: 'Essence', access_scope: 'public' }) === 201, 'V1: fuel_type Essence');
  var V3 = await bare('DOUBLON');
  ok(await fact(V3.internal_ref, { fact_key: 'fuel_type', fact_value: 'Diesel', access_scope: 'professional' }) === 201, 'V3: fuel_type Diesel (professional scope)');
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(V3.ivid) + '/merge', { canonical_ref: V1.id })).status === 200, 'V3 merged into V1 through the audited merge route');
  // V2: no year, no plate, a conflict fact, a pending observation.
  var V2 = await bare('DEUX');
  ok(await fact(V2.internal_ref, { fact_key: 'body_type', fact_value: 'Berline', access_scope: 'public', verification_status: 'conflict' }) === 201, 'V2: a fact entered as conflict');
  var obs = await asAdmin('POST', '/api/observations', { vehicle_internal_ref: V2.internal_ref, status: 'pending_review' });
  ok(obs.status === 201, 'V2: a pending_review observation');
  // V4: nothing to report.
  var V4 = await confirm('QUATRE', 2021);
  ok(await fact(V4.id, { fact_key: 'colour', fact_value: 'Blanc', access_scope: 'public' }) === 201, 'V4: one colour, nothing else');

  /* ===================================================================== */
  say('\n3. TOTALS — each moves by exactly what the fixtures add');
  var after = await asAdmin('GET', R);
  ok(after.status === 200, 'GET ' + R + ' -> 200');
  var t0 = before.totals, t1 = after.body.totals;
  var expect = { identities: 3, all: 2, disagreement: 1, pending_facts: 1, conflict_facts: 1, pending_observations: 1, incomplete: 1, no_plate: 1 };
  Object.keys(expect).forEach(function (k) { ok(t1[k] - t0[k] === expect[k], k + ' +' + expect[k] + ' (' + t0[k] + ' -> ' + t1[k] + ')'); });
  ok(after.body.merged_records - before.merged_records === 1, 'merged records +1');
  ok(after.body.review.pending_review - before.review.pending_review === 1, 'observations pending review +1');
  var subs = (await db.query('SELECT status k, count(*)::int n FROM idauto_submissions GROUP BY 1')).rows;
  ok(subs.length === Object.keys(after.body.review.submissions_by_status).length && subs.every(function (s) { return after.body.review.submissions_by_status[s.k] === s.n; }), 'submissions by status equal the database');
  var factsDb = (await db.query("SELECT verification_status k, count(*)::int n FROM idauto_vehicle_facts WHERE is_active AND access_scope <> 'mythos_private' AND LOWER(TRIM(fact_key)) <> 'vin' GROUP BY 1")).rows;
  ok(factsDb.every(function (s) { return after.body.facts_by_status[s.k] === s.n; }) && factsDb.length === Object.keys(after.body.facts_by_status).length, 'facts by status equal the database, restricted facts and VINs excluded');
  var bySrc = (await db.query("SELECT cs.code, count(*)::int n FROM idauto_observations o JOIN idauto_capture_sources cs ON cs.id = o.capture_source_id WHERE o.status IN ('pending_review','pending_confirmation') GROUP BY 1")).rows;
  ok(bySrc.every(function (s) { return after.body.review.pending_by_source.some(function (x) { return x.code === s.code && x.n === s.n; }); }), 'pending observations by source equal the database');
  var raw = after.raw + JSON.stringify((await asAdmin('GET', R + '?q=' + TAG + '&page_size=100')).body);
  ok(raw.indexOf(VIN) === -1 && raw.indexOf(SECRET) === -1, 'neither the VIN nor the restricted value appears anywhere');

  /* ===================================================================== */
  say('\n4. THE LIST — each identity in exactly its issues');
  async function ivids(issue) {
    var r = await asAdmin('GET', R + '?q=' + TAG + '&page_size=100' + (issue ? '&issue=' + issue : ''));
    return r.body.results.map(function (x) { return x.ivid; });
  }
  var where = {};
  var ISSUES = ['disagreement', 'pending_facts', 'conflict_facts', 'pending_observations', 'incomplete', 'no_plate'];
  for (var i = 0; i < ISSUES.length; i++) where[ISSUES[i]] = await ivids(ISSUES[i]);
  var all = await ivids(null);
  ok(all.length === 2 && all.indexOf(V1.id) !== -1 && all.indexOf(V2.ivid) !== -1, 'issue=all lists V1 and V2 — not the clean V4, not the merged V3');
  ok(where.disagreement.join() === V1.id && where.pending_facts.join() === V1.id, 'V1: disagreement and pending facts');
  ok(where.conflict_facts.join() === V2.ivid && where.pending_observations.join() === V2.ivid && where.incomplete.join() === V2.ivid && where.no_plate.join() === V2.ivid,
    'V2: conflict fact, pending observation, incomplete, no plate');
  var row1 = (await asAdmin('GET', R + '?q=' + V1.id)).body.results[0];
  ok(row1 && row1.aliases === 1 && row1.issues.disagreement === 2 && row1.issues.pending_facts === 1 && row1.issues.incomplete === 0 && row1.issues.no_plate === false, 'V1 row: 1 alias, 2 keys in disagreement (colour, fuel_type through the alias), 1 pending fact');
  var keys = row1.disagreements.map(function (d) { return d.fact_key; });
  ok(keys.join() === 'colour,fuel_type', 'the disagreeing keys are colour and fuel_type — never the VIN, never the restricted key');
  var colour = row1.disagreements[0];
  ok(colour.distinct_values === 2 && colour.values.indexOf('ROUGE') !== -1, 'Rouge and « ROUGE » count as one value; 2 distinct values');
  var long = colour.values.filter(function (v) { return v !== 'ROUGE'; })[0];
  ok(long.length === 81 && /…$/.test(long) && long.indexOf('BLEU <IMG SRC=X') === 0, 'a long value is cut to 80 characters (markup is data, returned as text)');
  ok(row1.disagreements[1].values.join('/') === 'DIESEL/ESSENCE', 'the alias\'s Diesel and V1\'s Essence are reported together');
  var row2 = (await asAdmin('GET', R + '?q=' + V2.internal_ref)).body.results[0];
  ok(row2 && row2.issues.incomplete === 1 && row2.year === null && row2.plate === null && row2.issues.pending_observations === 1 && row2.issues.conflict_facts === 1, 'V2 row: year missing (1 field), no plate, 1 observation, 1 conflict');
  ok((await asAdmin('GET', R + '?q=' + V4.id)).body.total === 0, 'q=V4 -> nothing to report');
  ok((await asAdmin('GET', R + '?q=' + V3.ivid)).body.total === 0, 'the merged record has no row of its own');
  var paged = [];
  for (var pg = 1; pg <= 2; pg++) paged = paged.concat((await asAdmin('GET', R + '?q=' + TAG + '&page_size=1&page=' + pg)).body.results.map(function (x) { return x.ivid; }));
  ok(paged.length === 2 && paged[0] !== paged[1] && paged.indexOf(V1.id) === 0, 'paging one per page walks both, disagreements first');
  ok((await asAdmin('GET', R + '?q=' + encodeURIComponent(TAG.slice(0, 3) + '%'))).body.total === 0, '% in q is a literal character, not a wildcard');
  var bads = [['issue=wrong', 'an unknown issue'], ['page_size=101', 'page_size above 100'], ['page=0', 'page 0'], ['page=1.5', 'a fractional page'], ['q=a%00', 'a NUL byte'], ['q=' + 'x'.repeat(65), 'a q longer than 64']];
  for (var b = 0; b < bads.length; b++) {
    var bad = await asAdmin('GET', R + '?' + bads[b][0]);
    ok(bad.status === 400 && typeof bad.body.message_fr === 'string', 'refuses ' + bads[b][1] + ' with 400');
  }

  /* ===================================================================== */
  say('\n5. REVIEW DETAIL — a public-scoped VIN no longer reaches it');
  var o1 = await asAdmin('POST', '/api/observations', { vehicle_internal_ref: V1.internal_ref, status: 'pending_review' });
  var det = await asAdmin('GET', '/api/review/observations/' + o1.body.id);
  ok(det.status === 200 && det.body.facts.some(function (f) { return f.fact_key === 'colour'; }), 'the detail still lists the vehicle\'s visible facts');
  ok(det.raw.indexOf(VIN) === -1 && det.body.facts.every(function (f) { return f.fact_key.trim().toLowerCase() !== 'vin'; }), 'no VIN fact, whatever its key case or scope');
  ok(det.raw.indexOf(SECRET) === -1, 'no restricted fact');
  var dec = await asAdmin('POST', '/api/review/observations/' + o1.body.id + '/decision', { decision: 'reject' });
  var audit = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE target_ref = $1 AND event_type = 'observation.review.reject'", [String(o1.body.id)])).rows[0].n;
  ok(dec.status === 200 && dec.body.status === 'rejected' && audit === 1, 'a decision is still taken through the audited route (1 audit row)');

  /* ===================================================================== */
  say('\n6. PAGES');
  var pq = await request('GET', '/admin/quality');
  var csp = pq.headers['content-security-policy'] || '';
  ok(pq.status === 200 && pq.headers['cache-control'] === 'no-store' && csp.indexOf("script-src 'self';") !== -1 && csp.indexOf("frame-ancestors 'none'") !== -1, '/admin/quality -> 200, no-store, admin CSP');
  ok((await request('GET', '/admin/quality/')).status === 200 && (await request('GET', '/admin/quality-ui.js')).status === 200, 'the trailing-slash form and the script are served');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close();
  await db.closePool();
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) {
  console.error('FATAL', err && err.stack || err);
  if (server) server.close();
  process.exit(1);
});
