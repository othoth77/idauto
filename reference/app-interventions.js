'use strict';
/* IDauto — IDA-UI-4 — interventions (simplified, 2026-11-06).
 *   /atelier/interventions              list + search (GET /api/workspace/interventions?q=)
 *   /atelier/interventions?new=1[&vehicle=IVID]   the form (POST /api/workspace/interventions)
 *   /atelier/interventions?id=N         the same form, filled, to edit (PUT …/:id) or cancel (DELETE …/:id)
 * One intervention = vehicle, date, mileage, description, technician, and any number of parts,
 * each with its DECLARED source: bought from us, or supplied by the customer. Every value is textContent. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var params = new URLSearchParams(location.search), ID = params.get('id'), NEW = params.get('new') === '1';
  var status = document.getElementById('page-status'), form = document.getElementById('iv-form');
  var me = null, chosen = null, rowSeq = 0;
  function enc(v) { return encodeURIComponent(v); }
  function say(kind, text) { clear(status); if (text) status.appendChild(el('p', { class: 'ida-alert ida-alert--' + kind, role: kind === 'danger' ? 'alert' : null }, text)); }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function vehicleText(v) { return [v.plate ? v.plate : null, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || v.ivid; }
  Array.prototype.forEach.call(document.querySelectorAll('dialog [data-close]'), function (b) { b.addEventListener('click', function () { b.closest('dialog').close(''); }); });

  // ---- list -----------------------------------------------------------------
  var list = document.getElementById('list'), q = document.getElementById('f-q');
  q.value = params.get('q') || '';
  async function loadList() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/interventions' + (q.value.trim() ? '?q=' + enc(q.value.trim()) : ''));
      list.setAttribute('aria-busy', 'false'); clear(list);
      list.appendChild(el('p', { class: 'ida-small ida-muted', id: 'list-total' }, t('# intervention(s)').replace('#', String(out.total))));
      if (!out.interventions.length) { list.appendChild(el('p', { class: 'ida-empty' }, q.value ? t('Aucune intervention ne correspond.') : t('Aucune intervention pour le moment.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Date', 'Véhicule', 'Kilométrage', 'Travail effectué', 'Pièces', 'Technicien'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.interventions.map(function (iv) {
          var parts = iv.operations.filter(function (o) { return o.part; });
          return el('tr', null, [el('td', null, el('a', { href: '/atelier/interventions?id=' + iv.id }, C.date(iv.date))),
            el('td', null, iv.vehicle ? el('a', { href: '/atelier/vehicule?ref=' + enc(iv.vehicle.ivid) }, [C.plate(iv.vehicle.plate, iv.vehicle.plate), ' ', [iv.vehicle.make, iv.vehicle.model].filter(Boolean).join(' ')]) : '—'),
            el('td', null, iv.odometer_km !== null && iv.odometer_km !== undefined ? C.km(iv.odometer_km) : '—'),
            el('td', null, iv.reason ? el('span', { class: 'ida-pre', translate: 'no' }, iv.reason) : '—'),
            el('td', null, String(parts.length)), el('td', null, iv.technician ? iv.technician.name : '—')]);
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); history.replaceState(null, '', q.value.trim() ? '?q=' + enc(q.value.trim()) : location.pathname); loadList(); });

  // ---- form: vehicle chooser ------------------------------------------------
  var vq = document.getElementById('f-vehicle-q'), vres = document.getElementById('vehicle-results'), vchosen = document.getElementById('vehicle-chosen');
  function choose(v) {
    chosen = v; clear(vres); clear(vchosen);
    vchosen.appendChild(el('span', null, [t('Véhicule choisi') + ' : ', el('strong', null, vehicleText(v))]));
    if (v.odometer_km !== null && v.odometer_km !== undefined) vchosen.appendChild(el('span', { class: 'ida-muted' }, [' · ' + t('dernier kilométrage') + ' ', C.km(v.odometer_km)]));
  }
  async function searchVehicles() {
    clear(vres);
    var s = vq.value.trim(); if (!s) return;
    try {
      var out = await C.api('/api/workspace/vehicles?q=' + enc(s));
      if (!out.vehicles.length) { vres.appendChild(el('p', { class: 'ida-small' }, [t('Aucun véhicule trouvé.') + ' ', el('a', { href: '/atelier/vehicules/nouveau' }, t('Ajouter un véhicule'))])); return; }
      vres.appendChild(el('ul', { class: 'ida-op-list', id: 'vehicle-options' }, out.vehicles.slice(0, 8).map(function (v) {
        var b = el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm', 'data-ivid': v.ivid }, t('Choisir'));
        b.addEventListener('click', function () { choose(v); });
        return el('li', { class: 'ida-op' }, [el('span', null, [C.plate(v.plate, v.plate), ' ', [v.make, v.model, v.year].filter(Boolean).join(' ')]), b]);
      })));
    } catch (e) { vres.appendChild(el('p', { class: 'ida-field-error' }, C.errorText(e))); }
  }
  document.getElementById('vehicle-search').addEventListener('click', searchVehicles);
  vq.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); searchVehicles(); } });

  // ---- form: parts ------------------------------------------------------------
  var partsBox = document.getElementById('parts'), noParts = document.getElementById('no-parts');
  function refreshEmpty() { noParts.hidden = partsBox.children.length > 0; }
  function addPart(p) {
    p = p || {}; var n = ++rowSeq, name = 'src-' + n;
    function radio(value, label) {
      var i = el('input', { type: 'radio', name: name, value: value, required: true });
      if (p.source === value) i.checked = true;
      return el('label', { class: 'ida-radio' }, [i, ' ', t(label)]);
    }
    var remove = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm ida-part-remove' }, t('Retirer'));
    var row = el('div', { class: 'ida-part-row', 'data-part': '', 'data-id': p.id ? String(p.id) : null }, [
      el('div', { class: 'ida-field' }, [el('label', { for: 'p-label-' + n, class: 'ida-required' }, t('Pièce')), el('input', { class: 'ida-input', id: 'p-label-' + n, 'data-f': 'label', maxlength: '120', autocomplete: 'off', value: p.label || '' })]),
      el('div', { class: 'ida-field' }, [el('label', { for: 'p-ref-' + n }, t('Référence')), el('input', { class: 'ida-input', id: 'p-ref-' + n, 'data-f': 'reference', maxlength: '60', autocomplete: 'off', dir: 'ltr', value: p.reference || '' })]),
      el('div', { class: 'ida-field' }, [el('label', { for: 'p-qty-' + n }, t('Quantité')), el('input', { class: 'ida-input', id: 'p-qty-' + n, 'data-f': 'quantity', inputmode: 'numeric', maxlength: '3', value: String(p.quantity || 1) })]),
      el('fieldset', { class: 'ida-radio-group ida-radio-inline', 'data-source': '' }, [el('legend', { class: 'ida-label' }, t('Provenance')), radio('our_shop', 'Achetée chez nous'), radio('customer_supplied', 'Fournie par le client')]),
      remove]);
    remove.addEventListener('click', function () { row.remove(); refreshEmpty(); });
    partsBox.appendChild(row); refreshEmpty();
    return row;
  }
  document.getElementById('add-part').addEventListener('click', function () { var r = addPart(); r.querySelector('[data-f=label]').focus(); });

  function collect() {
    return Array.prototype.map.call(partsBox.querySelectorAll('[data-part]'), function (r) {
      var src = r.querySelector('input[type=radio]:checked');
      return { id: r.getAttribute('data-id') || undefined, label: r.querySelector('[data-f=label]').value, reference: r.querySelector('[data-f=reference]').value,
        quantity: r.querySelector('[data-f=quantity]').value, source: src ? src.value : null };
    });
  }

  // ---- form: technician (managers / admins choose; a technician is recorded as themself) ----
  async function loadTechnicians(selected) {
    if (!me || me.role === 'technician') return;
    try {
      var out = await C.api('/api/workspace/technicians'), sel = document.getElementById('f-tech');
      clear(sel); sel.appendChild(el('option', { value: '' }, t('Moi-même')));
      out.people.forEach(function (p) { if (p.id) sel.appendChild(el('option', { value: 'user:' + p.id }, p.name + (p.org && me.role === 'admin' ? ' · ' + p.org : ''))); });
      if (selected) sel.value = selected;
      document.getElementById('tech-field').hidden = out.people.length === 0;
    } catch (e) { /* the field stays hidden */ }
  }
  async function loadOrgs(current) {
    if (!me || me.role !== 'admin') return;
    try {
      var out = await C.api('/api/admin/organisations?status=active&page_size=100'), sel = document.getElementById('f-org');
      clear(sel); out.results.forEach(function (o) { sel.appendChild(el('option', { value: String(o.id) }, o.name)); });
      if (current) sel.value = String(current);
      document.getElementById('org-field').hidden = out.results.length < 2 || !!ID;
    } catch (e) { /* the server picks the only active workshop */ }
  }

  async function openForm(existing) {
    document.getElementById('list-box').hidden = true; form.hidden = false;
    document.getElementById('f-date').value = today(); document.getElementById('f-date').max = today();
    await Promise.all([loadTechnicians(existing ? existing.technician_ref : null), loadOrgs(existing ? existing.org.id : null)]);
    if (existing) {
      document.getElementById('sec-form').textContent = t('Intervention du') + ' ' + C.date(existing.date);
      document.getElementById('vehicle-field').hidden = true;
      chosen = existing.vehicle;
      document.getElementById('f-date').value = String(existing.performed_on || existing.opened_at).slice(0, 10);
      document.getElementById('f-km').value = existing.odometer_km === null || existing.odometer_km === undefined ? '' : existing.odometer_km;
      document.getElementById('f-desc').value = existing.reason || '';
      existing.operations.filter(function (o) { return o.part; }).forEach(function (o) { addPart({ id: o.id, label: o.part.label, reference: o.part.reference, quantity: o.quantity, source: o.part.source }); });
      document.getElementById('iv-submit').textContent = t('Enregistrer les modifications');
      var cancelBtn = document.getElementById('iv-cancel-record'); cancelBtn.hidden = existing.status === 'cancelled';
      cancelBtn.addEventListener('click', cancelRecord);
      document.querySelector('.ida-page-head h1').textContent = t('Intervention');
    } else {
      var ref = params.get('vehicle');
      if (ref) { try { var d = await C.api('/api/vehicles/' + enc(ref) + '/dossier'); choose({ ivid: d.vehicle.ivid, plate: d.vehicle.plate, make: d.vehicle.make, model: d.vehicle.model, odometer_km: d.vehicle.odometer_km }); } catch (e) { /* choose by search */ } }
      if (!chosen) vq.focus();
    }
    refreshEmpty();
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var errBox = document.getElementById('form-errors'); clear(errBox);
    var problems = [];
    if (!chosen) problems.push(t('Choisissez le véhicule.'));
    var parts = collect();
    if (!document.getElementById('f-desc').value.trim() && !parts.length) problems.push(t('Décrivez le travail effectué.'));
    parts.forEach(function (p, i) {
      if (!p.label.trim()) problems.push(t('Pièce') + ' ' + (i + 1) + ' : ' + t('indiquez le nom de la pièce.'));
      if (!p.source) problems.push(t('Pièce') + ' ' + (i + 1) + ' : ' + t('choisissez la provenance.'));
    });
    if (problems.length) { errBox.appendChild(el('div', { class: 'ida-alert ida-alert--danger', role: 'alert' }, el('ul', null, problems.map(function (p) { return el('li', null, p); })))); return; }
    var body = { performed_on: document.getElementById('f-date').value, odometer_km: document.getElementById('f-km').value.replace(/[\s.]/g, ''), description: document.getElementById('f-desc').value,
      technician: document.getElementById('f-tech').value || null, parts: parts };
    var submit = document.getElementById('iv-submit'); submit.disabled = true;
    try {
      if (ID) { await C.send('PUT', '/api/workspace/interventions/' + enc(ID), body); location.href = '/atelier/interventions?id=' + enc(ID) + '&saved=1'; }
      else {
        body.vehicle_ref = chosen.ivid; if (me.role === 'admin' && !document.getElementById('org-field').hidden) body.org_id = document.getElementById('f-org').value;
        var out = await C.send('POST', '/api/workspace/interventions', body); location.href = '/atelier/interventions?id=' + out.id + '&saved=1';
      }
    } catch (err) { submit.disabled = false; errBox.appendChild(el('p', { class: 'ida-alert ida-alert--danger', role: 'alert' }, C.errorText(err))); }
  });

  async function cancelRecord() {
    var d = document.getElementById('confirm-dialog'); document.getElementById('confirm-text').textContent = t('Annuler cette intervention ? Elle reste dans l\'historique comme annulée, et ses pièces ne sont plus comptées.');
    var yes = await new Promise(function (res) { d.returnValue = ''; d.showModal(); d.addEventListener('close', function h() { d.removeEventListener('close', h); res(d.returnValue === 'yes'); }); });
    if (!yes) return;
    try { await C.send('DELETE', '/api/workspace/interventions/' + enc(ID)); location.href = '/atelier/interventions'; }
    catch (e) { say('danger', C.errorText(e)); }
  }

  var newBtn = document.getElementById('act-new-intervention');
  if (newBtn) newBtn.addEventListener('click', function () { location.href = '/atelier/interventions?new=1'; });

  (async function () {
    me = await C.sessionLine(null, location.pathname + location.search); if (!me) return;
    if (ID) {
      try {
        var out = await C.api('/api/workspace/interventions?id=' + enc(ID) + '&status=' + 'any');
        var iv = out.interventions[0];
        if (!iv) { say('danger', t('Intervention introuvable.')); return; }
        if (params.get('saved')) say('success', t('Intervention enregistrée.'));
        if (iv.status === 'cancelled') say('info', t('Cette intervention est annulée.'));
        await openForm(iv);
      } catch (e) { say('danger', C.errorText(e)); }
    } else if (NEW) await openForm(null);
    else loadList();
  }());
}());
