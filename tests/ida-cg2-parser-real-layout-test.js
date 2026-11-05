#!/usr/bin/env node
'use strict';
// IDA-CG2 — the carte grise parser on the OCR output of a REAL card's layout (staging failure
// 2026-11-05: « Lecture terminée » over empty fields). No database, no OCR engine.
//
// The owner's real card, read with Tesseract fra+ara, produced lines in which French and Arabic
// labels of two columns share one line, labels sit in the MIDDLE of the line, invisible direction
// marks (U+200E/U+200F) wrap every Arabic run, some labels carry OCR typos, and holder data (name,
// CIN) is merged into lines with technical labels. The parser then accepted a label only within the
// first 4 characters of a line: every field was lost. The fixtures below reproduce those SHAPES
// with synthetic values (no real text, no real person).

var path = require('path');
var parser = require(path.join(__dirname, '..', 'reference', 'documents', 'registration-parser.js'));
var submissions = require(path.join(__dirname, '..', 'reference', 'documents', 'registration-submissions.js'));
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
var L = '‎', R = '‏';
function field(p, k) { return p.fields.filter(function (f) { return f.key === k; })[0] || null; }
function keys(p) { return p.fields.map(function (f) { return f.key; }).sort().join(','); }

console.log('1. THE STAGING FAILURE, REPRODUCED (labels mid-line, Arabic first, direction marks)');
var face2 = [
  'NOMBRE DE PLACES 05 ' + R + 'عدد المقاعد' + L + ' PTAC 1550',
  'CARROSSERIE CI ' + R + 'هيكل السيارة' + L + ' ENERGIE ESSENCE ' + R + 'مصدر الطاقة' + L,
  R + 'القوة الجبائية' + L + ' 6 LE CV PUISSANCE FISCALE 6',
  'CYLlNDRFE 1199 ' + R + 'السعة' + L,
  'AGENCE TECHNIQUE DES TRANSPORTS TERRESTRES N° DU CERTIFICAT 123456 DATE 2019/03/12'
].join('\n');
var p2 = parser.parseFace(face2, { source: 'face_2', confidence: 61 });
ok(field(p2, 'seats') && field(p2, 'seats').value === 5, 'seats read from « NOMBRE DE PLACES 05 » although an Arabic label and PTAC follow on the same line');
ok(field(p2, 'gross_weight_kg') && field(p2, 'gross_weight_kg').value === 1550, 'PTAC read from the MIDDLE of a line');
ok(field(p2, 'fuel') && field(p2, 'fuel').value === 'petrol', 'énergie read after « CARROSSERIE CI » (a heading that ends the previous value), Arabic label stripped');
ok(field(p2, 'fiscal_power') && field(p2, 'fiscal_power').value === 6, 'puissance fiscale read at the END of a line that starts in Arabic');
var cc = field(p2, 'engine_cc');
ok(cc && cc.value === 1199 && cc.confidence < field(p2, 'seats').confidence, 'cylindrée read through an OCR typo in its label (« CYLlNDRFE », 2 edits), at a lower confidence');
ok(!field(p2, 'registration'), '« N° DU CERTIFICAT » is never read as an immatriculation');
ok(!/[‎‏]/.test(JSON.stringify(p2.fields)), 'no direction mark left in any value');

console.log('\n2. FACE 1 — holder data merged into technical lines, VIN mid-line, a date in the type slot');
var face1 = [
  'REPUBLIQUE TUNISIENNE ' + R + 'الجمهورية التونسية' + L,
  'CERTIFICAT D\'IMMATRICULATION ' + R + 'شهادة تسجيل' + L,
  'NOM ET PRENOM SPECIMEN FICTIF CIN 00000000 GENRE VP',
  R + 'رقم الهيكل' + L + ' N° SERIE DU TYPE VF3ABCDEF12345678 ' + R + 'النوع' + L,
  'TYPE COMMERCIAL 2019/03/12 ' + R + 'الطراز' + L,
  'MARQUE PEUGEOT ' + R + 'الصانع' + L + ' GENRE VP'
].join('\n');
var p1 = parser.parseFace(face1, { source: 'face_1', confidence: 63 });
ok(field(p1, 'vin') && field(p1, 'vin').value === 'VF3ABCDEF12345678' && field(p1, 'vin').label === 'N° SERIE DU TYPE', 'VIN read from « N° SERIE DU TYPE » in the middle of a line, as a LABELLED field');
ok(!field(p1, 'type'), 'a date read into « TYPE COMMERCIAL » (next column) is refused, not proposed as the type');
ok(field(p1, 'manufacturer') && field(p1, 'manufacturer').value === 'PEUGEOT', 'marque read with an Arabic label and another label after it');
ok(!field(p1, 'registration'), 'the heading « CERTIFICAT D\'IMMATRICULATION » is never read as a plate');
ok(JSON.stringify(p1.fields).indexOf('SPECIMEN') === -1 && JSON.stringify(p1.fields).indexOf('00000000') === -1 && p1.dropped_lines >= 1, 'the holder line is dropped WHOLE, technical labels on it included (D5: privacy before completeness)');
ok(p1.fields.filter(function (f) { return f.key === 'genre'; }).length === 1, 'one proposal per field and face (a label repeated on two lines does not create a conflict)');

