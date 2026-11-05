'use strict';
/* IDauto — IDA-UI-3 — role → permission matrix, exactly as the server applies it (GET /api/admin/roles). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var SCOPE = {
    'vehicle:read': 'Consulter les véhicules', 'vehicle:write': 'Enregistrer et modifier les véhicules', 'vehicle:search': 'Rechercher dans le registre', 'vehicle:resolve': 'Identifier un véhicule',
    'vin:search': 'Rechercher et voir le numéro de châssis (VIN)', 'plate:read': 'Consulter les plaques', 'fact:read': 'Consulter les informations techniques', 'fact:write': 'Ajouter des informations techniques',
    'observation:read': 'Consulter les observations', 'observation:write': 'Ajouter des observations', 'passport:read': 'Consulter le passeport', 'identity:resolve': 'Résoudre une identité',
    'parts:read': 'Consulter le catalogue des pièces', 'parts:write': 'Ajouter des pièces au catalogue', 'stock:write': 'Gérer le stock', 'workshop:read': 'Consulter les interventions',
    'workshop:write': 'Enregistrer les interventions', 'document:read': 'Voir les cartes grises', 'document:write': 'Joindre ou remplacer une carte grise', 'document:delete': 'Supprimer une carte grise',
    'owner:read': 'Voir les coordonnées du propriétaire (son atelier)', 'owner:write': 'Enregistrer les coordonnées du propriétaire', 'team:read': 'Voir les comptes de l\'atelier'
  };
  var list = document.getElementById('list');
  (async function () {
    var me = await C.sessionLine(null, '/admin/roles'); if (!me) return;
    try {
      var out = await C.api('/api/admin/roles');
      var roles = out.roles.filter(function (r) { return r.role !== 'admin'; });
      list.setAttribute('aria-busy', 'false'); clear(list);
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, [el('th', { scope: 'col' }, t('Permission')), el('th', { scope: 'col' }, t('Administrateur'))].concat(roles.map(function (r) { return el('th', { scope: 'col' }, C.label('role', r.role)); })))),
        el('tbody', null, Object.keys(SCOPE).map(function (s) {
          return el('tr', null, [el('td', null, [t(SCOPE[s]), ' ', el('code', { class: 'ida-id', translate: 'no' }, s)]), el('td', null, t('Oui'))].concat(roles.map(function (r) { return el('td', null, r.scopes.indexOf(s) !== -1 ? t('Oui') : '—'); })));
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }());
}());
