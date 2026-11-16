#!/usr/bin/env node
'use strict';
/* IDauto — Update 3 — vehicle photographs: EXIF, location priority, combining front and rear, offline
 * location, metadata cleaning, the extended vision answer, and static checks of pages, routes and migration.
 * Offline: no database, no camera, no network. Accuracy on real photographs is NOT established here
 * (docs/VEHICLE_PHOTOS.md §7). */
var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function say(m) { console.log(m); }
function read(p) { return fs.readFileSync(path.join(BASE, p), 'utf8'); }

var M = require(path.join(BASE, 'web', 'citizen', 'photo-meta.js'));
var geo = require(path.join(BASE, 'reference', 'photos', 'tn-geo.js'));
var clean = require(path.join(BASE, 'reference', 'photos', 'photo-clean.js'));
var vision = require(path.join(BASE, 'reference', 'recognition', 'vehicle-vision.js'));

/* A JPEG start with an EXIF block: GPS position and/or DateTimeOriginal, big- or little-endian. */
function exifJpeg(o) {
  var le = !!o.le;
  function u16(v) { var b = Buffer.alloc(2); le ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; }
  function u32(v) { var b = Buffer.alloc(4); le ? b.writeUInt32LE(v >>> 0) : b.writeUInt32BE(v >>> 0); return b; }
  function rat(v) { var d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 1000); return Buffer.concat([u32(d), u32(1), u32(m), u32(1), u32(s), u32(1000)]); }
  function entry(tag, type, count, val) { return Buffer.concat([u16(tag), u16(type), u32(count), val]); }
  function asc(s) { var b = Buffer.alloc(4); b.write(s, 'ascii'); return b; }
  var hasGps = typeof o.lat === 'number', hasDate = !!o.date, n0 = (hasGps ? 1 : 0) + (hasDate ? 1 : 0);
  var ifd0 = 8, ifd0Len = 2 + n0 * 12 + 4, exifIfd = ifd0 + ifd0Len, exifLen = hasDate ? 2 + 12 + 4 + 20 : 0, gpsIfd = exifIfd + exifLen, gpsLen = 2 + 4 * 12 + 4, latAt = gpsIfd + gpsLen, lonAt = latAt + 24;
  var parts = [Buffer.from(le ? 'II' : 'MM'), u16(42), u32(ifd0), u16(n0)];
  if (hasDate) parts.push(entry(0x8769, 4, 1, u32(exifIfd)));
  if (hasGps) parts.push(entry(0x8825, 4, 1, u32(gpsIfd)));
  parts.push(u32(0));
  if (hasDate) parts.push(u16(1), entry(0x9003, 2, 20, u32(exifIfd + 2 + 12 + 4)), u32(0), Buffer.from(o.date + '\0', 'ascii'));
  if (hasGps) parts.push(u16(4), entry(1, 2, 2, asc(o.latRef || (o.lat >= 0 ? 'N' : 'S'))), entry(2, 5, 3, u32(latAt)), entry(3, 2, 2, asc(o.lonRef || (o.lon >= 0 ? 'E' : 'W'))), entry(4, 5, 3, u32(lonAt)), u32(0), o.zeroDen ? Buffer.alloc(24) : rat(Math.abs(o.lat)), rat(Math.abs(o.lon)));
  var tiff = Buffer.concat(parts), lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(2 + 6 + tiff.length);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), lenBuf, Buffer.from('Exif\0\0', 'ascii'), tiff, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}

