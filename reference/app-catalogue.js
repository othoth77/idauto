'use strict';
/* IDauto — IDA-UI-3 — parts catalogue: GET /api/parts/search?q (parts:read); POST /api/parts (parts:write — managers).
 * A catalogue entry is a reference, not a stock nor a purchase. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), q = document.getElementById('f-q');
  q.value = new URLSearchParams(location.search).get('q') || '';
  async function search() {
    var v = q.value.trim(); clear(list);
    if (v.length < 2) { list.appendChild(el('p', { class: 'ida-muted' }, t('Saisissez au moins deux caractères.'))); return; }
    list.setAttribute('aria-busy', 'true');
    try {
      var out = await C.api('/api/parts/search?q=' + encodeURIComponent(v));
      list.setAttribute('aria-busy', 'false'); clear(list);
      var parts = out.parts || [];
      if (!parts.length) { list.appendChild(el('p', { class: 'ida-empty' }, t('Aucune pièce ne correspond.'))); return; }
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Désignation', 'Marque', 'Référence', 'Référence constructeur (OE)', 'Catégorie', 'Origine'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, parts.map(function (p) {
          return el('tr', null, [el('td', null, C.text(p.name)), el('td', null, C.text(p.brand)), el('td', null, el('bdi', { dir: 'ltr' }, C.text(p.reference))),
            el('td', null, p.oe_reference ? el('bdi', { dir: 'ltr' }, p.oe_reference) : '—'), el('td', null, C.text(p.category)),
            el('td', null, p.org_id ? t('Votre atelier') : p.source === 'tecdoc' ? t('Fournisseur') : t('Catalogue partagé'))]);
        }))])));
      if (out.supplier && out.supplier.message_fr) list.appendChild(el('p', { class: 'ida-small ida-muted' }, out.supplier.message_fr));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); history.replaceState(null, '', q.value.trim() ? '?q=' + encodeURIComponent(q.value.trim()) : location.pathname); search(); });
  document.getElementById('add-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var box = document.getElementById('add-errors'); clear(box);
    var body = { reference: document.getElementById('p-ref').value.trim(), brand: document.getElementById('p-brand').value.trim(), name: document.getElementById('p-name').value.trim() || null,
      category: document.getElementById('p-cat').value.trim() || null, oe_reference: document.getElementById('p-oe').value.trim() || null };
    if (!body.reference || !body.brand) { box.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, t('La référence et la marque sont obligatoires.'))); return; }
    try { await C.send('POST', '/api/parts', body); e.target.reset(); box.appendChild(el('p', { class: 'ida-alert ida-alert--success' }, t('Pièce ajoutée au catalogue.'))); q.value = body.reference; search(); }
    catch (err) { box.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, C.errorText(err))); }
  });
  (async function () {
    var me = await C.sessionLine(null, location.pathname + location.search); if (!me) return;
    document.getElementById('add-box').hidden = !(me.role === 'admin' || me.role === 'manager');
    if (q.value) search();
  }());
}());
