'use strict';
/* IDauto — IDA-ADMIN-3 — ateliers and data sources (/admin/sources).
 * Reads GET /api/admin/organisations and GET /api/admin/sources; writes
 * nothing. Server values are placed with textContent through
 * IdAutoConsole.el(). An organisation's contact e-mail and tax id are never
 * sent to this page — only whether each is recorded. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var form = document.getElementById('filters');
  var results = document.getElementById('results');
  var summary = document.getElementById('results-summary');
  var orgTotals = document.getElementById('org-totals');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var FIELDS = ['q', 'status', 'org_type', 'sort', 'dir'];
  var current = { page: 1, pages: 1 };

  var ORG_STATUS = { pending: 'En attente', active: 'Active', suspended: 'Suspendue', cancelled: 'Résiliée' };
  var ORG_TONE = { pending: 'pending', active: 'verified', suspended: 'anomaly', cancelled: 'neutral' };
  var ORG_TYPE = { garage: 'Garage / atelier', insurer: 'Assureur', fleet: 'Flotte', judicial: 'Judiciaire', government: 'Administration', other: 'Autre' };
  function th(h) { return el('th', { scope: 'col' }, h); }
  function n(v) { return v === null || v === undefined ? C.DASH : String(v); }

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    FIELDS.forEach(function (f) { var e = form.elements[f]; if (e) e.value = p.has(f) ? p.get(f) : (e.tagName === 'SELECT' ? e.options[0].value : ''); });
    var page = parseInt(p.get('page') || '1', 10);
    current.page = isFinite(page) && page > 0 ? page : 1;
  }
  function params() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = String(form.elements[f].value || '').trim(); if (v && !(f === 'sort' && v === 'name') && !(f === 'dir' && v === 'asc')) p.set(f, v); });
    if (current.page > 1) p.set('page', String(current.page));
    return p;
  }

  function orgRow(o) {
    var a = o.activity;
    var flags = [];
    if (o.is_fixpert_pilot) flags.push(el('span', { class: 'ida-status ida-status--neutral' }, 'Pilote Fixpert'));
    if (o.verified_at) flags.push(el('span', { class: 'ida-status ida-status--verified' }, 'Vérifiée le ' + C.date(o.verified_at)));
    return el('tr', null, [
      el('th', { scope: 'row' }, [el('bdi', null, o.name), el('span', { class: 'ida-caption ida-u-block' }, (ORG_TYPE[o.org_type] || o.org_type) + (o.city ? ' · ' + o.city : '') + (o.governorate ? ' · ' + o.governorate : ''))]),
      el('td', null, [el('span', { class: 'ida-status ida-status--' + (ORG_TONE[o.status] || 'neutral') }, ORG_STATUS[o.status] || o.status)].concat(flags)),
      el('td', null, [o.accounts.managers + ' gestionnaire(s)', el('span', { class: 'ida-u-block' }, o.accounts.technicians + ' technicien(s)')]),
      el('td', null, o.integration
        ? [o.integration.credentials + ' accès de service', el('span', { class: 'ida-caption ida-u-block' }, o.integration.scopes.join(', '))]
        : el('span', { class: 'ida-muted' }, 'Aucune')),
      el('td', null, [a.visits + ' visite(s), ' + a.open_visits + ' ouverte(s)', el('span', { class: 'ida-caption ida-u-block' },
        a.operations + ' opération(s) · ' + a.service_events + ' entretien(s) · ' + a.documents + ' document(s) · ' + a.observations + ' observation(s) · ' + a.stock_lines + ' ligne(s) de stock')]),
      el('td', null, a.last_activity_at ? C.date(a.last_activity_at, true) : el('span', { class: 'ida-muted' }, 'aucune activité enregistrée')),
      el('td', null, [o.contact_present ? 'Contact enregistré' : el('span', { class: 'ida-muted' }, 'Pas de contact'),
        el('span', { class: 'ida-caption ida-u-block' }, o.tax_id_present ? 'Matricule fiscal enregistré' : 'Matricule fiscal absent')])
    ]);
  }

  async function loadOrganisations(push) {
    var p = params();
    if (push) window.history.pushState(null, '', '/admin/sources' + (p.toString() ? '?' + p.toString() : ''));
    prev.disabled = true; next.disabled = true; summary.textContent = '';
    C.state(results, 'loading', 'Chargement des organisations…');
    try {
      var api = new URLSearchParams(p); api.set('page', String(current.page));
      var data = await C.api('/api/admin/organisations?' + api.toString());
      current.page = data.page; current.pages = data.pages;
      var bs = data.by_status;
      orgTotals.textContent = Object.keys(ORG_STATUS).map(function (k) { return (bs[k] || 0) + ' ' + ORG_STATUS[k].toLowerCase(); }).join(' · ');
      C.clear(results); results.setAttribute('aria-busy', 'false');
      if (!data.results.length) C.state(results, 'empty', data.total === 0 ? 'Aucune organisation ne correspond à ces critères.' : 'Cette page est vide.');
      else results.appendChild(el('table', { class: 'ida-table' }, [
        el('caption', { class: 'ida-sr-only' }, 'Organisations'),
        el('thead', null, el('tr', null, ['Organisation', 'Statut', 'Comptes', 'Intégration', 'Activité enregistrée', 'Dernière activité', 'Coordonnées'].map(th))),
        el('tbody', null, data.results.map(orgRow))
      ]));
      summary.textContent = data.total + ' organisation(s) · page ' + data.page + ' sur ' + data.pages;
      prev.disabled = data.page <= 1; next.disabled = data.page >= data.pages;
    } catch (err) { C.state(results, 'error', err.message); }
  }

  async function loadSources() {
    var box = document.getElementById('sources'), prov = document.getElementById('providers');
    C.state(box, 'loading', 'Chargement des sources…'); C.state(prov, 'loading', 'Chargement…');
    try {
      var d = await C.api('/api/admin/sources');
      C.clear(box); box.setAttribute('aria-busy', 'false');
      if (!d.capture_sources.length) C.state(box, 'empty', 'Aucune source de capture n\'est configurée.');
      else box.appendChild(el('table', { class: 'ida-table' }, [
        el('caption', { class: 'ida-sr-only' }, 'Sources de capture'),
        el('thead', null, el('tr', null, ['Source', 'Type', 'Confiance', 'Consentement', 'Base légale', 'État', 'Données produites'].map(th))),
        el('tbody', null, d.capture_sources.map(function (s) {
          return el('tr', null, [
            el('th', { scope: 'row' }, [el('code', { class: 'ida-id', translate: 'no' }, s.code), el('span', { class: 'ida-caption ida-u-block' }, s.name_fr),
              s.name_ar ? el('span', { class: 'ida-caption ida-u-block', lang: 'ar', dir: 'rtl' }, s.name_ar) : null]),
            el('td', null, C.label('source_type', s.source_type)),
            el('td', null, s.trust_level + ' / 5'),
            el('td', null, s.requires_consent ? 'Requis' : 'Non requis'),
            el('td', null, s.legal_basis ? s.legal_basis : el('span', { class: 'ida-muted' }, 'non renseignée')),
            el('td', null, el('span', { class: 'ida-status ida-status--' + (s.active ? 'verified' : 'neutral') }, s.active ? 'Active' : 'Inactive')),
            el('td', null, s.usage.observations + ' observation(s) · ' + s.usage.facts + ' donnée(s) · ' + s.usage.submissions + ' soumission(s)')
          ]);
        }))
      ]));

      C.clear(prov); prov.setAttribute('aria-busy', 'false');
      var external = d.vehicle_providers.filter(function (p) { return p.kind !== 'local'; });
      prov.appendChild(el('dl', { class: 'ida-admin-dl' }, [
        el('dt', null, 'Identification des véhicules'),
        el('dd', null, external.length
          ? 'Base IDauto locale + ' + external.map(function (p) { return p.name + ' (' + p.kind + ')'; }).join(', ')
          : 'Base IDauto locale uniquement — aucun fournisseur externe plaque → véhicule n\'est configuré.'),
        el('dt', null, 'Catalogue de pièces'),
        el('dd', null, d.parts_catalogue.supplier && d.parts_catalogue.supplier.configured
          ? 'Catalogue local + fournisseur ' + (d.parts_catalogue.supplier.provider || 'configuré')
          : 'Catalogue local uniquement — ' + String((d.parts_catalogue.supplier && d.parts_catalogue.supplier.message_fr) || 'catalogue fournisseur non configuré').replace(/\.+$/, '') + '.'),
        el('dt', null, 'Accès de service (serveur à serveur)'),
        el('dd', null, d.service_credentials.organisation_credentials + ' accès d\'organisation pour ' + d.service_credentials.organisations + ' organisation(s) · ' +
          d.service_credentials.admin_credentials + ' accès administrateur' + (d.service_credentials.invalid_entries ? ' · ' + d.service_credentials.invalid_entries + ' entrée(s) invalide(s), refusée(s) par le contrôle d\'accès' : '') +
          '. Les identifiants eux-mêmes ne sont jamais affichés.')
      ]));
    } catch (err) { C.state(box, 'error', err.message); C.state(prov, 'error', err.message); }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); current.page = 1; loadOrganisations(true); });
  form.addEventListener('reset', function () { setTimeout(function () { current.page = 1; loadOrganisations(true); }, 0); });
  prev.addEventListener('click', function () { if (current.page > 1) { current.page--; loadOrganisations(true); } });
  next.addEventListener('click', function () { if (current.page < current.pages) { current.page++; loadOrganisations(true); } });
  window.addEventListener('popstate', function () { readUrl(); loadOrganisations(false); });

  (async function start() {
    readUrl();
    var user = await C.sessionLine('session-line', '/admin/sources');
    if (!user) return;
    if (user.role !== 'admin') { C.state(results, 'error', 'Cette page est réservée aux administrateurs.'); return; }
    loadOrganisations(false);
    loadSources();
  }());
}());
