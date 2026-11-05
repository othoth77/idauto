'use strict';
/* IDauto — IDA-CG2 stage 4 — carte grise review page (/atelier/carte-grise).
 *
 * Talks only to /api/registration-submissions/* with the session cookie and the
 * X-IDauto-Session header. Every server value is placed with textContent.
 * Nothing is stored in the browser.
 *   - The ORIGINAL file is uploaded byte for byte (D4); a small thumbnail is made
 *     separately for the preview. The browser measures sharpness and reports it.
 *   - OCR (Tesseract fra+ara, vendored, same origin) runs on an in-memory copy;
 *     only its text is sent, bound to the image's hash; the server parses it and
 *     drops it (D1). The page never shows a VIN value — the operator reads it on
 *     the photo and confirms or types it.
 *   - Every confirmation, correction and decision is a server call the server
 *     validates and audits; the page decides nothing on its own.
 */
(function () {
  if (typeof document === 'undefined') return;
  var ENGINE = '/atelier/assets/tesseract/';
  var API = '/api/registration-submissions';
  var LABEL = { registration: 'Immatriculation', manufacturer: 'Marque', type: 'Type / modèle', genre: 'Genre', category_code: 'Catégorie', vin: 'Numéro de châssis (VIN)',
    first_registration_date: '1re mise en circulation', year: 'Année', fuel: 'Énergie', engine_cc: 'Cylindrée (cm³)', fiscal_power: 'Puissance fiscale', seats: 'Places', gross_weight_kg: 'Poids total (kg)', engine: 'Moteur' };
  var STATUS = { extracted: ['Lu — à vérifier', 'pending'], conflict: ['Les faces ne concordent pas', 'anomaly'], missing: ['Non lu', 'anomaly'], confirmed: ['Confirmé', 'verified'],
    corrected: ['Corrigé', 'verified'], unreadable: ['Illisible', 'neutral'], not_present: ['Absent de la carte', 'neutral'] };
  var SUB_STATUS = { draft: 'Brouillon', extracted: 'Lu', in_review: 'En vérification', needs_better_image: 'Photo à refaire', linked: 'Rattaché', created: 'Véhicule créé', rejected: 'Rejeté' };
  var PROBLEM = { face_1_missing: 'La face 1 manque.', face_2_missing: 'La face 2 manque.', same_image_both_faces: 'La même photo est utilisée pour les deux faces.' };
  var CHECK = { year_differs_from_first_registration_date: 'L\'année ne correspond pas à la date de 1re mise en circulation.', faces_disagree: 'Les deux faces donnent des valeurs différentes', parser_substituted_characters: 'Des caractères ont été remplacés à la lecture (O→0, I→1) : vérifiez sur la photo' };
  var REASON = { several_vehicles: 'plusieurs véhicules correspondent', only_weak_evidence: 'seule une ancienne plaque correspond', vin_differs_from_record: 'le VIN diffère de celui enregistré',
    current_plate_active_on_another_vehicle: 'cette plaque est active sur un autre véhicule', current_plate_not_on_record: 'la plaque de la carte n\'est pas encore enregistrée sur ce véhicule', no_usable_identifier: 'aucun identifiant utilisable' };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]); });
    [].concat(kids === undefined ? [] : kids).forEach(function (c) { if (c === null || c === undefined) return; n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function badge(text, tone) { return el('span', { class: 'ida-status ida-status--' + tone }, text); }
  function say(node, text, kind) { clear(node); if (text) node.appendChild(el('p', { class: kind === 'error' ? 'ida-alert ida-alert--danger' : kind === 'ok' ? 'ida-alert ida-alert--success' : 'ida-muted', role: kind === 'error' ? 'alert' : null }, text)); }
  var REASON_FR = { create_without_vin_requires_admin: 'Sans VIN vérifié, seul un administrateur peut créer le véhicule.',
    note_required_to_set_vin_aside: 'Indiquez pourquoi le VIN est illisible ou absent (au moins 5 caractères).',
    thumbnail_does_not_match_original: 'La miniature ne correspond pas à la photo originale.',
    resolution_too_low: 'Photo trop petite pour être lisible (au moins 600 pixels sur le petit côté) : reprenez-la plus près, carte à plat.',
    dimensions_too_large: 'Photo trop grande (plus de 10 000 pixels de côté) : utilisez la photo normale du téléphone.',
    empty_image: 'Le fichier est vide.',
    same_image_both_faces: 'La même photo est déjà utilisée pour l\'autre face : photographiez l\'autre côté de la carte.',
    ambiguous_match_requires_admin_acknowledgement: 'Rattachement ambigu : seul un administrateur peut le décider, après avoir coché la confirmation.',
    vehicle_already_known: 'Ce véhicule existe déjà dans IDauto : rattachez la carte au lieu de créer un véhicule.',
    vehicle_not_among_matches: 'Ce véhicule ne fait pas partie des résultats de la recherche : relancez la recherche.',
    not_ready_for_decision: 'Décision impossible : chaque information doit d\'abord être vérifiée.',
    stale_version: 'Le dossier a changé entre-temps : la page a été actualisée, recommencez l\'action.',
    ocr_for_another_image_version: 'La photo a changé pendant la lecture : relancez « Lire la carte ».' };
  function message(err) {
    var r = err && err.body && err.body.details && err.body.details.reason;
    if (r && REASON_FR[r]) return REASON_FR[r]; return (err && err.body && err.body.message_fr ? err.body.message_fr : 'La demande n\'a pas abouti.') + (err && err.body && err.body.details && err.body.details.reason ? ' (' + err.body.details.reason + ')' : ''); }

  async function call(method, path, body, raw, extraHeaders) {
    var headers = Object.assign({ 'X-IDauto-Session': '1', Accept: 'application/json' }, extraHeaders || {});
    if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    var r = await fetch(path, { method: method, credentials: 'same-origin', headers: headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error('login'); }
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw { status: r.status, body: data };
    return data;
  }
  async function blobUrl(path) { var r = await fetch(path, { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } }); if (!r.ok) throw new Error('image ' + r.status); return URL.createObjectURL(await r.blob()); }
  async function sha256(buf) { var h = await crypto.subtle.digest('SHA-256', buf); return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  var state = { ref: null, sub: null, match: null, previews: {} };
  function refFromUrl() { var m = /[?&]ref=(cgs_[0-9a-f]{24})/.exec(location.search); return m ? m[1] : null; }

  // ---- list ----
  async function loadList() {
    try {
      var d = await call('GET', API);
      var box = $('list'); clear(box);
      if (!d.submissions.length) { box.appendChild(el('p', { class: 'ida-empty' }, 'Aucune carte en cours.')); return; }
      box.appendChild(el('ul', { class: 'ida-cgr-list' }, d.submissions.map(function (s) {
        return el('li', null, [el('a', { href: '/atelier/carte-grise?ref=' + s.ref }, s.ref.slice(0, 12) + '…'), ' · ', SUB_STATUS[s.status] || s.status,
          ' · faces ' + (s.faces[1] ? '1' : '–') + '/' + (s.faces[2] ? '2' : '–'), s.vehicle ? ' · ' + s.vehicle.ivid : '']);
      })));
    } catch (e) { say($('list'), message(e), 'error'); }
  }
  $('single-sided').addEventListener('change', function () { $('single-reason').hidden = !this.checked; });
  $('new-submission').addEventListener('click', async function () {
    try {
      var single = $('single-sided').checked;
      var s = await call('POST', API, { two_sided: !single, single_sided_reason: single ? $('single-reason').value : undefined });
      history.pushState(null, '', '/atelier/carte-grise?ref=' + s.ref); await open(s.ref);
    } catch (e) { say($('status'), message(e), 'error'); }
  });

  // ---- one submission ----
  async function open(ref) {
    state.ref = ref; state.match = null; $('work').hidden = false;
    try { render(await call('GET', API + '/' + ref)); } catch (e) { say($('status'), message(e), 'error'); }
    loadList();
  }
  function closed() { return ['linked', 'created', 'rejected'].indexOf(state.sub.status) !== -1; }

  function render(sub) {
    state.sub = sub;
    $('sub-line').textContent = 'Dossier ' + sub.ref + ' · ' + (SUB_STATUS[sub.status] || sub.status) + (sub.two_sided ? '' : ' · une seule face (' + sub.single_sided_reason + ')') + ' · version ' + sub.version;
    [1, 2].forEach(function (f) { renderFace(f); });
    document.querySelector('.ida-cgr-face[data-face="2"]').hidden = !sub.two_sided;
    renderChecks(); renderFields(); renderDecision();
    $('run-ocr').disabled = closed() || !sub.faces[1] || (sub.two_sided && !sub.faces[2]);
    Array.prototype.forEach.call(document.querySelectorAll('[data-file]'), function (i) { i.disabled = closed(); });
  }
  async function renderFace(f) {
    var meta = state.sub.faces[f], box = document.querySelector('[data-preview="' + f + '"]'), st = document.querySelector('[data-face-status="' + f + '"]');
    if (!meta) { clear(box); box.appendChild(el('span', { class: 'ida-muted' }, 'Aucune photo')); st.textContent = state.sub.two_sided || f === 1 ? 'Requise.' : ''; return; }
    var q = meta.quality && meta.quality.client;
    st.textContent = 'Version ' + meta.version + ' · ' + meta.width + '×' + meta.height + ' px · ' + Math.round(meta.byte_size / 1024) + ' Ko (originale)' + (q && typeof q.blur_score === 'number' ? ' · netteté ' + Math.round(q.blur_score) + (q.blur_score < 60 ? ' — floue ?' : '') : '');
    var key = state.ref + ':' + f + ':' + meta.version;
    if (state.previews[f] && state.previews[f].key === key) return;
    try {
      var url = await blobUrl(API + '/' + state.ref + '/faces/' + f + '/image' + (meta.has_thumbnail ? '?variant=thumb' : ''));
      if (state.previews[f]) URL.revokeObjectURL(state.previews[f].url);
      state.previews[f] = { key: key, url: url };
      clear(box); box.appendChild(el('img', { src: url, alt: 'Carte grise — face ' + f + ', version ' + meta.version }));
    } catch (e) { clear(box); box.appendChild(el('span', { class: 'ida-muted' }, 'Aperçu indisponible')); }
  }

  // Sharpness: variance of a Laplacian on a 512 px grey copy (higher = sharper). Advisory only.
  function measure(bitmap) {
    var w = Math.min(512, bitmap.width), h = Math.round(bitmap.height * w / bitmap.width);
    var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d'); g.drawImage(bitmap, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, grey = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    var sum = 0, sum2 = 0, n = 0;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var k = y * w + x; var l = grey[k - w] + grey[k + w] + grey[k - 1] + grey[k + 1] - 4 * grey[k]; sum += l; sum2 += l * l; n++; }
    var mean = sum / n;
    return { blur_score: Math.round((sum2 / n - mean * mean) * 100) / 100, detection: 'none', rotation: 0 };
  }
  async function thumbnail(bitmap) {
    var w = Math.min(480, bitmap.width), h = Math.round(bitmap.height * w / bitmap.width);
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.7); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-file]'), function (input) {
    input.addEventListener('change', async function () {
      var f = +input.getAttribute('data-file'), file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      var msgs = $('face-messages');
      say(msgs, 'Envoi de la face ' + f + '…');
      try {
        var bitmap;
        try { bitmap = await createImageBitmap(file); } catch (e) { say(msgs, 'La face ' + f + ' ne peut pas être décodée : choisissez une photo JPEG, PNG ou WebP lisible.', 'error'); return; }
        var quality = measure(bitmap);
        var bytes = await file.arrayBuffer();   // the original, untouched
        var out = await call('PUT', API + '/' + state.ref + '/faces/' + f, bytes, true, { 'Content-Type': 'application/octet-stream', 'X-IDauto-Quality': JSON.stringify(quality) });
        var thumb = await thumbnail(bitmap);
        if (thumb) await call('PUT', API + '/' + state.ref + '/faces/' + f + '/thumbnail', thumb, true, { 'Content-Type': 'image/jpeg' }).catch(function () {});
        var warn = (out.warnings || []).map(function (w) { return w.code === 'image_already_submitted' ? 'Cette photo a déjà été envoyée dans un autre dossier (' + w.refs.join(', ') + ').' : w.code; });
        say(msgs, 'Face ' + f + ' enregistrée (version ' + out.version + ', originale).' + (quality.blur_score < 60 ? ' La photo semble floue : refaites-la si le texte est difficile à lire.' : '') + (warn.length ? ' ' + warn.join(' ') : ''), warn.length || quality.blur_score < 60 ? null : 'ok');
        render((await call('GET', API + '/' + state.ref)));
      } catch (e) { say(msgs, 'Face ' + f + ' : ' + message(e), 'error'); }
    });
  });

  // ---- OCR ----
  var worker = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function engine() {
    if (worker) return worker;
    if (!window.Tesseract) await loadScript(ENGINE + 'tesseract.min.js');
    worker = await window.Tesseract.createWorker('fra+ara', 1, { workerPath: ENGINE + 'worker.min.js', corePath: ENGINE, langPath: ENGINE, workerBlobURL: false, gzip: true });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return worker;
  }
  $('run-ocr').addEventListener('click', async function () {
    var btn = this; btn.disabled = true;
    try {
      $('ocr-status').textContent = 'Chargement du lecteur…';
      var w = await engine(), faces = [];
      var list = state.sub.two_sided ? [1, 2] : [1];
      for (var i = 0; i < list.length; i++) {
        var f = list[i], meta = state.sub.faces[f];
        $('ocr-status').textContent = 'Lecture de la face ' + f + '…';
        // The archive (original) is fetched and read in memory; nothing is kept.
        var r = await fetch(API + '/' + state.ref + '/faces/' + f + '/image', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
        var bitmap = await createImageBitmap(await r.blob());
        var edge = Math.min(1800, Math.max(bitmap.width, bitmap.height)), s = edge / Math.max(bitmap.width, bitmap.height);
        var c = document.createElement('canvas'); c.width = Math.round(bitmap.width * s); c.height = Math.round(bitmap.height * s); c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
        var res = await w.recognize(c);
        faces.push({ face: f, image_sha256: meta.sha256, text: res.data.text, confidence: res.data.confidence });
      }
      $('ocr-status').textContent = 'Analyse…';
      var out = await call('POST', API + '/' + state.ref + '/extraction', { faces: faces });
      faces = null;
      $('ocr-status').textContent = 'Lecture terminée : vérifiez chaque ligne.';
      render(out.submission);
    } catch (e) { $('ocr-status').textContent = 'Lecture impossible : ' + message(e); }
    finally { btn.disabled = closed(); }
  });

  // ---- review ----
  function renderChecks() {
    var a = state.sub.assessment, box = $('checks'); clear(box);
    var items = a.problems.map(function (p) { return PROBLEM[p.code] || p.code; })
      .concat(a.checks.map(function (c) { return (CHECK[c.code] || c.code) + (c.key ? ' : ' + (LABEL[c.key] || c.key) : ''); }));
    if (a.unreviewed.length) items.push('À vérifier : ' + a.unreviewed.map(function (k) { return LABEL[k] || k; }).join(', ') + '.');
    if (!a.identifier_settled && state.sub.fields.length) items.push('Confirmez au moins l\'immatriculation ou le numéro de châssis.');
    if (items.length) box.appendChild(el('ul', { class: 'ida-cgr-checks' }, items.map(function (t) { return el('li', null, t); })));
    else if (state.sub.fields.length) box.appendChild(el('p', { class: 'ida-alert ida-alert--success' }, 'Toutes les informations sont vérifiées.'));
  }
  async function review(key, action, value, note) {
    try { render(await call('POST', API + '/' + state.ref + '/review', { expected_version: state.sub.version, actions: [{ key: key, action: action, value: value, note: note }] })); }
    catch (e) { say($('status'), (LABEL[key] || key) + ' : ' + message(e), 'error'); if (e && e.status === 409) render(await call('GET', API + '/' + state.ref)); }
  }
  function renderFields() {
    var box = $('fields'); clear(box);
    if (!state.sub.fields.length) { box.appendChild(el('p', { class: 'ida-empty' }, 'Pas encore lu.')); return; }
    var rows = state.sub.fields.map(function (f) {
      var st = STATUS[f.status] || [f.status, 'neutral'];
      var shown = f.key === 'vin' ? (f.value_present ? 'présent — lisez-le sur la photo' : '—') : (f.value === null || f.value === undefined ? '—' : f.value);
      var extra = [];
      if (f.raw && f.raw !== f.value && f.key !== 'vin') extra.push(el('span', { class: 'ida-caption ida-u-block' }, 'lu : ' + f.raw));
      if (f.corrected_by_parser) extra.push(el('span', { class: 'ida-caption ida-u-block' }, 'caractères remplacés à la lecture'));
      if (f.status === 'conflict' && f.note) { try { var n = JSON.parse(f.note); extra.push(el('span', { class: 'ida-caption ida-u-block' }, (n.proposals || []).map(function (p) { return 'face ' + p.face + (p.value ? ' : ' + p.value : ''); }).join(' · '))); } catch (e) {} }
      var input = el('input', { class: 'ida-input ida-cgr-correct', 'aria-label': 'Corriger ' + (LABEL[f.key] || f.key), placeholder: f.key === 'vin' ? 'VIN lu sur la photo' : 'valeur correcte', maxlength: '80' });
      var ctl = closed() ? [] : [
        el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', 'data-action': 'confirm', disabled: !(f.value_present || (f.value !== null && f.value !== undefined)) || ['extracted', 'confirmed', 'corrected'].indexOf(f.status) === -1 }, 'Confirmer'),
        input, el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-action': 'correct' }, 'Corriger'),
        el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-action': 'unreadable' }, 'Illisible'),
        el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-action': 'not_present' }, 'Absent')];
      var tr = el('tr', { 'data-key': f.key }, [
        el('th', { scope: 'row' }, LABEL[f.key] || f.key),
        el('td', null, [el('bdi', null, String(shown))].concat(extra)),
        el('td', null, f.source ? 'face ' + f.source.face + ' (v' + f.source.version + ')' + (f.source.line !== null ? ', ligne ' + (f.source.line + 1) : '') : (f.method === 'operator' ? 'saisie' : '—')),
        el('td', null, typeof f.confidence === 'number' ? Math.round(f.confidence * 100) + ' %' : '—'),
        el('td', null, badge(st[0], st[1])),
        el('td', { class: 'ida-cgr-controls' }, ctl)
      ]);
      tr.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-action]'); if (!b) return;
        var a = b.getAttribute('data-action');
        if (a === 'correct') { if (!input.value.trim()) { input.focus(); return; } review(f.key, 'correct', input.value.trim()); }
        else if (f.key === 'vin') {
          // Setting the VIN aside skips the strongest identity check: the server requires a reason.
          var why = window.prompt(a === 'unreadable' ? 'Pourquoi le VIN est-il illisible ? (au moins 5 caractères)' : 'Pourquoi le VIN est-il absent de la carte ? (au moins 5 caractères)');
          if (why === null) return;
          review(f.key, a, undefined, why.trim());
        }
        else review(f.key, a);
      });
      return tr;
    });
    box.appendChild(el('table', { class: 'ida-table' }, [el('caption', { class: 'ida-sr-only' }, 'Informations lues sur la carte'),
      el('thead', null, el('tr', null, ['Information', 'Valeur', 'Source', 'Confiance', 'État', 'Action'].map(function (h) { return el('th', { scope: 'col' }, h); }))), el('tbody', null, rows)]));
  }

  // ---- match + decision ----
  $('run-match').addEventListener('click', async function () {
    try { state.match = await call('POST', API + '/' + state.ref + '/match', {}); renderDecision(); }
    catch (e) { say($('match'), message(e), 'error'); }
  });
  function renderDecision() {
    var box = $('match'), dec = $('decision'); clear(box); clear(dec);
    var s = state.sub;
    if (closed()) {
      dec.appendChild(el('p', { class: s.status === 'rejected' ? 'ida-alert ida-alert--danger' : 'ida-alert ida-alert--success' }, (SUB_STATUS[s.status] || s.status) + (s.vehicle ? ' : ' + s.vehicle.ivid : '') + (s.decision_reason ? ' — ' + s.decision_reason : '')));
      if (s.vehicle) dec.appendChild(el('p', null, el('a', { href: '/admin/vehicle?ref=' + encodeURIComponent(s.vehicle.ivid) }, 'Ouvrir le dossier du véhicule')));
      var ch = Object.keys(s.applied_changes || {}), di = Object.keys(s.discrepancies || {});
      if (ch.length) dec.appendChild(el('p', { class: 'ida-small' }, 'Complété sur le véhicule : ' + ch.join(', ')));
      if (di.length) dec.appendChild(el('p', { class: 'ida-small' }, 'Différences non appliquées : ' + di.join(', ') + '.'));
      return;
    }
    if (!state.match) { box.appendChild(el('p', { class: 'ida-muted' }, 'Lancez la recherche une fois l\'immatriculation ou le VIN vérifié.')); }
    else {
      var r = state.match.result;
      box.appendChild(el('p', null, [badge(r.outcome === 'existing' ? 'Véhicule trouvé' : r.outcome === 'ambiguous' ? 'Ambigu — à décider' : 'Aucun véhicule', r.outcome === 'existing' ? 'verified' : r.outcome === 'ambiguous' ? 'anomaly' : 'neutral'),
        r.reasons.length ? ' ' + r.reasons.map(function (x) { return REASON[x] || x; }).join(' ; ') : '']));
      // An ambiguous match is never acknowledged by an ordinary click: the person ticks an explicit
      // confirmation first (the server still requires an administrator).
      var ack = null, linkButtons = [];
      if (r.outcome === 'ambiguous') {
        ack = el('input', { type: 'checkbox', id: 'cgr-ack-ambiguity' });
        ack.addEventListener('change', function () { linkButtons.forEach(function (x) { x.disabled = !s.assessment.ready_for_decision || !ack.checked; }); });
        box.appendChild(el('p', { class: 'ida-cgr-ack' }, [ack, ' ', el('label', { for: 'cgr-ack-ambiguity' }, 'J\'ai comparé la carte et le dossier : je confirme le véhicule choisi malgré l\'ambiguïté (administrateur).')]));
      }
      r.candidates.forEach(function (c) {
        var b = el('button', { type: 'button', class: 'ida-btn ida-btn--primary ida-btn--sm', disabled: !s.assessment.ready_for_decision || !!ack }, 'Rattacher à ce véhicule');
        linkButtons.push(b);
        b.addEventListener('click', function () { decide({ action: 'link', vehicle_ref: c.ivid, acknowledge_ambiguity: ack && ack.checked ? true : undefined }); });
        box.appendChild(el('div', { class: 'ida-card ida-cgr-candidate' }, [el('p', null, [el('code', { class: 'ida-id' }, c.ivid), ' · ', [c.make, c.model, c.year].filter(Boolean).join(' ') || '—']),
          el('p', { class: 'ida-small' }, 'Plaques : ' + (c.active_plates.join(', ') || '—') + ' · VIN : ' + ({ match: 'concorde', differs: 'DIFFÉRENT', none_on_record: 'aucun enregistré', not_checked: 'non vérifié' }[c.vin_check] || c.vin_check)),
          el('p', { class: 'ida-small' }, 'Preuves : ' + c.evidence.map(function (e) { return e.identifier + (e.plate ? ' ' + e.plate : '') + (e.plate_status && e.plate_status !== 'active' ? ' (' + e.plate_status + ')' : ''); }).join(' ; ')), b]));
      });
      if (r.outcome === 'none') {
        var cb = el('button', { type: 'button', class: 'ida-btn ida-btn--primary', disabled: !s.assessment.ready_for_decision }, 'Créer le véhicule');
        cb.addEventListener('click', function () { decide({ action: 'create' }); });
        box.appendChild(cb);
      }
      if (r.outcome === 'ambiguous') box.appendChild(el('p', { class: 'ida-small' }, 'Un rattachement ambigu ne peut être décidé que par un administrateur.'));
    }
    if (!s.assessment.ready_for_decision) dec.appendChild(el('p', { class: 'ida-muted' }, 'Décision possible quand les deux faces sont présentes et que chaque information est vérifiée.'));
  }
  async function decide(body) {
    try { var out = await call('POST', API + '/' + state.ref + '/decision', Object.assign({ expected_version: state.sub.version }, body)); render(out.submission); say($('status'), out.decision === 'create' ? 'Véhicule créé : ' + out.ivid : out.decision === 'reject' ? 'Document rejeté.' : 'Carte rattachée à ' + out.ivid, 'ok'); loadList(); }
    catch (e) { say($('status'), message(e), 'error'); if (e && e.status === 409) { try { render(await call('GET', API + '/' + state.ref)); } catch (x) {} } }
  }
  $('request-better').addEventListener('click', async function () {
    try { render(await call('POST', API + '/' + state.ref + '/request-image', { face: +$('better-face').value, reason: $('better-reason').value })); say($('status'), 'Photo à refaire : remplacez la face indiquée.', 'ok'); }
    catch (e) { say($('status'), message(e), 'error'); }
  });
  $('reject').addEventListener('click', async function () { await decide({ action: 'reject', reason: $('reject-reason').value }); });

  window.addEventListener('popstate', function () { var r = refFromUrl(); if (r) open(r); else { $('work').hidden = true; loadList(); } });
  (async function start() {
    try {
      var r = await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      var me = r.ok ? await r.json() : null;
      if (!me || !me.user) { location.replace('/login?next=' + encodeURIComponent('/atelier/carte-grise')); return; }
      $('session-line').textContent = 'Connecté : ' + me.user.name;
    } catch (e) { $('session-line').textContent = 'Session : vérification impossible.'; }
    var ref = refFromUrl();
    if (ref) open(ref); else loadList();
  }());
}());
