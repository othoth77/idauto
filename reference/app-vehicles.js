'use strict';
/* IDauto — IDA-UI-3 — vehicles list: GET /api/workspace/vehicles?q&page (own workshop; admin: all). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), pager = document.getElementById('pager'), q = document.getElementById('f-q');
  var params = new URLSearchParams(location.search), page = parseInt(params.get('page'), 10) || 1;
  q.value = params.get('q') || '';
  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/vehicles?page=' + page + (q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''));
      list.setAttribute('aria-busy', 'false'); clear(list); clear(pager);
      if (!out.vehicles.length) { list.appendChild(el('p', { class: 'ida-empty' }, [q.value ? t('Aucun véhicule ne correspond.') : t('Aucun véhicule pour le moment.'), ' ', el('a', { href: '/atelier/vehicules/nouveau' }, t('Ajouter un véhicule'))])); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Immatriculation', 'Véhicule', 'Année', 'Énergie', 'Carte grise', 'Dernière intervention'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.vehicles.map(function (v) {
          return el('tr', null, [el('td', null, el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, C.plate(v.plate, v.plate))),
            el('td', null, el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, [v.make, v.model, v.variant].filter(Boolean).join(' ') || v.ivid)),
            el('td', null, C.text(v.year)), el('td', null, C.label('fuel_type', v.fuel_type)),
            el('td', null, v.documents >= 2 ? el('span', { class: 'ida-status ida-status--verified' }, t('2 faces')) : v.documents === 1 ? el('span', { class: 'ida-status ida-status--pending' }, t('Face 1 seule')) : el('span', { class: 'ida-status ida-status--neutral' }, t('Aucune photo'))),
            el('td', null, v.last_intervention_at ? C.date(v.last_intervention_at) : '—')]);
        }))])));
      if (page > 1) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: '?page=' + (page - 1) + (q.value ? '&q=' + encodeURIComponent(q.value) : '') }, t('Page précédente')));
      if (out.has_more) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: '?page=' + (page + 1) + (q.value ? '&q=' + encodeURIComponent(q.value) : '') }, t('Page suivante')));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); page = 1; history.replaceState(null, '', q.value.trim() ? '?q=' + encodeURIComponent(q.value.trim()) : location.pathname); load(); });
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) load(); }());
}());
