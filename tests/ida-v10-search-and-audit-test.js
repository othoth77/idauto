'use strict';

/* IDA-V10 — VEHICLE SEARCH, THE VIN SCOPE, AND THE AUDIT ORGANISATION.
 * Owner ruling, 2026-08-28.
 *
 * This suite exists because of three findings, and each assertion below
 * traces to one of them. All three were live in production when found.
 *
 *   1. GET /api/vehicles/:ref matched internal_ref ONLY, while
 *      docs/ID_AUTO_INTEGRATION.md §4 instructs Fixpert to "store the IVID
 *      as your primary reference" and §5 documents ":ref = ivid or
 *      internal_ref". An integration built exactly as documented got 404 on
 *      its most-used read.
 *
 *   2. idauto_audit_log.org_id was never written by any code path. Every
 *      audit row in production had org_id NULL and actor_type 'admin', so an
 *      atelier's write was indistinguishable from the operator's — while §12
 *      of the contract promised callers that audit rows carry "the
 *      organisation".
 *
 *   3. There was no vehicle search at all. The ruling requires exact plate,
 *      exact VIN under a DEDICATED SCOPE and ALWAYS AUDITED, Vehicle ID,
 *      internal_ref, make, model and year.
 *
 * It also walks the owner's end-to-end cases 1, 2, 3, 4, 5 and 7 as literal
 * scenarios rather than as unit assertions, because those cases are about
 * sequences — search, then create, then read back — and a sequence is where
 * an integration actually breaks.
 *
 * Runs against a real PostgreSQL and refuses the production database.
 */

var http = require('http');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var ORG_A = 'orga-' + crypto.randomBytes(10).toString('hex');
var ORG_B = 'orgb-' + crypto.randomBytes(10).toString('hex');
var ADMIN_REF = 'usr_' + crypto.randomBytes(12).toString('hex');

var identities = {};
identities[ADMIN] = ADMIN_REF;
// Atelier A may search, but holds NO vin:search — case 7's "sans scope".
identities[ORG_A] = { actor_ref: 'svc_atelier_a', org_id: 0,
  scopes: ['vehicle:read', 'vehicle:write', 'vehicle:search', 'observation:write', 'observation:read', 'fact:read', 'identity:resolve'] };
// Atelier B holds vin:search — case 7's "avec scope".
identities[ORG_B] = { actor_ref: 'svc_atelier_b', org_id: 0,
  scopes: ['vehicle:read', 'vehicle:search', 'vin:search'] };

var db = require(path.join(BASE, 'reference', 'db.js'));

