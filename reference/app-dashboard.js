'use strict';
/* IDauto — dashboard (client restructuring 2026-11-06): the five numbers the client asked for, counted in the
   database by GET /api/workspace/overview, each linking to the list it counts; then the most recent vehicles.
   Admin: every workshop; manager / technician: their workshop. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var stats = document.getElementById('stats');
  function tile(label, value, href) { return el('a', { class: 'ida-card ida-admin-stat--link', href: href }, [el('p', { class: 'ida-admin-stat-value' }, String(value)), el('p', { class: 'ida-small ida-muted' }, label)]); }
  (async function () {
    var me = await C.sessionLine(null, '/atelier/tableau-de-bord'); if (!me) return;
    try {
      var o = await C.api('/api/workspace/overview');
      stats.setAttribute('aria-busy', 'false'); clear(stats);
      stats.appendChild(tile(t('Véhicules enregistrés'), o.vehicles, '/atelier/vehicules'));
      stats.appendChild(tile(t('Véhicules avec données'), o.vehicles_with_data, '/atelier/vehicules?with_data=1'));
      stats.appendChild(tile(t('Ateliers enregistrés'), o.workshops, '/atelier/ateliers'));
      stats.appendChild(tile(t('Interventions enregistrées'), o.interventions, '/atelier/interventions'));
      stats.appendChild(tile(t('Pièces enregistrées'), o.parts, '/atelier/pieces-remplacees'));
      document.getElementById('stats-scope').textContent = o.scope === 'all_workshops'
        ? t('Tous les ateliers. « Avec données » : au moins une information technique, une photo de carte grise ou une intervention.')
        : t('Votre atelier. « Avec données » : au moins une information technique, une photo de carte grise ou une intervention.');
      var rv = document.getElementById('recent-vehicles');
      rv.appendChild(o.recent_vehicles.length ? el('ul', { class: 'ida-op-list' }, o.recent_vehicles.map(function (v) {
        return el('li', { class: 'ida-op' }, [el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, [C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ')]), el('span', { class: 'ida-small ida-muted' }, C.date(v.created_at))]);
      })) : el('p', { class: 'ida-empty' }, t('Aucun véhicule pour le moment.')));
    } catch (e) { stats.setAttribute('aria-busy', 'false'); C.state(stats, 'error', C.errorText(e)); }
  }());
}());