var twice = parser.parseFace(['POIDS TOTAL 1500 ' + R + 'الوزن' + L, 'PTAC 1550'].join('\n'), { source: 'face_2', confidence: 60 });
ok(twice.fields.filter(function (f) { return f.key === 'gross_weight_kg'; }).length === 1, 'two readings of one field on one face → ONE proposal (the more confident), not a false « faces disagree »');
var genre = parser.parseFace('GENRE VP ' + R + 'خاصة' + L + ' CARROSSERIE CI', { source: 'face_1' });
ok(field(genre, 'genre') && field(genre, 'genre').value === 'VP', 'the Arabic label of the next column is not glued to a Latin value (« VP », not « VP خاصة »)');

console.log('\n3. NOTHING IS INVENTED');
var garbage = parser.parseFace([R + 'ععععع ععععع' + L + ' aaa | 9 ;', '‎9 "9 9‏', 'NOM AA PRENOM', '|||'].join('\n'), { source: 'face_1', confidence: 33 });
ok(garbage.fields.length === 0, 'OCR noise gives NO field (never a guessed value)');
var empty = parser.parseFace('', { source: 'face_1' });
ok(empty.fields.length === 0, 'empty OCR text gives no field');
var noisyLabel = parser.parseFace('MARQUE ' + R + 'الصانع' + L + '\nTYPE', { source: 'face_1' });
ok(!field(noisyLabel, 'manufacturer') && !field(noisyLabel, 'type'), 'a label with no value next to it proposes nothing');

console.log('\n4. THE SIMPLE LAYOUT STILL READS (regression)');
var simple = parser.parseFace(['N° D\'IMMATRICULATION : 123 TU 4567', 'MARQUE : RENAULT', 'TYPE : CLIO', 'D.P.M.C : 05/07/2017', 'ENERGIE : DIESEL', 'N° DE SERIE : VF1ABCDEF12345678', 'CYLINDREE : 1461', 'NOMBRE DE PLACES : 5'].join('\n'), { source: 'face_1', confidence: 80 });
ok(keys(simple) === 'engine_cc,first_registration_date,fuel,manufacturer,registration,seats,type,vin,year', 'all nine fields of a « label : value » card (' + keys(simple) + ')');
ok(submissions.normalize('registration', field(simple, 'registration').value).ok && field(simple, 'type').value === 'CLIO', 'the values normalise as before');

var digitsType = parser.parseFace('TYPE COMMERCIAL 2008 ' + R + 'الطراز' + L, { source: 'face_1' });
ok(field(digitsType, 'type') && field(digitsType, 'type').value === '2008', 'a type made of digits only (« 2008 ») is kept — only a date is refused');

console.log('\n5. THE PAGE AND THE D7 TOOL READ THE SAME WAY');
var fs = require('fs');
var ui = fs.readFileSync(path.join(__dirname, '..', 'reference', 'atelier-carte-grise-ui.js'), 'utf8');
var tool = fs.readFileSync(path.join(__dirname, '..', 'ops', 'cg2-ocr-validate.js'), 'utf8');
ok(/passes: \['4', '11'\], edge: 2400, filter: 'grayscale\(1\) contrast\(1\.6\)'/.test(ui) && /ps=\["4","11"\]/.test(tool) && /2400\/Math\.max/.test(tool) && /grayscale\(1\) contrast\(1\.6\)/.test(tool),
  'page and ops/cg2-ocr-validate.js: same passes (psm 4 + 11), same 2400 px long edge, same grayscale + contrast');
ok(/quality === 'none'/.test(ui) && /Aucune information technique n\\'a pu être lue/.test(ui), 'the page warns when no technical field was read (never « terminée » alone)');

console.log('\nIDA-CG2 parser on the real layout: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
