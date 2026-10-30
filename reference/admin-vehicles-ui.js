'use strict';
/* IDauto — IDA-ADMIN-1 — the vehicle registry (/admin/vehicles).
 * Reads GET /api/admin/overview and GET /api/admin/vehicles; writes nothing.
 * The filter state lives in the URL, so a filtered page can be reloaded,
 * bookmarked and reached again with the browser's Back button. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var form = document.getElementById('filters');
  var results = document.getElementById('results');
  var summary = document.getElementById('results-summary');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var overview = document.getElementById('overview');
  var overviewNote = document.getElementById('overview-note');
  var FIELDS = ['q', 'make', 'model', 'year', 'fiche_status', 'verified', 'sort', 'dir'];
  var current = { page: 1, pages: 1 };

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    FIELDS.forEach(function (f) { if (p.has(f) && form.elements[f]) form.elements[f].value = p.get(f); });
    form.elements.include_merged.checked = p.get('include_merged') === '1';
    var page = parseInt(p.get('page') || '1', 10);
    current.page = isFinite(page) && page > 0 ? page : 1;
  }
  function params() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = form.elements[f].value.trim(); if (v) p.set(f, v); });
    if (form.elements.include_merged.checked) p.set('include_merged', '1');
    if (current.page > 1) p.set('page', String(current.page));
    return p;
  }

  function stat(labelText, value, hint) {
    return el('div', { class: 'ida-card ida-admin-stat' }, [
      el('p', { class: 'ida-label' }, labelText),
      el('p', { class: 'ida-admin-stat-value' }, C.text(value)),
      hint ? el('p', { class: 'ida-caption' }, hint) : null
    ]);
  }
  function sum(map) { return Object.keys(map || {}).reduce(function (s, k) { return s + (map[k] || 0); }, 0); }

  async function loadOverview() {
    C.state(overview, 'loading', 'Chargement des indicateurs…');
    try {
      var o = await C.api('/api/admin/overview');
      C.clear(overview);
      overview.setAttribute('aria-busy', 'false');
      var visits = o.workshop.visits_by_status || {};
      [
        stat('Identités de véhicules', o.vehicles.canonical, o.vehicles.verified + ' à identification vérifiée · ' + o.vehicles.merged + ' fiche(s) fusionnée(s)'),
        stat('Plaques actives', o.plates.active, o.plates.total + ' plaque(s) enregistrée(s) au total'),
        stat('À revoir', o.review.pending_observations, o.review.pending_submissions + ' soumission(s) en attente'),
        stat('Données en conflit', (o.facts_by_status || {}).conflict || 0, ((o.facts_by_status || {}).pending_review || 0) + ' en attente de revue'),
        stat('Visites atelier', sum(visits), (visits.open || 0) + (visits.in_progress || 0) + ' ouverte(s) ou en cours'),
        stat('Opérations atelier', sum(o.workshop.operations_by_type), o.workshop.service_events + ' événement(s) d\'entretien'),
        stat('Documents', o.documents, 'cartes grises (faces)')
      ].forEach(function (n) { overview.appendChild(n); });
      overviewNote.textContent = 'Base de données : ' + (o.health.database === 'ok' ? 'disponible' : 'indisponible') +
        ' · fournisseurs d\'identification externes configurés : ' + o.health.vehicle_providers_configured +
        ' · catalogue fournisseur : ' + (o.health.parts_supplier_configured ? 'configuré' : 'non configuré') +
        ' · calculé le ' + C.date(o.generated_at, true) + '.';
    } catch (err) {
      C.state(overview, 'error', err.message);
    }
  }

  function headerCell(textValue) { return el('th', { scope: 'col' }, textValue); }

  function row(v) {
    var link = el('a', { href: '/admin/vehicle?ref=' + encodeURIComponent(v.ivid || v.internal_ref) }, [C.id(v.ivid || v.internal_ref)]);
    var flags = [];
    if (v.merged_into) flags.push(el('span', { class: 'ida-status ida-status--neutral' }, 'Fusionnée'));
    if (v.conflict_count) flags.push(el('span', { class: 'ida-status ida-status--anomaly' }, v.conflict_count + ' conflit(s)'));
    if (v.disagreement_count) flags.push(el('span', { class: 'ida-status ida-status--anomaly' }, v.disagreement_count + ' donnée(s) divergente(s)'));
    return el('tr', null, [
      el('th', { scope: 'row' }, link),
      el('td', null, C.plate(v.plate_display, v.plate)),
      el('td', null, [C.text([v.make, v.model].filter(Boolean).join(' ') || null), v.variant ? el('span', { class: 'ida-caption ida-u-block' }, v.variant) : null]),
      el('td', null, C.text(v.year)),
      el('td', null, [C.badge('fiche_status', v.fiche_status)].concat(flags)),
      el('td', null, v.verified ? C.badge('verification_status', 'verified') : el('span', { class: 'ida-muted' }, 'Non vérifiée')),
      el('td', null, String(v.visit_count)),
      el('td', null, C.date(v.updated_at))
    ]);
  }

  async function loadRegistry(push) {
    var p = params();
    if (push) window.history.pushState(null, '', '/admin/vehicles' + (p.toString() ? '?' + p.toString() : ''));
    prev.disabled = true; next.disabled = true;
    summary.textContent = '';
    C.state(results, 'loading', 'Chargement du registre…');
    try {
      var api = new URLSearchParams(p);
      api.set('page', String(current.page));
      var data = await C.api('/api/admin/vehicles?' + api.toString());
      current.page = data.page; current.pages = data.pages;
      C.clear(results);
      results.setAttribute('aria-busy', 'false');
      if (!data.results.length) {
        C.state(results, 'empty', data.total === 0 ? 'Aucun véhicule ne correspond à ces critères. Cela ne veut pas dire que le véhicule n\'existe pas : il n\'est peut-être pas encore enregistré.' : 'Cette page est vide.');
      } else {
        results.appendChild(el('table', { class: 'ida-table' }, [
          el('caption', { class: 'ida-sr-only' }, 'Véhicules du registre'),
          el('thead', null, el('tr', null, ['Vehicle ID', 'Plaque actuelle', 'Véhicule', 'Année', 'Fiche', 'Identification', 'Visites', 'Modifié'].map(headerCell))),
          el('tbody', null, data.results.map(row))
        ]));
      }
      summary.textContent = data.total + ' véhicule(s) · page ' + data.page + ' sur ' + data.pages;
      prev.disabled = data.page <= 1;
      next.disabled = data.page >= data.pages;
    } catch (err) {
      C.state(results, 'error', err.message);
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); current.page = 1; loadRegistry(true); });
  form.addEventListener('reset', function () { setTimeout(function () { current.page = 1; loadRegistry(true); }, 0); });
  prev.addEventListener('click', function () { if (current.page > 1) { current.page--; loadRegistry(true); } });
  next.addEventListener('click', function () { if (current.page < current.pages) { current.page++; loadRegistry(true); } });
  window.addEventListener('popstate', function () { readUrl(); loadRegistry(false); });

  (async function start() {
    readUrl();
    var user = await C.sessionLine('session-line', '/admin/vehicles');
    if (!user) return;
    if (user.role !== 'admin') {
      C.state(results, 'error', 'Le registre est réservé aux administrateurs. Utilisez l\'atelier pour identifier un véhicule.');
      C.clear(overview);
      return;
    }
    loadOverview();
    loadRegistry(false);
  }());
}());