say('\n1. EXIF — the position and date written in the file, and nothing else');
var e = M.readExif(exifJpeg({ lat: 36.646, lon: 10.196, date: '2026:11:14 10:32:05' }));
ok(Math.abs(e.latitude - 36.646) < 1e-5 && Math.abs(e.longitude - 10.196) < 1e-5, 'GPS position read to the fifth decimal: ' + e.latitude + ', ' + e.longitude);
ok(e.capturedAt && new Date(e.capturedAt).getFullYear() === 2026 && new Date(e.capturedAt).getMinutes() === 32, 'capture date read: ' + e.capturedAt);
e = M.readExif(exifJpeg({ lat: 36.8065, lon: 10.1815, le: true }));
ok(Math.abs(e.latitude - 36.8065) < 1e-5 && e.capturedAt === null, 'little-endian file, position without a date: date stays null');
e = M.readExif(exifJpeg({ lat: -33.9249, lon: 18.4241 }));
ok(e.latitude < 0 && Math.abs(e.latitude + 33.9249) < 1e-4, 'southern latitude keeps its sign');
e = M.readExif(exifJpeg({ lat: 40.7128, lon: -74.006 }));
ok(e.longitude < 0, 'western longitude keeps its sign');
e = M.readExif(exifJpeg({ date: '2026:11:12 09:15:00' }));
ok(e.latitude === null && e.longitude === null && !!e.capturedAt && e.hasExif, 'a date without GPS: no position is invented');
ok(M.readExif(exifJpeg({ lat: 36.6, lon: 10.2, zeroDen: true })).latitude === null, 'a broken GPS value (zero denominator) gives no position, not a wrong one');
ok(M.readExif(exifJpeg({ lat: 0, lon: 0 })).latitude === null, '0,0 (a camera without a fix) is not a position');
ok(M.readExif(exifJpeg({ lat: 36.6, lon: 10.2, latRef: 'X' })).latitude === null, 'an unreadable hemisphere gives no position');
ok(M.readExif(exifJpeg({ date: '1970:01:01 00:00:00' })).capturedAt === null, 'a date before 2000 (an unset clock) is not kept');
var none = M.readExif(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9, 0, 0]));
ok(none.latitude === null && none.capturedAt === null && !none.hasExif, 'a JPEG without EXIF: everything unknown');
ok(M.readExif(Buffer.from('not an image at all')).latitude === null && M.readExif(null).latitude === null && M.readExif(new Uint8Array(3)).latitude === null, 'not a JPEG, empty or missing input: unknown, no exception');
var trunc = exifJpeg({ lat: 36.646, lon: 10.196, date: '2026:11:14 10:32:05' }).subarray(0, 60);
ok(M.readExif(trunc).latitude === null, 'a truncated EXIF block gives nothing rather than garbage');

say('\n2. WHICH LOCATION A PHOTOGRAPH GETS — EXIF, then the device (taken here, allowed), then nothing');
var live = { latitude: 36.8782, longitude: 10.3247 }, withGps = { latitude: 36.646, longitude: 10.196 }, noGps = { latitude: null, longitude: null };
ok(M.chooseLocation(withGps, live, true).source === 'exif' && M.chooseLocation(withGps, live, true).latitude === 36.646, 'EXIF wins over the device position, even for a photograph taken here');
ok(M.chooseLocation(noGps, live, true).source === 'browser', 'taken here, no EXIF, position allowed: the device position, marked « browser »');
ok(M.chooseLocation(noGps, null, true) === null, 'taken here, position refused: unknown');
ok(M.chooseLocation(noGps, live, false) === null, 'a file CHOSEN from the device never receives the device\'s current position');
ok(M.chooseLocation(null, null, false) === null, 'nothing known: unknown — never a guess');

