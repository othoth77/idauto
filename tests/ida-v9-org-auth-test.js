'use strict';

/* IDA-V9 — organisation-scoped access and mandatory provenance.
 * Owner decision, 2026-08-27: OPTION B.
 *
 * Fixpert authenticates as ONE organisation holding a service credential.
 * IDauto stores no workshop user account: the acting person travels as
 * PROVENANCE, never as an authorisation subject. The two properties this
 * suite exists to prove are both negative:
 *
 *   1. An organisation credential can reach ONLY what its scopes name, and
 *      nothing that is admin-only.
 *   2. One atelier can never see another atelier's data — and is told 404,
 *      not 403, because confirming that a record it may not read EXISTS is
 *      itself a disclosure.
 *
 * Runs against a real PostgreSQL and refuses the production database. */

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
var NOSCOPE = 'nos-' + crypto.randomBytes(10).toString('hex');
var ADMIN_REF = 'usr_' + crypto.randomBytes(12).toString('hex');

var identities = {};
identities[ADMIN] = ADMIN_REF;
identities[ORG_A] = { actor_ref: 'svc_atelier_a', org_id: 0, scopes: ['vehicle:read', 'vehicle:write', 'observation:write', 'observation:read', 'fact:read', 'identity:resolve'] };
identities[ORG_B] = { actor_ref: 'svc_atelier_b', org_id: 0, scopes: ['observation:read', 'vehicle:read'] };
identities[NOSCOPE] = { actor_ref: 'svc_nothing', org_id: 0, scopes: ['vehicle:read'] };

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

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) {
    console.error('FATAL: refusing to run against "' + dbName + '"');
    process.exit(1);
  }
  say('database: ' + dbName);

  // Two real organisations — an atelier IS an idauto_organizations row.
  var oa = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier A','garage','active') RETURNING id")).rows[0].id;
  var obId = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Atelier B','garage','active') RETURNING id")).rows[0].id;
  identities[ORG_A].org_id = oa;
  identities[ORG_B].org_id = obId;
  identities[NOSCOPE].org_id = oa;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);

  var identity = require(path.join(BASE, 'reference', 'identity.js'));
  identity.clearIdentityCache();
  var api = require(path.join(BASE, 'reference', 'api.js'));
  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;

  say('\n1. PRINCIPALS — the same identity map, read two ways');
  ok(identity.resolveIdentity(ADMIN) === ADMIN_REF, 'an admin token still resolves to its actor_ref string');
  var pa = identity.resolvePrincipal(ORG_A);
  ok(pa && pa.kind === 'organisation' && pa.org_id === oa, 'an organisation token resolves to its organisation');
  ok(identity.principalHasScope(identity.resolvePrincipal(ADMIN), 'anything:at:all'), 'admin holds every scope');
  ok(!identity.principalHasScope(pa, 'fact:write'), 'an organisation holds only what it was granted');

  say('\n2. VEHICLE — an organisation may create and read within its scopes');
  var v = await request('POST', '/api/vehicles', ORG_A, { make: 'SSANGYONG' });
  
  ok(v.status === 201 || v.status === 200, 'atelier A may create a vehicle (vehicle:write)');
  var ref = v.body.internal_ref, ivid = v.body.ivid;
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(ref), ORG_A)).status === 200, 'and read it back (vehicle:read)');

  say('\n3. SCOPES — refused with 403, not silently allowed');
  var noWrite = await request('POST', '/api/vehicles', ORG_B, { make: 'X' });
  ok(noWrite.status === 403, 'atelier B has no vehicle:write and is refused');
  ok(noWrite.body && noWrite.body.required_scope === 'vehicle:write', 'and is told which scope it lacked');
  var noFact = await request('POST', '/api/vehicles/' + encodeURIComponent(ref) + '/facts', ORG_A, { fact_key: 'colour', fact_value: 'blanc' });
  ok(noFact.status === 403, 'atelier A has no fact:write and is refused');
  ok((await request('GET', '/api/review/observations', ORG_A)).status === 403, 'the review queue is admin-only — no organisation may reach it');
  ok((await request('POST', '/api/vehicles/' + encodeURIComponent(ivid) + '/merge', ORG_A, { canonical_ref: ivid })).status === 403,
    'merge is admin-only — an organisation cannot rewrite identity');
  ok((await request('GET', '/health', ORG_A)).status === 403, 'a route absent from the scope table is admin-only by default');
  ok((await request('GET', '/health', ADMIN)).status === 200, 'and the admin still reaches it');

  say('\n4. PROVENANCE — mandatory, and taken from the credential, not the body');
  var noProv = await request('POST', '/api/observations', ORG_A, { vehicle_internal_ref: ref, status: 'received' });
  ok(noProv.status === 400, 'an organisation observation without provenance is refused');
  ok(/author/.test(noProv.body.error) && /source_reference/.test(noProv.body.error), 'and the refusal names every missing field');

  var good = await request('POST', '/api/observations', ORG_A, {
    vehicle_internal_ref: ref, status: 'received',
    author: 'mecanicien-42', source: 'fixpert', source_type: 'workshop_record', source_reference: 'FX-2026-000123'
  });
  
  ok(good.status === 201 || good.status === 200, 'with complete provenance it is accepted');
  var obs = good.body.observation || good.body;
  ok(String(obs.org_id) === String(oa), 'and is stored against the AUTHENTICATED organisation');
  ok(obs.author_ref === 'mecanicien-42' && obs.source === 'fixpert' && obs.source_type === 'workshop_record' && obs.source_reference === 'FX-2026-000123',
    'with author, source, source_type and source_reference all persisted');
  ok(!!obs.capture_time, 'and a timestamp');

  var spoof = await request('POST', '/api/observations', ORG_A, {
    vehicle_internal_ref: ref, status: 'received', org_id: obId,
    author: 'x', source: 'fixpert', source_type: 'workshop_record', source_reference: 'FX-9'
  });
  var spoofed = spoof.body.observation || spoof.body;
  ok(String(spoofed.org_id) === String(oa), 'an org_id in the REQUEST BODY is ignored — a caller cannot write as another atelier');

  var dbRow = (await db.query('SELECT org_id, author_ref, source, source_type, source_reference FROM idauto_observations WHERE id=$1', [obs.id])).rows[0];
  ok(dbRow.org_id === oa && dbRow.author_ref && dbRow.source_reference, 'the row carries its provenance in the database');

  say('\n5. THE DATABASE REFUSES INCOMPLETE PROVENANCE BY ITSELF');
  var direct = null;
  try {
    await db.query("INSERT INTO idauto_observations (capture_source_id, capture_method, status, org_id) SELECT id,'manual_admin','received',$1 FROM idauto_capture_sources LIMIT 1", [oa]);
  } catch (e) { direct = e.code; }
  ok(direct === '23514', 'a direct INSERT with an organisation but no provenance violates chk_obs_org_provenance');

  say('\n6. ISOLATION — one atelier never sees another');
  var seenByOwner = await request('GET', '/api/observations/' + obs.id, ORG_A);
  ok(seenByOwner.status === 200, 'atelier A reads its own observation');
  var seenByOther = await request('GET', '/api/observations/' + obs.id, ORG_B);
  ok(seenByOther.status === 404, "atelier B gets 404 for atelier A's observation — not 403, which would confirm it exists");
  ok(seenByOther.raw.indexOf('FX-2026-000123') === -1, "and none of atelier A's provenance leaks in the body");
  var seenByAdmin = await request('GET', '/api/observations/' + obs.id, ADMIN);
  ok(seenByAdmin.status === 200, 'the admin still sees everything');

  say('\n7. AUTHENTICATION AND AUDIT');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(ref), null)).status === 401, 'no credential is 401');
  ok((await request('GET', '/api/vehicles/' + encodeURIComponent(ref), 'wrong')).status === 401, 'a wrong credential is 401');
  var audits = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE actor_ref = 'svc_atelier_a'")).rows[0].n;
  ok(audits > 0, "the organisation's writes are audited under its own actor_ref");

  say('\n8. THE PUBLIC SURFACE IS UNCHANGED');
  ok((await request('GET', '/public/passport/' + encodeURIComponent(ivid), null)).status !== 401, 'the anonymous passport still needs no credential');
  ok((await request('GET', '/admin', null)).status === 200, '/admin still serves its page');
  ok((await request('POST', '/api/vehicles', null, { make: 'X' })).status === 401, 'and writing still requires a credential');

  server.close();
  console.log('\nIDA-V9 organisation auth: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
