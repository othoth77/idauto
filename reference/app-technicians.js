'use strict';
/* IDauto — IDA-UI-3 — the workshop's people: GET /api/workspace/technicians (team:read — manager, admin). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list');
  (async function () {
    var me = await C.sessionLine(null, location.pathname); if (!me) return;
    try {
      var out = await C.api('/api/workspace/technicians');
      list.setAttribute('aria-busy', 'false'); clear(list);
      if (!out.people.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucun compte pour le moment.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Nom', 'Rôle'].concat(me.role === 'admin' ? ['Atelier'] : [], ['Interventions ouvertes', 'Opérations enregistrées', 'Dernière connexion']).map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.people.map(function (p) {
          return el('tr', null, [el('td', null, p.name), el('td', null, C.label('role', p.role))].concat(me.role === 'admin' ? [el('td', null, C.text(p.org))] : [],
            [el('td', null, String(p.interventions)), el('td', null, String(p.operations)), el('td', null, p.last_seen ? C.date(p.last_seen, true) : '—')]));
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', e.status === 403 ? t('Cette page est réservée aux gestionnaires d\'atelier.') : C.errorText(e)); }
  }());
}());
