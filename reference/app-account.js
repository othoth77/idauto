'use strict';
/* IDauto — IDA-UI-4 — « Paramètres »: my account, language, password; for an admin the links to users and roles.
 * Better Auth route only (/api/auth/change-password); the
 * password is sent once in the request body and never stored or shown. */
(function () {
  var C = window.IdAutoConsole, el = C.el, clear = C.clear, I = window.IdAutoI18n || { t: function (s) { return s; }, lang: function () { return 'fr'; }, setLanguage: function () {} }, t = I.t;
  var lang = document.getElementById('pref-lang');
  lang.value = I.lang(); lang.addEventListener('change', function () { I.setLanguage(lang.value); });
  async function auth(method, path, body) {
    var r = await fetch(path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw Object.assign(new Error(d.message_fr || (d.message === 'Invalid password' ? t('Mot de passe actuel incorrect.') : t('La demande n\'a pas abouti.'))), { status: r.status });
    return d;
  }
  document.getElementById('pwd-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('pwd-msg'); clear(msg);
    var cur = document.getElementById('pwd-current').value, nw = document.getElementById('pwd-new').value, nw2 = document.getElementById('pwd-new2').value;
    function bad(m) { msg.appendChild(el('p', { class: 'ida-field-error', role: 'alert' }, m)); }
    if (!cur) return bad(t('Saisissez votre mot de passe actuel.'));
    if (nw.length < 12 || !/[A-Za-z]/.test(nw) || !/[0-9]/.test(nw)) return bad(t('Le nouveau mot de passe doit comporter 12 caractères au moins, avec des lettres et des chiffres.'));
    if (nw !== nw2) return bad(t('Les deux nouveaux mots de passe ne sont pas identiques.'));
    try { await auth('POST', '/api/auth/change-password', { currentPassword: cur, newPassword: nw, revokeOtherSessions: true }); e.target.reset(); msg.appendChild(el('p', { class: 'ida-alert ida-alert--success' }, t('Mot de passe changé. Vos autres sessions ont été fermées.'))); }
    catch (err) { bad(err.message); }
  });
  (async function () {
    var me = await C.sessionLine(null, location.pathname); if (!me) return;
    var p = document.getElementById('profile'); clear(p);
    p.appendChild(el('dl', { class: 'ida-kv' }, [el('dt', null, t('Nom')), el('dd', null, me.name), el('dt', null, t('Rôle')), el('dd', null, C.label('role', me.role)),
      el('dt', null, t('Identifiant de connexion')), el('dd', null, el('bdi', { dir: 'ltr' }, me.email || '—'))]));
    document.getElementById('admin-box').hidden = me.role !== 'admin';
  }());
}());
