'use strict';
/* IDauto — IDA-UI-4 — parts used at interventions: GET /api/workspace/parts-used?source=&q=.
   Columns: part, reference, vehicle, date, DECLARED source. No price, no stock, no supplier. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), source = document.getElementById('f-source'), q = document.getElementById('f-q');
  var params = new URLSearchParams(location.search);
  source.value = params.get('source') || ''; q.value = params.get('q') || '';
  function qs() { var p = []; if (source.value) p.push('source=' + encodeURIComponent(source.value)); if (q.value.trim()) p.push('q=' + encodeURIComponent(q.value.trim())); return p.length ? '?' + p.join('&') : ''; }
  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/parts-used' + qs());
      list.setAttribute('aria-busy', 'false'); clear(list);
      // Older records (before this version) may carry « autre fournisseur » or no source: offered as filters only when they exist.
      [['external_supplier', 'Autre fournisseur (ancienne saisie)'], ['unknown', 'Provenance non renseignée']].forEach(function (x) {
        if (out.totals[x[0]] && !source.querySelector('option[value=' + x[0] + ']')) { source.appendChild(el('option', { value: x[0] }, t(x[1]))); if (params.get('source') === x[0]) source.value = x[0]; }
      });
      list.appendChild(el('p', { class: 'ida-small ida-muted', id: 'list-total' }, t('# pièce(s)').replace('#', String(out.matching))));
      if (!out.parts.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune pièce pour cette recherche.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Pièce', 'Référence', 'Véhicule', 'Date', 'Provenance'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.parts.map(function (p) {
          return el('tr', null, [el('td', { translate: 'no' }, [C.text(p.label), p.quantity > 1 ? el('span', { class: 'ida-muted' }, ' × ' + p.quantity) : '']),
            el('td', null, p.reference ? el('bdi', { dir: 'ltr' }, p.reference) : '—'),
            el('td', null, p.vehicle ? el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(p.vehicle.ivid) }, [C.plate(p.vehicle.plate, p.vehicle.plate), ' ', [p.vehicle.make, p.vehicle.model].filter(Boolean).join(' ')]) : '—'),
            el('td', null, el('a', { href: '/atelier/interventions?id=' + p.intervention }, C.date(p.performed_on || p.at))),
            el('td', null, C.label('part_source_short', p.source || 'unknown'))]);
        }))])));
      if (out.parts.length >= out.shown_limit) list.appendChild(el('p', { class: 'ida-small ida-muted' }, t('Les 200 plus récentes sont affichées ; affinez la recherche pour voir les autres.')));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  source.addEventListener('change', function () { history.replaceState(null, '', location.pathname + qs()); load(); });
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); history.replaceState(null, '', location.pathname + qs()); load(); });
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) load(); }());
}());
