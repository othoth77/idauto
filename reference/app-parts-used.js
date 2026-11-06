'use strict';
/* IDauto — parts fitted at interventions, with their DECLARED source: GET /api/workspace/parts-used?source=&org=.
   The totals per source are counted in the database over the same scope as the list. No price: none is recorded
   for a fitted part (client restructuring 2026-11-06, docs/RESTRUCTURE_2026-11.md §5). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), totals = document.getElementById('totals'), source = document.getElementById('f-source');
  var params = new URLSearchParams(location.search), org = params.get('org') || '';
  source.value = params.get('source') || '';
  function qs(src) { var p = []; if (src) p.push('source=' + encodeURIComponent(src)); if (org) p.push('org=' + encodeURIComponent(org)); return p.length ? '?' + p.join('&') : ''; }
  function sourceOf(p) { return C.label('part_source', p.source || 'unknown'); }
  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/parts-used' + qs(source.value));
      list.setAttribute('aria-busy', 'false'); clear(list); clear(totals);
      [['', t('Toutes les pièces posées'), out.total], ['our_shop', null, out.totals.our_shop], ['customer_supplied', null, out.totals.customer_supplied],
        ['external_supplier', null, out.totals.external_supplier], ['unknown', null, out.totals.unknown]].forEach(function (x) {
        if (x[0] === 'unknown' && !x[2]) return;
        totals.appendChild(el('a', { class: 'ida-card ida-admin-stat--link' + (source.value === x[0] ? ' is-active' : ''), href: location.pathname + qs(x[0]), 'aria-current': source.value === x[0] ? 'true' : null },
          [el('p', { class: 'ida-admin-stat-value' }, String(x[2])), el('p', { class: 'ida-small ida-muted' }, x[1] || C.label('part_source', x[0]))]));
      });
      if (!out.parts.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune pièce enregistrée pour ce filtre.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Date', 'Pièce', 'Référence', 'Quantité', 'Véhicule', 'Intervention', 'Atelier', 'Provenance', 'État', 'Technicien'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.parts.map(function (p) {
          return el('tr', null, [el('td', null, C.date(p.performed_on || p.at)), el('td', null, C.text(p.label)), el('td', null, p.reference ? el('bdi', { dir: 'ltr' }, p.reference) : '—'), el('td', null, String(p.quantity)),
            el('td', null, p.vehicle ? el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(p.vehicle.ivid) }, [C.plate(p.vehicle.plate, p.vehicle.plate), ' ', [p.vehicle.make, p.vehicle.model].filter(Boolean).join(' ')]) : '—'),
            el('td', null, el('a', { href: '/atelier/interventions?id=' + p.intervention }, '#' + p.intervention)),
            el('td', null, p.org_id ? el('a', { href: '/atelier/ateliers?id=' + p.org_id }, C.text(p.org)) : C.text(p.org)),
            el('td', null, sourceOf(p)), el('td', null, C.label('part_condition', p.condition)), el('td', null, p.technician ? p.technician.name : '—')]);
        }))])));
      if (out.parts.length >= out.shown_limit) list.appendChild(el('p', { class: 'ida-small ida-muted' }, t('Les 100 plus récentes sont affichées ; filtrez par provenance pour voir les autres.')));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  source.addEventListener('change', function () { history.replaceState(null, '', location.pathname + qs(source.value)); load(); });
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) load(); }());
}());
