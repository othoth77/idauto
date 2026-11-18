'use strict';
/* IDauto — Update 6 — cartes grises received without a vehicle (/admin/cartes-grises).
 * Reads GET /api/carte-grise/intake[/:id[/original]]; writes POST /api/carte-grise/intake/:id/resolve (audited).
 * Technical fields only: the holder's name, CIN and address never reach this page. Server values are placed with
 * textContent through IdAutoConsole.el(); the original is shown from a blob URL (fetched with the session header). */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole, el = C.el;
  var STATUS = { pending_extraction: 'En attente d\'extraction', extraction_failed: 'Extraction échouée', pending_review: 'À vérifier', unassigned: 'Non rattaché',
    linked_existing_vehicle: 'Rattaché à un véhicule existant', vehicle_created: 'Véhicule créé' };
  var TONE = { pending_extraction: 'pending', extraction_failed: 'anomaly', pending_review: 'pending', unassigned: 'neutral', linked_existing_vehicle: 'verified', vehicle_created: 'verified' };
  var FIELDS = [['vin', 'Numéro de châssis (VIN)'], ['plate', 'Immatriculation'], ['make', 'Marque'], ['model', 'Modèle (type commercial)'], ['body_type', 'Genre / carrosserie'],
    ['fuel_type', 'Énergie'], ['seats', 'Places assises'], ['first_registration', 'Date de première mise en circulation'], ['fiscal_power', 'Puissance fiscale']];
  var FORMAT = { CARTE_GRISE_IMAGE: 'Image', CARTE_GRISE_PDF: 'PDF', CARTE_GRISE_TEXT: 'Texte collé' };
  var REASON = { vin_invalid: 'Numéro de châssis invalide (17 caractères, sans I, O ni Q).', plate_invalid: 'Immatriculation non reconnue.',
    vin_required_to_create: 'Sans numéro de châssis, aucun véhicule n\'est créé : rattachez à un véhicule existant ou gardez le document non rattaché.',
    vehicle_ref_required: 'Indiquez l\'IVID du véhicule à rattacher.', already_resolved: 'Ce document a déjà été traité.', already_on_vehicle: 'Ce fichier est déjà dans le dossier de ce véhicule.',
    vin_on_several_vehicles: 'Ce numéro de châssis est sur plusieurs véhicules : une fusion doit d\'abord être faite.', vin_is_on_another_vehicle: 'Ce numéro de châssis appartient à un autre véhicule.',
    vin_unknown_on_that_vehicle: 'Ce véhicule ne porte pas ce numéro de châssis : il n\'est jamais ajouté sans vérification.', plate_attached_to_another_vehicle: 'Cette immatriculation est déjà sur un autre véhicule.',
    vin_unknown_use_create: 'Ce numéro de châssis est inconnu : utilisez « Créer le véhicule ».' };
  var statusSel = document.getElementById('f-status'), list = document.getElementById('list'), summary = document.getElementById('list-summary');
  var box = document.getElementById('review'), current = null, blob = null;
  function badge(s) { return el('span', { class: 'ida-status ida-status--' + (TONE[s] || 'neutral') }, STATUS[s] || s); }
  function th(h) { return el('th', { scope: 'col' }, h); }

  async function load() {
    var q = statusSel.value ? '?status=' + encodeURIComponent(statusSel.value) : '';
    try {
      var d = await C.api('/api/carte-grise/intake' + q);
      C.clear(list);
      list.appendChild(el('thead', null, el('tr', null, [th('Reçu le'), th('Document'), th('Statut'), th('Lu par LENS'), th('Véhicule'), th('')])));
      var tb = el('tbody');
      d.documents.forEach(function (x) {
        var f = x.extraction && x.extraction.fields || {};
        tb.appendChild(el('tr', null, [
          el('td', null, C.date(x.uploaded_at, true)),
          el('td', null, [(FORMAT[x.source_format] || x.source_format) + ' · face ' + x.face, el('span', { class: 'ida-caption ida-u-block' }, x.original_filename || '')]),
          el('td', null, badge(x.intake_status)),
          el('td', null, [f.make || f.model ? [f.make, f.model].filter(Boolean).join(' ') : C.DASH, el('span', { class: 'ida-caption ida-u-block' }, f.vin ? 'VIN lu' : 'VIN non lu')]),
          el('td', null, x.vehicle ? el('a', { href: '/admin/vehicle?ref=' + encodeURIComponent(x.vehicle.ivid) }, x.vehicle.ivid) : C.DASH),
          el('td', null, el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', 'data-open': x.id }, x.vehicle ? 'Voir' : 'Vérifier'))
        ]));
      });
      list.appendChild(tb);
      var c = d.counts || {};
      summary.textContent = d.documents.length + ' document(s) · ' + (c.pending_review || 0) + ' à vérifier · ' + (c.pending_extraction || 0) + ' en attente d\'extraction · ' + (c.extraction_failed || 0) + ' échec(s) · ' + (c.unassigned || 0) + ' non rattaché(s)';
    } catch (e) { summary.textContent = C.errorText(e); }
  }

  async function open(id) {
    var d;
    try { d = await C.api('/api/carte-grise/intake/' + encodeURIComponent(id)); } catch (e) { summary.textContent = C.errorText(e); return; }
    current = d; box.hidden = false;
    document.getElementById('review-meta').textContent = (FORMAT[d.source_format] || d.source_format) + ' · face ' + d.face + ' · reçu le ' + C.date(d.uploaded_at, true) + ' · SHA-256 ' + d.sha256.slice(0, 16) + '… · ' + (STATUS[d.intake_status] || d.intake_status);
    var pv = C.clear(document.getElementById('review-preview'));
    if (blob) { URL.revokeObjectURL(blob); blob = null; }
    try {
      var r = await fetch('/api/carte-grise/intake/' + encodeURIComponent(id) + '/original', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var b = await r.blob(); blob = URL.createObjectURL(b);
      if (/^image\//.test(d.mime_type)) pv.appendChild(el('img', { src: blob, alt: 'Carte grise (original)', class: 'ida-intake-preview', 'data-intake-preview': '' }));
      else if (/^text\//.test(d.mime_type)) pv.appendChild(el('pre', { class: 'ida-small ida-intake-preview', dir: 'auto', 'data-intake-preview': '' }, await b.text()));
      else pv.appendChild(el('a', { href: blob, download: 'carte-grise.pdf', 'data-intake-preview': '' }, 'Ouvrir le PDF original'));
    } catch (e) { pv.appendChild(el('p', { class: 'ida-small ida-muted' }, 'Aperçu indisponible.')); }
    var m = d.match || {}, line = document.getElementById('review-match');
    line.textContent = m.case === 'A' ? 'Ce numéro de châssis est déjà sur le véhicule ' + (m.vehicle ? m.vehicle.ivid : '') + ' : le document y sera rattaché (aucun doublon).' +
        (m.conflicts && m.conflicts.length ? ' Différences à vérifier : ' + m.conflicts.map(function (c) { return c.field + ' (véhicule « ' + c.vehicle + ' », document « ' + c.document + ' »)'; }).join(' ; ') + '. Le véhicule n\'est pas modifié.' : '')
      : m.case === 'B' ? 'Numéro de châssis inconnu dans IDauto : le véhicule peut être créé après votre confirmation.'
      : 'Numéro de châssis absent ou illisible : aucun véhicule ne sera créé. Corrigez-le, rattachez à un véhicule existant, ou gardez le document non rattaché.';
    var basis = Object.assign({}, d.extraction && d.extraction.fields || {}, d.confirmed_fields || {}), conf = d.extraction && d.extraction.confidence || {};
    var grid = C.clear(document.getElementById('review-fields'));
    FIELDS.forEach(function (f) {
      var c = conf[f[0]], hint = c && typeof c.confidence === 'number' ? 'LENS : confiance ' + Math.round(c.confidence * 100) + ' %' + (c.state ? ' · ' + c.state : '') : (basis[f[0]] ? '' : 'non lu');
      grid.appendChild(el('div', { class: 'ida-field' }, [el('label', { for: 'f-' + f[0] }, f[1]),
        el('input', { class: 'ida-input', id: 'f-' + f[0], name: f[0], value: basis[f[0]] || '', maxlength: '80', autocomplete: 'off', dir: f[0] === 'vin' || f[0] === 'plate' ? 'ltr' : null }),
        hint ? el('span', { class: 'ida-caption' }, hint) : null]));
    });
    var done = !!d.vehicle || ['linked_existing_vehicle', 'vehicle_created'].indexOf(d.intake_status) !== -1;
    Array.prototype.forEach.call(box.querySelectorAll('[data-action]'), function (b) { b.disabled = done; });
    document.getElementById('review-status').textContent = done ? 'Déjà traité' + (d.resolved ? ' par ' + d.resolved.by + ' le ' + C.date(d.resolved.at, true) : '') + '.' : '';
    box.scrollIntoView({ block: 'start' });
  }

  async function resolve(action) {
    if (!current) return;
    var form = document.getElementById('review-form'), fields = {};
    FIELDS.forEach(function (f) { var v = String(form.elements[f[0]].value || '').trim(); if (v) fields[f[0]] = v; });
    var label = action === 'create' ? 'Créer le véhicule à partir de ces informations et y rattacher la carte grise ?' : action === 'attach' ? 'Rattacher la carte grise au véhicule ?' : 'Garder la carte grise non rattachée ?';
    if (!window.confirm(label)) return;
    var st = document.getElementById('review-status');
    Array.prototype.forEach.call(box.querySelectorAll('[data-action]'), function (b) { b.disabled = true; });
    try {
      var out = await C.send('POST', '/api/carte-grise/intake/' + encodeURIComponent(current.id) + '/resolve', { action: action, fields: fields, vehicle_ref: String(form.elements.vehicle_ref.value || '').trim() || undefined });
      st.textContent = out.intake_status === 'vehicle_created' ? 'Véhicule créé (' + out.vehicle.ivid + ') et carte grise rattachée.'
        : out.intake_status === 'linked_existing_vehicle' ? 'Carte grise rattachée au véhicule ' + out.vehicle.ivid + ' (version ' + out.version + ').' + (out.conflicts && out.conflicts.length ? ' ' + out.conflicts.length + ' différence(s) à vérifier dans le dossier.' : '')
        : 'Document gardé non rattaché.';
      load();
    } catch (e) {
      var r = e.body && e.body.details && e.body.details.reason;
      st.textContent = REASON[r] || C.errorText(e);
      Array.prototype.forEach.call(box.querySelectorAll('[data-action]'), function (b) { b.disabled = false; });
    }
  }

  list.addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) open(b.getAttribute('data-open')); });
  box.addEventListener('click', function (e) { var b = e.target.closest('[data-action]'); if (b) resolve(b.getAttribute('data-action')); });
  statusSel.addEventListener('change', load);
  C.sessionLine('session-line', '/admin/cartes-grises').then(function (u) { if (u) load(); });
})();
