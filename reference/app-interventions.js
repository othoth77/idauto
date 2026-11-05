'use strict';
/* IDauto — IDA-UI-3 — interventions: list, open one, record what was done.
 *   GET  /api/workspace/interventions[?status|id]   (own workshop; admin: all)
 *   POST /api/workshop/visits {vehicle_ref, reason}  open an intervention on a chosen vehicle
 *   POST /api/workshop/visits/:id/operations         one operation = one part at most, with its DECLARED source
 *   POST /api/workshop/visits/:id/operations/:op/status, /close, /cancel
 * The technician is the signed-in account (recorded by the server). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var params = new URLSearchParams(location.search);
  var list = document.getElementById('list'), detailBox = document.getElementById('detail-box'), detail = document.getElementById('detail');
  var opForm = document.getElementById('op-form'), status = document.getElementById('page-status'), statusSel = document.getElementById('f-status');
  var me = null, current = null;
  function say(kind, text) { clear(status); if (text) status.appendChild(el('p', { class: 'ida-alert ida-alert--' + kind, role: kind === 'danger' ? 'alert' : null }, text)); }
  function enc(v) { return encodeURIComponent(v); }
  function orgBody(iv) { return me && me.role === 'admin' ? { org_id: iv.org.id } : {}; }
  if (params.get('status')) statusSel.value = params.get('status');

  function vehicleCell(v) { return v ? el('a', { href: '/atelier/vehicule?ref=' + enc(v.ivid) }, [C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ')]) : el('span', { class: 'ida-muted' }, t('Véhicule non identifié')); }

  async function loadList() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/interventions' + (statusSel.value ? '?status=' + enc(statusSel.value) : ''));
      list.setAttribute('aria-busy', 'false'); clear(list);
      if (!out.interventions.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune intervention pour ce filtre.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['N°', 'Date', 'Véhicule', 'Motif', 'Opérations', 'Statut'].concat(me && me.role === 'admin' ? ['Atelier'] : []).map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.interventions.map(function (iv) {
          return el('tr', null, [el('td', null, el('a', { href: '?id=' + iv.id }, '#' + iv.id)), el('td', null, C.date(iv.opened_at, true)), el('td', null, vehicleCell(iv.vehicle)),
            el('td', null, C.text(iv.reason)), el('td', null, String(iv.operations.length)), el('td', null, C.badge('visit_status', iv.status))].concat(me && me.role === 'admin' ? [el('td', null, C.text(iv.org.name))] : []));
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  statusSel.addEventListener('change', loadList);

  async function loadDetail(id) {
    try {
      var out = await C.api('/api/workspace/interventions?id=' + enc(id));
      current = out.interventions[0];
      if (!current) { say('danger', t('Intervention introuvable.')); return; }
      renderDetail();
    } catch (e) { say('danger', C.errorText(e)); }
  }
  function renderDetail() {
    var iv = current, open = iv.status === 'open' || iv.status === 'in_progress';
    detailBox.hidden = false; clear(detail);
    document.getElementById('sec-detail').textContent = t('Intervention') + ' #' + iv.id;
    detail.appendChild(el('dl', { class: 'ida-kv' }, [el('dt', null, t('Véhicule')), el('dd', null, vehicleCell(iv.vehicle)), el('dt', null, t('Ouverte le')), el('dd', null, C.date(iv.opened_at, true)),
      el('dt', null, t('Ouverte par')), el('dd', null, iv.opened_by ? iv.opened_by.name : '—'), el('dt', null, t('Motif')), el('dd', null, C.text(iv.reason)), el('dt', null, t('Statut')), el('dd', null, C.badge('visit_status', iv.status)),
      iv.closed_at ? el('dt', null, t('Clôturée le')) : null, iv.closed_at ? el('dd', null, C.date(iv.closed_at, true)) : null]));
    var ops = el('ul', { class: 'ida-op-list' });
    iv.operations.forEach(function (o) {
      var p = o.part, acts = [];
      if (open && o.status === 'planned') { var done = el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm' }, t('Marquer réalisée')); done.addEventListener('click', function () { setOp(o, 'done'); }); acts.push(done); }
      if (open && o.status !== 'cancelled') { var cx = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm' }, t('Annuler l\'opération')); cx.addEventListener('click', function () { setOp(o, 'cancelled'); }); acts.push(cx); }
      ops.appendChild(el('li', { class: 'ida-op' }, [el('span', null, [el('strong', null, C.label('operation_type', o.type)), o.description ? ' — ' + o.description : '']), C.badge('operation_status', o.status),
        el('div', { class: 'ida-op-meta' }, [p ? el('span', null, [t('Pièce') + ' : ', p.label || '—', p.reference ? el('bdi', { dir: 'ltr' }, ' (' + p.reference + ')') : '', ' × ' + o.quantity]) : null,
          p && p.source ? el('span', null, t('Provenance') + ' : ' + C.label('part_source', p.source)) : null, p && p.condition ? el('span', null, C.label('part_condition', p.condition)) : null,
          el('span', null, t('Date') + ' : ' + C.date(o.performed_on || o.created_at)), o.technician ? el('span', null, t('Technicien') + ' : ' + o.technician.name) : null, o.notes ? el('span', null, t('Remarques') + ' : ' + o.notes) : null]),
        acts.length ? el('div', { class: 'ida-page-actions' }, acts) : null]));
    });
    detail.appendChild(el('h3', { class: 'ida-h3' }, t('Opérations')));
    detail.appendChild(iv.operations.length ? ops : el('p', { class: 'ida-empty' }, t('Aucune opération enregistrée.')));
    var actions = document.getElementById('detail-actions'); clear(actions);
    if (open) {
      var close = el('button', { type: 'button', class: 'ida-btn ida-btn--primary ida-btn--sm' }, t('Clôturer l\'intervention'));
      close.addEventListener('click', function () { finish(false); });
      var cancel = el('button', { type: 'button', class: 'ida-btn ida-btn--ghost ida-btn--sm' }, t('Annuler l\'intervention'));
      cancel.addEventListener('click', function () { finish(true); });
      actions.appendChild(cancel); actions.appendChild(close);
    }
    opForm.hidden = !open;
    document.getElementById('op-date').max = new Date().toISOString().slice(0, 10);
    if (!document.getElementById('op-date').value) document.getElementById('op-date').value = new Date().toISOString().slice(0, 10);
    detailBox.scrollIntoView({ block: 'start' });
  }
  async function setOp(o, st) {
    try { await C.send('POST', '/api/workshop/visits/' + current.id + '/operations/' + o.id + '/status', Object.assign({ status: st }, orgBody(current))); await loadDetail(current.id); loadList(); }
    catch (e) { say('danger', C.errorText(e)); }
  }
  async function finish(cancel) {
    try { await C.send('POST', '/api/workshop/visits/' + current.id + (cancel ? '/cancel' : '/close'), orgBody(current)); say('success', t(cancel ? 'Intervention annulée.' : 'Intervention clôturée.')); await loadDetail(current.id); loadList(); }
    catch (e) { say('danger', C.errorText(e)); }
  }

  opForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var errBox = document.getElementById('op-errors'); clear(errBox);
    var part = document.getElementById('op-part').value.trim(), ref = document.getElementById('op-ref').value.trim();
    var src = opForm.querySelector('input[name=part_source]:checked'), cond = opForm.querySelector('input[name=part_condition]:checked');
    var problems = [];
    if ((part || ref) && !src) problems.push(t('Choisissez la provenance de la pièce.'));
    var qty = document.getElementById('op-qty').value.trim() || '1';
    if (!/^\d{1,3}$/.test(qty) || +qty < 1) problems.push(t('Quantité : un nombre entier de 1 à 999.'));
    if (problems.length) { errBox.appendChild(el('div', { class: 'ida-alert ida-alert--danger', role: 'alert' }, el('ul', null, problems.map(function (p) { return el('li', null, p); })))); return; }
    var body = Object.assign({ operation_type: document.getElementById('op-type').value, description: document.getElementById('op-desc').value.trim() || null,
      part_label: part || null, part_reference: ref || null, quantity: +qty, part_source: (part || ref) && src ? src.value : null, part_condition: (part || ref) && cond && cond.value ? cond.value : null,
      performed_on: document.getElementById('op-date').value || null, notes: document.getElementById('op-notes').value.trim() || null, status: document.getElementById('op-done').checked ? 'done' : 'planned' }, orgBody(current));
    try {
      await C.send('POST', '/api/workshop/visits/' + current.id + '/operations', body);
      ['op-desc', 'op-part', 'op-ref', 'op-notes'].forEach(function (i) { document.getElementById(i).value = ''; });
      document.getElementById('op-qty').value = '1'; if (src) src.checked = false; opForm.querySelector('input[name=part_condition][value=""]').checked = true;
      say('success', t('Opération enregistrée.')); await loadDetail(current.id); loadList();
    } catch (err) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, C.errorText(err))); }
  });

  // ---- new intervention: choose the vehicle (server search), open the visit --------------------
  var dlg = document.getElementById('new-dialog'), nVehicle = document.getElementById('n-vehicle'), nResults = document.getElementById('n-results'), chosen = null, timer = null;
  Array.prototype.forEach.call(document.querySelectorAll('dialog [data-close]'), function (b) { b.addEventListener('click', function () { b.closest('dialog').close(''); }); });
  function pick(v) { chosen = v; clear(nResults); nResults.appendChild(el('p', { class: 'ida-alert ida-alert--success' }, [t('Véhicule choisi') + ' : ', C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ')])); }
  async function findVehicles() {
    chosen = null; var q = nVehicle.value.trim(); clear(nResults);
    if (q.length < 2) return;
    try {
      var out = await C.api('/api/workspace/vehicles?q=' + enc(q));
      if (!out.vehicles.length) { nResults.appendChild(el('p', { class: 'ida-small ida-muted' }, [t('Aucun véhicule trouvé.') + ' ', el('a', { href: '/atelier/vehicules/nouveau' }, t('Ajouter un véhicule'))])); return; }
      out.vehicles.slice(0, 6).forEach(function (v) { var b = el('button', { type: 'button', class: 'ida-btn ida-btn--secondary ida-btn--sm' }, [C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ')]); b.addEventListener('click', function () { pick(v); }); nResults.appendChild(b); });
    } catch (e) { nResults.appendChild(el('p', { class: 'ida-field-error' }, C.errorText(e))); }
  }
  nVehicle.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(findVehicles, 250); });
  async function openNew(prefill) {
    chosen = null; clear(nResults); clear(document.getElementById('n-errors')); nVehicle.value = '';
    if (me && me.role === 'admin') {
      document.getElementById('n-org-field').hidden = false;
      var sel = document.getElementById('n-org'); clear(sel);
      try { var orgs = await C.api('/api/admin/organisations'); (orgs.organisations || orgs.items || []).forEach(function (o) { sel.appendChild(el('option', { value: String(o.id) }, o.name)); }); } catch (e) { /* the server refuses without an organisation */ }
    }
    if (prefill) { try { var d = await C.api('/api/vehicles/' + enc(prefill) + '/dossier'); pick({ ivid: d.vehicle.ivid, plate: d.vehicle.plate, make: d.vehicle.make, model: d.vehicle.model }); nVehicle.value = d.vehicle.plate || d.vehicle.ivid; } catch (e) { /* choose by hand */ } }
    dlg.showModal();
  }
  document.getElementById('act-new-intervention').addEventListener('click', function () { openNew(null); });
  document.getElementById('new-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errBox = document.getElementById('n-errors'); clear(errBox);
    if (!chosen) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, t('Choisissez le véhicule dans la liste.'))); return; }
    var body = { vehicle_ref: chosen.ivid, reason: document.getElementById('n-reason').value.trim() || null };
    if (me && me.role === 'admin') body.org_id = document.getElementById('n-org').value;
    try { var out = await C.send('POST', '/api/workshop/visits', body); dlg.close(''); history.replaceState(null, '', '?id=' + out.visit.id); await loadDetail(out.visit.id); loadList(); say('success', t('Intervention ouverte.')); }
    catch (err) { errBox.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, C.errorText(err))); }
  });

  (async function start() {
    me = await C.sessionLine(null, location.pathname + location.search);
    if (!me) return;
    loadList();
    if (params.get('id')) loadDetail(params.get('id'));
    if (params.get('new')) openNew(params.get('vehicle'));
  }());
}());
