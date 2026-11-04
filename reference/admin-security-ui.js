'use strict';
/* IDauto — IDA-ADMIN-5 — security and audit (/admin/security).
 * Reads GET /api/admin/accounts and GET /api/admin/audit; writes nothing.
 * Server values are placed with textContent through IdAutoConsole.el(). No
 * password hash, session token, session address or user agent is ever sent
 * to this page; for capture rows the server withholds actor, target and hour. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var form = document.getElementById('filters');
  var accountForm = document.getElementById('account-filters');
  var results = document.getElementById('results');
  var summary = document.getElementById('results-summary');
  var accounts = document.getElementById('accounts');
  var accountsSummary = document.getElementById('accounts-summary');
  var totalsBox = document.getElementById('totals');
  var access = document.getElementById('access');
  var activity = document.getElementById('activity');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var FIELDS = ['event', 'actor_type', 'target_type', 'actor', 'from', 'to'];
  var current = { page: 1, pages: 1 };
  var wanted = {};

  var ROLE = { admin: 'Administrateur', manager: 'Gestionnaire', technician: 'Technicien' };
  var DENIAL = {
    no_credentials: 'aucune identification présentée', malformed_authorization: 'en-tête d\'autorisation mal formé',
    unknown_credential: 'identifiant inconnu', missing_scope: 'droit manquant pour cette route',
    route_not_available_to_organisations: 'route réservée aux administrateurs'
  };
  // The VIN disclosure events, written by the audited fiche and search routes.
  var VIN_READ = 'vehicle.' + 'vin.read', VIN_SEARCH = 'vehicle.search.' + 'vin';

  function stat(labelText, value, hint) {
    return el('div', { class: 'ida-card ida-admin-stat' }, [
      el('p', { class: 'ida-label' }, labelText),
      el('p', { class: 'ida-admin-stat-value' }, C.text(value)),
      hint ? el('p', { class: 'ida-caption' }, hint) : null
    ]);
  }
  function th(h) { return el('th', { scope: 'col' }, h); }

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    FIELDS.forEach(function (f) { var e = form.elements[f]; if (e) e.value = p.has(f) ? p.get(f) : (e.tagName === 'SELECT' ? e.options[0].value : ''); });
    wanted = { event: p.get('event') || '', target_type: p.get('target_type') || '' };
    var page = parseInt(p.get('page') || '1', 10);
    current.page = isFinite(page) && page > 0 ? page : 1;
  }
  function params() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = String(form.elements[f].value || '').trim(); if (v) p.set(f, v); });
    if (current.page > 1) p.set('page', String(current.page));
    return p;
  }
  // The event and target lists come from the log itself; a value from the URL
  // is kept selected once its option exists.
  function fillSelect(select, values, keep, labelOf) {
    while (select.options.length > 1) select.remove(1);
    values.forEach(function (v) { select.appendChild(el('option', { value: v }, labelOf ? labelOf(v) : v)); });
    select.value = keep;
    if (select.value !== keep) select.value = '';
  }
  function eventOptions(types) {
    var families = {};
    types.forEach(function (t) { families[t.split('.')[0] + '.'] = true; });
    return Object.keys(families).sort().concat(types);
  }

  function auditRow(r) {
    var actor = r.masked
      ? el('span', { class: 'ida-muted' }, C.label('actor_type', r.actor_type) + ' · non affiché')
      : el('div', null, [C.label('actor_type', r.actor_type),
        r.actor_name ? el('span', { class: 'ida-caption ida-u-block' }, el('bdi', null, r.actor_name)) : null,
        r.actor_ref ? el('span', { class: 'ida-caption ida-u-block' }, C.id(r.actor_ref)) : null]);
    return el('tr', null, [
      el('th', { scope: 'row' }, r.masked ? [C.date(r.at), el('span', { class: 'ida-caption ida-u-block' }, 'jour seulement')] : C.date(r.at, true)),
      el('td', null, el('code', { class: 'ida-id', translate: 'no' }, r.event_type)),
      el('td', null, actor),
      el('td', null, r.org_id === null ? el('span', { class: 'ida-muted' }, 'IDauto') : (r.org_name ? el('bdi', null, r.org_name) : 'Organisation ' + r.org_id)),
      el('td', null, r.target_type ? [el('code', { class: 'ida-id', translate: 'no' }, r.target_type),
        r.masked ? el('span', { class: 'ida-caption ida-u-block' }, 'cible non affichée') : (r.target_ref ? el('span', { class: 'ida-caption ida-u-block' }, C.id(r.target_ref)) : null)]
        : C.DASH),
      el('td', null, r.summary ? el('bdi', null, r.summary) : C.DASH)
    ]);
  }

  async function loadAudit(push) {
    var p = params();
    if (push) window.history.pushState(null, '', '/admin/security' + (p.toString() ? '?' + p.toString() : ''));
    prev.disabled = true; next.disabled = true; summary.textContent = '';
    C.state(results, 'loading', 'Chargement du journal…');
    try {
      var api = new URLSearchParams(p); api.set('page', String(current.page));
      var d = await C.api('/api/admin/audit?' + api.toString());
      current.page = d.page; current.pages = d.pages;
      fillSelect(form.elements.event, eventOptions(d.filters.event_types), form.elements.event.value || wanted.event,
        function (v) { return /\.$/.test(v) ? v + '* (famille)' : v; });
      fillSelect(form.elements.target_type, d.filters.target_types, form.elements.target_type.value || wanted.target_type);
      renderActivity(d.last_30_days);
      C.clear(results); results.setAttribute('aria-busy', 'false');
      if (!d.results.length) C.state(results, 'empty', d.total === 0 ? 'Aucune ligne du journal ne correspond à ces critères.' : 'Cette page est vide.');
      else results.appendChild(el('table', { class: 'ida-table' }, [
        el('caption', { class: 'ida-sr-only' }, 'Journal d\'audit'),
        el('thead', null, el('tr', null, ['Date', 'Événement', 'Acteur', 'Organisation', 'Cible', 'Résumé'].map(th))),
        el('tbody', null, d.results.map(auditRow))
      ]));
      summary.textContent = d.total + ' ligne(s) · page ' + d.page + ' sur ' + d.pages;
      prev.disabled = d.page <= 1; next.disabled = d.page >= d.pages;
    } catch (err) {
      C.state(results, 'error', err.message);
      if (activity.getAttribute('aria-busy') === 'true') C.state(activity, 'error', err.message);
      if (totalsBox.getAttribute('aria-busy') === 'true') C.state(totalsBox, 'error', err.message);
    }
  }

  function renderActivity(a) {
    C.clear(activity); activity.setAttribute('aria-busy', 'false');
    activity.appendChild(el('div', { class: 'ida-stack' }, [
      el('h3', { class: 'ida-label' }, 'Par famille d\'événements'),
      a.by_family.length ? el('ul', { class: 'ida-admin-ops' }, a.by_family.map(function (f) { return el('li', null, [el('code', { class: 'ida-id', translate: 'no' }, f.k), ' : ' + f.n]); }))
        : el('p', { class: 'ida-muted' }, 'Aucune écriture enregistrée sur la période.')
    ]));
    var actors = Object.keys(a.by_actor_type || {}).sort();
    activity.appendChild(el('div', { class: 'ida-stack' }, [
      el('h3', { class: 'ida-label' }, 'Par type d\'acteur'),
      actors.length ? el('ul', { class: 'ida-admin-ops' }, actors.map(function (k) { return el('li', null, C.label('actor_type', k) + ' : ' + a.by_actor_type[k]); }))
        : el('p', { class: 'ida-muted' }, 'Aucun.')
    ]));
    lastActivity = a;
    renderTotals();
  }

  var lastAccounts = null, lastActivity = null;
  function renderTotals() {
    if (!lastAccounts || !lastActivity) return;
    C.clear(totalsBox); totalsBox.setAttribute('aria-busy', 'false');
    var t = lastAccounts.totals, sc = lastAccounts.service_credentials, ad = lastAccounts.auth_decisions.counters, by = lastActivity.by_type || {};
    var orgCreds = sc.organisations.reduce(function (n, o) { return n + o.credentials; }, 0);
    [
      stat('Comptes web', t.accounts, Object.keys(ROLE).map(function (k) { return (t.by_role[k] || 0) + ' ' + ROLE[k].toLowerCase(); }).join(' · ')),
      stat('Sessions actives', t.active_sessions, t.accounts_signed_in + ' compte(s) connecté(s)'),
      stat('Comptes bloqués', t.without_organisation, 'gestionnaire ou technicien sans organisation : connexion refusée'),
      stat('Accès de service', sc.admin_credentials + orgCreds, sc.admin_credentials + ' administrateur · ' + orgCreds + ' organisation' + (sc.invalid_entries ? ' · ' + sc.invalid_entries + ' invalide(s)' : '')),
      stat('Accès refusés', ad.auth_denied || 0, (ad.auth_granted || 0) + ' accordé(s) depuis le démarrage du service'),
      stat('Numéros de châssis lus', by[VIN_READ] || 0, (by[VIN_SEARCH] || 0) + ' recherche(s) par numéro de châssis · 30 jours')
    ].forEach(function (n) { totalsBox.appendChild(n); });
  }

  function accountRow(u) {
    return el('tr', null, [
      el('th', { scope: 'row' }, [el('bdi', null, u.name), el('span', { class: 'ida-caption ida-u-block' }, el('bdi', { dir: 'ltr' }, u.email)),
        u.email_verified ? null : el('span', { class: 'ida-caption ida-u-block' }, 'e-mail non vérifié')]),
      el('td', null, ROLE[u.role] || u.role),
      el('td', null, u.org_id === null
        ? (u.role === 'admin' ? el('span', { class: 'ida-muted' }, 'Toutes') : el('span', { class: 'ida-status ida-status--anomaly' }, 'Aucune — connexion refusée'))
        : [el('bdi', null, u.org_name || ('Organisation ' + u.org_id)), u.org_status && u.org_status !== 'active' ? el('span', { class: 'ida-caption ida-u-block' }, 'organisation : ' + u.org_status) : null]),
      el('td', null, u.active_sessions ? u.active_sessions + ' active(s)' : el('span', { class: 'ida-muted' }, 'aucune')),
      el('td', null, u.last_seen_at ? C.date(u.last_seen_at, true) : el('span', { class: 'ida-muted' }, 'jamais connecté')),
      el('td', null, C.date(u.created_at))
    ]);
  }

  async function loadAccounts() {
    C.state(accounts, 'loading', 'Chargement des comptes…');
    if (!access.childNodes.length) C.state(access, 'loading', 'Chargement…');
    accountsSummary.textContent = '';
    try {
      var p = new URLSearchParams();
      ['q', 'role'].forEach(function (f) { var v = accountForm.elements[f].value.trim(); if (v) p.set(f, v); });
      var d = await C.api('/api/admin/accounts?' + p.toString());
      lastAccounts = d; renderTotals();
      C.clear(accounts); accounts.setAttribute('aria-busy', 'false');
      if (!d.results.length) C.state(accounts, 'empty', 'Aucun compte ne correspond à ces critères.');
      else accounts.appendChild(el('table', { class: 'ida-table' }, [
        el('caption', { class: 'ida-sr-only' }, 'Comptes web'),
        el('thead', null, el('tr', null, ['Compte', 'Rôle', 'Organisation', 'Sessions', 'Dernière activité', 'Créé le'].map(th))),
        el('tbody', null, d.results.map(accountRow))
      ]));
      accountsSummary.textContent = d.results.length + ' compte(s)' + (d.truncated ? ' — liste limitée à 500, affinez la recherche' : '');

      C.clear(access); access.setAttribute('aria-busy', 'false');
      var sc = d.service_credentials, ad = d.auth_decisions;
      access.appendChild(el('dl', { class: 'ida-admin-dl' }, [
        el('dt', null, 'Accès de service (serveur à serveur)'),
        el('dd', null, sc.admin_credentials + ' accès administrateur' + (sc.invalid_entries ? ' · ' + sc.invalid_entries + ' entrée(s) invalide(s), refusée(s)' : '') +
          '. Les identifiants eux-mêmes ne sont jamais affichés.'),
        el('dt', null, 'Par organisation'),
        el('dd', null, sc.organisations.length ? el('ul', { class: 'ida-admin-ops' }, sc.organisations.map(function (o) {
          return el('li', null, ['Organisation ' + o.org_id + ' : ' + o.credentials + ' accès · ', el('span', { class: 'ida-caption' }, o.scopes.join(', '))]);
        })) : el('span', { class: 'ida-muted' }, 'Aucun accès de service d\'organisation.')),
        el('dt', null, 'Décisions d\'accès depuis le ' + C.date(ad.since, true)),
        el('dd', null, (function () {
          var c = ad.counters, keys = Object.keys(c).filter(function (k) { return /^auth_denied:/.test(k); }).sort();
          var lines = [el('li', null, (c.auth_granted || 0) + ' accordée(s), ' + (c.auth_denied || 0) + ' refusée(s)')];
          keys.forEach(function (k) { var r = k.slice('auth_denied:'.length); lines.push(el('li', null, (DENIAL[r] || r) + ' : ' + c[k])); });
          return [el('ul', { class: 'ida-admin-ops' }, lines),
            el('span', { class: 'ida-caption ida-u-block' }, 'Compteurs du processus en cours : remis à zéro à chaque redémarrage du service. Les échecs de mot de passe à la connexion ne sont pas comptés ici.')];
        }()))
      ]));
    } catch (err) {
      C.state(accounts, 'error', err.message);
      C.state(access, 'error', err.message);
      if (totalsBox.getAttribute('aria-busy') === 'true') C.state(totalsBox, 'error', err.message);
    }
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); current.page = 1; loadAudit(true); });
  form.addEventListener('reset', function () { setTimeout(function () { wanted = {}; current.page = 1; loadAudit(true); }, 0); });
  accountForm.addEventListener('submit', function (e) { e.preventDefault(); loadAccounts(); });
  prev.addEventListener('click', function () { if (current.page > 1) { current.page--; loadAudit(true); } });
  next.addEventListener('click', function () { if (current.page < current.pages) { current.page++; loadAudit(true); } });
  window.addEventListener('popstate', function () { readUrl(); loadAudit(false); });

  (async function start() {
    readUrl();
    var user = await C.sessionLine('session-line', '/admin/security');
    if (!user) return;
    if (user.role !== 'admin') { C.state(results, 'error', 'Cette page est réservée aux administrateurs.'); return; }
    C.state(totalsBox, 'loading', 'Chargement des indicateurs…');
    C.state(activity, 'loading', 'Chargement…');
    loadAccounts();
    loadAudit(false);
  }());
}());
