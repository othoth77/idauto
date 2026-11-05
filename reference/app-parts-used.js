'use strict';
/* IDauto — IDA-UI-3 — replaced / repaired parts with their DECLARED source: GET /api/workspace/parts-used?source=. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), source = document.getElementById('f-source');
  source.value = new URLSearchParams(location.search).get('source') || '';
  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/workspace/parts-used' + (source.value ? '?source=' + encodeURIComponent(source.value) : ''));
      list.setAttribute('aria-busy', 'false'); clear(list);
      if (!out.parts.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune pièce enregistrée pour ce filtre.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Date', 'Véhicule', 'Pièce', 'Référence', 'Quantité', 'Provenance', 'État', 'Technicien', 'Intervention'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.parts.map(function (p) {
          return el('tr', null, [el('td', null, C.date(p.performed_on || p.at)),
            el('td', null, p.vehicle ? el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(p.vehicle.ivid) }, [C.plate(p.vehicle.plate, p.vehicle.plate), ' ', [p.vehicle.make, p.vehicle.model].filter(Boolean).join(' ')]) : '—'),
            el('td', null, C.text(p.label)), el('td', null, p.reference ? el('bdi', { dir: 'ltr' }, p.reference) : '—'), el('td', null, String(p.quantity)),
            el('td', null, C.label('part_source', p.source)), el('td', null, C.label('part_condition', p.condition)), el('td', null, p.technician ? p.technician.name : '—'),
            el('td', null, el('a', { href: '/atelier/interventions?id=' + p.intervention }, '#' + p.intervention))]);
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  source.addEventListener('change', function () { history.replaceState(null, '', source.value ? '?source=' + source.value : location.pathname); load(); });
  (async function () { if (await C.sessionLine(null, location.pathname + location.search)) load(); }());
}());
