'use strict';
/* IDauto — IDA-ADMIN-2 — maintenance history (/admin/maintenance).
 * Reads GET /api/admin/maintenance; writes nothing. Every value from the server
 * is placed with textContent through IdAutoConsole.el(). The filter state lives
 * in the URL so a filtered view can be reloaded, shared and reached with Back. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;

  var form = document.getElementById('filters');
  var results = document.getElementById('results');
  var summary = document.getElementById('results-summary');
  var totals = document.getElementById('totals');
  var orgSelect = document.getElementById('f-org');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var FIELDS = ['kind', 'q', 'org_id', 'status', 'operation_type', 'identified', 'from', 'to', 'dir'];
  var current = { page: 1, pages: 1 };
  var wantedOrg = '';

  function kind() { return form.elements.kind.value; }
  function syncKind() {
    // Visit-only filters are hidden AND cleared for service events, so a stale
    // value can never be sent with a kind the server refuses it for.
    var visits = kind() === 'visits';
    Array.prototype.forEach.call(document.querySelectorAll('[data-visits-only]'), function (f) {
      f.hidden = !visits;
      if (!visits) { var s = f.querySelector('select'); if (s) s.value = ''; }
    });
  }
  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    // Every field is set, not only those in the URL: defaults are left out of
    // the URL, so on Back a field absent from it must return to its default
    // rather than keep the value of the page being left.
    FIELDS.forEach(function (f) { var e = form.elements[f]; if (e) e.value = p.has(f) ? p.get(f) : (e.tagName === 'SELECT' ? e.options[0].value : ''); });
    wantedOrg = p.get('org_id') || '';
    var page = parseInt(p.get('page') || '1', 10);
    current.page = isFinite(page) && page > 0 ? page : 1;
    syncKind();
  }
  function params() {
    var p = new URLSearchParams();
    FIELDS.forEach(function (f) { var v = String(form.elements[f].value || '').trim(); if (v && !(f === 'kind' && v === 'visits') && !(f === 'dir' && v === 'desc')) p.set(f, v); });
    if (current.page > 1) p.set('page', String(current.page));
    return p;
  }

  function fillOrganisations(orgs) {
    var keep = orgSelect.value || wantedOrg;
    while (orgSelect.options.length > 1) orgSelect.remove(1);
    orgs.forEach(function (o) { orgSelect.appendChild(el('option', { value: o.id }, o.name + (o.status && o.status !== 'active' ? ' (' + o.status + ')' : ''))); });
    orgSelect.value = keep;
  }

  function vehicleCell(r) {
    if (!r.vehicle) {
      return el('div', null, [
        el('span', { class: 'ida-status ida-status--pending' }, 'Véhicule non identifié'),
        r.plate_read ? el('span', { class: 'ida-caption ida-u-block' }, ['Plaque lue à l\'atelier : ', C.plate(r.plate_read, r.plate_read)]) : null
      ]);
    }
    var v = r.vehicle;
    return el('div', null, [
      el('a', { href: '/admin/vehicle?ref=' + encodeURIComponent(v.ivid) }, [v.make || v.model ? [v.make, v.model].filter(Boolean).join(' ') : C.id(v.ivid)]),
      el('span', { class: 'ida-caption ida-u-block' }, [C.plate(v.plate_display, v.plate), v.year ? ' · ' + v.year : '']),
      v.merged_into ? el('span', { class: 'ida-caption ida-u-block' }, ['Fiche fusionnée dans ', C.id(v.merged_into)]) : null
    ]);
  }
  function orgName(r) { return r.org_name || ('Organisation ' + r.org_id); }

  function visitRow(r) {
    return el('tr', null, [
      el('th', { scope: 'row' }, [C.date(r.opened_at, true), r.closed_at ? el('span', { class: 'ida-caption ida-u-block' }, 'clôturée le ' + C.date(r.closed_at)) : null]),
      el('td', null, orgName(r)),
      el('td', null, vehicleCell(r)),
      el('td', null, [C.badge('visit_status', r.status), r.reason ? el('span', { class: 'ida-caption ida-u-block' }, 'Motif : ' + r.reason) : null]),
      el('td', null, r.operations.length ? el('ul', { class: 'ida-admin-ops' }, r.operations.map(function (o) {
        return el('li', null, [
          el('strong', null, C.label('operation_type', o.operation_type)), ' ', C.badge('operation_status', o.status),
          o.description ? el('span', { class: 'ida-u-block' }, o.description) : null,
          o.part ? el('span', { class: 'ida-caption ida-u-block' }, 'Pièce : ' + [o.part.brand, o.part.reference, o.part.name].filter(Boolean).join(' · ') + ' × ' + o.quantity) : null
        ]);
      })) : el('span', { class: 'ida-muted' }, 'Aucune opération saisie')),
      el('td', null, el('span', { class: 'ida-muted' }, 'non enregistré'))
    ]);
  }
  function eventRow(r) {
    return el('tr', null, [
      el('th', { scope: 'row' }, C.date(r.event_date)),
      el('td', null, orgName(r)),
      el('td', null, vehicleCell(r)),
      el('td', null, [C.text(r.event_type), r.description ? el('span', { class: 'ida-caption ida-u-block' }, r.description) : null]),
      el('td', null, r.odometer_km === null || r.odometer_km === undefined ? el('span', { class: 'ida-muted' }, 'non enregistré') : Number(r.odometer_km).toLocaleString('fr-FR') + ' km'),
      el('td', null, [r.outcome ? C.badge('outcome', r.outcome) : el('span', { class: 'ida-muted' }, 'non renseigné'),
        r.next_service_due ? el('span', { class: 'ida-caption ida-u-block' }, 'Prochain : ' + C.date(r.next_service_due)) : null]),
      el('td', null, r.is_public ? 'Toutes organisations' : 'Organisation seule')
    ]);
  }

  async function load(push) {
    var p = params();
    if (push) window.history.pushState(null, '', '/admin/maintenance' + (p.toString() ? '?' + p.toString() : ''));
    prev.disabled = true; next.disabled = true;
    summary.textContent = '';
    C.state(results, 'loading', 'Chargement de l\'historique…');
    try {
      var api = new URLSearchParams(p);
      api.set('page', String(current.page));
      var data = await C.api('/api/admin/maintenance?' + api.toString());
      current.page = data.page; current.pages = data.pages;
      fillOrganisations(data.organisations);
      var t = data.totals;
      totals.textContent = t.visits + ' visite(s) atelier dont ' + t.unidentified_visits + ' sans véhicule identifié · ' + t.operations + ' opération(s) · ' +
        t.service_events + ' événement(s) d\'entretien, dont ' + t.service_events_with_mileage + ' avec kilométrage. Les visites atelier ne saisissent pas le kilométrage.';
      C.clear(results);
      results.setAttribute('aria-busy', 'false');
      if (!data.results.length) {
        C.state(results, 'empty', data.total === 0
          ? 'Aucun enregistrement ne correspond. Cela ne prouve pas qu\'aucune intervention n\'a eu lieu : seules les interventions déclarées à IDauto apparaissent ici.'
          : 'Cette page est vide.');
      } else if (data.kind === 'visits') {
        results.appendChild(el('table', { class: 'ida-table' }, [
          el('caption', { class: 'ida-sr-only' }, 'Visites atelier'),
          el('thead', null, el('tr', null, ['Ouverte le', 'Atelier', 'Véhicule', 'Statut', 'Opérations', 'Kilométrage'].map(function (h) { return el('th', { scope: 'col' }, h); }))),
          el('tbody', null, data.results.map(visitRow))
        ]));
      } else {
        results.appendChild(el('table', { class: 'ida-table' }, [
          el('caption', { class: 'ida-sr-only' }, 'Événements d\'entretien'),
          el('thead', null, el('tr', null, ['Date', 'Organisation', 'Véhicule', 'Événement', 'Kilométrage', 'Résultat', 'Visibilité'].map(function (h) { return el('th', { scope: 'col' }, h); }))),
          el('tbody', null, data.results.map(eventRow))
        ]));
      }
      summary.textContent = data.total + ' enregistrement(s) · page ' + data.page + ' sur ' + data.pages;
      prev.disabled = data.page <= 1;
      next.disabled = data.page >= data.pages;
    } catch (err) {
      C.state(results, 'error', err.message);
    }
  }

  form.elements.kind.addEventListener('change', function () { syncKind(); current.page = 1; load(true); });
  form.addEventListener('submit', function (e) { e.preventDefault(); current.page = 1; load(true); });
  form.addEventListener('reset', function () { setTimeout(function () { wantedOrg = ''; syncKind(); current.page = 1; load(true); }, 0); });
  prev.addEventListener('click', function () { if (current.page > 1) { current.page--; load(true); } });
  next.addEventListener('click', function () { if (current.page < current.pages) { current.page++; load(true); } });
  window.addEventListener('popstate', function () { readUrl(); load(false); });

  (async function start() {
    readUrl();
    var user = await C.sessionLine('session-line', '/admin/maintenance');
    if (!user) return;
    if (user.role !== 'admin') {
      C.state(results, 'error', 'L\'historique toutes organisations est réservé aux administrateurs. Un atelier consulte ses propres visites depuis /atelier.');
      return;
    }
    load(false);
  }());
}());
