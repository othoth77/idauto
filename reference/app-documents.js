'use strict';
/* IDauto — IDA-UI-3 — carte grise documents: GET /api/workspace/documents (own workshop; admin: all). */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), pager = document.getElementById('pager');
  var page = parseInt(new URLSearchParams(location.search).get('page'), 10) || 1;
  (async function () {
    if (!(await C.sessionLine(null, location.pathname + location.search))) return;
    try {
      var out = await C.api('/api/workspace/documents?page=' + page);
      list.setAttribute('aria-busy', 'false'); clear(list);
      if (!out.documents.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune carte grise jointe pour le moment.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Immatriculation', 'Véhicule', 'Faces jointes', 'Mise à jour'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.documents.map(function (d) {
          var both = d.faces.indexOf(1) !== -1 && d.faces.indexOf(2) !== -1;
          return el('tr', null, [el('td', null, el('a', { href: '/atelier/vehicule?ref=' + encodeURIComponent(d.ivid) + '#sec-docs-box' }, C.plate(d.plate, d.plate))),
            el('td', null, [d.make, d.model].filter(Boolean).join(' ') || d.ivid),
            el('td', null, el('span', { class: 'ida-status ida-status--' + (both ? 'verified' : 'pending') }, both ? t('Faces 1 et 2') : t('Face ' + d.faces.join(', ')))),
            el('td', null, C.date(d.at, true))]);
        }))])));
      if (page > 1) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: '?page=' + (page - 1) }, t('Page précédente')));
      if (out.has_more) pager.appendChild(el('a', { class: 'ida-btn ida-btn--secondary ida-btn--sm', href: '?page=' + (page + 1) }, t('Page suivante')));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }());
}());
