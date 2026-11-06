'use strict';
/* IDauto — IDA-UI-4 — dashboard: five real numbers from GET /api/workspace/overview, each opening its list.
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
      stats.appendChild(tile(t('Véhicules'), o.vehicles, '/atelier/vehicules'));
      stats.appendChild(tile(t('Interventions'), o.interventions, '/atelier/interventions'));
      stats.appendChild(tile(t('Pièces utilisées'), o.parts, '/atelier/pieces-remplacees'));
      stats.appendChild(tile(t('Pièces achetées chez nous'), o.parts_our_shop, '/atelier/pieces-remplacees?source=our_shop'));
      stats.appendChild(tile(t('Pièces fournies par les clients'), o.parts_customer, '/atelier/pieces-remplacees?source=customer_supplied'));
      document.getElementById('stats-scope').textContent = o.scope === 'all_workshops' ? t('Tous les ateliers. La provenance d\'une pièce est déclarée à l\'intervention ; IDauto ne gère pas de ventes.') : t('Votre atelier. La provenance d\'une pièce est déclarée à l\'intervention ; IDauto ne gère pas de ventes.');
    } catch (e) { stats.setAttribute('aria-busy', 'false'); C.state(stats, 'error', C.errorText(e)); }
  }());
}());
