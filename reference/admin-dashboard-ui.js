'use strict';
/* IDauto — IDA-ADMIN-6 — dashboard (/admin/dashboard).
 * Reads GET /api/admin/dashboard; writes nothing. Each tile is a link into the
 * module that details its number, with the filter that reproduces it there.
 * Server values are placed with textContent through IdAutoConsole.el(). */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var box = document.getElementById('dashboard');
  var recent = document.getElementById('recent');
  var generated = document.getElementById('generated');
  // The VIN disclosure events, written by the audited fiche and search routes.
  var VIN_READ = 'vehicle.' + 'vin.read', VIN_SEARCH = 'vehicle.search.' + 'vin';

  function n(map, k) { return (map && map[k]) || 0; }
  function sum(map) { return Object.keys(map || {}).reduce(function (s, k) { return s + (map[k] || 0); }, 0); }

  // A tile: label, value, hint, and the module view that shows the same number.
  function tile(labelText, value, hint, href, tone) {
    return el('a', { class: 'ida-card ida-admin-stat ida-admin-stat--link' + (tone ? ' ida-admin-stat--' + tone : ''), href: href }, [
      el('p', { class: 'ida-label' }, labelText),
      el('p', { class: 'ida-admin-stat-value' }, C.text(value)),
      hint ? el('p', { class: 'ida-caption' }, hint) : null
    ]);
  }
  function group(id, title, href, linkText, tiles) {
    return el('section', { class: 'ida-stack', 'aria-labelledby': id }, [
      el('div', { class: 'ida-admin-group-head' }, [
        el('h2', { id: id, class: 'ida-h3' }, title),
        el('a', { href: href, class: 'ida-small' }, linkText)
      ]),
      el('div', { class: 'ida-admin-stats' }, tiles)
    ]);
  }
  // A count that needs attention is flagged only when it is above zero.
  function attention(v) { return v > 0 ? 'attention' : null; }

  function render(d) {
    C.clear(box); box.setAttribute('aria-busy', 'false');
    var v = d.vehicles, m = d.maintenance, w = d.workshops, q = d.quality, r = d.review, s = d.security;
    var visits = m.visits_by_status || {};
    var orgs = w.organisations_by_status || {};
    var pending = r.pending_review + r.pending_confirmation;
    var ad = s.auth_decisions.counters, by = s.audit_30d.by_type || {};
    var sc = s.service_credentials;

    box.appendChild(group('g-vehicles', 'Véhicules', '/admin/vehicles', 'Ouvrir le registre', [
      tile('Identités de véhicules', v.canonical, v.created_30d + ' créée(s) ces 30 derniers jours', '/admin/vehicles'),
      tile('Identification vérifiée', v.verified, v.canonical ? Math.round(100 * v.verified / v.canonical) + ' % des identités' : 'aucune identité', '/admin/vehicles?verified=true'),
      tile('Plaques actives', v.plates_active, v.documents + ' face(s) de carte grise enregistrée(s)', '/admin/vehicles'),
      tile('Fiches en conflit', n(v.fiche_by_status, 'conflict'), n(v.fiche_by_status, 'pending_review') + ' en attente de revue', '/admin/vehicles?fiche_status=conflict', attention(n(v.fiche_by_status, 'conflict'))),
      tile('Fiches fusionnées', v.merged, 'rattachées à une autre identité', '/admin/vehicles?include_merged=1')
    ]));

    box.appendChild(group('g-maintenance', 'Entretien', '/admin/maintenance', 'Ouvrir l\'historique', [
      tile('Visites atelier', sum(visits), m.visits_30d + ' ces 30 derniers jours', '/admin/maintenance'),
      tile('Visites ouvertes', n(visits, 'open'), n(visits, 'in_progress') + ' en cours', '/admin/maintenance?status=open'),
      tile('Visites non identifiées', m.unidentified_visits, 'sans véhicule rattaché', '/admin/maintenance?identified=false', attention(m.unidentified_visits)),
      tile('Opérations', sum(m.operations_by_type), n(m.operations_by_type, 'replacement') + ' remplacement(s) · ' + n(m.operations_by_type, 'repair') + ' réparation(s)', '/admin/maintenance'),
      tile('Événements d\'entretien', m.service_events, m.service_events_30d + ' enregistré(s) ces 30 derniers jours', '/admin/maintenance?kind=service_events')
    ]));

    box.appendChild(group('g-workshops', 'Ateliers et sources', '/admin/sources', 'Ouvrir les ateliers', [
      tile('Organisations actives', n(orgs, 'active'), sum(orgs) + ' au total', '/admin/sources?status=active'),
      tile('En attente', n(orgs, 'pending'), 'organisation(s) à valider', '/admin/sources?status=pending', attention(n(orgs, 'pending'))),
      tile('Suspendues ou résiliées', n(orgs, 'suspended') + n(orgs, 'cancelled'), n(orgs, 'suspended') + ' suspendue(s)', '/admin/sources?status=suspended'),
      tile('Ateliers actifs', w.active_30d, 'au moins une visite ces 30 derniers jours', '/admin/sources?sort=activity&dir=desc')
    ]));

    box.appendChild(group('g-quality', 'Qualité et revue', '/admin/quality', 'Ouvrir la qualité', [
      tile('Observations à revoir', pending, r.pending_confirmation + ' en attente de confirmation · ' + r.pending_submissions + ' soumission(s)', '/admin/review', attention(pending)),
      tile('Identités avec un point ouvert', q.all, 'sur ' + q.identities + ' identité(s)', '/admin/quality'),
      tile('Valeurs en désaccord', q.disagreement, 'identité(s) concernée(s)', '/admin/quality?issue=disagreement', attention(q.disagreement)),
      tile('Données en attente de revue', q.pending_facts, q.conflict_facts + ' avec une donnée marquée en conflit', '/admin/quality?issue=pending_facts'),
      tile('Identités incomplètes', q.incomplete, q.no_plate + ' sans plaque active', '/admin/quality?issue=incomplete')
    ]));

    box.appendChild(group('g-security', 'Sécurité et audit', '/admin/security', 'Ouvrir la sécurité', [
      tile('Comptes web', s.accounts.accounts, n(s.accounts.by_role, 'admin') + ' administrateur · ' + n(s.accounts.by_role, 'manager') + ' gestionnaire · ' + n(s.accounts.by_role, 'technician') + ' technicien', '/admin/security'),
      tile('Sessions actives', s.accounts.active_sessions, s.accounts.accounts_signed_in + ' compte(s) connecté(s)', '/admin/security'),
      tile('Comptes bloqués', s.accounts.without_organisation, 'sans organisation : connexion refusée', '/admin/security', attention(s.accounts.without_organisation)),
      tile('Accès refusés', ad.auth_denied || 0, 'depuis le démarrage du service (' + C.date(s.auth_decisions.since, true) + ')', '/admin/security'),
      tile('Numéros de châssis lus', n(by, VIN_READ), n(by, VIN_SEARCH) + ' recherche(s) · 30 jours, toutes auditées', '/admin/security?event=' + encodeURIComponent(VIN_READ)),
      tile('Écritures auditées', s.audit_30d.total, 'ces 30 derniers jours · ' + (sc.admin_credentials + sc.organisation_credentials) + ' accès de service', '/admin/security')
    ]));

    var h = d.health;
    generated.textContent = 'Compté le ' + C.date(d.generated_at, true) + ' · base de données : disponible · fournisseurs d\'identification externes : ' +
      (h.vehicle_providers_configured ? h.vehicle_providers_configured : 'aucun') + ' · catalogue fournisseur : ' + (h.parts_supplier_configured ? 'configuré' : 'non configuré');

    C.clear(recent); recent.setAttribute('aria-busy', 'false');
    if (!d.recent_activity.length) { C.state(recent, 'empty', 'Aucune écriture n\'est encore enregistrée au journal d\'audit.'); return; }
    recent.appendChild(el('ul', { class: 'ida-admin-ops' }, d.recent_activity.map(function (a) {
      return el('li', null, [
        a.masked ? C.date(a.at) + ' (jour seulement)' : C.date(a.at, true), ' · ',
        el('code', { class: 'ida-id', translate: 'no' }, a.event_type), ' · ', C.label('actor_type', a.actor_type),
        a.org_id !== null ? ' · organisation ' + a.org_id : ''
      ]);
    })));
    recent.appendChild(el('p', { class: 'ida-caption' }, el('a', { href: '/admin/security' }, 'Tout le journal d\'audit')));
  }

  async function load() {
    C.state(box, 'loading', 'Chargement des indicateurs…');
    C.state(recent, 'loading', 'Chargement…');
    try {
      render(await C.api('/api/admin/dashboard'));
    } catch (err) {
      C.state(box, 'error', err.message);
      C.state(recent, 'error', err.message);
    }
  }

  (async function start() {
    var user = await C.sessionLine('session-line', '/admin/dashboard');
    if (!user) return;
    if (user.role !== 'admin') { C.state(box, 'error', 'Le tableau de bord est réservé aux administrateurs.'); return; }
    load();
  }());
}());
