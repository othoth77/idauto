'use strict';
/* IDauto — IDA-UI-3 — platform accounts (admin): GET /api/admin/accounts. Read-only: accounts are
 * created and changed by the operator CLI (ops/auth-users.js), so a password never crosses a web page. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, t = (window.IdAutoI18n || { t: function (s) { return s; } }).t;
  var list = document.getElementById('list'), totals = document.getElementById('totals');
  (async function () {
    var me = await C.sessionLine(null, '/admin/utilisateurs'); if (!me) return;
    if (me.role !== 'admin') { C.state(list, 'error', t('Accès réservé aux administrateurs.')); return; }
    try {
      var out = await C.api('/api/admin/accounts');
      list.setAttribute('aria-busy', 'false'); clear(list); clear(totals);
      var by = { admin: 0, manager: 0, technician: 0 }; out.results.forEach(function (u) { by[u.role] = (by[u.role] || 0) + 1; });
      Object.keys(by).forEach(function (r) { totals.appendChild(el('div', { class: 'ida-card' }, [el('p', { class: 'ida-admin-stat-value' }, String(by[r])), el('p', { class: 'ida-small ida-muted' }, C.label('role', r))])); });
      list.appendChild(el('div', { class: 'ida-table-wrap' }, el('table', { class: 'ida-table' }, [
        el('thead', null, el('tr', null, ['Nom', 'Identifiant', 'Rôle', 'Atelier', 'Sessions actives', 'Dernière connexion', 'Connexion possible'].map(function (h) { return el('th', { scope: 'col' }, t(h)); }))),
        el('tbody', null, out.results.map(function (u) {
          return el('tr', null, [el('td', null, u.name), el('td', null, el('bdi', { dir: 'ltr' }, u.email)), el('td', null, C.label('role', u.role)), el('td', null, C.text(u.org_name)),
            el('td', null, String(u.active_sessions || 0)), el('td', null, u.last_seen_at ? C.date(u.last_seen_at, true) : '—'),
            el('td', null, el('span', { class: 'ida-status ida-status--' + (u.can_sign_in ? 'verified' : 'anomaly') }, u.can_sign_in ? t('Oui') : t('Non : aucun atelier')))]);
        }))])));
    } catch (e) { list.setAttribute('aria-busy', 'false'); C.state(list, 'error', C.errorText(e)); }
  }());
}());
