'use strict';
/* IDauto — Update 4 — the vehicle's archive in the administrator dossier (/admin/vehicle?ref=…).
 *
 *   Photos du véhicule   take or choose a photograph → POST /api/vehicles/:ref/photos (the EXISTING audited route; the
 *                        original file is sent as it is). Its place: the GPS written in the file (EXIF), else — only for a
 *                        photograph TAKEN here, and only if the person allows it — the device's position, else the place
 *                        typed by hand, else none. A refusal never blocks the photograph; an IP address is never a place.
 *   Carte grise          a recto / verso → PUT /api/vehicles/:ref/registration-document/:face (existing route): every
 *                        deposit is a NEW VERSION, the previous ones stay.
 *   History              GET /api/admin/vehicles/:ref/archive, newest first; « Ouvrir l'original » →
 *                        GET /api/admin/archive/:id/file. A photograph's date and place can be corrected
 *                        (PUT /api/vehicles/:ref/photos/:id, audited); the file never changes.
 */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole, M = window.IdaPhotoMeta, el = C.el, DASH = '—';
  var ref = (new URLSearchParams(window.location.search).get('ref') || '').trim().slice(0, 64);
  var root = document.querySelector('[data-archive-photos]');
  if (!ref || !root) return;
  var q = function (s) { return document.querySelector(s); };
  var SOURCE = { public_scanner: 'Scanner public', workshop: 'Atelier', admin: 'Administration' };
  var LOC = { exif: 'position enregistrée dans la photo', browser: "position de l'appareil à la prise de vue", manual: 'lieu saisi à la main' };
  var ARCH = { stored: 'archivée sur Haddad', pending: 'archivage en cours', failed: "archivage en échec — nouvel essai automatique", removed: 'supprimée' };
  var LENS = { succeeded: 'analyse LENS terminée', needs_review: 'analyse LENS à vérifier', failed: 'analyse LENS en échec', queued: 'analyse LENS en attente', deferred: 'analyse LENS différée (machine occupée)', running: 'analyse LENS en cours', not_configured: 'LENS non configuré', submit_failed: "envoi à LENS en échec" };
  var LENS_LABEL = { plate_tn: 'Immatriculation', vin: 'N° de série (VIN)', date_premiere_circulation: 'Première circulation', marque: 'Marque', type_commercial: 'Type commercial', genre: 'Genre', energie: 'Énergie', puissance_fiscale: 'Puissance fiscale', places_assises: 'Places assises' };

  function b64url(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function position() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var done = false, t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 12000);
      navigator.geolocation.getCurrentPosition(function (p) { if (done) return; done = true; clearTimeout(t); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }); },
        function () { if (done) return; done = true; clearTimeout(t); resolve(null); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    });
  }
  function place(it) {
    var l = it.location;
    if (!l) return DASH;
    var s = l.place_name || (typeof l.latitude === 'number' ? l.latitude.toFixed(5) + ', ' + l.longitude.toFixed(5) : '');
    return (s || DASH) + (l.source ? ' (' + (LOC[l.source] || l.source) + ')' : '');
  }
  // Private files are fetched with the session header (CSRF belt, auth/principal.js) and shown from a blob URL — a plain
  // link or <img src> cannot carry that header, exactly like the workshop dossier (app-dossier-photos.js).
  var blobs = Object.create(null);
  async function blobUrl(id) {
    if (blobs[id]) return blobs[id];
    var r = await fetch('/api/admin/archive/' + encodeURIComponent(id) + '/file', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (blobs[id] = URL.createObjectURL(await r.blob()));
  }
  function openLink(it) {
    var b = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-archive-open': it.id }, "Ouvrir l'original");
    b.addEventListener('click', async function () {
      var w = window.open('', '_blank');                         // opened on the click itself (pop-up rules), filled once the bytes arrive
      try { var u = await blobUrl(it.id); if (w) w.location.href = u; else window.location.href = u; }
      catch (e) { if (w) w.close(); b.textContent = "Ouverture impossible (" + e.message + ")"; }
    });
    return b;
  }
  function thumb(it) {
    var img = el('img', { alt: 'Photo du véhicule', class: 'ida-admin-thumb', width: '96', 'data-archive-thumb': it.id });
    blobUrl(it.id).then(function (u) { img.src = u; }, function () { img.alt = 'Aperçu indisponible'; });
    return img;
  }

  // ---- history ---------------------------------------------------------------------------------------------------
  async function load() {
    var d;
    try { d = await C.api('/api/admin/vehicles/' + encodeURIComponent(ref) + '/archive'); }
    catch (e) { q('[data-photo-history]').textContent = C.errorText ? C.errorText(e) : e.message; return; }
    var ph = C.clear(q('[data-photo-history]'));
    if (!d.photos.length) ph.appendChild(el('p', { class: 'ida-muted' }, 'Aucune photo archivée pour ce véhicule.'));
    else ph.appendChild(el('table', { class: 'ida-table', 'data-photo-table': '' }, [
      el('thead', null, el('tr', null, ['Photo', 'Prise le', 'Lieu', 'Reçue le', 'Source', 'Archive', ''].map(function (h) { return el('th', { scope: 'col' }, h); }))),
      el('tbody', null, d.photos.map(function (it) {
        return el('tr', { 'data-photo-row': it.id }, [
          el('td', null, it.mime_type && /^image\//.test(it.mime_type) ? thumb(it) : DASH),
          el('td', null, it.captured_at ? C.date(it.captured_at, true) : 'inconnue'),
          el('td', null, place(it)),
          el('td', null, C.date(it.uploaded_at, true)),
          el('td', null, (SOURCE[it.source] || it.source) + (it.uploaded_by ? ' · ' + it.uploaded_by : '')),
          el('td', null, [ARCH[it.archive.status] || it.archive.status, it.corrected ? el('span', { class: 'ida-caption ida-u-block' }, 'métadonnées corrigées le ' + C.date(it.corrected.at, true)) : null]),
          el('td', null, [openLink(it), it.document_id ? ' · ' : null, it.document_id ? correctButton(it) : null])
        ]);
      }))
    ]));
    await renderCg(d);
  }
  // Update 5 — the carte grise history from the one pipeline: every source (image, PDF, pasted text), every version,
  // how it was captured, its review (public deposits), its LENS processing and validation, its Haddad archive.
  var FORMAT = { CARTE_GRISE_IMAGE: 'Image', CARTE_GRISE_PDF: 'PDF', CARTE_GRISE_TEXT: 'Texte collé' };
  var METHOD = { camera: 'caméra', upload: 'fichier', paste_image: 'image collée', paste_text: 'texte collé', legacy: 'ancien dépôt' };
  var PROC = { PENDING_LENS: 'en attente de LENS', NONE: 'non soumis', PROCESSING: 'analyse en cours', DONE: 'analysé', FAILED: 'analyse en échec' };
  var VALID = { NOT_VALIDATED: 'non validé', VALIDATED: 'validé', CORRECTED: 'corrigé', REJECTED: 'rejeté' };
  var REVIEW = { accepted: null, pending_review: 'dépôt public — à vérifier', rejected: 'refusé' };
  async function fileButton(it, which, label) {
    var b = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-cg-open': which + ':' + it.id }, label);
    b.addEventListener('click', async function () {
      var w = window.open('', '_blank');
      try {
        var r = await fetch('/api/vehicles/' + encodeURIComponent(ref) + '/carte-grise/' + encodeURIComponent(it.id) + '/' + which, { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var u = URL.createObjectURL(await r.blob()); if (w) w.location.href = u; else window.location.href = u;
      } catch (e) { if (w) w.close(); b.textContent = 'Ouverture impossible (' + e.message + ')'; }
    });
    return b;
  }
  function reviewButtons(it) {
    if (it.review.status !== 'pending_review') return null;
    return ['accepted', 'rejected'].map(function (dec) {
      var b = el('button', { type: 'button', class: 'ida-btn ida-btn--sm ' + (dec === 'accepted' ? 'ida-btn--secondary' : 'ida-btn--ghost'), 'data-cg-review': dec + ':' + it.id }, dec === 'accepted' ? 'Accepter' : 'Refuser');
      b.addEventListener('click', async function () { b.disabled = true; try { await C.send('POST', '/api/carte-grise/' + encodeURIComponent(it.id) + '/review', { decision: dec }); await load(); } catch (e) { b.disabled = false; b.textContent = e.message; } });
      return b;
    });
  }
  async function renderCg(arch) {
    var cg = C.clear(q('[data-cg-history]')), h;
    try { h = await C.api('/api/vehicles/' + encodeURIComponent(ref) + '/carte-grise'); } catch (e) { cg.appendChild(el('p', { class: 'ida-field-error' }, e.message)); return; }
    var archOf = {}; (arch.carte_grise || []).forEach(function (a) { if (a.document_id) archOf[a.document_id] = a.archive; });
    if (!h.documents.length) { cg.appendChild(el('p', { class: 'ida-muted' }, 'Aucune carte grise pour ce véhicule.')); return; }
    var rows = [];
    for (var i = 0; i < h.documents.length; i++) {
      var it = h.documents[i], ar = archOf[it.id];
      var actions = [await fileButton(it, 'original', it.source_format === 'CARTE_GRISE_TEXT' ? 'Ouvrir le texte' : "Ouvrir l'original")];
      if (it.has_preview) actions.push(await fileButton(it, 'preview', 'Aperçu recadré'));
      rows.push(el('tr', { 'data-cg-row': it.id, 'data-cg-format': it.source_format, class: it.current ? null : 'ida-admin-superseded' }, [
        el('th', { scope: 'row' }, [FORMAT[it.source_format] + ' — ' + (it.face === 2 ? 'verso' : 'recto'), el('span', { class: 'ida-caption ida-u-block' }, (it.original_filename || '') + (it.text_chars ? it.text_chars + ' caractères' : '') + (it.byte_size ? ' · ' + Math.max(1, Math.round(it.byte_size / 1024)) + ' Ko' : '')),
          it.current ? el('span', { class: 'ida-status ida-status--verified' }, 'actuelle') : REVIEW[it.review.status] ? el('span', { class: 'ida-status ida-status--pending' }, REVIEW[it.review.status]) : el('span', { class: 'ida-caption ida-u-block' }, 'version remplacée')]),
        el('td', null, 'v' + it.version),
        el('td', null, METHOD[it.input_method] || it.input_method),
        el('td', null, [C.date(it.uploaded_at, true), el('span', { class: 'ida-caption ida-u-block' }, it.uploaded_by || '')]),
        el('td', { 'data-cg-processing': it.processing_status }, PROC[it.processing_status] || it.processing_status),
        el('td', { 'data-cg-validation': it.validation_status }, VALID[it.validation_status] || it.validation_status),
        el('td', null, ar ? (ARCH[ar.status] || ar.status) : '—'),
        el('td', null, actions.concat(reviewButtons(it) || []))
      ]));
    }
    cg.appendChild(el('table', { class: 'ida-table', 'data-cg-table': '' }, [
      el('thead', null, el('tr', null, ['Document', 'Version', 'Saisie', 'Déposé', 'Traitement', 'Validation', 'Archive', ''].map(function (x) { return el('th', { scope: 'col' }, x); }))),
      el('tbody', null, rows)]));
  }
  function lensCell(l) {
    if (!l || !l.status) return 'non soumise';
    var parts = [LENS[l.status] || ('LENS : ' + l.status)];
    if (Array.isArray(l.fields) && l.fields.length) parts.push(el('ul', { class: 'ida-caption' }, l.fields.map(function (f) { return el('li', null, (LENS_LABEL[f.key] || f.key) + ' : ' + (f.value || DASH) + (typeof f.confidence === 'number' ? ' (' + Math.round(f.confidence * 100) + ' %)' : '')); })));
    if (Array.isArray(l.fields) && l.fields.length) parts.push(el('span', { class: 'ida-caption ida-u-block' }, 'Proposition : rien n\'est enregistré sur le véhicule sans confirmation.'));
    return parts;
  }

  // ---- metadata correction (the file never changes) --------------------------------------------------------------
  function correctButton(it) {
    var b = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-photo-correct': it.id }, 'Corriger la date / le lieu');
    b.addEventListener('click', function () {
      var row = b.closest('tr'), box = el('div', { class: 'ida-cluster', 'data-correct-form': '' }), when = el('input', { type: 'datetime-local', class: 'ida-input ida-input--sm', 'aria-label': 'Date de prise de vue' }), where = el('input', { class: 'ida-input ida-input--sm', maxlength: '120', placeholder: 'Lieu', 'aria-label': 'Lieu' }), ok = el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm' }, 'Enregistrer');
      if (it.captured_at) when.value = new Date(new Date(it.captured_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      if (it.location && it.location.place_name) where.value = it.location.place_name;
      ok.addEventListener('click', async function () {
        var patch = {};
        if (when.value) patch.captured_at = new Date(when.value).toISOString();
        if (where.value.trim()) patch.location = { source: 'manual', place_name: where.value.trim() };
        ok.disabled = true;
        try { await C.send('PUT', '/api/vehicles/' + encodeURIComponent(ref) + '/photos/' + encodeURIComponent(it.document_id), patch); await load(); }
        catch (e) { ok.disabled = false; box.appendChild(el('span', { class: 'ida-field-error' }, e.message)); }
      });
      box.append(when, where, ok);
      row.lastChild.appendChild(box); b.remove();
    });
    return b;
  }

  // ---- uploads ---------------------------------------------------------------------------------------------------
  async function uploadPhoto(file, taken) {
    var st = q('[data-photo-status]');
    if (!file) return;
    st.textContent = 'Envoi de la photo…';
    var exif = { latitude: null, longitude: null, capturedAt: null };
    if (/jpe?g/i.test(file.type) && M) { try { exif = M.readExif(await file.arrayBuffer()); } catch (e) { /* no EXIF */ } }
    var live = taken ? await position() : null;                   // asked for a photograph taken here only; a refusal is null
    var loc = M ? M.chooseLocation(exif, live, taken) : null, typed = (q('[data-photo-place]').value || '').trim();
    if (!loc && typed) loc = { source: 'manual', place_name: typed };
    else if (loc && typed) loc.place_name = typed;
    var meta = { view: 'unknown', captured_at: exif.capturedAt || (taken ? new Date().toISOString() : null), location: loc };
    try {
      var out = await C.send('POST', '/api/vehicles/' + encodeURIComponent(ref) + '/photos', file, { raw: true, headers: { 'Content-Type': file.type || 'image/jpeg', 'X-IDauto-Photo-Meta': b64url(meta), 'X-IDauto-Filename': encodeURIComponent(file.name || '') } });
      st.textContent = out.duplicate ? 'Cette photo est déjà enregistrée pour ce véhicule.' : 'Photo enregistrée' + (loc ? '' : ' (sans lieu)') + '.';
      await load();
    } catch (e) { st.textContent = 'La photo n\'a pas été enregistrée : ' + e.message; }
  }
  function bind(sel, fn) { var i = q(sel); i.addEventListener('change', function () { var f = i.files && i.files[0]; i.value = ''; fn(f); }); }
  bind('[data-photo-take]', function (f) { uploadPhoto(f, true); });
  bind('[data-photo-pick]', function (f) { uploadPhoto(f, false); });
  var addBtn = q('[data-cg-add]');
  if (addBtn) addBtn.addEventListener('click', function () {
    if (window.IdaRegistrationScanner) { window.IdaRegistrationScanner.configure({ scanicUrl: '/assets/scanic.umd.js' }); var hostEl = document.querySelector('[data-cg-root]'); if (hostEl && !hostEl.firstChild) window.IdaRegistrationScanner.mount(hostEl); }
    window.IdaCarteGrise.open({ ivid: ref, mode: 'session', onDone: function () { load(); } });
  });
  window.IdaAdminArchive = { blobUrl: blobUrl, load: load, _uploadPhoto: uploadPhoto };
  load();
})();
