'use strict';
/* IDauto — IDA-ADMIN-4 — data quality (/admin/quality).
 * Reads GET /api/admin/quality; writes nothing. Decisions are taken on
 * /admin/review through the existing audited routes — this page only links
 * there. Server values are placed with textContent through IdAutoConsole.el().
 * No restricted fact and no VIN reaches this page: the server never selects
 * them. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var form = document.getElementById('filters');
  var results = document.getElementById('results');
  var summary = document.getElementById('results-summary');
  var totalsBox = document.getElementById('totals');
  var backlog = document.getElementById('backlog');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var current = { page: 1, pages: 1 };

  var ISSUE = {
    all: 'Tous les points ouverts', disagreement: 'Valeurs en désaccord', pending_facts: 'Données en attente de revue',
    conflict_facts: 'Données marquées en conflit', pending_observations: 'Observations à revoir',
    incomplete: 'Identité incomplète', no_plate: 'Sans plaque active'
  };
  var SUBMISSION = { pending: 'En attente', accepted: 'Acceptée', rejected: 'Rejetée', duplicate: 'Doublon' };

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    var issue = p.get('issue');
    form.elements.issue.value = issue && Object.prototype.hasOwnProperty.call(ISSUE, issue) ? issue : 'all';
    form.elements.q.value = p.get('q') || '';
    var page = parseInt(p.get('page') || '1', 10);
    current.page = isFinite(page) && page > 0 ? page : 1;
  }
  function params() {
    var p = new URLSearchParams();
    if (form.elements.issue.value !== 'all') p.set('issue', form.elements.issue.value);
    var q = form.elements.q.value.trim();
    if (q) p.set('q', q);
    if (current.page > 1) p.set('page', String(current.page));
    return p;
  }

  function stat(labelText, value, hint, href) {
    return el('div', { class: 'ida-card ida-admin-stat' }, [
      el('p', { class: 'ida-label' }, labelText),
      el('p', { class: 'ida-admin-stat-value' }, C.text(value)),
      hint ? el('p', { class: 'ida-caption' }, hint) : null,
      href ? el('p', { class: 'ida-caption' }, el('a', { href: href[0] }, href[1])) : null
    ]);
  }
  function sum(map) { return Object.keys(map || {}).reduce(function (s, k) { return s + (map[k] || 0); }, 0); }

  function issueList(r) {
    var i = r.issues, items = [];
    r.disagreements.forEach(function (d) {
      items.push(el('li', null, [el('strong', null, 'Désaccord'), ' sur ', el('code', { class: 'ida-id', translate: 'no' }, d.fact_key), ' : ',
        el('bdi', null, d.values.join(' / ')), d.distinct_values > d.values.length ? ' (' + d.distinct_values + ' valeurs au total)' : '']));
    });
    if (i.disagreement > r.disagreements.length) items.push(el('li', null, i.disagreement + ' clé(s) en désaccord'));
    if (i.pending_facts) items.push(el('li', null, i.pending_facts + ' donnée(s) en attente de revue'));
    if (i.conflict_facts) items.push(el('li', null, i.conflict_facts + ' donnée(s) marquée(s) en conflit'));
    if (i.pending_observations) items.push(el('li', null, [i.pending_observations + ' observation(s) à revoir — ', el('a', { href: '/admin/review' }, 'ouvrir la revue')]));
    if (i.incomplete) {
      var missing = [];
      if (!r.make) missing.push('marque');
      if (!r.model) missing.push('modèle');
      if (r.year === null || r.year === undefined) missing.push('année');
      items.push(el('li', null, 'Identité incomplète : ' + (missing.length ? missing.join(', ') : i.incomplete + ' champ(s)') + ' manquant(s)'));
    }
    if (i.no_plate) items.push(el('li', null, 'Aucune plaque active'));
    return el('ul', { class: 'ida-admin-ops' }, items);
  }

  function row(r) {
    var name = [r.make, r.model].filter(Boolean).join(' ');
    return el('tr', null, [
      el('th', { scope: 'row' }, [
        el('a', { href: '/admin/vehicle?ref=' + encodeURIComponent(r.ivid) }, name ? el('bdi', null, name) : C.id(r.ivid)),
        el('span', { class: 'ida-caption ida-u-block' }, [C.id(r.ivid), r.year ? ' · ' + r.year : '']),
        r.aliases ? el('span', { class: 'ida-caption ida-u-block' }, r.aliases + ' fiche(s) fusionnée(s) incluse(s)') : null
      ]),
      el('td', null, r.plate ? C.plate(r.plate_display, r.plate) : el('span', { class: 'ida-muted' }, 'Aucune plaque active')),
      el('td', null, C.badge('fiche_status', r.fiche_status)),
      el('td', null, issueList(r)),
      el('td', null, r.updated_at ? C.date(r.updated_at) : C.DASH)
    ]);
  }

  function renderTotals(d) {
    C.clear(totalsBox); totalsBox.setAttribute('aria-busy', 'false');
    var t = d.totals, rv = d.review;
    [
      stat('Identités avec un point ouvert', t.all, 'sur ' + t.identities + ' identité(s) de véhicule'),
      stat('Valeurs en désaccord', t.disagreement, 'identité(s) dont une donnée active a plusieurs valeurs'),
      stat('Données en attente de revue', t.pending_facts, t.conflict_facts + ' identité(s) avec une donnée marquée en conflit'),
      stat('Observations à revoir', rv.pending_review + rv.pending_confirmation, rv.pending_unlinked + ' sans véhicule rattaché', ['/admin/review', 'Ouvrir la revue']),
      stat('Identités incomplètes', t.incomplete, 'marque, modèle ou année manquant'),
      stat('Sans plaque active', t.no_plate, null),
      stat('Visites non identifiées', d.unidentified_visits, 'visites atelier sans véhicule', ['/admin/maintenance?identified=false', 'Voir ces visites']),
      stat('Fiches fusionnées', d.merged_records, 'rattachées à une autre identité')
    ].forEach(function (n) { totalsBox.appendChild(n); });
  }

  function countList(title, map, labels) {
    var keys = Object.keys(map || {});
    return el('div', { class: 'ida-stack' }, [
      el('h3', { class: 'ida-label' }, title),
      keys.length ? el('ul', { class: 'ida-admin-ops' }, keys.sort().map(function (k) { return el('li', null, labels(k) + ' : ' + map[k]); }))
        : el('p', { class: 'ida-muted' }, 'Aucun enregistrement.')
    ]);
  }

  function renderBacklog(d) {
    C.clear(backlog); backlog.setAttribute('aria-busy', 'false');
    var rv = d.review;
    backlog.appendChild(el('div', { class: 'ida-stack' }, [
      el('h3', { class: 'ida-label' }, 'Observations en attente par source'),
      rv.pending_by_source.length ? el('ul', { class: 'ida-admin-ops' }, rv.pending_by_source.map(function (s) {
        return el('li', null, [el('code', { class: 'ida-id', translate: 'no' }, s.code), ' ' + (s.name_fr || '') + ' : ' + s.n]);
      })) : el('p', { class: 'ida-muted' }, 'Aucune observation en attente de revue.')
    ]));
    backlog.appendChild(countList('Soumissions par statut', rv.submissions_by_status, function (k) { return SUBMISSION[k] || k; }));
    backlog.appendChild(countList('Données actives par statut de vérification', d.facts_by_status, function (k) { return C.label('verification_status', k); }));
    backlog.appendChild(countList('Fiches par statut', d.fiche_by_status, function (k) { return C.label('fiche_status', k); }));
  }

  async function load(push) {
    var p = params();
    if (push) window.history.pushState(null, '', '/admin/quality' + (p.toString() ? '?' + p.toString() : ''));
    prev.disabled = true; next.disabled = true; summary.textContent = '';
    C.state(results, 'loading', 'Chargement des points ouverts…');
    if (!totalsBox.childNodes.length) C.state(totalsBox, 'loading', 'Chargement des indicateurs…');
    if (!backlog.childNodes.length) C.state(backlog, 'loading', 'Chargement…');
    try {
      var api = new URLSearchParams(p); api.set('page', String(current.page));
      var data = await C.api('/api/admin/quality?' + api.toString());
      current.page = data.page; current.pages = data.pages;
      renderTotals(data); renderBacklog(data);
      C.clear(results); results.setAttribute('aria-busy', 'false');
      if (!data.results.length) {
        C.state(results, 'empty', data.total === 0
          ? 'Aucune identité ne présente ce point. Cela décrit ce qui est enregistré, pas l\'exactitude des données.'
          : 'Cette page est vide.');
      } else {
        results.appendChild(el('table', { class: 'ida-table' }, [
          el('caption', { class: 'ida-sr-only' }, 'Identités à traiter — ' + ISSUE[data.issue]),
          el('thead', null, el('tr', null, ['Véhicule', 'Plaque', 'Fiche', 'Points relevés', 'Mise à jour'].map(function (h) { return el('th', { scope: 'col' }, h); }))),
          el('tbody', null, data.results.map(row))
        ]));
      }
      summary.textContent = data.total + ' identité(s) · ' + ISSUE[data.issue].toLowerCase() + (data.q ? ' · recherche « ' + data.q + ' »' : '') + ' · page ' + data.page + ' sur ' + data.pages;
      prev.disabled = data.page <= 1; next.disabled = data.page >= data.pages;
    } catch (err) {
      C.state(results, 'error', err.message);
      if (totalsBox.getAttribute('aria-busy') === 'true') C.state(totalsBox, 'error', err.message);
      if (backlog.getAttribute('aria-busy') === 'true') C.state(backlog, 'error', err.message);
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); current.page = 1; load(true); });
  form.elements.issue.addEventListener('change', function () { current.page = 1; load(true); });
  prev.addEventListener('click', function () { if (current.page > 1) { current.page--; load(true); } });
  next.addEventListener('click', function () { if (current.page < current.pages) { current.page++; load(true); } });
  window.addEventListener('popstate', function () { readUrl(); load(false); });

  (async function start() {
    readUrl();
    var user = await C.sessionLine('session-line', '/admin/quality');
    if (!user) return;
    if (user.role !== 'admin') { C.state(results, 'error', 'Cette page est réservée aux administrateurs.'); return; }
    load(false);
  }());
}());
