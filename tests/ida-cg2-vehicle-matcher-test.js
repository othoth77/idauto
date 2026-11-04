'use strict';

/* IDA-CG2 stage 1 — REGISTRATION DOCUMENT → EXISTING VEHICLE MATCHER.
 *
 * POST /api/registration-documents/match and reference/documents/vehicle-matcher.js.
 * What this suite proves:
 *   - an existing vehicle is found by its current plate (in every spelling the
 *     normaliser accepts), by a past plate, by its VIN, through a merged record;
 *   - "existing" needs a STRONG identifier and no contradiction; a past plate
 *     alone, two vehicles, a VIN that differs from the one on record, or the
 *     card's plate active on another vehicle are "ambiguous" — never guessed;
 *   - an unusable identifier is reported, not corrected; make + model never match;
 *   - the VIN is used only with vin:search, audited once, never returned;
 *   - nothing is written (vehicles, plates, facts unchanged);
 *   - access: anonymous 401, a credential without vehicle:resolve 403.
 *
 * Refuses any database not named idauto_scratch_*.
 */

var http = require('http');
var crypto = require('crypto');
var path = require('path');
var BASE = path.join(__dirname, '..');

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }

process.env.IDAUTO_AUTH_SECRET = process.env.IDAUTO_AUTH_SECRET || crypto.randomBytes(32).toString('base64');
var ADMIN = 'adm-' + crypto.randomBytes(10).toString('hex');
var RESOLVER = 'res-' + crypto.randomBytes(10).toString('hex');   // vehicle:resolve without vin:search
var READER = 'rdr-' + crypto.randomBytes(10).toString('hex');     // no vehicle:resolve
var identities = {};
identities[ADMIN] = 'usr_admin_cg2_' + crypto.randomBytes(4).toString('hex');
identities[RESOLVER] = { actor_ref: 'svc_cg2_res', org_id: 0, scopes: ['vehicle:resolve', 'vehicle:read'] };
identities[READER] = { actor_ref: 'svc_cg2_rdr', org_id: 0, scopes: ['vehicle:read'] };

var db = require(path.join(BASE, 'reference', 'db.js'));
var server, port;

