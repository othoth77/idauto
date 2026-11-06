'use strict';
/* IDauto — workshops (client restructuring 2026-11-06). /atelier/ateliers lists the workshops this account may see
   (admin: every workshop not cancelled; manager / technician: their own); ?id= opens one: its identity, the
   vehicles it worked on, the repairs it recorded and when, and its technicians when the role may see the team.
   Every datum comes from GET /api/workspace/workshops[/:id]; nothing here is computed in the page. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var id = new URLSearchParams(location.search).get('id');
  var TYPE = { garage: 'Garage', insurer: 'Assureur', fleet: 'Flotte', judicial: 'Judiciaire', government: 'Administration', other: 'Autre' };
  var STATUS = { active: 'Actif', pending: 'En attente', suspended: 'Suspendu', cancelled: 'Résilié' };
  function table(heads, rows) { return el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [el('thead', null, el('tr', null, heads.map(function (h) { return el('th', { scope: 'col' }, t(h)); }))), el('tbody', null, rows)])); }
  function place(w) { return [w.city, w.governorate].filter(Boolean).join(' · ') || t('Non renseignée'); }
  function vehicleLink(v) { return el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, [C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ') || v.ivid]); }
  async function showList() {
    var box = document.getElementById('list');
    try {
      var out = await C.api('/api/workspace/workshops');
      box.setAttribute('aria-busy', 'false'); clear(box);
      if (out.scope === 'own_workshop' && out.workshops.length === 1) { location.replace('/atelier/ateliers?id=' + out.workshops[0].id); return; }
      if (!out.workshops.length) { box.appendChild(el('p', { class: 'ida-empty' }, t('Aucun atelier enregistré.'))); return; }
      box.appendChild(table(['Atelier', 'Ville', 'Véhicules', 'Interventions', 'Dernière intervention', 'Statut'], out.workshops.map(function (w) {
        return el('tr', null, [el('td', null, el('a', { href: '/atelier/ateliers?id=' + w.id }, el('bdi', null, w.name))), el('td', null, place(w)), el('td', null, String(w.vehicles)),
          el('td', null, String(w.interventions)), el('td', null, w.last_intervention_at ? C.date(w.last_intervention_at) : '—'), el('td', null, t(STATUS[w.status] || w.status))]);
      })));
    } catch (e) { box.setAttribute('aria-busy', 'false'); C.state(box, 'error', C.errorText(e)); }
  }
  async function showOne() {
    document.getElementById('list-box').hidden = true; document.getElementById('detail-box').hidden = false;
    var ident = document.getElementById('identity');
    try {
      var out = await C.api('/api/workspace/workshops/' + encodeURIComponent(id)), w = out.workshop;
      document.getElementById('sec-id').textContent = w.name;
      document.getElementById('parts-link').setAttribute('href', '/atelier/pieces-remplacees?org=' + w.id);
      ident.appendChild(el('dl', { class: 'ida-kv' }, [
        [t('Type'), t(TYPE[w.type] || w.type)], [t('Adresse'), place(w)], [t('Statut'), t(STATUS[w.status] || w.status)],
        [t('Comptes de l\'atelier'), String(w.accounts)], [t('Véhicules'), String(w.vehicles)], [t('Interventions'), String(w.interventions)],
        [t('E-mail de contact'), w.contact_email_present ? t('Enregistré (non affiché)') : t('Non renseigné')]
      ].reduce(function (acc, r) { return acc.concat([el('dt', null, r[0]), el('dd', null, r[1])]); }, [])));
      var vb = document.getElementById('vehicles');
      vb.appendChild(out.vehicles.length ? table(['Véhicule', 'Année', 'Interventions', 'Dernière intervention'], out.vehicles.map(function (v) {
        return el('tr', null, [el('td', null, vehicleLink(v)), el('td', null, C.text(v.year)), el('td', null, String(v.interventions)), el('td', null, v.last_intervention_at ? C.date(v.last_intervention_at) : '—')]);
      })) : el('p', { class: 'ida-empty' }, t('Aucune intervention enregistrée par cet atelier.')));
      var rb = document.getElementById('repairs');
      rb.appendChild(out.interventions.length ? table(['Date', 'Véhicule', 'Motif', 'Travaux réalisés', 'Statut'], out.interventions.map(function (iv) {
        var works = iv.operations.map(function (op) { return [op.description || C.label('operation_type', op.type), op.part ? ' — ' + (op.part.label || op.part.reference || '') : ''].join(''); });
        return el('tr', null, [el('td', null, el('a', { href: '/atelier/interventions?id=' + iv.id }, C.date(iv.opened_at))), el('td', null, iv.vehicle ? vehicleLink(iv.vehicle) : t('Véhicule non identifié')),
          el('td', null, C.text(iv.reason)), el('td', null, works.length ? el('ul', { class: 'ida-plain-list' }, works.map(function (x) { return el('li', null, x); })) : '—'), el('td', null, C.badge('visit_status', iv.status))]);
      })) : el('p', { class: 'ida-empty' }, t('Aucune intervention enregistrée par cet atelier.')));
      if (out.technicians) {
        document.getElementById('tech-box').hidden = false;
        var tb = document.getElementById('technicians');
        tb.appendChild(out.technicians.length ? table(['Nom', 'Rôle', 'Interventions', 'Opérations'], out.technicians.map(function (p) {
          return el('tr', null, [el('td', null, el('bdi', null, p.name)), el('td', null, C.label('role', p.role)), el('td', null, String(p.interventions)), el('td', null, String(p.operations))]);
        })) : el('p', { class: 'ida-empty' }, t('Aucun compte dans cet atelier.')));
      }
    } catch (e) { C.state(ident, 'error', C.errorText(e)); }
  }
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) { if (id) showOne(); else showList(); } }());
}());
