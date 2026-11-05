'use strict';
/* IDauto — IDA-UI-1 — the application shell (/admin/shell.js, /atelier/shell.js).
 *
 * ONE navigation for every signed-in page (operator console AND workshop). Each
 * page carries an empty <aside data-admin-sidebar> inside .ida-admin-shell and
 * loads this script; the sidebar, the top bar (page title, global search,
 * notifications, language, profile menu) and the mobile drawer are built here
 * from the single NAV list below — there is no second copy of the menu.
 *
 * The menu is filtered by the signed-in role (admin / manager / technician).
 * That is presentation only: it grants nothing. Every API checks the role and
 * the organisation on the server, and every page refuses what its role may not
 * open. The identity area shows the name and role — never the e-mail.
 *
 * Nothing is stored in the browser (no localStorage/sessionStorage): the
 * collapsed state lasts for the page; the language is a cookie (i18n.js).
 * Every value is placed with textContent; icons are built as SVG elements.
 */
(function () {
  var ALL = ['admin', 'manager', 'technician'], ADMIN = ['admin'], MANAGE = ['admin', 'manager'];
  // Sections in order. An item may have a different page for the admin (`admin`)
  // and for a workshop account (`href`). `match` lists the pages that belong to it.
  var SECTIONS = [
    { label: 'Vue générale', items: [
      { label: 'Tableau de bord', icon: 'dashboard', roles: ALL, href: '/atelier/tableau-de-bord', admin: '/admin/dashboard', match: ['/admin/dashboard', '/atelier/tableau-de-bord'] }] },
    { label: 'Gestion des véhicules', items: [
      { label: 'Véhicules', icon: 'car', roles: ALL, href: '/atelier/vehicules', admin: '/admin/vehicles', match: ['/admin/vehicles', '/atelier/vehicules', '/atelier/vehicule', '/admin/vehicle'] },
      { label: 'Ajouter un véhicule', icon: 'plus', roles: ALL, href: '/atelier/vehicules/nouveau', match: ['/atelier/vehicules/nouveau'] }] },
    { label: 'Carte grise', items: [
      { label: 'Documents et pièces jointes', icon: 'file', roles: ALL, href: '/atelier/documents', match: ['/atelier/documents'] }] },
    { label: 'Maintenance', items: [
      { label: 'Interventions', icon: 'wrench', roles: ALL, href: '/atelier/interventions', match: ['/atelier/interventions', '/atelier/intervention', '/atelier'] },
      { label: 'Pièces remplacées', icon: 'part', roles: ALL, href: '/atelier/pieces-remplacees', match: ['/atelier/pieces-remplacees'] },
      { label: 'Historique de maintenance', icon: 'history', roles: ADMIN, href: '/admin/maintenance', match: ['/admin/maintenance'] }] },
    { label: 'Ateliers', items: [
      { label: 'Liste des ateliers', icon: 'building', roles: ADMIN, href: '/admin/sources', match: ['/admin/sources'] },
      { label: 'Techniciens', icon: 'users', roles: MANAGE, href: '/atelier/techniciens', match: ['/atelier/techniciens'] }] },
    { label: 'Catalogue', items: [
      { label: 'Catalogue des pièces', icon: 'box', roles: ALL, href: '/atelier/catalogue', match: ['/atelier/catalogue'] }] },
    { label: 'Administration', items: [
      { label: 'Utilisateurs', icon: 'users', roles: ADMIN, href: '/admin/utilisateurs', match: ['/admin/utilisateurs'] },
      { label: 'Rôles et permissions', icon: 'key', roles: ADMIN, href: '/admin/roles', match: ['/admin/roles'] },
      { label: 'Qualité des données', icon: 'check', roles: ADMIN, href: '/admin/quality', match: ['/admin/quality'] },
      { label: 'Vérification et validation', icon: 'inbox', roles: ADMIN, href: '/admin/review', match: ['/admin/review'] },
      { label: 'Saisie technique (avancée)', icon: 'edit', roles: ADMIN, href: '/admin', match: ['/admin'] }] },
    { label: 'Sécurité', items: [
      { label: 'Journal d’activité et audit', icon: 'shield', roles: ADMIN, href: '/admin/security', match: ['/admin/security'] }] },
    { label: 'Configuration', items: [
      { label: 'Mon compte', icon: 'user', roles: ALL, href: '/atelier/compte', match: ['/atelier/compte'] }] }
  ];
  // Flat list (tests, page titles): every item once.
  var NAV = [];
  SECTIONS.forEach(function (s) { s.items.forEach(function (i) { NAV.push(Object.assign({ section: s.label }, i)); }); });
  var ROLE_FR = { admin: 'Administrateur', manager: 'Gestionnaire', technician: 'Technicien' };

  function hrefFor(item, role) { return role === 'admin' && item.admin ? item.admin : item.href; }
  function visible(role) {
    return SECTIONS.map(function (s) { return { label: s.label, items: s.items.filter(function (i) { return i.roles.indexOf(role) !== -1; }) }; })
      .filter(function (s) { return s.items.length; });
  }
  function normalise(p) { return p.length > 1 ? p.replace(/\/+$/, '') : p; }
  function locate(pathname) {
    var p = normalise(pathname);
    for (var i = 0; i < NAV.length; i++) if (NAV[i].match.indexOf(p) !== -1) return { item: NAV[i], section: NAV[i].section };
    return { item: null, section: null };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { SECTIONS: SECTIONS, NAV: NAV, locate: locate, visible: visible, hrefFor: hrefFor }; return; }
  if (typeof document === 'undefined') return;

  var I18N = window.IdAutoI18n || { lang: function () { return 'fr'; }, t: function (s) { return s; }, setLanguage: function () {} };
  var t = I18N.t;

  // 24×24 stroke icons (currentColor).
  var ICONS = {
    dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
    car: ['M5 17h14', 'M3 13l2-6h14l2 6v4H3z', 'M7 17v2', 'M17 17v2', 'M7.5 13h.01', 'M16.5 13h.01'],
    plus: ['M12 5v14', 'M5 12h14'],
    file: ['M6 2h9l5 5v15H6z', 'M14 2v6h6', 'M9 13h6', 'M9 17h6'],
    wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
    part: ['M12 2l8 4.5v9L12 20l-8-4.5v-9z', 'M12 11l8-4.5', 'M12 11v9', 'M12 11L4 6.5'],
    history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 3'],
    building: ['M4 21V5l8-3 8 3v16', 'M9 21v-5h6v5', 'M8 8h.01', 'M12 8h.01', 'M16 8h.01', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
    users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7', 'M22 21v-1a6 6 0 0 0-4-5.6'],
    box: ['M3 7l9-4 9 4v10l-9 4-9-4z', 'M3 7l9 4 9-4', 'M12 11v10'],
    key: ['M15 7a4 4 0 1 1-3.9 4.8L4 19v2h3v-2h2v-2h2l1.2-1.2A4 4 0 0 1 15 7z', 'M16 9h.01'],
    check: ['M9 12l2 2 4-4', 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'],
    inbox: ['M3 13h5l2 3h4l2-3h5', 'M5 5h14l2 8v6H3v-6z'],
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    shield: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z', 'M12 8v4', 'M12 16h.01'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21v-1a8 8 0 0 1 16 0v1'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3'],
    bell: ['M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8', 'M10.3 21a2 2 0 0 0 3.4 0'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    collapse: ['M15 6l-6 6 6 6'],
    logout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
    theme: ['M12 3a9 9 0 1 0 0 18z', 'M12 3a9 9 0 0 1 0 18']
  };
  var SVG = 'http://www.w3.org/2000/svg';
  function icon(name) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.setAttribute('class', 'ida-admin-icon');
    (ICONS[name] || ICONS.file).forEach(function (d) { var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]); });
    [].concat(children === undefined ? [] : children).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  // ONE session read per page, shared with the page scripts (Better Auth limits
  // /api/auth/* per client; two reads per page could reach 429).
  // A 429 (too many session reads) is NOT a sign-out: retry with a short backoff instead of
  // sending the person to /login.
  function readSession(attempt) {
    return fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 429 && attempt < 4) return new Promise(function (res) { setTimeout(res, 800 * Math.pow(2, attempt)); }).then(function () { return readSession(attempt + 1); });
        return r.ok ? r.json() : null;
      }).catch(function () { return null; });
  }
  var sessionPromise = readSession(0);
  window.IdAutoAdminShell = { NAV: NAV, SECTIONS: SECTIONS, locate: locate, session: function () { return sessionPromise; } };

  var aside = document.querySelector('[data-admin-sidebar]');
  var shell = document.querySelector('.ida-admin-shell');
  if (!aside || !shell) return;
  var main = shell.querySelector('.ida-admin-main') || shell;
  var here = locate(window.location.pathname);
  var dashHref = '/atelier/tableau-de-bord';

  // ---- sidebar (filled once the role is known) ------------------------------
  var collapseBtn = el('button', { type: 'button', class: 'ida-admin-sidebar-collapse', 'aria-controls': 'admin-sidebar',
    'aria-expanded': 'true', 'aria-label': 'Réduire le menu', title: 'Réduire le menu' }, icon('collapse'));
  var closeBtn = el('button', { type: 'button', class: 'ida-admin-drawer-close', 'aria-label': 'Fermer le menu' }, icon('close'));
  var navHost = el('nav', { class: 'ida-admin-nav', 'aria-label': 'Navigation principale' });
  var brandLink = el('a', { class: 'ida-wordmark', href: dashHref, 'aria-label': 'IDauto — tableau de bord' },
    [el('span', { class: 'ida-wordmark-id', 'aria-hidden': 'true' }, 'ID'), el('span', { class: 'ida-admin-nav-label' }, 'auto')]);
  aside.id = 'admin-sidebar';
  aside.appendChild(el('div', { class: 'ida-admin-brand' }, [brandLink, closeBtn, el('span', { class: 'ida-admin-brand-sub ida-admin-nav-label' }, 'Gestion des véhicules')]));
  aside.appendChild(navHost);
  aside.appendChild(el('div', { class: 'ida-admin-sidebar-foot' }, [el('div', { class: 'ida-admin-tools' }, [collapseBtn])]));

  function renderNav(role) {
    clear(navHost);
    visible(role).forEach(function (s, si) {
      var hid = 'nav-sec-' + si;
      var list = el('ul', { class: 'ida-admin-nav-list', 'aria-labelledby': hid });
      s.items.forEach(function (m) {
        var href = hrefFor(m, role), active = !!here.item && here.item.label === m.label && here.item.section === s.label;
        list.appendChild(el('li', null, el('a', { href: href, class: 'ida-admin-nav-link' + (active ? ' is-active' : ''), title: m.label,
          'aria-current': active ? 'page' : null, 'data-module': href }, [icon(m.icon), el('span', { class: 'ida-admin-nav-label' }, m.label)])));
      });
      navHost.appendChild(el('div', { class: 'ida-admin-nav-section' }, [el('p', { class: 'ida-admin-nav-heading ida-admin-nav-label', id: hid }, s.label), list]));
    });
  }

  // ---- top bar: title, search, notifications, language, profile ------------
  var menuBtn = el('button', { type: 'button', class: 'ida-admin-menu-btn', 'aria-controls': 'admin-sidebar', 'aria-expanded': 'false', 'aria-label': 'Ouvrir le menu' }, icon('menu'));
  var crumbs = el('nav', { class: 'ida-admin-topbar-title', 'aria-label': 'Fil d’Ariane' }, here.item
    ? el('ol', { class: 'ida-admin-crumbs' }, [el('li', null, here.section), el('li', { 'aria-current': 'page' }, here.item.label)])
    : el('span', null, document.title.replace(/^IDauto\s*[—-]\s*/, '')));

  // Global search (server-side: /api/search; every result is filtered by the server for this account).
  var searchInput = el('input', { type: 'search', class: 'ida-input ida-app-search-input', id: 'app-search', name: 'q', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Rechercher : immatriculation, véhicule, intervention, pièce…', 'aria-label': 'Recherche globale', role: 'combobox',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'app-search-results', maxlength: '80' });
  var searchResults = el('div', { class: 'ida-app-search-results', id: 'app-search-results', role: 'listbox', 'aria-label': 'Résultats de recherche', hidden: true });
  var searchForm = el('form', { class: 'ida-app-search', role: 'search', 'data-app-search': '' }, [el('span', { class: 'ida-app-search-icon', 'aria-hidden': 'true' }, icon('search')), searchInput, searchResults]);
  var searchToggle = el('button', { type: 'button', class: 'ida-admin-tool ida-app-search-toggle', 'aria-label': 'Ouvrir la recherche', 'aria-expanded': 'false' }, icon('search'));

  var bellCount = el('span', { class: 'ida-app-badge', hidden: true, 'data-app-notif-count': '' }, '');
  var bellBtn = el('button', { type: 'button', class: 'ida-admin-tool ida-app-bell', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'app-notif', 'aria-label': 'Notifications', title: 'Notifications' }, [icon('bell'), bellCount]);
  var bellPanel = el('div', { class: 'ida-app-popover', id: 'app-notif', hidden: true, 'data-app-notif': '' }, el('p', { class: 'ida-small ida-muted' }, 'Chargement…'));

  var langSelect = el('select', { class: 'ida-input ida-app-lang', 'aria-label': 'Langue', 'data-app-lang': '' }, [
    el('option', { value: 'fr', lang: 'fr' }, 'Français'), el('option', { value: 'ar', lang: 'ar' }, 'العربية')]);
  langSelect.value = I18N.lang();
  langSelect.setAttribute('data-i18n-skip', '');
  langSelect.addEventListener('change', function () { I18N.setLanguage(langSelect.value); });

  var avatar = el('span', { class: 'ida-admin-avatar', 'aria-hidden': 'true' }, '·');
  var nameEl = el('span', { class: 'ida-admin-identity-name', 'data-admin-identity-name': '' }, 'Session…');
  var roleEl = el('span', { class: 'ida-admin-identity-role', 'data-admin-identity-role': '' }, '');
  var profileBtn = el('button', { type: 'button', class: 'ida-app-profile', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'app-profile' },
    [avatar, el('span', { class: 'ida-admin-identity-text ida-admin-identity' }, [nameEl, roleEl])]);
  var themeBtn = el('button', { type: 'button', class: 'ida-app-menuitem', 'data-theme-toggle': '', role: 'menuitem' }, [icon('theme'), el('span', null, 'Thème clair / sombre')]);
  var logoutBtn = el('button', { type: 'button', class: 'ida-app-menuitem', 'data-admin-logout': '', role: 'menuitem', hidden: true }, [icon('logout'), el('span', null, 'Déconnexion')]);
  var profilePanel = el('div', { class: 'ida-app-popover ida-app-popover--end', id: 'app-profile', role: 'menu', hidden: true }, [
    el('a', { class: 'ida-app-menuitem', href: '/atelier/compte', role: 'menuitem' }, [icon('user'), el('span', null, 'Mon compte')]), themeBtn, logoutBtn]);

  var topbar = el('header', { class: 'ida-admin-topbar', 'data-app-topbar': '' }, [
    menuBtn,
    el('a', { class: 'ida-wordmark ida-app-topbar-brand', href: dashHref, 'aria-label': 'IDauto — tableau de bord' }, [el('span', { class: 'ida-wordmark-id', 'aria-hidden': 'true' }, 'ID'), el('span', null, 'auto')]),
    crumbs, searchForm,
    el('div', { class: 'ida-app-actions' }, [searchToggle,
      el('div', { class: 'ida-app-anchor' }, [bellBtn, bellPanel]), langSelect,
      el('div', { class: 'ida-app-anchor' }, [profileBtn, profilePanel])])
  ]);
  var backdrop = el('div', { class: 'ida-admin-backdrop', hidden: '' });
  main.insertBefore(topbar, main.firstChild);
  shell.appendChild(backdrop);

  // Popovers: one open at a time, Esc and outside click close.
  var popovers = [[bellBtn, bellPanel], [profileBtn, profilePanel]];
  function closePopovers(except) { popovers.forEach(function (p) { if (p[1] !== except) { p[1].hidden = true; p[0].setAttribute('aria-expanded', 'false'); } }); }
  popovers.forEach(function (p) {
    p[0].addEventListener('click', function (e) { e.stopPropagation(); var open = p[1].hidden; closePopovers(p[1]); p[1].hidden = !open; p[0].setAttribute('aria-expanded', open ? 'true' : 'false'); if (open && p[1] === bellPanel) loadNotifications(); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.ida-app-anchor')) closePopovers(); if (!e.target.closest('[data-app-search]')) hideResults(); });

  // ---- search ----------------------------------------------------------------
  var searchTimer = null, searchCtl = null, options = [], activeIdx = -1;
  function hideResults() { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); searchInput.removeAttribute('aria-activedescendant'); activeIdx = -1; }
  function showMessage(text) { clear(searchResults); searchResults.appendChild(el('p', { class: 'ida-app-search-msg' }, text)); searchResults.hidden = false; searchInput.setAttribute('aria-expanded', 'true'); options = []; }
  var GROUP = { vehicles: 'Véhicules', owners: 'Propriétaires', interventions: 'Interventions', parts: 'Pièces' };
  function renderResults(data) {
    clear(searchResults); options = []; activeIdx = -1;
    var groups = (data && data.groups) || [];
    var any = groups.some(function (g) { return g.items.length; });
    if (!any) { showMessage(t('Aucun résultat pour cette recherche.')); return; }
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var gid = 'srch-g-' + g.key;
      var box = el('div', { role: 'group', 'aria-labelledby': gid, class: 'ida-app-search-group' }, el('p', { class: 'ida-app-search-heading', id: gid }, GROUP[g.key] || g.key));
      g.items.forEach(function (it) {
        var id = 'srch-o-' + options.length;
        var o = el('a', { id: id, role: 'option', class: 'ida-app-search-option', href: it.href, 'aria-selected': 'false' }, [
          el('span', { class: 'ida-app-search-title' }, [it.plate ? el('bdi', { dir: 'ltr', class: 'ida-id' }, it.plate) : null, it.plate && it.title ? ' · ' : null, it.title || '']),
          it.subtitle ? el('span', { class: 'ida-app-search-sub' }, it.subtitle) : null]);
        options.push(o); box.appendChild(o);
      });
      searchResults.appendChild(box);
    });
    if (data.truncated) searchResults.appendChild(el('p', { class: 'ida-app-search-msg' }, t('Résultats limités : précisez la recherche.')));
    searchResults.hidden = false; searchInput.setAttribute('aria-expanded', 'true');
  }
  function setActive(i) {
    if (!options.length) return;
    if (activeIdx >= 0) options[activeIdx].setAttribute('aria-selected', 'false');
    activeIdx = (i + options.length) % options.length;
    options[activeIdx].setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', options[activeIdx].id);
    options[activeIdx].scrollIntoView({ block: 'nearest' });
  }
  function runSearch() {
    var q = searchInput.value.trim();
    if (q.length < 2) { hideResults(); return; }
    if (searchCtl) searchCtl.abort();
    searchCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    showMessage(t('Recherche…'));
    fetch('/api/search?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1', Accept: 'application/json' }, signal: searchCtl ? searchCtl.signal : undefined })
      .then(function (r) { if (r.status === 401) { window.location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error('login'); } if (r.status === 429) throw new Error('limit'); if (!r.ok) throw new Error('fail'); return r.json(); })
      .then(renderResults)
      .catch(function (e) { if (e && e.name === 'AbortError') return; showMessage(t(e && e.message === 'limit' ? 'Trop de recherches : patientez un instant.' : 'La recherche n’a pas abouti.')); });
  }
  searchInput.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (searchResults.hidden) runSearch(); else setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) window.location.assign(options[activeIdx].href); else if (options.length === 1) window.location.assign(options[0].href); else runSearch(); }
    else if (e.key === 'Escape') { hideResults(); }
  });
  searchForm.addEventListener('submit', function (e) { e.preventDefault(); });
  searchToggle.addEventListener('click', function () { var open = !shell.classList.contains('is-searching'); shell.classList.toggle('is-searching', open); searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) searchInput.focus(); });

  // ---- notifications (real counts from /api/notifications) -------------------
  function loadNotifications() {
    return fetch('/api/notifications', { credentials: 'same-origin', headers: { 'X-IDauto-Session': '1', Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var items = (d && d.items) || [], total = items.reduce(function (s, i) { return s + (i.count || 0); }, 0);
        bellCount.hidden = total === 0; bellCount.textContent = total > 99 ? '99+' : String(total);
        bellBtn.setAttribute('aria-label', total ? t('Notifications') + ' (' + total + ')' : t('Notifications'));
        clear(bellPanel);
        if (!d) { bellPanel.appendChild(el('p', { class: 'ida-small ida-muted' }, 'Notifications indisponibles.')); return; }
        if (!items.length) { bellPanel.appendChild(el('p', { class: 'ida-small ida-muted' }, 'Aucune notification.')); return; }
        bellPanel.appendChild(el('ul', { class: 'ida-app-notif-list' }, items.map(function (i) {
          return el('li', null, el('a', { href: i.href, class: 'ida-app-menuitem' }, [el('span', { class: 'ida-app-badge ida-app-badge--inline' }, String(i.count)), el('span', null, i.label)]));
        })));
      }).catch(function () {});
  }

  // ---- drawer / collapse -----------------------------------------------------
  var mobile = window.matchMedia('(max-width: 63.99rem)');
  function setDrawer(open) {
    shell.setAttribute('data-drawer', open ? 'open' : 'closed');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    backdrop.hidden = !open;
    syncInert();
    if (open) window.requestAnimationFrame(function () { var first = aside.querySelector('a[href], button:not([hidden])'); if (first) first.focus(); });
  }
  function setCollapsed(collapsed) {
    shell.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var label = t(collapsed ? 'Déployer le menu' : 'Réduire le menu');
    collapseBtn.setAttribute('aria-label', label); collapseBtn.setAttribute('title', label);
  }
  function syncMode() {
    var small = mobile.matches;
    shell.setAttribute('data-mode', small ? 'drawer' : 'sidebar');
    if (small) { setCollapsed(false); setDrawer(false); } else { backdrop.hidden = true; shell.setAttribute('data-drawer', 'closed'); syncInert(); }
  }
  function syncInert() {
    var hide = shell.getAttribute('data-mode') === 'drawer' && shell.getAttribute('data-drawer') !== 'open';
    if (hide) aside.setAttribute('inert', ''); else aside.removeAttribute('inert');
  }
  setCollapsed(false);
  syncMode();
  if (mobile.addEventListener) mobile.addEventListener('change', syncMode); else if (mobile.addListener) mobile.addListener(syncMode);
  menuBtn.addEventListener('click', function () { setDrawer(true); });
  function closeDrawer() { if (shell.getAttribute('data-drawer') === 'open') { setDrawer(false); menuBtn.focus(); } }
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePopovers();
    if (shell.getAttribute('data-drawer') !== 'open') return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(aside.querySelectorAll('a[href], button:not([hidden])'), function (n) { return n.getClientRects().length > 0; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  aside.addEventListener('click', function (e) { if (e.target.closest('a[href]') && shell.getAttribute('data-mode') === 'drawer') setDrawer(false); });
  collapseBtn.addEventListener('click', function () { setCollapsed(shell.getAttribute('data-sidebar') !== 'collapsed'); });

  // ---- identity, role-filtered menu, logout -----------------------------------
  (async function () {
    var me = await sessionPromise;
    if (!me || !me.user) { nameEl.textContent = t('Non connecté'); renderNav('technician'); return; }
    var role = ['admin', 'manager', 'technician'].indexOf(me.user.role) !== -1 ? me.user.role : 'technician';
    shell.setAttribute('data-role', role);
    if (role === 'admin') { dashHref = '/admin/dashboard'; brandLink.setAttribute('href', dashHref); topbar.querySelector('.ida-app-topbar-brand').setAttribute('href', dashHref); }
    renderNav(role);
    nameEl.textContent = me.user.name || '—';
    roleEl.textContent = t(ROLE_FR[role] || role);
    avatar.textContent = String(me.user.name || '?').trim().charAt(0).toUpperCase() || '?';
    logoutBtn.hidden = false;
    logoutBtn.addEventListener('click', async function () {
      logoutBtn.disabled = true;
      try { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); } catch (e) { /* the session is server-side; /login confirms */ }
      window.location.replace('/login');
    });
    loadNotifications();
  }());
}());