function request(method, p, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
    var headers = { 'Content-Length': payload ? Buffer.byteLength(payload) : 0 };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (payload) headers['Content-Type'] = 'application/json';
    var req = http.request({ hostname: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      var c = [];
      res.on('data', function (x) { c.push(x); });
      res.on('end', function () { var raw = Buffer.concat(c).toString('utf8'), parsed = null; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function asAdmin(method, p, body) { return request(method, p, { token: ADMIN, body: body }); }
function match(body, token) { return request('POST', '/api/registration-documents/match', { token: token || ADMIN, body: body }); }

var VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function randomVin() { var s = ''; for (var i = 0; i < 17; i++) s += VIN_CHARS[crypto.randomInt(VIN_CHARS.length)]; return s; }
var used = {};
async function unusedPlate() {
  for (;;) {
    var s = crypto.randomInt(100, 999), n = crypto.randomInt(1000, 9999), p = s + ' TUN ' + n;
    if (used[p]) continue;
    if (!(await db.query('SELECT 1 FROM idauto_plates WHERE plate_number = $1', [p])).rows.length) { used[p] = { series: s, number: n }; return p; }
  }
}
var AR = '٠١٢٣٤٥٦٧٨٩';
function arabicDigits(n) { return String(n).replace(/\d/g, function (d) { return AR[+d]; }); }
async function counts() {
  return (await db.query('SELECT (SELECT count(*)::int FROM idauto_vehicles) v, (SELECT count(*)::int FROM idauto_plates) p, (SELECT count(*)::int FROM idauto_vehicle_facts) f')).rows[0];
}

async function main() {
  var dbName = (await db.query('SELECT current_database() d')).rows[0].d;
  if (!/^idauto_scratch_/.test(dbName)) { console.error('FATAL: refusing to run against "' + dbName + '"'); process.exit(1); }
  say('database: ' + dbName);
  var org = (await db.query("INSERT INTO idauto_organizations (name, org_type, status) VALUES ('Garage CG2','garage','active') RETURNING id")).rows[0].id;
  identities[RESOLVER].org_id = org; identities[READER].org_id = org;
  process.env.IDAUTO_ADMIN_IDENTITIES = JSON.stringify(identities);
  require(path.join(BASE, 'reference', 'identity.js')).clearIdentityCache();
  server = require(path.join(BASE, 'reference', 'api.js')).createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  var run = crypto.randomBytes(3).toString('hex').toUpperCase();
  var MAKE = 'CG2' + run;

  say('\n1. FIXTURES — through the real identification, fact and merge routes');
  async function confirm(plate, vin, model) {
    var r = await asAdmin('POST', '/api/resolve/confirm', { plate: plate, vin: vin || undefined, method: 'admin', candidate: { manufacturer: MAKE, model: model || 'M', year: 2019 } });
    return r.body && r.body.vehicle;
  }
  var PA_OLD = await unusedPlate(), PA = await unusedPlate(), PB = await unusedPlate(), PD = await unusedPlate(), PX = await unusedPlate();
  var VA = randomVin(), VC = randomVin(), VX = randomVin();
  var A = await confirm(PA_OLD, VA, 'ALPHA');
  // A is re-plated: the old plate retired (as an operator records it), a new one attached through confirm.
  await db.query("UPDATE idauto_plates SET status = 'cancelled', valid_until = CURRENT_DATE WHERE plate_number = $1", [PA_OLD]);
  ok((await asAdmin('POST', '/api/resolve/confirm', { vehicle_ref: A.id, plate: PA, method: 'admin', candidate: {} })).status === 200, 'A: VIN on record, plate ' + PA + ', past plate ' + PA_OLD);
  var B = await confirm(PB, null, 'BETA');
  ok(!!B, 'B: plate only');
  var C1 = await confirm(await unusedPlate(), null, 'GAMMA'), C2 = await confirm(await unusedPlate(), null, 'GAMMA');
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(C1.id) + '/facts', { fact_key: 'vin', fact_value: VC, access_scope: 'mythos_private' })).status === 201 &&
    (await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(C2.id) + '/facts', { fact_key: ' VIN ', fact_value: VC.toLowerCase(), access_scope: 'mythos_private' })).status === 201,
    'C1 and C2 both carry the same VIN (keyed « vin » and « VIN », different case)');
  var D = await confirm(PD, null, 'ALPHA');
  ok((await asAdmin('POST', '/api/vehicles/' + encodeURIComponent(D.id) + '/merge', { canonical_ref: A.id })).status === 200, 'D (plate ' + PD + ') merged into A');
  var before = await counts();
  var auditBefore = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin'")).rows[0].n;

  say('\n2. EXISTING — strong identifier, nothing contradicts');
  var r1 = await match({ plate: PA, vin: VA });
  ok(r1.status === 200 && r1.body.outcome === 'existing' && r1.body.candidates.length === 1 && r1.body.candidates[0].ivid === A.id, 'current plate + VIN → A');
  ok(r1.body.candidates[0].vin_check === 'match' && r1.body.candidates[0].vin_on_record === true && r1.body.requires_human_review === false, 'the VIN matches the one on record; no review needed');
  ok(r1.raw.indexOf(VA) === -1 && r1.raw.indexOf(VA.toLowerCase()) === -1, 'the VIN value is never returned');
  var pb = used[PB];
  var spellings = [pb.series + ' TU ' + pb.number, pb.series + '-تونس-' + pb.number, pb.series + 'TU' + pb.number, arabicDigits(pb.series) + ' تونس ' + arabicDigits(pb.number), '  ' + pb.series + '  TUN  ' + pb.number + ' '];
  var allB = true;
  for (var s = 0; s < spellings.length; s++) { var rb = await match({ plate: spellings[s] }); if (!(rb.body.outcome === 'existing' && rb.body.candidates[0].ivid === B.id)) allB = false; }
  ok(allB, 'B is found from ' + spellings.length + ' spellings of its plate (hyphens, TU/TUN/تونس, Arabic-Indic digits, spacing)');
  var rv = await match({ vin: VA });
  ok(rv.body.outcome === 'existing' && rv.body.candidates[0].ivid === A.id, 'the VIN alone → A');
  var rvl = await match({ vin: VA.toLowerCase() });
  ok(rvl.body.outcome === 'existing' && rvl.body.candidates[0].ivid === A.id, 'the VIN in lower case → A (normalised, not corrected)');
  var rp = await match({ plate: PA, previous_plates: [PA_OLD] });
  ok(rp.body.outcome === 'existing' && rp.body.candidates.length === 1 && rp.body.candidates[0].evidence.some(function (e) { return e.identifier === 'previous_plate' && e.plate_status === 'cancelled'; }), 'current plate + past plate → A, the past plate listed as evidence');
  var rd = await match({ plate: PD });
  ok(rd.body.candidates.length === 1 && rd.body.candidates[0].ivid === A.id && rd.body.candidates[0].evidence[0].via_merged_record === true, 'the plate of a record merged into A → A (canonical), marked as through a merged record');

  say('\n3. AMBIGUOUS — a person decides');
  var rw = await match({ plate: PA_OLD });
  ok(rw.body.outcome === 'ambiguous' && rw.body.reasons.indexOf('only_weak_evidence') !== -1 && rw.body.candidates[0].ivid === A.id, 'only a past plate → ambiguous (only_weak_evidence)');
  var rx = await match({ plate: PB, vin: VA });
  ok(rx.body.outcome === 'ambiguous' && rx.body.candidates.length === 2 && rx.body.reasons.indexOf('several_vehicles') !== -1, 'plate of B + VIN of A → ambiguous, both shown');
  var rc = await match({ vin: VC });
  ok(rc.body.outcome === 'ambiguous' && rc.body.candidates.length === 2, 'one VIN on two vehicles (C1, C2) → ambiguous, both shown');
  var rdv = await match({ plate: PA, vin: VX });
  ok(rdv.body.outcome === 'ambiguous' && rdv.body.reasons.indexOf('vin_differs_from_record') !== -1 && rdv.body.candidates[0].vin_check === 'differs', 'A\'s plate with a different VIN → ambiguous (vin_differs_from_record)');
  var rel = await match({ plate: PB, previous_plates: [PA] });
  ok(rel.body.outcome === 'ambiguous' && rel.body.candidates.length === 2, 'current plate of B, past plate active on A → ambiguous');
  var rnew = await match({ plate: PX, vin: VA });
  ok(rnew.body.outcome === 'existing' && rnew.body.candidates[0].ivid === A.id && rnew.body.reasons.indexOf('current_plate_not_on_record') !== -1 && rnew.body.requires_human_review === true,
    'A\'s VIN with a plate unknown to IDauto → A, flagged current_plate_not_on_record for review');
  ok(rw.body.requires_human_review && rx.body.requires_human_review && rc.body.requires_human_review && rdv.body.requires_human_review, 'every ambiguous answer requires human review');

  say('\n4. NONE, UNUSABLE, NEVER GUESSED');
  var rn = await match({ plate: PX, vin: VX });
  ok(rn.body.outcome === 'none' && rn.body.candidates.length === 0, 'unknown plate + unknown VIN → none');
  var bad = await match({ plate: '12', vin: 'ABC' });
  ok(bad.body.outcome === 'none' && bad.body.identifiers.every(function (i) { return i.usable === false; }) && bad.body.reasons.indexOf('no_usable_identifier') !== -1, 'a partial plate and a short VIN are reported unusable, not completed');
  var mm = await match({ plate: PX, make: MAKE, model: 'ALPHA' });
  ok(mm.body.outcome === 'none', 'make + model never identify a vehicle (A and D share them)');
  ok((await match({})).body.outcome === 'none', 'an empty card → none');
  var many = []; for (var m2 = 0; m2 < 15; m2++) many.push(PA_OLD);
  ok((await match({ plate: PX, previous_plates: many })).body.identifiers.length === 11, 'previous plates are capped (10)');
  ok((await request('POST', '/api/registration-documents/match', { token: ADMIN, body: 'not json' })).status >= 400, 'a body that is not JSON is refused');

  say('\n5. VIN PERMISSION AND AUDIT');
  var auditAfter = (await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin'")).rows[0].n;
  var vinSearches = 8;   // r1, rv, rvl, rx, rc, rdv, rnew, rn — the calls above that carried a valid VIN
  ok(auditAfter - auditBefore === vinSearches, 'each VIN search was audited once (' + (auditAfter - auditBefore) + ' rows for ' + vinSearches + ' searches)');
  var last = (await db.query("SELECT change_summary FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin' ORDER BY id DESC LIMIT 1")).rows[0].change_summary;
  ok(/vin_digest=[0-9a-f]+/.test(last) && last.indexOf(VX) === -1, 'the audit row holds a digest, not the VIN');
  var t = await match({ plate: PA, vin: VA }, RESOLVER);
  ok(t.status === 200 && t.body.outcome === 'existing' && t.body.identifiers.some(function (i) { return i.kind === 'vin' && i.reason === 'not_permitted'; }) && t.body.candidates[0].vin_check === 'not_checked',
    'without vin:search the VIN is not used (not_permitted); the plate still matches');
  ok((await db.query("SELECT count(*)::int n FROM idauto_audit_log WHERE event_type = 'vehicle.search.vin'")).rows[0].n === auditAfter, 'and no VIN search is recorded');

  say('\n6. READ ONLY AND ACCESS');
  var after = await counts();
  ok(after.v === before.v && after.p === before.p && after.f === before.f, 'no vehicle, plate or fact was written by ' + (pass + fail) + ' checks of matching');
  ok((await request('POST', '/api/registration-documents/match', { body: { plate: PA } })).status === 401, 'anonymous → 401');
  ok((await match({ plate: PA }, READER)).status === 403, 'a credential without vehicle:resolve → 403');
  ok((await request('GET', '/api/registration-documents/match', { token: ADMIN })).status !== 200, 'GET is not a route');

  say('\n' + pass + ' passed, ' + fail + ' failed');
  server.close(); await db.closePool();
  process.exit(fail ? 1 : 0);
}

main().catch(function (err) { console.error('FATAL', err && err.stack || err); if (server) server.close(); process.exit(1); });
