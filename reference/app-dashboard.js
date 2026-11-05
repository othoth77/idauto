'use strict';
/* IDauto — IDA-UI-3 — workshop dashboard: real counts from GET /api/workspace/overview (own workshop). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var stats = document.getElementById('stats');
  function tile(label, value, href) { return el('a', { class: 'ida-card ida-admin-stat--link', href: href }, [el('p', { class: 'ida-admin-stat-value' }, String(value)), el('p', { class: 'ida-small ida-muted' }, label)]); }
  (async function () {
    var me = await C.sessionLine(null, '/atelier/tableau-de-bord'); if (!me) return;
    if (me.role === 'admin') { location.replace('/admin/dashboard'); return; }
    try {
      var o = await C.api('/api/workspace/overview');
      stats.setAttribute('aria-busy', 'false'); clear(stats);
      stats.appendChild(tile(t('Véhicules suivis par votre atelier'), o.vehicles, '/atelier/vehicules'));
      stats.appendChild(tile(t('Véhicules enregistrés (30 jours)'), o.registered_30d, '/atelier/vehicules'));
      stats.appendChild(tile(t('Interventions en cours'), o.interventions_open, '/atelier/interventions?status=in_progress'));
      stats.appendChild(tile(t('Interventions (30 jours)'), o.interventions_30d, '/atelier/interventions'));
      stats.appendChild(tile(t('Comptes de l\'atelier'), o.technicians, me.role === 'manager' ? '/atelier/techniciens' : '/atelier/compte'));
      var rv = document.getElementById('recent-vehicles');
      rv.appendChild(o.recent_vehicles.length ? el('ul', { class: 'ida-op-list' }, o.recent_vehicles.map(function (v) {
        return el('li', { class: 'ida-op' }, [el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(v.ivid) }, [C.plate(v.plate, v.plate), ' ', [v.make, v.model].filter(Boolean).join(' ')]), el('span', { class: 'ida-small ida-muted' }, C.date(v.created_at))]);
      })) : el('p', { class: 'ida-empty' }, t('Aucun véhicule pour le moment.')));
      var ri = document.getElementById('recent-interventions');
      ri.appendChild(o.recent_interventions.length ? el('ul', { class: 'ida-op-list' }, o.recent_interventions.map(function (iv) {
        return el('li', { class: 'ida-op' }, [el('a', { href: '/atelier/interventions?id=' + iv.id }, ['#' + iv.id + ' · ', iv.vehicle ? [iv.vehicle.make, iv.vehicle.model].filter(Boolean).join(' ') : t('Véhicule non identifié'), iv.reason ? ' · ' + iv.reason : '']), C.badge('visit_status', iv.status)]);
      })) : el('p', { class: 'ida-empty' }, t('Aucune intervention pour le moment.')));
    } catch (e) { stats.setAttribute('aria-busy', 'false'); C.state(stats, 'error', C.errorText(e)); }
  }());
}());
