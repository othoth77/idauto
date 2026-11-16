'use strict';
/* IDauto — Update 3 — « Photos du véhicule » on the registration page.
 *
 * The person photographs the whole front or rear of the vehicle (or picks image files). For each photograph:
 *   · the file's own EXIF is read (GPS position, capture date) BEFORE the image is reduced — the reduced
 *     copy that is uploaded carries no hidden metadata;
 *   · its location follows one order only: EXIF position → the device's position if the photograph was TAKEN
 *     here and the person allowed it → the place the person types → unknown. A chosen file never receives the
 *     device's current position;
 *   · the plate is looked for and read on the device (the shared photo-analysis.js); when the workshop has
 *     configured the vehicle analysis, the photograph is also sent to this server's own route for make,
 *     model, colour, body type. Nothing is invented: what is not recognised stays empty.
 * The photographs are held in the page until the vehicle form is saved; then each is stored with its own
 * view, date, location and analysis. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var M = window.IdaPhotoMeta, A = window.IdaPhotoAnalysis;   // the shared analysis (web/citizen/photo-analysis.js)
  var list = document.getElementById('photo-list'), take = document.getElementById('photo-take'), pick = document.getElementById('photo-pick');
  if (!list || !take || !pick || !M || !A) return;

  var photos = [], seq = 0, geoData = null, vision = null, livePosition = null;
  var MAX_PHOTOS = 6;
  var VIEW_LABEL = { front: 'Avant', rear: 'Arrière', unknown: 'Vue non précisée' };
  var SOURCE_LABEL = { exif: 'position enregistrée dans la photo', browser: 'position de l\'appareil à la prise de vue', manual: 'lieu saisi à la main' };

  // ---- location ------------------------------------------------------------------------------------------------
  /* Asked once, explicitly, when the person presses « Prendre une photo ». A refusal is null and never blocks. */
  var askPosition = A.askPosition;
  async function resolvePlace(p) {
    if (!p.location || p.location.source === 'manual' || p.location.place_name || p.location.governorate) return;
    try {
      var r = (await C.api('/api/workspace/geo/resolve?lat=' + encodeURIComponent(p.location.latitude) + '&lon=' + encodeURIComponent(p.location.longitude))).resolved;
      if (r) { p.location.resolved = r; }
    } catch (e) { /* the coordinates are kept; the server resolves them again when the photograph is stored */ }
  }
  function placeText(p) {
    var l = p.location;
    if (!l) return t('Lieu inconnu');
    var r = l.resolved || {}, parts = [l.place_name || r.place_name, l.governorate || r.governorate, l.country || r.country].filter(Boolean);
    var name = parts.length ? parts.join(', ') : (l.latitude !== null && l.latitude !== undefined ? l.latitude.toFixed(4) + ', ' + l.longitude.toFixed(4) : t('Lieu inconnu'));
    if (l.source !== 'manual' && !l.place_name && (r.place_name || r.governorate)) name += ' ' + t('(approximatif)');
    return name;
  }

  // ---- adding a photograph -------------------------------------------------------------------------------------
  async function add(file, taken) {
    if (photos.length >= MAX_PHOTOS) { C.toast ? C.toast(t('Six photos au plus par véhicule ici.')) : null; return; }
    if (!/^image\//.test(file.type || '')) return;
    var p = { id: ++seq, taken: !!taken, view: 'unknown', status: 'reading', analysis: null, location: null, capturedAt: null, name: file.name || '' };
    photos.push(p); render();
    try {
      var prep = await A.prepare(file, taken, livePosition);
      p.canvas = prep.canvas; p.blob = prep.blob; p.url = prep.url; p.location = prep.location; p.capturedAt = prep.capturedAt;
      p.status = 'ready';
      await resolvePlace(p);
    } catch (e) { p.status = 'error'; p.error = t('Cette image ne peut pas être lue : choisissez une autre photo.'); }
    render();
  }

  // ---- analysing one photograph --------------------------------------------------------------------------------
  async function analyse(p) {
    p.status = 'analysing'; render();
    var r = await A.analyse(p, { visionEnabled: !!(vision && vision.enabled), visionUrl: '/api/workspace/vehicle-recognition',
      post: function (url, blob) { return C.send('POST', url, blob, { raw: true, headers: { 'Content-Type': 'image/jpeg' } }); } });
    var a = r.analysis;
    p.plateSeen = r.plateSeen; p.visionError = r.visionError; p.plateDisagree = r.plateDisagree;
    if (p.view === 'unknown' && r.view) { p.view = r.view; p.viewBy = 'vision'; }
    p.analysis = a; p.status = 'done';
    render(); publish();
  }

  // ---- the combined result → the card of the registration page ---------------------------------------------------
  function publish() {
    var done = photos.filter(function (p) { return p.status === 'done'; });
    if (!done.length || !window.IdAutoRegister) return;
    var cmb = M.combine(done), LBL = window.IdAutoRegister.labels, best = cmb.plate ? done[cmb.plate.photo] : done[0];
    var fieldLabel = { plate: t('Immatriculation'), make: t('Marque'), model: t('Modèle'), trim: t('Version'), colour: t('Couleur'), body_type: t('Carrosserie'), year: t('Année') };
    done.forEach(function (p) { if (p.plateDisagree && !cmb.conflicts.some(function (c) { return c.field === 'plate'; })) cmb.conflicts.push({ field: 'plate', values: [{ value: p.analysis.plate.serie + ' ' + p.analysis.plate.numero }, { value: p.plateDisagree }] }); });
    var frame = document.createElement('canvas'); frame.width = best.canvas.width; frame.height = best.canvas.height; frame.getContext('2d').drawImage(best.canvas, 0, 0);
    window.IdAutoRegister.showResult({
      serie: cmb.plate ? cmb.plate.serie : '', numero: cmb.plate ? cmb.plate.numero : '', confidence: cmb.plate ? cmb.plate.confidence : 0, auto: !!(cmb.plate && cmb.plate.accepted),
      plate: cmb.plate ? { first: cmb.plate.serie, text: 'تونس', last: cmb.plate.numero } : null,
      confText: cmb.plate ? (cmb.plate.accepted ? t('lue sur la photo') + ' · ' + cmb.plate.confidence + ' %' : (cmb.plate.source === 'vision' ? t('lue par l\'analyse d\'image — à vérifier') : t('lecture à vérifier')) + ' · ' + cmb.plate.confidence + ' %') : '',
      frame: frame,
      pre: { fields: cmb.fields, analysis: vision && vision.enabled ? { enabled: true, provider: done[0].analysis.provider, model: done[0].analysis.model, error: done.every(function (p) { return p.visionError; }) ? done[0].visionError : null } : { enabled: false } },
      photos: done.map(function (p) { return { viewLabel: t(VIEW_LABEL[p.view]), placeLabel: placeText(p), dateLabel: p.capturedAt ? C.date(p.capturedAt) : '' }; }),
      conflicts: cmb.conflicts.map(function (c) { return { label: fieldLabel[c.field] || c.field, values: c.values.map(function (v) { return c.field === 'colour' ? t(LBL.colour[v.value] || v.value) : c.field === 'body_type' ? t(LBL.body[v.value] || v.value) : String(v.value); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }) }; })
    });
  }

  // ---- one photograph's card -------------------------------------------------------------------------------------
  function locationEditor(p) {
    var gov = el('select', { class: 'ida-input', 'aria-label': t('Gouvernorat') }, [el('option', { value: '' }, '—')].concat((geoData ? geoData.governorates : []).map(function (g) { return el('option', { value: g.name, 'data-i18n-skip': '' }, g.name); })));
    var dl = el('datalist', { id: 'photo-places-' + p.id });
    var place = el('input', { class: 'ida-input', maxlength: '120', autocomplete: 'off', dir: 'auto', list: dl.id, placeholder: t('Délégation ou localité'), 'aria-label': t('Délégation ou localité') });
    function fill() { clear(dl); var g = (geoData ? geoData.governorates : []).filter(function (x) { return x.name === gov.value; })[0]; (g ? g.delegations : []).forEach(function (d) { dl.appendChild(el('option', { value: d })); }); }
    var l = p.location || {}, r = l.resolved || {};
    gov.value = l.governorate || r.governorate || ''; place.value = l.place_name || r.place_name || ''; fill();
    gov.addEventListener('change', fill);
    var ok = el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm' }, t('Valider le lieu'));
    var none = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm' }, t('Lieu inconnu'));
    ok.addEventListener('click', function () {
      if (!gov.value && !place.value.trim()) return;
      // a position measured by GPS keeps its coordinates and its source; only its NAME is corrected.
      // without coordinates the place is what the person says: source « manual ».
      if (p.location && p.location.source !== 'manual') { p.location.place_name = place.value.trim() || null; p.location.governorate = gov.value || null; p.location.country = gov.value ? 'Tunisie' : (p.location.country || null); }
      else p.location = { source: 'manual', latitude: null, longitude: null, place_name: place.value.trim() || null, governorate: gov.value || null, country: gov.value ? 'Tunisie' : null };
      p.editing = false; render(); publish();
    });
    none.addEventListener('click', function () { p.location = null; p.editing = false; render(); publish(); });
    return el('div', { class: 'ida-photo-loc-edit' }, [gov, place, dl, ok, none]);
  }

  function card(p) {
    var a = p.analysis, lines = [];
    var viewSel = el('select', { class: 'ida-input ida-photo-view', 'aria-label': t('Vue du véhicule') }, ['unknown', 'front', 'rear'].map(function (v) { return el('option', { value: v }, t(VIEW_LABEL[v])); }));
    viewSel.value = p.view;
    viewSel.addEventListener('change', function () { p.view = viewSel.value; p.viewBy = 'manual'; publish(); });
    if (p.status === 'reading') lines.push(el('p', { class: 'ida-small ida-muted' }, t('Lecture de la photo…')));
    if (p.status === 'error') lines.push(el('p', { class: 'ida-field-error' }, p.error));
    if (p.status === 'analysing') lines.push(el('p', { class: 'ida-small ida-muted', role: 'status' }, t('Analyse en cours…')));
    if (p.status === 'done') {
      lines.push(el('p', { class: 'ida-small' }, a.plate
        ? [el('strong', null, t('Plaque : ')), el('bdi', { dir: 'ltr', class: 'ida-id' }, a.plate.serie + ' · ' + a.plate.numero), ' ', el('span', { class: 'ida-muted' }, (a.plate.accepted ? t('lue') : t('à vérifier')) + ' · ' + a.plate.confidence + ' %')]
        : [el('strong', null, t('Plaque : ')), p.plateSeen ? t('repérée mais non lue — saisissez-la') : t('aucune plaque visible sur cette photo')]));
      if (p.plateDisagree) lines.push(el('p', { class: 'ida-field-error' }, t('L\'analyse d\'image lit une autre plaque : ') + p.plateDisagree));
    }
    var when = p.capturedAt ? C.date(p.capturedAt) : t('date inconnue');
    var locLine = el('p', { class: 'ida-small' }, [el('strong', null, t('Lieu de la photo : ')), el('span', { 'data-photo-place': '' }, placeText(p)),
      p.location ? el('span', { class: 'ida-muted' }, ' — ' + t(SOURCE_LABEL[p.location.source])) : '', ' · ', when, ' ',
      el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-photo-loc': '' }, p.location ? t('Corriger le lieu') : t('Indiquer le lieu'))]);
    locLine.querySelector('[data-photo-loc]').addEventListener('click', function () { p.editing = !p.editing; render(); });
    var actions = [];
    if (p.status === 'ready' || p.status === 'done') {
      var go = el('button', { type: 'button', class: 'ida-btn ' + (p.status === 'ready' ? 'ida-btn--primary' : 'ida-btn--ghost') + ' ida-btn--sm', 'data-photo-analyse': '' }, p.status === 'ready' ? t('Analyser cette photo') : t('Analyser à nouveau'));
      go.addEventListener('click', function () { analyse(p); });
      actions.push(go);
    }
    var rm = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', 'data-photo-remove': '' }, p.status === 'ready' ? t('Reprendre') : t('Retirer'));
    rm.addEventListener('click', function () { if (p.url) URL.revokeObjectURL(p.url); photos = photos.filter(function (x) { return x !== p; }); render(); publish(); });
    actions.push(rm);
    return el('li', { class: 'ida-photo', 'data-photo': String(p.id), 'data-status': p.status }, [
      el('div', { class: 'ida-photo-thumb' }, p.url ? el('img', { src: p.url, alt: t('Photo du véhicule') }) : el('span', { class: 'ida-muted' }, '…')),
      el('div', { class: 'ida-photo-body' }, [el('div', { class: 'ida-photo-head' }, [el('label', { class: 'ida-small' }, [t('Vue'), ' ', viewSel])]), lines, locLine, p.editing ? locationEditor(p) : null,
        el('div', { class: 'ida-form-actions' }, actions)])]);
  }
  function flat(a) { return a.reduce(function (o, x) { return o.concat(Array.isArray(x) ? flat(x) : [x]); }, []); }
  function render() { clear(list); photos.forEach(function (p) { list.appendChild(card(p)); }); }

  // ---- wiring ------------------------------------------------------------------------------------------------------
  document.getElementById('photo-take-label').addEventListener('click', function () { livePosition = askPosition(); });   // explicit, at the moment a photograph is asked for
  take.addEventListener('change', function () { var f = take.files && take.files[0]; take.value = ''; if (f) add(f, true); });
  pick.addEventListener('change', function () { var fs = Array.prototype.slice.call(pick.files || []); pick.value = ''; fs.forEach(function (f) { add(f, false); }); });

  // base64url JSON for the metadata header (the Arabic word of the plate travels as UTF-8)
  function header(o) { var b = new TextEncoder().encode(JSON.stringify(o)), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function metaOf(p) {
    var l = p.location;
    return { view: p.view, captured_at: p.capturedAt, confirmed: true,
      location: l ? { source: l.source, latitude: l.latitude, longitude: l.longitude, place_name: l.place_name || null, governorate: l.governorate || null, country: l.country || null } : null,
      analysis: p.analysis || null };
  }

  window.IdAutoPhotos = {
    ready: function () {
      C.api('/api/workspace/vehicle-recognition').then(function (o) {
        vision = o.vehicle_analysis || { enabled: false };
        var n = document.getElementById('photos-privacy');
        if (n) n.textContent = vision.enabled ? t('La photo est envoyée au service d\'analyse configuré par l\'atelier, pour proposer la marque et le modèle.') : t('L\'analyse reste sur l\'appareil : la marque et le modèle sont à saisir.');
      }).catch(function () { vision = { enabled: false }; });
      C.api('/api/workspace/geo/tn').then(function (g) { geoData = g; }).catch(function () {});
    },
    count: function () { return photos.filter(function (p) { return p.blob && p.status !== 'error'; }).length; },
    // stores every photograph on the vehicle; returns the list of failures (empty when all went well)
    uploadAll: async function (ivid) {
      var failed = [];
      for (var i = 0; i < photos.length; i++) {
        var p = photos[i];
        if (!p.blob || p.status === 'error') continue;
        try { await C.send('POST', '/api/vehicles/' + encodeURIComponent(ivid) + '/photos', p.blob, { raw: true, headers: { 'Content-Type': 'image/jpeg', 'X-IDauto-Photo-Meta': header(metaOf(p)) } }); }
        catch (e) { failed.push(t('Photo') + ' ' + (i + 1) + ' : ' + C.errorText(e)); }
      }
      return failed;
    },
    _photos: function () { return photos; }, _add: add, _analyse: analyse
  };
}());
