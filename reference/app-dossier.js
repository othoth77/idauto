'use strict';
/* IDauto — IDA-UI-3 — the vehicle dossier (/atelier/vehicule?ref=…, also /admin/vehicle).
 * GET /api/vehicles/:ref/dossier — identity, plates, carte grise, maintenance history,
 * filtered by the server for this account (own workshop; admin: every workshop).
 * The owner's contact is a SEPARATE, audited read (GET …/owner), made only when the person
 * asks to see it. Images come from the private store as blobs. Every value is textContent. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, I = window.IdAutoI18n || { t: function (s) { return s; } }, t = I.t;
  var root = document.getElementById('dossier'), status = document.getElementById('page-status');
  var params = new URLSearchParams(location.search), REF = params.get('ref') || '';
  var data = null;
  function enc(v) { return encodeURIComponent(v); }
  function say(kind, text) { clear(status); if (text) status.appendChild(el('p', { class: 'ida-alert ida-alert--' + kind, role: kind === 'danger' ? 'alert' : null }, text)); }
  function kv(rows) { return el('dl', { class: 'ida-kv' }, rows.filter(function (r) { return r; }).reduce(function (a, r) { a.push(el('dt', null, r[0]), el('dd', null, r[1])); return a; }, [])); }
  function section(id, title, actions, body) {
    return el('section', { class: 'ida-card ida-stack', 'aria-labelledby': id, id: id + '-box' }, [el('div', { class: 'ida-section-head' }, [el('h2', { id: id }, title), actions ? el('div', { class: 'ida-page-actions' }, actions) : null]), body]);
  }
  function confirmAction(text) {
    var d = document.getElementById('confirm-dialog'); document.getElementById('confirm-text').textContent = text;
    return new Promise(function (res) { d.returnValue = ''; d.showModal(); d.addEventListener('close', function h() { d.removeEventListener('close', h); res(d.returnValue === 'yes'); }); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('dialog [data-close]'), function (b) { b.addEventListener('click', function () { b.closest('dialog').close(''); }); });

  async function load() {
    if (!REF) { root.setAttribute('aria-busy', 'false'); C.state(root, 'error', t('Aucun véhicule indiqué.')); return; }
    try { data = await C.api('/api/vehicles/' + enc(REF) + '/dossier'); }
    catch (e) { root.setAttribute('aria-busy', 'false'); C.state(root, 'error', e.status === 404 ? t('Ce véhicule n\'existe pas dans IDauto.') : C.errorText(e)); return; }
    render();
  }

  function render() {
    var v = data.vehicle;
    root.setAttribute('aria-busy', 'false'); clear(root);
    document.querySelector('.ida-page-head h1').textContent = [v.make, v.model].filter(Boolean).join(' ') || t('Dossier du véhicule');
    document.querySelector('.ida-page-head p').textContent = '';
    document.querySelector('.ida-page-head p').appendChild(el('span', null, [C.plate(v.plate_display, v.plate), ' · ', C.id(v.ivid)]));
    var ni = document.getElementById('act-intervention'); if (ni) ni.setAttribute('href', '/atelier/interventions?new=1&vehicle=' + enc(v.ivid));
    if (params.get('created')) say('success', t('Véhicule enregistré.'));
    // Identity — the fields of the simplified form first; any other technical field the record holds is shown too.
    var idActions = [];
    if (v.can_edit) idActions.push(el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', id: 'details-edit' }, t('Modifier')));
    if (v.can_delete) idActions.push(el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', id: 'vehicle-delete' }, t('Supprimer le véhicule')));
    root.appendChild(section('sec-identity', t('Véhicule'), idActions, kv([
      [t('Immatriculation'), C.plate(v.plate_display, v.plate)],
      [t('Marque'), C.text(v.make)], [t('Modèle'), C.text(v.model)], [t('Année'), C.text(v.year)],
      [t('Kilométrage'), v.odometer_km !== null && v.odometer_km !== undefined ? [C.km(v.odometer_km), v.odometer_at ? el('span', { class: 'ida-small ida-muted' }, ' · ' + C.date(v.odometer_at)) : ''] : '—'],
      [t('Numéro de châssis (VIN)'), v.vin ? el('code', { class: 'ida-id', translate: 'no' }, v.vin) : (v.vin_present ? t('Enregistré (visible avec le droit de recherche par VIN)') : t('Non renseigné'))],
      v.variant ? [t('Version'), v.variant] : null, v.fuel_type ? [t('Énergie'), C.label('fuel_type', v.fuel_type)] : null, v.engine_cc ? [t('Cylindrée (cm³)'), String(v.engine_cc)] : null,
      v.seats ? [t('Places'), String(v.seats)] : null, v.gross_weight_kg ? [t('Poids total autorisé (kg)'), String(v.gross_weight_kg)] : null, v.category_code ? [t('Catégorie'), v.category_code] : null,
      v.body_type ? [t('Carrosserie'), v.body_type] : null, v.colour ? [t('Couleur'), v.colour] : null, v.engine_code ? [t('Code moteur'), el('bdi', { dir: 'ltr' }, v.engine_code)] : null,
      [t('Informations complémentaires'), v.notes ? el('span', { class: 'ida-pre', translate: 'no' }, v.notes.text) : '—']
    ])));
    var de = document.getElementById('details-edit'); if (de) de.addEventListener('click', editDetails);
    var vd = document.getElementById('vehicle-delete'); if (vd) vd.addEventListener('click', deleteVehicle);
    // Owner
    var ownerBody = el('div', { class: 'ida-stack', id: 'owner-body' });
    var ownerActions = [];
    if (data.owner.can_read && data.owner.recorded) ownerActions.push(el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', id: 'owner-show' }, t('Afficher les coordonnées')));
    if (data.owner.can_write) ownerActions.push(el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', id: 'owner-edit' }, data.owner.recorded ? t('Modifier') : t('Ajouter')));
    ownerBody.appendChild(el('p', { class: 'ida-small ida-muted' }, data.owner.recorded
      ? t('Des coordonnées sont enregistrées. Leur affichage est enregistré au journal d\'activité.')
      : (data.scope === 'own_workshop' ? t('Votre atelier n\'a pas enregistré de propriétaire pour ce véhicule.') : t('Aucun propriétaire enregistré.'))));
    root.appendChild(section('owner', t('Propriétaire'), ownerActions, ownerBody));
    var show = document.getElementById('owner-show'); if (show) show.addEventListener('click', showOwner);
    var edit = document.getElementById('owner-edit'); if (edit) edit.addEventListener('click', editOwner);
    // Carte grise
    var faces = el('div', { class: 'ida-faces' });
    [1, 2].forEach(function (f) {
      var meta = data.documents.faces.filter(function (x) { return x.face === f; })[0];
      var box = el('div', { class: 'ida-face-preview', 'data-face': String(f) }, el('span', { class: 'ida-muted' }, meta ? t('Chargement…') : t('Aucune photo')));
      var actions = el('div', { class: 'ida-page-actions' });
      if (data.documents.can_upload) {
        var input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment', 'data-upload': String(f) });
        actions.appendChild(el('label', { class: 'ida-btn ida-btn--secondary ida-btn--sm ida-file-btn' }, [meta ? t('Remplacer') : t('Ajouter'), input]));
        input.addEventListener('change', function () { upload(f, input); });
      }
      if (meta && data.documents.can_delete) {
        var del = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm' }, t('Supprimer'));
        del.addEventListener('click', function () { removeFace(f); }); actions.appendChild(del);
      }
      faces.appendChild(el('div', { class: 'ida-face' }, [el('p', { class: 'ida-label' }, t(f === 1 ? 'Face 1 — recto' : 'Face 2 — verso')), box,
        meta ? el('p', { class: 'ida-field-hint' }, meta.width + '×' + meta.height + ' px · ' + Math.round(meta.byte_size / 1024) + ' Ko · ' + C.date(meta.at, true)) : null, actions]));
      if (meta) loadImage(f, box);
    });
    root.appendChild(section('sec-docs', t('Carte grise'), null, el('div', { class: 'ida-stack' }, [faces, el('p', { class: 'ida-small ida-muted' }, t('Pièces justificatives : les photos ne sont pas lues automatiquement. Remplacement et suppression sont enregistrés au journal.'))])));
    // Maintenance history
    root.appendChild(section('sec-history', t('Historique d\'entretien'), [el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: '/atelier/interventions?new=1&vehicle=' + enc(v.ivid) }, t('Nouvelle intervention'))], history()));
  }

  // Maintenance history: one line per intervention — date, mileage, work done, technician, parts and their declared source.
  function history() {
    var box = el('div', { class: 'ida-stack' });
    if (!data.maintenance.length) {
      box.appendChild(el('p', { class: 'ida-empty' }, t('Aucune intervention enregistrée pour ce véhicule.')));
      return box;
    }
    box.appendChild(el('ol', { class: 'ida-timeline' }, data.maintenance.map(function (iv) {
      var parts = iv.operations.filter(function (o) { return o.part; });
      return el('li', { class: 'ida-event ida-event--verified' }, el('div', { class: 'ida-stack' }, [
        el('div', { class: 'ida-section-head' }, [el('p', { class: 'ida-label' }, [C.date(iv.date), iv.odometer_km !== null && iv.odometer_km !== undefined ? [' · ', C.km(iv.odometer_km)] : '', data.scope === 'all_workshops' && iv.org.name ? ' · ' + iv.org.name : '']),
          el('a', { class: 'ida-small', href: '/atelier/interventions?id=' + iv.id }, t('Voir / modifier'))]),
        iv.reason ? el('p', { class: 'ida-pre', translate: 'no' }, iv.reason) : null,
        parts.length ? el('ul', { class: 'ida-op-list' }, parts.map(function (o) {
          return el('li', { class: 'ida-op' }, [el('span', { translate: 'no' }, [o.part.label || '—', o.part.reference ? el('bdi', { dir: 'ltr', class: 'ida-muted' }, ' · ' + o.part.reference) : '', o.quantity > 1 ? ' × ' + o.quantity : '']),
            el('span', { class: 'ida-small' }, C.label('part_source_short', o.part.source || 'unknown'))]);
        })) : null,
        iv.technician ? el('p', { class: 'ida-small ida-muted' }, t('Technicien') + ' : ' + iv.technician.name) : null]));
    })));
    return box;
  }

  async function loadImage(f, box) {
    try {
      var r = await fetch('/api/vehicles/' + enc(data.vehicle.ivid) + '/registration-document/' + f + '/image', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
      if (!r.ok) throw new Error(String(r.status));
      var url = URL.createObjectURL(await r.blob());
      clear(box); box.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener', title: t('Ouvrir en grand') }, el('img', { src: url, alt: t(f === 1 ? 'Carte grise — face 1' : 'Carte grise — face 2') })));
    } catch (e) { clear(box); box.appendChild(el('span', { class: 'ida-muted' }, t('Image indisponible.'))); }
  }
  async function upload(f, input) {
    var file = input.files && input.files[0]; if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { say('danger', t('Le fichier n\'est pas une image JPEG, PNG ou WebP.')); return; }
    if (file.size > 6 * 1024 * 1024) { say('danger', t('Image trop volumineuse (6 Mo au plus).')); return; }
    if (f === 2 && !data.documents.faces.some(function (x) { return x.face === 1; })) { say('danger', t('Ajoutez la face 1 avant la face 2.')); return; }
    say('info', t('Envoi de la face ' + f + '…'));
    try { await C.send('PUT', '/api/vehicles/' + enc(data.vehicle.ivid) + '/registration-document/' + f, file, { raw: true, headers: { 'Content-Type': file.type, 'X-IDauto-Original-Bytes': String(file.size) } }); say('success', t('Face ' + f + ' enregistrée.')); await load(); }
    catch (e) { say('danger', C.errorText(e)); }
  }
  async function removeFace(f) {
    if (!(await confirmAction(t('Supprimer la photo de la face ' + f + ' ? L\'opération est enregistrée au journal.')))) return;
    try { await C.send('DELETE', '/api/vehicles/' + enc(data.vehicle.ivid) + '/registration-document/' + f); say('success', t('Photo supprimée.')); await load(); }
    catch (e) { say('danger', C.errorText(e)); }
  }

  // ---- delete (archive): a record entered by mistake; refused when work is recorded on it ----
  async function deleteVehicle() {
    if (!(await confirmAction(t('Supprimer ce véhicule ? Il disparaît des listes ; rien n\'est effacé de la base et l\'opération est enregistrée au journal.')))) return;
    try { await C.send('DELETE', '/api/vehicles/' + enc(data.vehicle.ivid)); window.location.assign('/atelier/vehicules?deleted=1'); }
    catch (e) { say('danger', C.errorText(e)); }
  }

  // ---- vehicle details: make, model, year, mileage, the workshop's note --------------
  function editDetails() {
    var v = data.vehicle, d = document.getElementById('details-dialog');
    document.getElementById('d-make').value = v.make || ''; document.getElementById('d-model').value = v.model || '';
    document.getElementById('d-year').value = v.year || ''; document.getElementById('d-km').value = v.odometer_km === null || v.odometer_km === undefined ? '' : v.odometer_km;
    document.getElementById('d-notes').value = v.notes ? v.notes.text : '';
    clear(document.getElementById('details-errors')); d.showModal();
  }
  document.getElementById('details-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errBox = document.getElementById('details-errors'); clear(errBox);
    var body = { make: document.getElementById('d-make').value, model: document.getElementById('d-model').value, year: document.getElementById('d-year').value.trim(),
      odometer_km: document.getElementById('d-km').value.replace(/[\s.]/g, ''), notes: document.getElementById('d-notes').value };
    try { await C.send('PUT', '/api/vehicles/' + enc(data.vehicle.ivid) + '/details', body); document.getElementById('details-dialog').close(''); say('success', t('Fiche mise à jour.')); await load(); }
    catch (err) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, C.errorText(err))); }
  });

  // ---- owner: shown on request (audited), edited in a dialog --------------------------
  var ownerCache = null;
  async function showOwner() {
    var body = document.getElementById('owner-body');
    try {
      var out = await C.api('/api/vehicles/' + enc(data.vehicle.ivid) + '/owner');
      ownerCache = out.contacts[0] || null; clear(body);
      if (!out.contacts.length) { body.appendChild(el('p', { class: 'ida-muted' }, t('Aucun propriétaire enregistré.'))); return; }
      out.contacts.forEach(function (c) {
        body.appendChild(kv([[t('Nom et prénom'), c.full_name], c.phone ? [t('Téléphone'), el('a', { href: 'tel:' + c.phone.replace(/[^+0-9]/g, ''), dir: 'ltr' }, c.phone)] : null,
          c.email ? [t('E-mail'), el('bdi', { dir: 'ltr' }, c.email)] : null, c.address ? [t('Adresse'), c.address] : null, c.notes ? [t('Remarques'), c.notes] : null, [t('Enregistré le'), C.date(c.recorded_at, true)]]));
      });
      if (data.owner.can_write) {
        var rm = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm' }, t('Retirer les coordonnées'));
        rm.addEventListener('click', removeOwner); body.appendChild(el('div', { class: 'ida-page-actions' }, rm));
      }
    } catch (e) { say('danger', C.errorText(e)); }
  }
  function editOwner() {
    var d = document.getElementById('owner-dialog'), c = ownerCache || {};
    document.getElementById('o-name').value = c.full_name || ''; document.getElementById('o-phone').value = c.phone || '';
    document.getElementById('o-email').value = c.email || ''; document.getElementById('o-address').value = c.address || ''; document.getElementById('o-notes').value = c.notes || '';
    clear(document.getElementById('owner-errors')); d.showModal();
  }
  document.getElementById('owner-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errBox = document.getElementById('owner-errors'); clear(errBox);
    var body = { full_name: document.getElementById('o-name').value, phone: document.getElementById('o-phone').value, email: document.getElementById('o-email').value, address: document.getElementById('o-address').value, notes: document.getElementById('o-notes').value };
    if (body.full_name.trim().length < 2) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, t('Le nom est obligatoire.'))); return; }
    try { await C.send('PUT', '/api/vehicles/' + enc(data.vehicle.ivid) + '/owner', body); document.getElementById('owner-dialog').close(''); say('success', t('Coordonnées enregistrées.')); ownerCache = null; await load(); }
    catch (err) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, C.errorText(err))); }
  });
  async function removeOwner() {
    if (!(await confirmAction(t('Retirer les coordonnées du propriétaire ? Elles restent dans l\'historique, l\'opération est enregistrée au journal.')))) return;
    try { await C.send('DELETE', '/api/vehicles/' + enc(data.vehicle.ivid) + '/owner'); ownerCache = null; say('success', t('Coordonnées retirées.')); await load(); }
    catch (e) { say('danger', C.errorText(e)); }
  }

  load();
}());