var server, port;
function request(method, p, token, body) {
  return new Promise(function (resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Length': payload ? Buffer.byteLength(payload) : 0 };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () {
        var raw = Buffer.concat(c).toString('utf8'), parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function vinAuditCount() {
  return (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin'")).rows[0].n;
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) {
    console.error('FATAL: refusing to run against "' + dbName + '" — point IDAUTO_DB_NAME at a scratch database');
    process.exit(1);
  }
  say('database: ' + dbName);

  var oa = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V10 A','garage','active') RETURNING id")).rows[0].id;
  var ob = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier V10 B','garage','active') RETURNING id")).rows[0].id;
  identities[ORG_A].org_id = oa;
  identities[ORG_B].org_id = ob;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);

  var identity = require(path.join(BASE, 'reference', 'identity.js'));
  identity.clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  /* =====================================================================
   * 1. FINDING 1 — a vehicle is readable by the identifier the contract
   *    tells Fixpert to store.
   * ===================================================================== */
  say('\n1. GET /api/vehicles/:ref — BOTH identifiers, as documented');
  var created = await request('POST', '/api/vehicles', ADMIN, { make: 'HYUNDAI', model: 'TUCSON', year: 2015 });
  ok(created.status === 201 || created.status === 200, 'a vehicle is created');
  var REF = created.body.internal_ref, IVID = created.body.ivid;
  ok(!!IVID, 'and is issued an IVID');

  var byRef = await request('GET', '/api/vehicles/' + encodeURIComponent(REF), ADMIN);
  ok(byRef.status === 200, 'GET by internal_ref -> 200 (unchanged behaviour)');
  var byIvid = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID), ADMIN);
  ok(byIvid.status === 200, 'GET by IVID -> 200 — the read the contract documents, which used to 404');
  ok(byIvid.body && byIvid.body.internal_ref === REF, 'and it is the SAME vehicle, not a lookalike');
  ok(byIvid.body && byIvid.body.ivid === IVID, 'the response carries the IVID, so one call is enough');

  var factsByIvid = await request('GET', '/api/vehicles/' + encodeURIComponent(IVID) + '/facts', ADMIN);
  ok(factsByIvid.status === 200, 'GET /facts by IVID -> 200');
  ok(factsByIvid.body && factsByIvid.body.vehicle_internal_ref === REF,
    'and reports the RESOLVED internal_ref, not the string the caller sent');

  var unknownRef = await request('GET', '/api/vehicles/ivid:1:ZZZZZZZZZZZZZZZZ:ZZ', ADMIN);
  ok(unknownRef.status === 404, 'an unknown identifier is still 404 — matching both did not widen anything');

  /* =====================================================================
   * 2. FINDING 2 — the audit row names the ORGANISATION.
   * ===================================================================== */
  say('\n2. AUDIT — the acting organisation is recorded, not just the actor');
  var orgVehicle = await request('POST', '/api/vehicles', ORG_A, { make: 'PEUGEOT', model: '208' });
  ok(orgVehicle.status === 201 || orgVehicle.status === 200, 'atelier A creates a vehicle');
  var orgAudit = (await db.query(
    "SELECT actor_type, actor_ref, org_id FROM idauto_audit_log WHERE actor_ref = 'svc_atelier_a' ORDER BY id DESC LIMIT 1"
  )).rows[0];
  ok(!!orgAudit, "the organisation's write produced an audit row");
  ok(String(orgAudit.org_id) === String(oa), 'the row carries org_id — it was NULL on every row before this fix');
  ok(orgAudit.actor_type === 'professional_user',
    "actor_type is 'professional_user', not 'admin' — an atelier is no longer indistinguishable from the operator");

  var adminAudit = (await db.query(
    'SELECT actor_type, org_id FROM idauto_audit_log WHERE actor_ref = $1 ORDER BY id DESC LIMIT 1', [ADMIN_REF]
  )).rows[0];
  ok(adminAudit && adminAudit.actor_type === 'admin' && adminAudit.org_id === null,
    'an ADMIN write is unchanged: actor_type admin, org_id NULL — no existing caller changed behaviour');

  /* =====================================================================
   * 3. CASE 1 — an authorised plate: search → Vehicle ID → get.
   * ===================================================================== */
  say('\n3. CASE 1 — plate → search → Vehicle ID → Get');
  var PLATE = '188 TUN ' + (1000 + Math.floor(Math.random() * 8999));
  await request('POST', '/api/plates', ADMIN, { plate_number: PLATE, format_code: 'TUN_STD', vehicle_internal_ref: REF });

  var byPlate = await request('GET', '/api/search/vehicles?plate=' + encodeURIComponent(PLATE), ORG_A);
  ok(byPlate.status === 200, 'search by exact plate -> 200');
  ok(byPlate.body && byPlate.body.count === 1, 'exactly one vehicle matches');
  ok(byPlate.body.results[0].ivid === IVID, 'and it yields the Vehicle ID (IVID)');

  var thenGet = await request('GET', '/api/vehicles/' + encodeURIComponent(byPlate.body.results[0].ivid), ORG_A);
  ok(thenGet.status === 200, 'the IVID from search feeds straight into Get — the full case-1 sequence works');

  var unnormalised = await request('GET', '/api/search/vehicles?plate=' + encodeURIComponent(PLATE.replace(/ /g, '').toLowerCase()), ORG_A);
  ok(unnormalised.body && unnormalised.body.count === 1,
    'the same plate written without spaces and in lower case finds the same vehicle');

  /* =====================================================================
   * 4. CASE 2 — an unknown vehicle: search → not found → create → get.
   * ===================================================================== */
  say('\n4. CASE 2 — unknown vehicle → Not Found → Create → Vehicle ID → Get');
  var GHOST = '199 TUN ' + (1000 + Math.floor(Math.random() * 8999));
  var miss = await request('GET', '/api/search/vehicles?plate=' + encodeURIComponent(GHOST), ORG_A);
  ok(miss.status === 200 && miss.body.count === 0, 'an unknown plate returns an empty result set, not an error');

  var newV = await request('POST', '/api/vehicles', ORG_A, { make: 'DACIA', model: 'LOGAN', year: 2019 });
  ok(newV.status === 201 || newV.status === 200, 'the atelier may then create the vehicle');
  ok(!!newV.body.ivid, 'and it receives a Vehicle ID immediately');
  var immediate = await request('GET', '/api/vehicles/' + encodeURIComponent(newV.body.ivid), ORG_A);
  ok(immediate.status === 200, 'which is readable immediately, with no intermediate step');

  /* =====================================================================
   * 5. CASE 7 — VIN: refused without the scope, allowed with it, always
   *    audited, and never echoed back.
   * ===================================================================== */
  say('\n5. CASE 7 — VIN search: dedicated scope + mandatory audit');
  var VIN = 'VF1' + crypto.randomBytes(7).toString('hex').toUpperCase();
  await request('POST', '/api/vehicles/' + encodeURIComponent(REF) + '/facts', ADMIN,
    { fact_key: 'vin', fact_value: VIN, access_scope: 'mythos_private', evidence_type: 'document_scan_official' });

  var before = await vinAuditCount();
  var refused = await request('GET', '/api/search/vehicles?vin=' + encodeURIComponent(VIN), ORG_A);
  ok(refused.status === 403, 'an atelier WITHOUT vin:search is refused — 403');
  ok(refused.body && refused.body.required_scope === 'vin:search', 'and is told exactly which scope it lacked');
  ok(refused.raw.indexOf(VIN) === -1, 'the refusal echoes no VIN');
  ok((await vinAuditCount()) === before,
    'a REFUSED search writes no audit row — nothing was disclosed, so there is nothing to audit');

  var allowed = await request('GET', '/api/search/vehicles?vin=' + encodeURIComponent(VIN), ORG_B);
  ok(allowed.status === 200, 'an atelier WITH vin:search is served');
  ok(allowed.body && allowed.body.count === 1 && allowed.body.results[0].ivid === IVID,
    'and finds the right vehicle by exact VIN');
  ok(allowed.raw.indexOf(VIN) === -1,
    'the RESULT contains no VIN — a private value is never echoed into a response body or a proxy log');

  var after = await vinAuditCount();
  ok(after === before + 1, 'the permitted search wrote exactly one audit row — the audit is mandatory');
  var vinRow = (await db.query(
    "SELECT actor_type, actor_ref, org_id, target_ref, change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' ORDER BY id DESC LIMIT 1"
  )).rows[0];
  ok(String(vinRow.org_id) === String(ob), 'the VIN audit row names the searching ORGANISATION');
  ok(vinRow.actor_ref === 'svc_atelier_b', 'and the searching actor');
  ok(vinRow.target_ref === IVID, 'and the IVID it matched');
  ok(vinRow.change_summary.indexOf(VIN) === -1,
    'the audit row stores NO raw VIN — it would copy a private value into a table with no access_scope');
  ok(/vin_digest=[0-9a-f]{16}/.test(vinRow.change_summary),
    'it stores a salted, truncated digest instead, so repeat searches correlate without being reversible');

  var vinMiss = await request('GET', '/api/search/vehicles?vin=VFXXXXXXXXXXXXXXX', ORG_B);
  ok(vinMiss.status === 200 && vinMiss.body.count === 0, 'a VIN that matches nothing returns an empty set');
  ok((await vinAuditCount()) === after + 1, 'and a MISS is audited too — an unsuccessful VIN search is still a VIN search');

  ok((await request('GET', '/api/search/vehicles?vin=' + encodeURIComponent(VIN), null)).status === 401,
    'no credential is 401 — there is no anonymous VIN search');

  /* =====================================================================
   * 6. THE REST OF THE CRITERIA THE RULING NAMES.
   * ===================================================================== */
  say('\n6. SEARCH — every criterion the ruling requires');
  var byIvidS = await request('GET', '/api/search/vehicles?ivid=' + encodeURIComponent(IVID), ORG_A);
  ok(byIvidS.status === 200 && byIvidS.body.count === 1, 'search by Vehicle ID');
  var byRefS = await request('GET', '/api/search/vehicles?internal_ref=' + encodeURIComponent(REF), ORG_A);
  ok(byRefS.status === 200 && byRefS.body.count === 1, 'search by Internal Ref');
  var byMake = await request('GET', '/api/search/vehicles?make=HYUNDAI', ORG_A);
  ok(byMake.status === 200 && byMake.body.count >= 1, 'search by marque');
  var byMakeModel = await request('GET', '/api/search/vehicles?make=hyundai&model=tucson', ORG_A);
  ok(byMakeModel.status === 200 && byMakeModel.body.count >= 1, 'marque + modèle combine, case-insensitively');
  var byYear = await request('GET', '/api/search/vehicles?make=HYUNDAI&model=TUCSON&year=2015', ORG_A);
  ok(byYear.status === 200 && byYear.body.count >= 1, 'marque + modèle + année combine');
  var wrongYear = await request('GET', '/api/search/vehicles?make=HYUNDAI&model=TUCSON&year=1901', ORG_A);
  ok(wrongYear.body.count === 0, 'and année actually filters');

  ok((await request('GET', '/api/search/vehicles', ORG_A)).status === 400,
    'a search with NO criterion is refused — it would be a "dump the register" route');
  ok((await request('GET', '/api/search/vehicles?year=abcd', ORG_A)).status === 400, 'a malformed year is refused');
  ok(byMake.raw.indexOf('"vin"') === -1, 'no search response carries a vin field at all');

  var noSearchScope = await request('GET', '/api/search/vehicles?make=HYUNDAI', ADMIN);
  ok(noSearchScope.status === 200, 'the admin reaches search like every other route');

  /* =====================================================================
   * 7. CASES 3, 4, 5 — search across a merge, a split, and an old reference.
   * ===================================================================== */
  say('\n7. CASES 3, 4, 5 — merge, alias resolution and split');
  var vA = (await request('POST', '/api/vehicles', ADMIN, { make: 'KIA', model: 'CEED' })).body;
  var vB = (await request('POST', '/api/vehicles', ADMIN, { make: 'KIA', model: 'CEED' })).body;
  var OLD_REF = vA.ivid;

  var merged = await request('POST', '/api/vehicles/' + encodeURIComponent(vA.ivid) + '/merge', ADMIN, { canonical_ref: vB.ivid });
  ok(merged.status === 200, 'CASE 3 — vehicle A merges into vehicle B');

  var searchOld = await request('GET', '/api/search/vehicles?ivid=' + encodeURIComponent(OLD_REF), ADMIN);
  ok(searchOld.status === 200 && searchOld.body.count === 1, 'CASE 4 — the atelier\'s OLD reference still resolves');
  ok(searchOld.body.results[0].ivid === vB.ivid, 'and search answers with the CANONICAL Vehicle ID');
  ok(searchOld.body.results[0].is_alias === true, 'the caller is told its stored reference is now an alias');
  ok(searchOld.body.results[0].matched_ref === OLD_REF, 'and which reference it actually matched');

  var mergeAudit = (await db.query(
    "SELECT actor_type, org_id FROM idauto_audit_log WHERE event_type = 'vehicle.merge' ORDER BY id DESC LIMIT 1"
  )).rows[0];
  ok(!!mergeAudit, 'the merge is a permanent audit record');

  var splitBack = await request('POST', '/api/vehicles/' + encodeURIComponent(vA.ivid) + '/split', ADMIN);
  ok(splitBack.status === 200, 'CASE 5 — an incorrect merge is split back');
  var searchAfterSplit = await request('GET', '/api/search/vehicles?ivid=' + encodeURIComponent(OLD_REF), ADMIN);
  ok(searchAfterSplit.body.results[0].ivid === OLD_REF, 'the restored identity answers for itself again');
  ok(!searchAfterSplit.body.results[0].is_alias, 'and is no longer reported as an alias');

  /* =====================================================================
   * 8. C3 — identity is global; the compartment is the DETAIL.
   * ===================================================================== */
  say('\n8. C3 — global identity, compartmented detail');
  var aFinds = await request('GET', '/api/search/vehicles?ivid=' + encodeURIComponent(newV.body.ivid), ORG_A);
  var bFinds = await request('GET', '/api/search/vehicles?ivid=' + encodeURIComponent(newV.body.ivid), ORG_B);
  ok(aFinds.body.count === 1 && bFinds.body.count === 1,
    'both ateliers find the SAME vehicle — a vehicle is nobody\'s exclusive property (C3)');
  ok(bFinds.raw.indexOf('observation') === -1,
    'and search discloses no observation — the compartmented layer is not reachable through it');

  /* =====================================================================
   * 9. THE PUBLIC SURFACE IS UNTOUCHED.
   * ===================================================================== */
  say('\n9. THE PUBLIC SURFACE IS UNCHANGED');
  ok((await request('GET', '/public/passport/' + encodeURIComponent(IVID), null)).status !== 401,
    'the anonymous passport still needs no credential');
  var pub = await request('GET', '/public/passport/' + encodeURIComponent(IVID), null);
  ok(pub.raw.indexOf(VIN) === -1, 'and the public passport still carries no VIN');

  server.close();
  console.log('\nIDA-V10 search, VIN scope and audit organisation: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
