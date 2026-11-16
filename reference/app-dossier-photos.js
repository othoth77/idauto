'use strict';
/* IDauto — Update 3 — the vehicle's photographs in its dossier.
 * Front and rear photographs, each with ITS capture date and ITS location (the photograph's, not the vehicle's).
 * Opening one shows the image, the location with its source and original coordinates, and what was recognised
 * on it; the view and the location can be corrected. Images are fetched with the session, never public. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t, M = window.IdaPhotoMeta;
  var VIEW = { front: 'Avant', rear: 'Arrière', unknown: 'Vue non précisée' };
  var SOURCE = { exif: 'position enregistrée dans la photo', browser: 'position de l\'appareil à la prise de vue', manual: 'lieu saisi à la main' };
  var FROM = { ocr: 'lu sur l\'image', vision: 'analyse d\'image', camera: 'estimation de la caméra', manual: 'saisi à la main' };
  var FIELD = { make: 'Marque', model: 'Modèle', trim: 'Version', colour: 'Couleur', body_type: 'Carrosserie', year: 'Année' };
  var geoData = null, urls = {};
  function enc(v) { return encodeURIComponent(v); }
  function place(p) { var l = p.location; if (!l) return t('Lieu inconnu'); return [l.place_name, l.governorate, l.country].filter(Boolean).join(', ') || (l.latitude !== null ? l.latitude.toFixed(4) + ', ' + l.longitude.toFixed(4) : t('Lieu inconnu')); }
  function when(p) { return p.captured_at ? C.date(p.captured_at) : t('date inconnue'); }
  async function imageUrl(ivid, p) {
    if (urls[p.id]) return urls[p.id];
    var r = await fetch('/api/vehicles/' + enc(ivid) + '/photos/' + p.id + '/image', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1' } });
    if (!r.ok) throw new Error(String(r.status));
    return (urls[p.id] = URL.createObjectURL(await r.blob()));
  }

  function section(data, makeSection, say) {
    var ivid = data.vehicle.ivid, canWrite = !!(data.documents && data.documents.can_upload), canDelete = !!(data.documents && data.documents.can_delete);
    var body = el('div', { class: 'ida-stack', id: 'photos-body', 'aria-busy': 'true' }, el('p', { class: 'ida-muted ida-small' }, t('Chargement…')));
    var input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, id: 'photo-add-input' });
    var actions = canWrite ? [el('label', { class: 'ida-btn ida-btn--secondary ida-btn--sm ida-file-btn' }, [t('Ajouter une photo'), input])] : null;
    var box = makeSection('sec-photos', t('Photos du véhicule'), actions, body);

    async function load() {
      var out;
      try { out = await C.api('/api/vehicles/' + enc(ivid) + '/photos'); }
      catch (e) { body.setAttribute('aria-busy', 'false'); clear(body); body.appendChild(el('p', { class: 'ida-muted ida-small' }, t('Photos indisponibles.'))); return; }
      body.setAttribute('aria-busy', 'false'); clear(body);
      if (!out.photos.length) { body.appendChild(el('p', { class: 'ida-empty' }, t('Aucune photo du véhicule pour le moment.'))); return; }
      [['front', 'Photos avant'], ['rear', 'Photos arrière'], ['unknown', 'Autres photos']].forEach(function (g) {
        var ps = out.photos.filter(function (p) { return p.view === g[0]; });
        if (!ps.length) return;
        body.appendChild(el('h3', { class: 'ida-h4' }, t(g[1])));
        body.appendChild(el('ul', { class: 'ida-photo-grid', 'data-photo-group': g[0] }, ps.map(function (p) {
          var thumb = el('div', { class: 'ida-photo-thumb' }, el('span', { class: 'ida-muted' }, '…'));
          imageUrl(ivid, p).then(function (u) { clear(thumb); thumb.appendChild(el('img', { src: u, alt: t(VIEW[p.view]) })); }).catch(function () { clear(thumb); thumb.appendChild(el('span', { class: 'ida-muted' }, t('Image indisponible.'))); });
          var b = el('button', { type: 'button', class: 'ida-photo-tile', 'data-photo-open': p.id }, [thumb,
            el('span', { class: 'ida-photo-cap' }, [el('strong', { 'data-photo-place': '' }, place(p)), el('span', { class: 'ida-muted' }, when(p))])]);
          b.addEventListener('click', function () { open(p); });
          return el('li', null, b);
        })));
      });
      body.appendChild(el('p', { class: 'ida-small ida-muted' }, t('Le lieu indiqué est celui de chaque prise de vue, pas l\'adresse du véhicule.')));
    }

    function open(p) {
      var d = document.getElementById('photo-dialog'), b = document.getElementById('photo-dialog-body'); clear(b);
      var img = el('div', { class: 'ida-photo-large' }, el('span', { class: 'ida-muted' }, '…'));
      imageUrl(ivid, p).then(function (u) { clear(img); img.appendChild(el('a', { href: u, target: '_blank', rel: 'noopener', title: t('Ouvrir en grand') }, el('img', { src: u, alt: t(VIEW[p.view]) }))); }).catch(function () {});
      var l = p.location, a = p.analysis || {}, rows = [];
      rows.push([t('Vue'), t(VIEW[p.view])]);
      rows.push([t('Date de prise de vue'), when(p)]);
      rows.push([t('Lieu de la photo'), l ? [place(p), el('span', { class: 'ida-muted' }, ' — ' + t(SOURCE[l.source]))] : t('Lieu inconnu')]);
      if (l && l.latitude !== null) rows.push([t('Coordonnées'), el('bdi', { dir: 'ltr' }, l.latitude.toFixed(6) + ', ' + l.longitude.toFixed(6))]);
      if (a.plate && a.plate.serie) rows.push([t('Immatriculation lue'), [el('bdi', { dir: 'ltr', class: 'ida-id' }, a.plate.serie + ' · ' + a.plate.numero), el('span', { class: 'ida-muted' }, ' — ' + t(FROM[a.plate.source] || '') + (a.plate.confidence !== null ? ' · ' + a.plate.confidence + ' %' : ''))]]);
      else rows.push([t('Immatriculation lue'), t('aucune plaque lue sur cette photo')]);
      Object.keys(FIELD).forEach(function (f) { var v = a.fields && a.fields[f]; if (v && v.value) rows.push([t(FIELD[f]), [el('span', { dir: 'auto' }, v.value), el('span', { class: 'ida-muted' }, ' — ' + t(FROM[v.source] || '') + (v.confidence !== null ? ' · ' + Math.round(v.confidence * 100) + ' %' : ''))]]); });
      rows.push([t('Vérifiée par l\'atelier'), p.confirmed ? t('oui') : t('non')]);
      b.appendChild(img);
      b.appendChild(el('dl', { class: 'ida-kv' }, rows.reduce(function (acc, r) { acc.push(el('dt', null, r[0]), el('dd', null, r[1])); return acc; }, [])));
      if (canWrite) {
        var view = el('select', { class: 'ida-input', id: 'pd-view', 'aria-label': t('Vue du véhicule') }, ['unknown', 'front', 'rear'].map(function (v) { return el('option', { value: v }, t(VIEW[v])); })); view.value = p.view;
        var gov = el('select', { class: 'ida-input', id: 'pd-gov', 'aria-label': t('Gouvernorat') }, [el('option', { value: '' }, '—')].concat((geoData ? geoData.governorates : []).map(function (g) { return el('option', { value: g.name, 'data-i18n-skip': '' }, g.name); })));
        var dl = el('datalist', { id: 'pd-places' }), pl = el('input', { class: 'ida-input', id: 'pd-place', maxlength: '120', dir: 'auto', list: 'pd-places', placeholder: t('Délégation ou localité'), 'aria-label': t('Délégation ou localité') });
        function fill() { clear(dl); var g = (geoData ? geoData.governorates : []).filter(function (x) { return x.name === gov.value; })[0]; (g ? g.delegations : []).forEach(function (x) { dl.appendChild(el('option', { value: x })); }); }
        gov.value = l && l.governorate ? l.governorate : ''; pl.value = l && l.place_name ? l.place_name : ''; fill(); gov.addEventListener('change', fill);
        var save = el('button', { type: 'button', class: 'ida-btn ida-btn--primary ida-btn--sm', id: 'pd-save' }, t('Enregistrer les corrections'));
        save.addEventListener('click', async function () {
          var patch = { view: view.value };
          var named = !!(gov.value || pl.value.trim());
          // a GPS position keeps its coordinates and its source: only its name is corrected. Without coordinates the place is manual.
          if (l && l.latitude !== null) patch.location = { source: l.source, latitude: l.latitude, longitude: l.longitude, place_name: pl.value.trim() || null, governorate: gov.value || null, country: gov.value ? 'Tunisie' : l.country };
          else patch.location = named ? { source: 'manual', place_name: pl.value.trim() || null, governorate: gov.value || null, country: gov.value ? 'Tunisie' : null } : null;
          try { await C.send('PUT', '/api/vehicles/' + enc(ivid) + '/photos/' + p.id, patch); d.close(''); say('success', t('Photo mise à jour.')); await load(); }
          catch (e) { say('danger', C.errorText(e)); d.close(''); }
        });
        var edit = [el('h3', { class: 'ida-h4' }, t('Corriger')), el('div', { class: 'ida-photo-loc-edit' }, [view, gov, pl, dl, save])];
        if (canDelete) {
          var del = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm', id: 'pd-delete' }, t('Supprimer cette photo'));
          del.addEventListener('click', async function () {
            try { await C.send('DELETE', '/api/vehicles/' + enc(ivid) + '/photos/' + p.id); delete urls[p.id]; d.close(''); say('success', t('Photo supprimée.')); await load(); }
            catch (e) { say('danger', C.errorText(e)); d.close(''); }
          });
          edit.push(del);
        }
        b.appendChild(el('div', { class: 'ida-stack' }, edit));
      }
      d.showModal();
    }

    // adding a photograph from the dossier: a chosen file — its own EXIF position if it has one, otherwise unknown (to be typed)
    input.addEventListener('change', async function () {
      var file = input.files && input.files[0]; input.value = '';
      if (!file) return;
      try {
        var exif = /jpe?g/i.test(file.type) && M ? M.readExif(await file.arrayBuffer()) : { latitude: null, longitude: null, capturedAt: null };
        var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
        var meta = { view: 'unknown', captured_at: exif.capturedAt, location: M ? M.chooseLocation(exif, null, false) : null, confirmed: false };
        var bytes = new TextEncoder().encode(JSON.stringify(meta)), str = ''; for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
        var out = await C.send('POST', '/api/vehicles/' + enc(ivid) + '/photos', blob, { raw: true, headers: { 'Content-Type': 'image/jpeg', 'X-IDauto-Photo-Meta': btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } });
        say('success', out.duplicate ? t('Cette photo est déjà dans le dossier.') : t('Photo ajoutée. Ouvrez-la pour préciser la vue et le lieu.'));
        await load();
      } catch (e) { say('danger', C.errorText(e)); }
    });

    C.api('/api/workspace/geo/tn').then(function (g) { geoData = g; }).catch(function () {});
    load();
    return box;
  }

  window.IdAutoDossierPhotos = { section: section };
}());
