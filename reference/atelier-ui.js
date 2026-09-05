/* IDauto — atelier UI (IDA-V12)
 * ============================================================================
 * The workshop journey, one state at a time:
 *   idle → scanning → recognized → confirm → resolving → resolved
 *                                              ↘ not_found → manual (VIN → marque/modèle)
 *                                              ↘ error
 * Every call goes to /api/* with the session cookie the server set at /login
 * (HttpOnly — this script never sees it) plus the header X-IDauto-Session: 1.
 * No token is asked for, stored or displayed. A 401 sends the visitor back
 * to /login. No inline script, no eval, no external origin. Errors shown to
 * the mechanic are the server's message_fr — never a technical string.
 */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var panels = { identify: $('[data-panel="identify"]'), fiche: $('[data-panel="fiche"]'), parts: $('[data-panel="parts"]'), workshop: $('[data-panel="workshop"]') };

  var state = { vehicle: null, candidate: null, plate: null, lastPlate: null, visit: null, selectedPart: null, identMethod: 'plate' };

  var LABELS = { idle: 'En attente', scanning: 'Lecture caméra', recognized: 'Plaque lue', confirm: 'À confirmer', resolving: 'Recherche…', resolved: 'Véhicule identifié', not_found: 'Introuvable', error: 'Erreur', manual: 'Saisie manuelle' };
  var GENERIC_FR = "La demande n'a pas abouti. Réessayez dans un instant.";

  var me = null;   // { name, email, role, org_id } from the server, never from the page
  function orgQuery() { var o = ($('#at-org').value || '').trim(); return o ? '?org_id=' + encodeURIComponent(o) : ''; }
  function orgBody(body) { var o = ($('#at-org').value || '').trim(); if (o) body.org_id = parseInt(o, 10); return body; }
  function toLogin() { location.replace('/login?next=' + encodeURIComponent('/atelier')); }

  async function api(method, path, body) {
    var headers = { 'Accept': 'application/json', 'X-IDauto-Session': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    var res, json = null;
    try {
      res = await fetch(path, { method: method, credentials: 'same-origin', headers: headers, body: body ? JSON.stringify(body) : undefined });
      try { json = await res.json(); } catch (e) { json = null; }
    } catch (e) {
      throw { status: 0, error: 'NETWORK_FAILURE', message_fr: 'Problème de connexion. Réessayez dans un instant.' };
    }
    if (res.status === 401) { toLogin(); throw { status: 401, error: 'unauthenticated', message_fr: 'Session expirée. Reconnectez-vous.' }; }
    if (!res.ok) {
      var msg = (json && json.message_fr) || (res.status === 403 ? "Votre compte n'a pas le droit nécessaire." : res.status === 429 ? 'Trop de demandes. Patientez une minute.' : GENERIC_FR);
      throw { status: res.status, error: (json && json.error) || 'request_error', message_fr: msg, details: json && json.details };
    }
    return json;
  }

  /* ---------------- identification state machine ---------------- */
  function setState(s) {
    panels.identify.setAttribute('data-state', s);
    $('[data-ident-badge]').textContent = LABELS[s] || s;
    $('[data-ident-confirm]').hidden = s !== 'confirm';
    $('[data-ident-candidate]').hidden = !(s === 'resolved' && state.candidate);
    $('[data-ident-manual]').hidden = !(s === 'not_found' || s === 'manual');
    $('[data-ident-error]').hidden = s !== 'error';
  }
  function status(msg) { $('[data-ident-status]').textContent = msg || ''; }
  function showError(err) {
    $('[data-ident-error-title]').textContent = err && err.error === 'PROVIDER_TIMEOUT' ? 'Service lent' : err && err.error === 'PROVIDER_UNAVAILABLE' ? 'Service indisponible' : 'Impossible de continuer';
    $('[data-ident-error-body]').textContent = (err && err.message_fr) || GENERIC_FR;
    setState('error');
  }
  function plateInput() {
    var serie = ($('#at-serie').value || '').replace(/\D/g, ''), numero = ($('#at-numero').value || '').replace(/\D/g, '');
    if (!serie || !numero) return null;
    return serie + ' ' + $('#at-type').value + ' ' + numero;
  }

  async function resolvePlate(opts) {
    opts = opts || {};
    var plate = plateInput();
    if (!plate) { status('Indiquez la série et le numéro de la plaque.'); return; }
    setState('resolving'); status('Recherche du véhicule…');
    try {
      var body = { plate: plate, method: opts.method || 'manual', confirmed: !!opts.confirmed };
      if (typeof opts.confidence === 'number') body.ocr_confidence = opts.confidence;
      var r = await api('POST', '/api/resolve/plate', body);
      state.plate = r.plate; state.lastPlate = plate;
      if (r.status === 'needs_confirmation') {
        $('[data-ident-confirm-note]').textContent = 'Lu : ' + r.plate.display + ' (confiance ' + Math.round((r.plate.confidence || 0) * 100) + ' %). Corrigez les chiffres si besoin, puis confirmez.';
        setState('confirm'); status(''); return;
      }
      handleResolution(r, 'plate');
    } catch (err) { showError(err); }
  }

  async function resolveVin() {
    var vin = ($('#at-vin').value || '').trim().toUpperCase();
    if (!vin) { status('Saisissez le VIN.'); return; }
    setState('resolving'); status('Recherche par VIN…');
    try { handleResolution(await api('POST', '/api/resolve/vin', { vin: vin }), 'vin'); }
    catch (err) { if (err.status === 403) { $('[data-ident-manual-note]').textContent = "Ce jeton n'a pas le droit de recherche par VIN. Utilisez marque, modèle et motorisation."; setState('manual'); status(''); } else showError(err); }
  }

  async function resolveManual() {
    var sel = { manufacturer: $('#at-make').value, model: $('#at-model').value, motorisation: $('#at-motor').value, year: $('#at-year').value, engine_code: $('#at-engine').value, tecdoc_car_id: $('#at-tecdoc').value };
    if (!sel.manufacturer || !sel.model) { status('Marque et modèle sont nécessaires.'); return; }
    setState('resolving'); status('Recherche…');
    try { handleResolution(await api('POST', '/api/resolve/manual', sel), 'manual_selection'); }
    catch (err) { showError(err); }
  }

  function describeCandidate(c) {
    return [c.manufacturer, c.model, c.version, c.motorisation, c.engine_code ? 'moteur ' + c.engine_code : null, c.year || (c.year_from ? c.year_from + '–' + (c.year_to || '') : null)].filter(Boolean).join(' · ');
  }

  function handleResolution(r, method) {
    state.identMethod = method;
    if (r.status === 'resolved') {
      state.candidate = null; state.vehicle = r.vehicle;
      setState('resolved'); status('Véhicule trouvé (' + (r.source === 'local' ? 'base IDauto' : r.source) + ').');
      renderFiche(r.vehicle); showParts(); showWorkshop();
      return;
    }
    if (r.status === 'candidate') {
      state.candidate = r; state.vehicle = null;
      $('[data-ident-candidate-body]').textContent = describeCandidate(r.candidate) || 'Identification proposée';
      $('[data-ident-candidate-source]').textContent = 'Source : ' + r.source + ' · confiance ' + Math.round((r.confidence || 0) * 100) + ' %' + (r.alternatives && r.alternatives.length ? ' · ' + r.alternatives.length + ' véhicules similaires déjà enregistrés' : '');
      setState('resolved'); status('Vérifiez la proposition avant de confirmer.');
      return;
    }
    var note = method === 'plate' ? 'Véhicule introuvable par la plaque. Saisissez le VIN, ou choisissez marque, modèle et motorisation.' : method === 'vin' ? 'Aucun véhicule pour ce VIN. Choisissez marque, modèle et motorisation.' : 'Aucun véhicule correspondant.';
    if (r.provider_errors && r.provider_errors.length) note += ' Le service externe n\'a pas répondu ; la base locale et la saisie manuelle restent disponibles.';
    $('[data-ident-manual-note]').textContent = note;
    setState('not_found'); status('');
  }

  async function confirmCandidate() {
    if (!state.candidate) return;
    var c = state.candidate;
    var body = { candidate: c.candidate, method: state.identMethod === 'plate' ? (c.plate && c.plate.confidence !== null ? 'plate_ocr' : 'plate_manual') : state.identMethod === 'vin' ? 'vin' : 'manual_selection', source: c.source, confidence: c.confidence };
    if (state.lastPlate && state.identMethod !== 'vin') body.plate = state.lastPlate;
    if (c.candidate && c.candidate.vin) body.vin = c.candidate.vin;
    if (state.identMethod === 'vin' && c.vin) body.vin = c.vin.vin;
    setState('resolving'); status('Enregistrement…');
    try {
      var r = state.visit ? await api('POST', '/api/workshop/visits/' + state.visit.id + '/identification', orgBody(body)) : await api('POST', '/api/resolve/confirm', body);
      var vehicle = r.vehicle;
      if (r.visit) state.visit = r.visit;
      state.vehicle = vehicle; state.candidate = null;
      setState('resolved'); status('Véhicule confirmé et enregistré.');
      renderFiche(vehicle); showParts(); showWorkshop();
    } catch (err) { showError(err); }
  }

  /* ---------------- fiche ---------------- */
  var FICHE_FIELDS = [['Plaque', 'plate_display'], ['VIN', 'vin'], ['Marque', 'manufacturer'], ['Modèle', 'model'], ['Version', 'version'], ['Motorisation', 'motorisation'], ['Code moteur', 'engine_code'], ['Année', 'year'], ['Identifiant catalogue', 'tecdoc_car_id'], ['Source', 'source'], ['Confiance', 'confidence'], ['Dernière vérification', 'verified_at'], ['Vérifié par', 'verified_by'], ['Méthode', 'verification_method'], ['Identifiant IDauto', 'id']];
  function fmt(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'confidence') return Math.round(v * 100) + ' %';
    if (k === 'verified_at') return new Date(v).toLocaleString('fr-TN');
    if (k === 'vin' && v === undefined) return 'non divulgué';
    return String(v);
  }
  function renderFiche(v) {
    panels.fiche.hidden = false;
    var dl = $('[data-fiche-fields]'); dl.textContent = '';
    FICHE_FIELDS.forEach(function (f) {
      if (f[1] === 'vin' && v.vin === undefined) { if (!v.vin_present) return; }
      var div = document.createElement('div'); var dt = document.createElement('dt'); var dd = document.createElement('dd');
      dt.textContent = f[0]; dd.textContent = f[1] === 'vin' && v.vin === undefined ? 'présent, non divulgué à ce jeton' : fmt(f[1], v[f[1]]);
      div.appendChild(dt); div.appendChild(dd); dl.appendChild(div);
    });
    var badge = $('[data-fiche-verified]');
    badge.textContent = v.verified ? 'Vérifié' : 'Non vérifié';
    badge.className = 'ida-status ' + (v.verified ? 'ida-status--verified' : 'ida-status--pending');
    $('[data-fiche-edit]').hidden = true; $('[data-fiche-history]').hidden = true;
  }
  function ficheStatus(m) { $('[data-fiche-status]').textContent = m || ''; }
  async function ficheConfirm() {
    if (!state.vehicle) return;
    try { var r = await api('POST', '/api/resolve/confirm', { vehicle_ref: state.vehicle.id, candidate: {}, method: 'admin', source: 'manual' }); state.vehicle = r.vehicle; renderFiche(r.vehicle); ficheStatus('Identification confirmée.'); }
    catch (err) { ficheStatus(err.message_fr || GENERIC_FR); }
  }
  function ficheEdit() {
    var v = state.vehicle; if (!v) return;
    $('#fe-make').value = v.manufacturer || ''; $('#fe-model').value = v.model || ''; $('#fe-version').value = v.version || ''; $('#fe-motor').value = v.motorisation || '';
    $('#fe-engine').value = v.engine_code || ''; $('#fe-year').value = v.year || ''; $('#fe-tecdoc').value = v.tecdoc_car_id || ''; $('#fe-vin').value = v.vin || '';
    $('[data-fiche-edit]').hidden = false;
  }
  async function ficheSave() {
    var body = { vehicle_ref: state.vehicle.id, action: 'edit', method: 'admin', source: 'manual', candidate: { manufacturer: $('#fe-make').value, model: $('#fe-model').value, version: $('#fe-version').value, motorisation: $('#fe-motor').value, engine_code: $('#fe-engine').value, year: $('#fe-year').value, tecdoc_car_id: $('#fe-tecdoc').value } };
    if (($('#fe-vin').value || '').trim()) body.vin = $('#fe-vin').value.trim();
    try { var r = await api('POST', '/api/resolve/confirm', body); state.vehicle = r.vehicle; renderFiche(r.vehicle); ficheStatus('Correction enregistrée.'); showParts(); }
    catch (err) { ficheStatus(err.message_fr || GENERIC_FR); }
  }
  async function ficheRefresh() {
    try {
      var r = await api('POST', '/api/vehicles/' + encodeURIComponent(state.vehicle.id) + '/identification/refresh', {});
      if (!r.providers_configured) ficheStatus('Aucun service externe configuré : la fiche reste celle de la base IDauto.');
      else if (r.status === 'candidate') { state.candidate = { candidate: r.proposals[0].candidate, source: r.proposals[0].source, confidence: r.proposals[0].confidence }; $('[data-ident-candidate-body]').textContent = describeCandidate(r.proposals[0].candidate); $('[data-ident-candidate-source]').textContent = 'Source : ' + r.proposals[0].source; setState('resolved'); ficheStatus('Une mise à jour est proposée ci-dessus.'); }
      else ficheStatus('Aucune mise à jour proposée.' + (r.provider_errors.length ? ' Le service externe n\'a pas répondu.' : ''));
    } catch (err) { ficheStatus(err.message_fr || GENERIC_FR); }
  }
  async function ficheHistory() {
    try {
      var r = await api('GET', '/api/vehicles/' + encodeURIComponent(state.vehicle.id) + '/identification/history');
      var ol = $('[data-fiche-history]'); ol.textContent = '';
      if (!r.history.length) { var li0 = document.createElement('li'); li0.textContent = 'Aucun changement enregistré.'; ol.appendChild(li0); }
      r.history.forEach(function (h) {
        var li = document.createElement('li');
        li.textContent = new Date(h.changed_at).toLocaleString('fr-TN') + ' — ' + h.action + ' (' + (h.method || '?') + ', ' + (h.source || '?') + ') par ' + (h.actor_ref || h.actor_type) + (h.next ? ' → ' + describeCandidate({ manufacturer: h.next.make, model: h.next.model, motorisation: h.next.motorisation, year: h.next.year }) : '');
        ol.appendChild(li);
      });
      ol.hidden = false;
    } catch (err) { ficheStatus(err.message_fr || GENERIC_FR); }
  }

  /* ---------------- parts ---------------- */
  function showParts() { panels.parts.hidden = false; partsCompatible(); }
  function renderParts(result) {
    var sup = result.supplier || {};
    $('[data-parts-supplier]').textContent = (sup.status && sup.status.configured ? 'Catalogue fournisseur : ' + sup.status.provider : 'Catalogue fournisseur non configuré — pièces du catalogue local uniquement.') + (sup.error && sup.error !== 'CATALOG_NOT_CONFIGURED' ? ' ' + (sup.message_fr || '') : '');
    var list = $('[data-parts-list]'); list.textContent = '';
    if (!result.parts.length) { var p = document.createElement('p'); p.className = 'ida-small ida-muted'; p.textContent = 'Aucune pièce connue pour ce véhicule. Ajoutez une référence ci-dessous.'; list.appendChild(p); return; }
    result.parts.forEach(function (part) {
      var card = document.createElement('button'); card.type = 'button'; card.className = 'ida-atelier-part'; card.setAttribute('data-part-id', part.id);
      var ref = document.createElement('span'); ref.className = 'ida-atelier-part-ref'; ref.textContent = part.reference + ' · ' + part.brand;
      var name = document.createElement('span'); name.textContent = (part.category ? part.category + ' — ' : '') + (part.name || '');
      var meta = document.createElement('span'); meta.className = 'ida-atelier-part-meta';
      var avail = part.availability === undefined ? '' : part.availability ? (part.availability.in_stock ? 'En stock (' + part.availability.quantity + ')' : 'Rupture') + (part.availability.price_millimes != null ? ' · ' + (part.availability.price_millimes / 1000).toFixed(3) + ' TND' : '') : 'Stock inconnu';
      meta.textContent = ['OE ' + (part.oe_reference || '—'), 'source ' + part.source, avail].filter(Boolean).join(' · ');
      card.appendChild(ref); card.appendChild(name); card.appendChild(meta);
      if (state.selectedPart && state.selectedPart.id === part.id) card.classList.add('is-selected');
      card.addEventListener('click', function () { state.selectedPart = part; $$('.ida-atelier-part').forEach(function (c) { c.classList.toggle('is-selected', c === card); }); $('#op-part').value = part.reference + ' · ' + part.brand + (part.source !== 'local' ? ' (' + part.source + ' — non commandable ici)' : ''); });
      list.appendChild(card);
    });
  }
  async function partsCompatible() {
    if (!state.vehicle) return;
    try { renderParts(await api('GET', '/api/vehicles/' + encodeURIComponent(state.vehicle.id) + '/parts' + orgQuery())); }
    catch (err) { $('[data-parts-supplier]').textContent = err.message_fr || GENERIC_FR; }
  }
  async function partsSearch() {
    var q = ($('#at-parts-q').value || '').trim(); if (!q) return partsCompatible();
    try { renderParts(await api('GET', '/api/parts/search?q=' + encodeURIComponent(q) + (orgQuery() ? '&' + orgQuery().slice(1) : ''))); }
    catch (err) { $('[data-parts-supplier]').textContent = err.message_fr || GENERIC_FR; }
  }
  async function partsAdd() {
    try {
      var part = await api('POST', '/api/parts', { reference: $('#np-ref').value, brand: $('#np-brand').value, oe_reference: $('#np-oe').value, category: $('#np-cat').value, name: $('#np-name').value });
      await api('POST', '/api/parts/' + part.local_id + '/compatibility', { vehicle_ref: state.vehicle.id });
      var qty = parseInt($('#np-qty').value || '0', 10), price = $('#np-price').value ? parseInt($('#np-price').value, 10) : null;
      try { await api('PUT', '/api/parts/' + part.local_id + '/stock', orgBody({ quantity: isFinite(qty) ? qty : 0, price_millimes: price })); } catch (e) { /* stock is optional (needs stock:write) */ }
      partsCompatible();
    } catch (err) { $('[data-parts-supplier]').textContent = err.message_fr || GENERIC_FR; }
  }

  /* ---------------- workshop ---------------- */
  function showWorkshop() { panels.workshop.hidden = false; }
  function visitStatus(m) { $('[data-visit-status]').textContent = m || ''; }
  function renderVisit(v) {
    state.visit = v;
    $('[data-visit-badge]').textContent = 'Visite n° ' + v.id + ' · ' + v.status;
    $('[data-visit-body]').hidden = v.status === 'closed' || v.status === 'cancelled';
    var ul = $('[data-visit-ops]'); ul.textContent = '';
    (v.operations || []).forEach(function (o) { var li = document.createElement('li'); li.textContent = o.operation_type + (o.description ? ' — ' + o.description : '') + (o.part_id ? ' · pièce ' + o.part_id + ' ×' + o.quantity : '') + ' [' + o.status + ']'; ul.appendChild(li); });
    (v.orders || []).forEach(function (o) { var li = document.createElement('li'); li.textContent = 'Commande n° ' + o.id + ' [' + o.status + ']'; ul.appendChild(li); });
  }
  async function visitOpen() {
    try {
      var body = orgBody({ customer_ref: $('#at-customer').value || undefined, reason: $('#at-reason').value || undefined });
      if (state.vehicle) { body.plate = state.vehicle.plate || undefined; if (!body.plate) body.selection = { manufacturer: state.vehicle.manufacturer, model: state.vehicle.model, motorisation: state.vehicle.motorisation, year: state.vehicle.year, tecdoc_car_id: state.vehicle.tecdoc_car_id }; body.plate_read_method = state.plate && state.plate.confidence !== null ? 'camera_ocr' : 'manual'; body.plate_confirmed = true; }
      var r = await api('POST', '/api/workshop/visits', body);
      renderVisit(r.visit); visitStatus('Visite ouverte.');
    } catch (err) { visitStatus(err.message_fr || GENERIC_FR); }
  }
  async function opAdd() {
    if (!state.visit) return visitStatus('Ouvrez d\'abord la visite.');
    var body = orgBody({ operation_type: $('#op-type').value, description: $('#op-desc').value, quantity: parseInt($('#op-qty').value || '1', 10) });
    if (state.selectedPart && state.selectedPart.source === 'local') body.part_id = state.selectedPart.id;
    try { await api('POST', '/api/workshop/visits/' + state.visit.id + '/operations', body); renderVisit(await api('GET', '/api/workshop/visits/' + state.visit.id + orgQuery())); visitStatus('Opération ajoutée.'); }
    catch (err) { visitStatus(err.message_fr || GENERIC_FR); }
  }
  async function orderCreate() {
    if (!state.visit) return visitStatus('Ouvrez d\'abord la visite.');
    var lines = (state.visit.operations || []).filter(function (o) { return o.part_id && o.status !== 'cancelled'; }).map(function (o) { return { part_id: o.part_id, quantity: o.quantity }; });
    if (!lines.length) return visitStatus('Aucune pièce du catalogue local dans les opérations.');
    try { var o = await api('POST', '/api/workshop/orders', orgBody({ visit_id: state.visit.id, lines: lines })); renderVisit(await api('GET', '/api/workshop/visits/' + state.visit.id + orgQuery())); visitStatus('Commande n° ' + o.id + ' créée (brouillon).'); }
    catch (err) { visitStatus(err.message_fr || GENERIC_FR); }
  }
  async function visitClose() {
    if (!state.visit) return;
    try { renderVisit(await api('POST', '/api/workshop/visits/' + state.visit.id + '/close', orgBody({}))); visitStatus('Visite clôturée.'); }
    catch (err) { visitStatus(err.message_fr || GENERIC_FR); }
  }

  /* ---------------- scanner ---------------- */
  var scanner = window.IdaPlateScanner;
  var scanEls = { root: $('[data-scan-root]') };
  if (scanner && scanEls.root) {
    scanEls.video = $('[data-scan-video]', scanEls.root);
    scanner.configure({ engineBase: '/atelier/assets/tesseract/' });
    scanner.bind(scanEls);
  }
  function openScanner() {
    if (!scanner || !scanEls.root) return;
    setState('scanning'); status('');
    scanner.open({ els: scanEls, onPlate: function (read) {
      $('#at-serie').value = read.serie; $('#at-numero').value = read.numero;
      setState('recognized'); status('Plaque lue : ' + read.serie + ' ' + $('#at-type').value + ' ' + read.numero + '.');
      resolvePlate({ method: 'camera_ocr', confidence: typeof read.confidence === 'number' ? read.confidence : undefined, confirmed: read.auto === false });
    } });
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]'); if (!t) return;
    var a = t.getAttribute('data-action');
    if (a === 'logout') return logout();
    if (a === 'scan') return openScanner();
    if (a === 'resolve-plate') return resolvePlate({ method: 'manual' });
    if (a === 'confirm-plate') return resolvePlate({ method: 'camera_ocr', confidence: state.plate ? state.plate.confidence : undefined, confirmed: true });
    if (a === 'show-manual') { setState('manual'); $('[data-ident-manual-note]').textContent = 'Saisissez le VIN, ou choisissez marque, modèle et motorisation.'; return; }
    if (a === 'resolve-vin') return resolveVin();
    if (a === 'resolve-manual') return resolveManual();
    if (a === 'confirm-candidate') return confirmCandidate();
    if (a === 'fiche-confirm') return ficheConfirm();
    if (a === 'fiche-edit') return ficheEdit();
    if (a === 'fiche-edit-cancel') { $('[data-fiche-edit]').hidden = true; return; }
    if (a === 'fiche-save') return ficheSave();
    if (a === 'fiche-refresh') return ficheRefresh();
    if (a === 'fiche-history') return ficheHistory();
    if (a === 'parts-search') return partsSearch();
    if (a === 'parts-compatible') return partsCompatible();
    if (a === 'parts-add') return partsAdd();
    if (a === 'visit-open') return visitOpen();
    if (a === 'op-add') return opAdd();
    if (a === 'order-create') return orderCreate();
    if (a === 'visit-close') return visitClose();
  });
  var ROLE_FR = { admin: 'administrateur', manager: 'gestionnaire', technician: 'technicien' };
  async function loadSession() {
    var s = null;
    try { var r = await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); s = r.ok ? await r.json() : null; } catch (e) { s = null; }
    if (!s || !s.user) return toLogin();
    me = { name: s.user.name, email: s.user.email, role: s.user.role, org_id: s.user.org_id };
    $('[data-user-line]').textContent = 'Connecté : ' + me.name + ' · ' + (ROLE_FR[me.role] || me.role) + (me.org_id ? ' · organisation ' + me.org_id : '');
    $('[data-admin-org]').hidden = me.role !== 'admin';
    try { var c = await api('GET', '/api/catalog/status'); $('[data-catalog-status]').textContent = c.supplier.configured ? 'Catalogue fournisseur : ' + c.supplier.provider : c.supplier.message_fr + ' Le catalogue local reste disponible.'; }
    catch (err) { $('[data-catalog-status]').textContent = err.message_fr || GENERIC_FR; }
  }
  async function logout() {
    try { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); } catch (e) { /* the cookie is server-side; /login will confirm */ }
    location.replace('/login');
  }
  loadSession();
  setState('idle');
})();
