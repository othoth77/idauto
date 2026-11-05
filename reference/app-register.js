'use strict';
/* IDauto — IDA-UI-3 — « Ajouter un véhicule »: manual registration from the carte grise.
 * The person types what the card says; nothing is read automatically (no OCR).
 * 1. POST /api/vehicles/register — vehicle + plate + VIN + owner, one transaction;
 * 2. PUT /api/vehicles/:ivid/registration-document/1 then /2 — the photos, private storage.
 * Every value placed with textContent; nothing stored in the browser. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var form = document.getElementById('register-form'), errors = document.getElementById('form-errors'), submit = document.getElementById('register-submit');
  var files = { 1: null, 2: null };
  var MAX_BYTES = 6 * 1024 * 1024, MAX_EDGE = 5000, MIN_EDGE = 400, TARGET_EDGE = 3000;

  C.sessionLine(null, '/atelier/vehicules/nouveau');

  // TU / RS plate inputs.
  Array.prototype.forEach.call(form.querySelectorAll('input[name=plate_type]'), function (r) {
    r.addEventListener('change', function () {
      var rs = form.plate_type.value === 'RS';
      form.querySelector('[data-plate-tu]').hidden = rs; form.querySelector('[data-plate-rs]').hidden = !rs;
    });
  });

  // ---- photos: checked, previewed, made uploadable (≤ 6 MB, 400–5000 px) ----------
  function faceMsg(f, text, bad) { var m = form.querySelector('[data-face-msg="' + f + '"]'); m.textContent = text || ''; m.className = bad ? 'ida-field-error' : 'ida-field-hint'; }
  async function prepare(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(t('Le fichier n\'est pas une image JPEG, PNG ou WebP.'));
    var bmp = await createImageBitmap(file).catch(function () { throw new Error(t('Cette image ne peut pas être lue : choisissez une autre photo.')); });
    if (Math.min(bmp.width, bmp.height) < MIN_EDGE) throw new Error(t('Photo trop petite pour être lisible (400 pixels au moins sur le petit côté).'));
    if (file.size <= MAX_BYTES && Math.max(bmp.width, bmp.height) <= MAX_EDGE) return { blob: file, width: bmp.width, height: bmp.height, original: file.size };
    // Too large for the private store: a faithful JPEG copy at 3000 px, the original size kept in the record.
    var s = TARGET_EDGE / Math.max(bmp.width, bmp.height), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.92); });
    if (!blob || blob.size > MAX_BYTES) throw new Error(t('Image trop volumineuse (6 Mo au plus).'));
    return { blob: blob, width: c.width, height: c.height, original: file.size };
  }
  Array.prototype.forEach.call(form.querySelectorAll('[data-file]'), function (input) {
    input.addEventListener('change', async function () {
      var f = input.getAttribute('data-file'), file = input.files && input.files[0];
      var box = form.querySelector('[data-preview="' + f + '"]');
      files[f] = null; clear(box); box.appendChild(el('span', { class: 'ida-muted' }, t('Aucune photo')));
      if (!file) return;
      try {
        var p = await prepare(file);
        files[f] = p; clear(box);
        box.appendChild(el('img', { src: URL.createObjectURL(p.blob), alt: t('Carte grise — face ' + f) }));
        faceMsg(f, p.width + '×' + p.height + ' px · ' + Math.round(p.blob.size / 1024) + ' Ko');
      } catch (e) { faceMsg(f, e.message, true); input.value = ''; }
    });
  });

  // ---- submit ----------------------------------------------------------------------
  function val(n) { var x = form.elements[n]; return x ? x.value.trim() : ''; }
  function showErrors(list) {
    clear(errors);
    if (!list.length) return;
    errors.appendChild(el('div', { class: 'ida-alert ida-alert--danger', role: 'alert' }, el('div', null, [el('p', { class: 'ida-alert-title' }, t('Le véhicule n\'a pas été enregistré')), el('ul', null, list.map(function (m) { return el('li', null, m); }))])));
    errors.scrollIntoView({ block: 'center' });
  }
  function mark(id, bad) { var n = document.getElementById(id); if (n) { if (bad) n.setAttribute('aria-invalid', 'true'); else n.removeAttribute('aria-invalid'); } }
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    ['f-plate-series', 'f-plate-number', 'f-plate-rs', 'f-vin', 'f-make', 'f-year'].forEach(function (i) { mark(i, false); });
    var rs = form.plate_type.value === 'RS';
    var plate = rs ? (val('plate_rs') ? { type: 'RS', number: val('plate_rs') } : null) : (val('plate_series') || val('plate_number') ? { type: 'TU', series: val('plate_series'), number: val('plate_number') } : null);
    var problems = [];
    if (!plate && !val('vin')) { problems.push(t('Indiquez l\'immatriculation ou le numéro de châssis.')); mark(rs ? 'f-plate-rs' : 'f-plate-series', true); mark('f-vin', true); }
    if (plate && !rs && (!/^\d{1,3}$/.test(plate.series) || !/^\d{1,4}$/.test(plate.number))) { problems.push(t('Immatriculation : série de 1 à 3 chiffres et numéro de 1 à 4 chiffres.')); mark('f-plate-series', true); mark('f-plate-number', true); }
    if (val('vin') && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(val('vin'))) { problems.push(t('Numéro de châssis : 17 caractères, sans I, O ni Q.')); mark('f-vin', true); }
    if (!val('make')) { problems.push(t('La marque est obligatoire.')); mark('f-make', true); }
    if (val('year') && !/^\d{4}$/.test(val('year'))) { problems.push(t('Année : 4 chiffres.')); mark('f-year', true); }
    if (files[2] && !files[1]) problems.push(t('Ajoutez la face 1 avant la face 2.'));
    if (problems.length) { showErrors(problems); return; }
    showErrors([]);
    var body = { plate: plate, vin: val('vin') || null, make: val('make'), model: val('model'), variant: val('variant'), year: val('year'), fuel_type: val('fuel_type') || null,
      engine_cc: val('engine_cc'), seats: val('seats'), gross_weight_kg: val('gross_weight_kg'), category_code: val('category_code'), body_type: val('body_type'), colour: val('colour'), engine_code: val('engine_code') };
    if (val('owner_full_name') || val('owner_phone')) body.owner = { full_name: val('owner_full_name'), phone: val('owner_phone'), email: val('owner_email'), address: val('owner_address') };
    submit.disabled = true; submit.textContent = t('Enregistrement…');
    var status = document.getElementById('page-status');
    try {
      var out = await C.send('POST', '/api/vehicles/register', body);
      var ref = encodeURIComponent(out.ivid), failed = [];
      for (var f = 1; f <= 2; f++) {
        if (!files[f]) continue;
        submit.textContent = t('Envoi de la face ' + f + '…');
        try {
          await C.send('PUT', '/api/vehicles/' + ref + '/registration-document/' + f, files[f].blob, { raw: true, headers: { 'Content-Type': files[f].blob.type || 'application/octet-stream', 'X-IDauto-Original-Bytes': String(files[f].original) } });
        } catch (err) { failed.push(t('Face ' + f) + ' : ' + C.errorText(err)); if (f === 1) break; }
      }
      if (failed.length) {
        clear(status); status.appendChild(el('div', { class: 'ida-alert ida-alert--warning', role: 'alert' }, el('div', null, [el('p', { class: 'ida-alert-title' }, t('Véhicule enregistré, mais une photo n\'a pas été jointe')),
          el('p', null, failed.join(' · ')), el('p', null, el('a', { href: '/atelier/vehicule?ref=' + ref }, t('Ouvrir le dossier pour la joindre à nouveau')))])));
        submit.disabled = false; submit.textContent = t('Enregistrer le véhicule'); return;
      }
      window.location.assign('/atelier/vehicule?ref=' + ref + '&created=1');
    } catch (err) {
      var d = err.body && err.body.details;
      if (d && d.reason === 'vehicle_already_registered') {
        showErrors([t(d.identifier === 'vin' ? 'Un véhicule avec ce numéro de châssis existe déjà dans IDauto.' : 'Un véhicule avec cette immatriculation existe déjà dans IDauto.')]);
        if (d.ivid) errors.firstChild.firstChild.appendChild(el('p', null, el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(d.ivid) }, t('Ouvrir son dossier'))));
      } else showErrors([C.errorText(err)]);
      submit.disabled = false; submit.textContent = t('Enregistrer le véhicule');
    }
  });
}());
