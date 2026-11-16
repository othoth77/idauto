'use strict';
/* IDauto — IDA-UI-3 — vehicles list: GET /api/workspace/vehicles?q&page (own workshop; admin: all). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  // Update 2 — colours are stored as the French word chosen in the form; shown in the page's language.
  var COLOUR = { noir: 'Noir', blanc: 'Blanc', gris: 'Gris', argent: 'Argent', rouge: 'Rouge', bleu: 'Bleu', vert: 'Vert', jaune: 'Jaune', orange: 'Orange', marron: 'Marron', beige: 'Beige' };
  var list = document.getElementById('list'), pager = document.getElementById('pager'), q = document.getElementById('f-q');
  var params = new URLSearchParams(location.search), page = parseInt(params.get('page'), 10) || 1;
  function link(p) { var x = []; if (p > 1) x.push('page=' + p); if (q.value.trim()) x.push('q=' + encodeURIComponent(q.value.trim())); return x.length ? '?' + x.join('&') : location.pathname; }
  q.value = params.get('q') || '';
  if (params.get('deleted')) { var st = document.getElementById('page-status'); if (st) st.appendChild(el('p', { class: 'ida-alert ida-alert--success' }, t('Véhicule supprimé.'))); }
  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/vehicles?page=' + page + (q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : '') );
      list.setAttribute('aria-busy', 'false'); clear(list); clear(pager);
      list.appendChild(el('p', { class: 'ida-small ida-muted', id: 'list-total' }, t('# véhicule(s)').replace('#', String(out.total))));
      if (!out.vehicles.length) { list.appendChild(el('p', { class: 'ida-empty' }, [q.value ? t('Aucun véhicule ne correspond.') : t('Aucun véhicule pour le moment.'), ' ', el('a', { href: '/atelier/vehicules/nouveau' }, t('Ajouter un véhicule'))])); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Immatriculation', 'Marque', 'Modèle', 'Couleur', 'Année', 'Lieu de la dernière photo', 'Kilométrage', 'Dernière intervention'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.vehicles.map(function (v) {
          return el('tr', null, [el('td', null, el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, C.plate(v.plate, v.plate))),
            el('td', { dir: 'auto' }, C.text(v.make)),
            el('td', { dir: 'auto' }, [v.model, v.variant].filter(Boolean).join(' ') || '—'),
            el('td', null, v.colour ? t(COLOUR[String(v.colour).toLowerCase()] || v.colour) : '—'),
            el('td', null, C.text(v.year)),
            // Update 3 — where the latest PHOTOGRAPH was taken, with its date: a capture location, not the vehicle's address
            el('td', { 'data-col': 'photo-place' }, v.last_photo_location ? [el('span', { dir: 'auto', 'data-i18n-skip': '' }, [v.last_photo_location.place_name, v.last_photo_location.governorate].filter(Boolean).join(', ') || '—'), ' ', v.last_photo_location.captured_at ? el('span', { class: 'ida-muted ida-small' }, C.date(v.last_photo_location.captured_at)) : null] : '—'), el('td', null, v.odometer_km !== null && v.odometer_km !== undefined ? C.km(v.odometer_km) : '—'),
            el('td', null, v.last_intervention_at ? C.date(v.last_intervention_at) : '—')]);
        }))])));
      if (page > 1) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: link(page - 1) }, t('Page précédente')));
      if (out.has_more) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: link(page + 1) }, t('Page suivante')));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); page = 1; history.replaceState(null, '', link(1)); load(); });
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) load(); }());
}());