say('\n3. FRONT AND REAR TOGETHER');
var rear = { view: 'rear', analysis: { plate: { serie: '173', numero: '8116', confidence: 95, source: 'ocr', accepted: true }, fields: { colour: { value: 'noir', confidence: 0.6, source: 'camera' } } } };
var front = { view: 'front', analysis: { plate: null, fields: { make: { value: 'Chevrolet', confidence: 0.9, source: 'vision' }, colour: { value: 'noir', confidence: 0.8, source: 'vision' } } } };
var c = M.combine([rear, front]);
ok(c.plate && c.plate.serie === '173' && c.plate.numero === '8116' && c.platePhotos === 1 && c.withoutPlate === 1, 'the plate comes from the rear view; a front view without a plate is not a failure');
ok(c.fields.make.value === 'Chevrolet' && c.fields.make.photo === 1, 'the make comes from the photograph that shows it');
ok(c.fields.colour.source === 'vision' && c.conflicts.length === 0, 'two photographs agreeing on the colour: one value (the vision one), no conflict');
var c2 = M.combine([rear, { view: 'front', analysis: { fields: { colour: { value: 'gris', confidence: 0.9, source: 'camera' } } } }]);
ok(c2.conflicts.length === 1 && c2.conflicts[0].field === 'colour' && c2.conflicts[0].values.length === 2, 'two photographs disagreeing on the colour: a conflict is returned, nothing is chosen silently');
var c3 = M.combine([rear, { view: 'rear', analysis: { plate: { serie: '173', numero: '8118', confidence: 80, source: 'ocr', accepted: false }, fields: {} } }]);
ok(c3.conflicts.some(function (x) { return x.field === 'plate'; }) && c3.plate.numero === '8116', 'two different plate readings: conflict flagged; the accepted, more confident one is proposed');
var c4 = M.combine([front]);
ok(c4.plate === null && c4.fields.make.value === 'Chevrolet', 'a front photograph alone: no plate, the other fields are still offered');
ok(M.combine([]).plate === null && M.combine(null).conflicts.length === 0 && M.combine([{ view: 'front', analysis: null }]).plate === null, 'no photograph, or none analysed: an empty result, no exception');
var c5 = M.combine([{ analysis: { fields: { make: { value: 'chevrolet', confidence: 0.7, source: 'vision' } } } }, { analysis: { fields: { make: { value: 'Chevrolet ', confidence: 0.9, source: 'vision' } } } }]);
ok(c5.conflicts.length === 0, 'the same value written differently (case, spaces) is not a conflict');

