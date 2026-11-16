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
      form.querySelector('[data-plate-word]').textContent = rs ? 'RS' : 'TU';
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

  // ---- Update 2 — scan the vehicle: plate found and read on the device, vehicle seen by the server's vision ----
  // Nothing recognised is saved by itself: it is shown on a card, the person confirms or corrects, and only the
  // form's own fields are sent. `recognition` records what was proposed and by which engine (provenance).
  var recognition = null, lastScan = null;
  var S = window.IdaPlateScanner, scanRoot = document.querySelector('[data-scan-root]'), scanOpen = document.getElementById('scan-open');
  var card = document.getElementById('recog-card');
  var COLOUR_LABEL = { noir: 'Noir', blanc: 'Blanc', gris: 'Gris', argent: 'Argent', rouge: 'Rouge', bleu: 'Bleu', vert: 'Vert', jaune: 'Jaune', orange: 'Orange', marron: 'Marron', beige: 'Beige' };
  var BODY_LABEL = { berline: 'Berline', citadine: 'Citadine', 'break': 'Break', suv: 'SUV', monospace: 'Monospace', coupe: 'Coupé', cabriolet: 'Cabriolet', 'pick-up': 'Pick-up', utilitaire: 'Utilitaire' };
  function setText(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }
  function show(field, label, confText) { setText('recog-' + field, label || t('Non reconnu')); setText('recog-' + field + '-conf', confText || ''); }
  function pct(c) { return Math.round(c * 100) + ' %'; }
  function sourceText(f) { return f.source === 'vision' ? t('analyse d\'image') + ' · ' + pct(f.confidence) : t('estimation de la caméra') + ' · ' + pct(f.confidence); }
  function frameBlob(canvas) { return new Promise(function (res) { if (!canvas || !canvas.toBlob) return res(null); canvas.toBlob(res, 'image/jpeg', 0.85); }); }

  async function onScan(r) {
    lastScan = r; recognition = null;
    var canonical = r.serie + ' TUN ' + r.numero, fields = { make: null, model: null, colour: null, body_type: null }, analysis = null;
    card.hidden = false;
    var photo = document.getElementById('recog-photo'); clear(photo);
    if (r.frame) { r.frame.className = 'ida-recog-img'; r.frame.setAttribute('role', 'img'); r.frame.setAttribute('aria-label', t('Image capturée du véhicule')); photo.appendChild(r.frame); }
    // three parts kept in reading order (digits · word · digits): left as one string, the Arabic word would reorder the digits
    var plateBox = document.getElementById('recog-plate'); clear(plateBox);
    plateBox.appendChild(el('bdi', { dir: 'ltr', class: 'ida-id' }, r.plate.first)); plateBox.appendChild(document.createTextNode(' '));
    plateBox.appendChild(el('bdi', { dir: 'rtl', lang: 'ar', class: 'ida-recog-word' }, r.plate.text)); plateBox.appendChild(document.createTextNode(' '));
    plateBox.appendChild(el('bdi', { dir: 'ltr', class: 'ida-id' }, r.plate.last));
    setText('recog-plate-conf', r.auto ? t('lecture automatique') + ' · ' + Math.round(r.confidence) + ' %' : t('chiffres validés à la main'));
    ['make', 'model', 'colour', 'body'].forEach(function (f) { show(f, '…', ''); });
    setText('recog-note', t('Analyse du véhicule…'));
    document.getElementById('recog-existing').hidden = true;
    document.getElementById('recog-confirm').disabled = true;
    card.scrollIntoView({ block: 'start' });
    // colour seen by the camera, on the device (a hint; the vision answer replaces it when there is one)
    if (r.colour && r.colour.value && r.colour.value !== 'unknown') fields.colour = { value: r.colour.value, confidence: r.colour.confidence, source: 'camera' };
    // 1. does this registration already exist? (never a second vehicle for one plate)
    var existing = null;
    try {
      var found = await C.api('/api/search?q=' + encodeURIComponent(canonical));
      (found.groups || []).forEach(function (g) { if (g.key === 'vehicles') g.items.forEach(function (i) { if (i.plate === canonical) existing = i; }); });
    } catch (e) { /* the save itself refuses a duplicate: this check is a courtesy */ }
    // 2. what the vehicle looks like — only if the operator configured the analysis
    var blob = existing ? null : await frameBlob(r.frame);
    if (blob) {
      try {
        analysis = (await C.send('POST', '/api/workspace/vehicle-recognition', blob, { raw: true, headers: { 'Content-Type': 'image/jpeg' } })).vehicle_analysis;
        ['make', 'model', 'colour', 'body_type'].forEach(function (f) { var v = analysis.fields && analysis.fields[f]; if (v && v.value) fields[f] = v; });
      } catch (e) { analysis = null; }
    }
    if (lastScan !== r) return;                    // another scan started meanwhile
    show('make', fields.make && fields.make.value, fields.make ? sourceText(fields.make) : '');
    show('model', fields.model && fields.model.value, fields.model ? sourceText(fields.model) : '');
    show('colour', fields.colour ? t(COLOUR_LABEL[fields.colour.value] || fields.colour.value) : '', fields.colour ? sourceText(fields.colour) : '');
    show('body', fields.body_type ? t(BODY_LABEL[fields.body_type.value] || fields.body_type.value) : '', fields.body_type ? sourceText(fields.body_type) : '');
    setText('recog-note', existing ? '' : (analysis && analysis.enabled && !analysis.error
      ? t('Marque, modèle et carrosserie sont lus sur l\'image, pas dans un registre : vérifiez-les.')
      : analysis && analysis.error ? t('L\'analyse du véhicule n\'a pas abouti : complétez la marque et le modèle à la main.')
      : t('L\'analyse de la marque et du modèle n\'est pas activée sur ce serveur : complétez-les à la main.')));
    r.fields = fields; r.analysis = analysis; r.existing = existing;
    var ex = document.getElementById('recog-existing'); clear(ex);
    if (existing) {
      ex.hidden = false;
      ex.appendChild(el('div', { class: 'ida-alert ida-alert--warning', role: 'alert' }, el('div', null, [el('p', { class: 'ida-alert-title' }, t('Ce véhicule existe déjà dans IDauto')),
        el('p', null, existing.title || ''), el('p', null, el('a', { class: 'ida-btn ida-btn--primary ida-btn--sm', id: 'recog-open-existing', href: existing.href }, t('Ouvrir sa fiche')))])));
    }
    document.getElementById('recog-confirm').disabled = !!existing;
    document.getElementById('recog-correct').disabled = !!existing;
  }

  function applyScan(focusFirst) {
    var r = lastScan; if (!r || r.existing) return;
    form.querySelector('input[name=plate_type][value=TU]').checked = true; form.querySelector('[data-plate-word]').textContent = 'TU';
    form.plate_series.value = r.serie; form.plate_number.value = r.numero;
    var f = r.fields || {};
    // a value typed by hand before the scan is never overwritten
    if (f.make && !val('make')) form.make.value = f.make.value;
    if (f.model && !val('model')) form.model.value = f.model.value;
    if (f.colour && !val('colour')) form.colour.value = f.colour.value;
    if (f.body_type && !val('body_type')) form.body_type.value = f.body_type.value;
    recognition = { provider: r.analysis && r.analysis.enabled ? r.analysis.provider : null, model: r.analysis && r.analysis.enabled ? r.analysis.model : null,
      plate: { confidence: r.confidence, auto: !!r.auto }, fields: {} };
    ['make', 'model', 'colour', 'body_type'].forEach(function (k) { if (f[k]) recognition.fields[k] = { proposed: f[k].value, confidence: f[k].confidence, source: f[k].source }; });
    card.hidden = true;
    var status = document.getElementById('page-status'); clear(status);
    status.appendChild(el('p', { class: 'ida-alert ida-alert--info', id: 'recog-applied' }, focusFirst ? t('Valeurs reportées dans le formulaire : corrigez-les, puis enregistrez.') : t('Valeurs reportées dans le formulaire : vérifiez-les, puis enregistrez.')));
    (focusFirst ? document.getElementById('f-plate-series') : submit).focus();
    (focusFirst ? document.getElementById('sec-ident') : submit).scrollIntoView({ block: 'center' });
  }

  function openScanner() { S.open({ els: { root: scanRoot, video: scanRoot.querySelector('[data-scan-video]'), opener: scanOpen }, onPlate: function () {}, onResult: onScan }); }
  if (S && scanRoot && scanOpen && S.cameraSupported()) {
    S.configure({ engineBase: '/atelier/assets/tesseract/' });
    S.bind({ root: scanRoot, video: scanRoot.querySelector('[data-scan-video]'), opener: scanOpen });
    scanOpen.hidden = false;
    scanOpen.addEventListener('click', openScanner);
    document.getElementById('recog-confirm').addEventListener('click', function () { applyScan(false); });
    document.getElementById('recog-correct').addEventListener('click', function () { applyScan(true); });
    document.getElementById('recog-retry').addEventListener('click', function () { card.hidden = true; lastScan = null; openScanner(); });
    C.api('/api/workspace/vehicle-recognition').then(function (o) {
      setText('scan-privacy', o.vehicle_analysis && o.vehicle_analysis.enabled
        ? t('Une image du véhicule est ensuite envoyée au service d\'analyse configuré par l\'atelier, pour proposer la marque et le modèle.')
        : t('Aucune image ne quitte l\'appareil.'));
    }).catch(function () {});
  }

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
    ['f-plate-series', 'f-plate-number', 'f-vin', 'f-year', 'f-km'].forEach(function (i) { mark(i, false); });
    var rs = form.plate_type.value === 'RS';
    // TU and RS plates have the same shape: series, type word, number (« 123 RS 4567 »).
    var plate = val('plate_series') || val('plate_number') ? { type: rs ? 'RS' : 'TU', series: val('plate_series'), number: val('plate_number') } : null;
    var problems = [];
    if (!plate) { problems.push(t('L\'immatriculation est obligatoire.')); mark('f-plate-series', true); mark('f-plate-number', true); }
    if (plate && (!/^\d{1,3}$/.test(plate.series) || !/^\d{1,4}$/.test(plate.number))) { problems.push(t('Immatriculation : série de 1 à 3 chiffres et numéro de 1 à 4 chiffres.')); mark('f-plate-series', true); mark('f-plate-number', true); }
    if (val('vin') && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(val('vin'))) { problems.push(t('Numéro de châssis : 17 caractères, sans I, O ni Q.')); mark('f-vin', true); }
    var km = val('odometer_km').replace(/[\s.]/g, '');
    if (km && !/^\d{1,7}$/.test(km)) { problems.push(t('Kilométrage : un nombre de kilomètres.')); mark('f-km', true); }
    if (val('year') && !/^\d{4}$/.test(val('year'))) { problems.push(t('Année : 4 chiffres.')); mark('f-year', true); }
    if (files[2] && !files[1]) problems.push(t('Ajoutez la face 1 avant la face 2.'));
    if (problems.length) { showErrors(problems); return; }
    showErrors([]);
    var body = { plate: plate, vin: val('vin') || null, make: val('make'), model: val('model'), year: val('year'), colour: val('colour'), body_type: val('body_type'), odometer_km: km, notes: form.notes.value };
    if (recognition) body.recognition = recognition;
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