say('\n4. OFFLINE LOCATION — a place near, a governorate, or nothing; always marked approximate');
var r = geo.resolve(36.646, 10.196);
ok(r.place_name === 'Khelidia' && r.governorate === 'Ben Arous' && r.country === 'Tunisie' && r.approximate === true, 'Khelidia → Khelidia, Ben Arous, Tunisie (approximate)');
r = geo.resolve(36.8065, 10.1815); ok(r.place_name === 'Tunis' && r.governorate === 'Tunis', 'central Tunis → Tunis, Tunis');
r = geo.resolve(34.2, 9.3); ok(r.place_name === null && !!r.governorate && r.distance_km > geo.NEAR_KM, 'far from any listed place: a governorate only, no place name invented (' + r.governorate + ', ' + r.distance_km + ' km from its centre)');
r = geo.resolve(48.8566, 2.3522); ok(r.outside === true && r.governorate === null && r.country === null, 'outside Tunisia: no Tunisian name is given');
ok(geo.resolve(0, 0) === null && geo.resolve(NaN, 10) === null && geo.resolve(91, 10) === null && geo.resolve('36', 10) === null, 'impossible coordinates: null');
var govs = geo.governorates();
ok(govs.length === 24 && govs.every(function (g) { return g.delegations.length >= 5; }), 'the 24 governorates, each with its delegations, for manual entry');
ok(govs.filter(function (g) { return g.name === 'Ben Arous'; })[0].delegations.indexOf('Khelidia') !== -1 && govs.some(function (g) { return g.name === 'Tunis'; }), 'Khelidia is offered under Ben Arous; Tunis is a governorate');
ok(geo.governorateOf('ben arous') === 'Ben Arous' && geo.governorateOf('Atlantide') === null, 'a governorate is recognised whatever its case; an unknown name is not');
ok(geo.PLACES.every(function (p) { return geo.inTunisia(p[2], p[3]) && govs.some(function (g) { return g.name === p[1]; }); }), 'every listed place lies inside Tunisia and names a real governorate');
ok(!/fetch\(|https?:\/\/|require\('https?'\)/.test(read('reference/photos/tn-geo.js')), 'no network: coordinates never leave the server to be resolved');

say('\n5. WHAT IS KEPT OF A PHOTOGRAPH\'S METADATA');
var m = clean.photoMeta({ view: 'rear', captured_at: '2026-11-14T10:32:05Z', confirmed: true, hacked: 1,
  location: { source: 'exif', latitude: 36.646, longitude: 10.196 },
  analysis: { plate: { serie: '173', numero: '8116', confidence: 96.4, source: 'ocr', accepted: true }, fields: { make: { value: 'Chevrolet', confidence: 0.93, source: 'vision' }, colour: { value: '<b>noir', confidence: 3, source: 'camera' }, model: { value: 'X', confidence: 1, source: 'register' }, vin: { value: 'Y', source: 'vision' } } } });
ok(m.view === 'rear' && m.confirmed === true && !('hacked' in m) && m.location.source === 'exif' && m.location.latitude === 36.646, 'view, confirmation and an EXIF position are kept; stray keys are not');
ok(m.analysis.plate.text === '173 تونس 8116' && m.analysis.plate.format === 'TUN_STD' && m.analysis.plate.confidence === 96 && m.confidence === 0.96, 'the plate reading is rebuilt: digits, format, text, confidence');
ok(m.analysis.fields.make.source === 'vision' && !/[<>]/.test(m.analysis.fields.colour.value) && m.analysis.fields.colour.confidence === 1 && !m.analysis.fields.model && !m.analysis.fields.vin, 'each value keeps its source; markup is removed, confidence clamped, unknown sources and fields dropped');
ok(clean.location({ source: 'ip', latitude: 36.8, longitude: 10.1 }) === null && clean.location({ source: 'guess' }) === null, 'a location from an IP address or any unknown source is not a location');
ok(clean.location({ source: 'browser', latitude: 36.8 }) === null && clean.location({ source: 'exif', latitude: 95, longitude: 10 }) === null && clean.location({ source: 'exif', latitude: 0, longitude: 0 }) === null, 'GPS sources need real coordinates: missing, impossible or 0,0 → unknown');
var man = clean.location({ source: 'manual', latitude: 36.8, longitude: 10.1, place_name: 'Khelidia', governorate: 'ben arous' });
ok(man.source === 'manual' && man.latitude === null && man.longitude === null && man.place_name === 'Khelidia' && man.governorate === 'Ben Arous', 'a place typed by hand keeps NO coordinates, whatever was sent with it');
ok(clean.location({ source: 'manual' }) === null && clean.location(null) === null && clean.location('Tunis') === null, 'a manual location needs a place or a governorate; otherwise unknown');
ok(clean.capturedAt('2026-11-14T10:32:05Z') !== null && clean.capturedAt('2099-01-01') === null && clean.capturedAt('1995-01-01') === null && clean.capturedAt('hier') === null, 'a capture date must be a real date, not in the future, not before 2000');
var empty = clean.photoMeta(undefined);
ok(empty.view === 'unknown' && empty.location === null && empty.captured_at === null && empty.analysis === null && empty.confirmed === false && empty.confidence === null, 'nothing sent: view unknown, location unknown, date unknown — unknown is preserved, not filled in');
ok(clean.analysis({ plate: { serie: '12345', numero: '1', source: 'ocr' } }) === null && clean.analysis({ plate: { serie: '173', numero: '8116', source: 'camera' } }) === null, 'a plate that is not a Tunisian number, or with an impossible source, is not recorded');
var patch = clean.photoPatch({ view: 'front', location: null });
ok(patch.view === 'front' && patch.location === null && patch.captured_at === undefined && patch.confirmed === null, 'a correction changes only what it names; « location: null » means the location is unknown');
ok(clean.photoPatch({}).location === undefined && clean.photoPatch({ view: 'side' }).view === null, 'an empty correction changes nothing; an unknown view is ignored');

say('\n6. THE VISION ANSWER — view, version, year and the plate, never invented');
var full = { vehicle_visible: true, view: 'rear', make: 'Chevrolet', make_confidence: 0.94, model: 'Aveo', model_confidence: 0.85, trim: 'LS', trim_confidence: 0.8, colour: 'noir', colour_confidence: 0.96, body_type: 'berline', body_type_confidence: 0.9,
  year: 'unknown', year_confidence: 0.1, plate_visible: true, plate_first_digits: '173', plate_last_digits: '8116', plate_confidence: 0.97 };
var n = vision.normalise(full);
ok(n.view === 'rear' && n.fields.make.value === 'Chevrolet' && n.fields.model.value === 'Aveo' && n.fields.trim.value === 'LS' && n.fields.colour.value === 'noir' && n.fields.body_type.value === 'berline', 'a confident answer: rear · Chevrolet · Aveo · LS · noir · berline');
ok(n.plate && n.plate.serie === '173' && n.plate.numero === '8116' && n.plate.text === '173 تونس 8116' && n.plate.source === 'vision' && n.plate.confidence === 97, 'the plate as the model read it, marked source: vision');
ok(n.fields.year.value === null, 'year « unknown »: no year');
ok(Object.keys(n.fields).every(function (f) { return n.fields[f].source === 'vision'; }), 'every value is marked as named by the vision model — to be confirmed by the person');
n = vision.normalise(Object.assign({}, full, { view: 'front', plate_visible: false, plate_first_digits: '', plate_last_digits: '' }));
ok(n.view === 'front' && n.plate === null && n.fields.make.value === 'Chevrolet', 'a front view without a plate: no plate, the rest stands');
n = vision.normalise(Object.assign({}, full, { plate_confidence: 0.4 }));
ok(n.plate === null, 'a plate the model is not sure of is withheld');
n = vision.normalise(Object.assign({}, full, { plate_first_digits: '17A', plate_last_digits: '81160' }));
ok(n.plate === null, 'digits that do not have the shape of a Tunisian number are refused');
n = vision.normalise(Object.assign({}, full, { year: '2010', year_confidence: 0.9 }));
ok(n.fields.year.value === '2010', 'a year is kept only when given with confidence');
n = vision.normalise(Object.assign({}, full, { year: '2090', year_confidence: 0.9 }));
ok(n.fields.year.value === null, 'an impossible year is dropped');
n = vision.normalise(Object.assign({}, full, { model: 'unknown', model_confidence: 0.2 }));
ok(n.fields.model.value === null && n.fields.trim.value === null, 'no model → no version either: a trim alone means nothing');
n = vision.normalise(Object.assign({}, full, { vehicle_visible: false }));
ok(n.view === 'unknown' && n.plate === null && Object.keys(n.fields).every(function (f) { return n.fields[f].value === null; }), 'no vehicle in the photograph: everything unknown, whatever else was answered');
ok(/Never infer them, or anything else, from the registration number/.test(read('reference/recognition/vehicle-vision.js')) && vision.SCHEMA.required.indexOf('view') !== -1 && vision.SCHEMA.required.indexOf('plate_visible') !== -1, 'the model is told never to infer anything from the registration number, and must answer the view and whether a plate is visible');
ok(vision.config({}).enabled === false, 'still OFF unless configured');

say('\n7. PAGES, ROUTES AND MIGRATION');
var routes = read('reference/workspace-routes.js'), photosJs = read('reference/app-photos.js'), reg = read('reference/app-register.js'), regHtml = read('reference/app-register.html'), svc = read('reference/photos/photo-service.js'), repo = read('reference/workspace/workspace-repository.js');
var front2 = [photosJs, reg, regHtml, read('reference/app-dossier-photos.js'), read('reference/app-dossier.html'), read('reference/app-vehicles.js'), read('web/citizen/photo-meta.js')].join('\n');
ok(!/anthropic|api[_-]?key|sk-ant|x-api-key|IDAUTO_VISION/i.test(front2), 'no key, key name or provider name in any file served to the browser');
ok(/id="photo-take"/.test(regHtml) && /capture="environment"/.test(regHtml) && /id="photo-pick"/.test(regHtml) && /multiple/.test(regHtml), 'camera capture and image upload (several files) are both offered');
ok(/id="scan-open"/.test(regHtml) && /Scanner la plaque en vidéo/.test(regHtml), 'the plate-only video scanner stays available as a fallback');
ok(/Analyser cette photo/.test(photosJs) && /p\.status === 'ready' \? t\('Reprendre'\)/.test(photosJs), 'each photograph is previewed first: analyse it, or retake it');
ok(/getElementById\('photo-take-label'\)\.addEventListener\('click', function \(\) \{ livePosition = askPosition\(\); \}\)/.test(photosJs) && !/askPosition\(\)/.test(photosJs.replace(/photo-take-label[^\n]*\n/, '').replace(/function askPosition[\s\S]*?\n  \}\n/, '')), 'the device position is asked only when the person presses « Prendre une photo »');
var sharedJs = read('web/citizen/photo-analysis.js');
ok(/M\.chooseLocation\(exif, live, !!taken\)/.test(sharedJs) && /var live = taken && livePosition \? await livePosition : null;/.test(sharedJs) && /A\.prepare\(file, taken, livePosition\)/.test(photosJs), 'a chosen file is never given the device position (shared photo-analysis.js, used by this page)');
ok(!/C\.send\('POST', '\/api\/vehicles\/register'/.test(photosJs) && /uploadAll/.test(reg) && /if \(P && P\.count\(\)\)/.test(reg), 'analysing saves nothing; the photographs are stored only after the form is saved');
ok(/recog-add-photos/.test(reg) && /Ajouter ces photos à ce véhicule/.test(reg), 'an existing registration offers to add the photographs to that vehicle');
['GET', 'POST'].forEach(function (mth) { ok(new RegExp("method: '" + mth + "', pattern: /\\^\\\\/api\\\\/vehicles\\\\/\\[\\^/\\]\\+\\\\/photos\\$/, scope: 'document:" + (mth === 'GET' ? 'read' : 'write') + "'").test(routes), mth + ' /photos needs the document scope'); });
ok(/photos\\\/\\d\{1,18\}\$\/, scope: 'document:delete'/.test(routes) && /photos\\\/\\d\{1,18\}\\\/image\$\/, scope: 'document:read'/.test(routes), 'deleting needs document:delete; an image is served to accounts with document:read only');
ok(/'Cache-Control': 'private, no-store'/.test(routes.slice(routes.indexOf('async function getPhotoImage'))), 'photographs are served private, never cached by a shared cache');
ok(/d\.org_id = \$2/.test(svc) && /d\.org_id = \$3/.test(svc), 'a workshop reads and changes its own photographs only');
ok(/referencesOfKey\(stored\.key, 0\) === 0\) await storage\.remove/.test(svc) && /referencesOfKey\(row\.storage_key, 0\) === 0/.test(svc), 'a refused upload leaves no file; a deleted photograph\'s file goes only when nothing references it');
ok(/AND d\.document_type = 'carte_grise'/.test(repo) && /AS last_photo_location/.test(repo) && /ORDER BY p\.captured_at DESC NULLS LAST/.test(repo), 'the list counts carte grise faces apart, and reports the LATEST photograph\'s location');
ok(/'Lieu de la dernière photo'/.test(read('reference/app-vehicles.js')), 'the list column is named for what it is: the place of the latest photograph, not the vehicle\'s address');
var sql = read('database/migrations/ida-u3-vehicle-photos.sql'), livesql = sql.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
ok(/CREATE TABLE IF NOT EXISTS idauto_vehicle_photos/.test(livesql) && /CREATE INDEX IF NOT EXISTS/.test(livesql) && /DROP CONSTRAINT IF EXISTS chk_vdoc_type/.test(livesql), 'the migration is safe to apply twice');
ok(!/\b(UPDATE|DELETE FROM|DROP TABLE|DROP COLUMN|TRUNCATE|ALTER COLUMN)\b/.test(livesql), 'it changes no existing row and removes nothing');
ok(/document_type IN \('carte_grise', 'vehicle_photo'\)/.test(livesql) && /document_type = 'carte_grise' AND face IN \(1, 2\)/.test(livesql), 'the document checks are only widened: a carte grise still has faces 1 and 2');
ok(!/bytea/i.test(livesql), 'no image bytes in PostgreSQL: the table holds metadata, the file stays in the media store');
ok(/chk_vphoto_gps_src\s+CHECK \(latitude IS NULL OR \(location_source IS NOT NULL AND location_source IN \('exif', 'browser'\)\)\)/.test(livesql), 'the database itself refuses coordinates without a GPS source');
var cat = read('reference/i18n-catalog-ar.js');
['Photos du véhicule', 'Prendre une photo', 'Choisir une image', 'Avant', 'Arrière', 'Lieu inconnu', 'Corriger le lieu', 'Analyser cette photo', 'Ajouter ces photos à ce véhicule', 'Lieu de la dernière photo', 'position enregistrée dans la photo', 'lieu saisi à la main']
  .forEach(function (k) { ok(cat.indexOf(JSON.stringify(k) + ':') !== -1, 'Tunisian Arabic exists for « ' + k + ' »'); });

console.log('\nIDA-U3 vehicle photographs: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
