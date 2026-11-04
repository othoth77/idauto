'use strict';
/* IDauto — IDA-ADMIN-7 — the operator console shell (/admin/shell.js).
 *
 * ONE navigation for every console page. Each page carries an empty
 * <aside data-admin-sidebar> and loads this script; the sidebar, the mobile
 * top bar and the drawer are built here from the single NAV list below, so
 * there is no second copy of the menu anywhere.
 *
 * The sidebar is navigation only. It grants nothing: every /api/admin/* route
 * checks the admin scope on the server, and every page refuses a non-admin
 * session on its own. The identity area shows the signed-in name and role —
 * never the e-mail — and logs out through the existing Better Auth route.
 *
 * Nothing is stored in the browser (no localStorage/sessionStorage, the rule
 * every authenticated page follows): the collapsed state lasts for the page.
 * Every value is placed with textContent; icons are built as SVG elements.
 */
(function () {
  // The six modules, in order. `match` lists the pages that belong to a
  // module; `children` are pages reached from it (kept routes, not modules).
  var NAV = [
    { href: '/admin/dashboard', label: 'Tableau de bord', icon: 'dashboard', match: ['/admin/dashboard'] },
    { href: '/admin/vehicles', label: 'Véhicules', icon: 'car', match: ['/admin/vehicles', '/admin/vehicle'],
      children: [{ href: '/admin', label: 'Saisie manuelle' }] },
    { href: '/admin/maintenance', label: 'Historique d’entretien', icon: 'wrench', match: ['/admin/maintenance'] },
    { href: '/admin/sources', label: 'Ateliers & Sources', icon: 'building', match: ['/admin/sources'] },
    { href: '/admin/quality', label: 'Qualité des données', icon: 'check', match: ['/admin/quality'],
      children: [{ href: '/admin/review', label: 'File de revue' }] },
    { href: '/admin/security', label: 'Sécurité & Audit', icon: 'shield', match: ['/admin/security'] }
  ];
  var ROLE_FR = { admin: 'Administrateur', manager: 'Gestionnaire', technician: 'Technicien' };

  // 24×24 stroke icons (currentColor), one or more path data strings each.
  var ICONS = {
    dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
    car: ['M5 17h14', 'M3 13l2-6h14l2 6v4H3z', 'M7 17v2', 'M17 17v2', 'M7.5 13h.01', 'M16.5 13h.01'],
    wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
    building: ['M4 21V5l8-3 8 3v16', 'M9 21v-5h6v5', 'M8 8h.01', 'M12 8h.01', 'M16 8h.01', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
    check: ['M9 12l2 2 4-4', 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'],
    shield: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z', 'M12 8v4', 'M12 16h.01'],
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
    ICONS[name].forEach(function (d) { var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); });
    [].concat(children === undefined ? [] : children).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  // Which module and which page the current path is. A trailing slash is the
  // same page (/admin/quality/ is served like /admin/quality).
  function normalise(p) { return p.length > 1 ? p.replace(/\/+$/, '') : p; }
  function locate(pathname) {
    var p = normalise(pathname);
    for (var i = 0; i < NAV.length; i++) {
      var m = NAV[i];
      if (m.match.indexOf(p) !== -1) return { module: m, page: m.href === p ? m : null };
      var kids = m.children || [];
      for (var j = 0; j < kids.length; j++) if (kids[j].href === p) return { module: m, page: kids[j] };
    }
    return { module: null, page: null };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { NAV: NAV, locate: locate };
  if (typeof document === 'undefined') return;

  // ONE session read per page, shared: the shell and the page script both need
  // it, and Better Auth limits /api/auth/* to 60 requests a minute per client
  // (auth.js). Two reads per page let a fast click-through hit 429 and bounce
  // the admin to /login; admin-console.js, admin-ui.js and review-ui.js reuse
  // this promise instead of asking again.
  var sessionPromise = fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  window.IdAutoAdminShell = { NAV: NAV, locate: locate, session: function () { return sessionPromise; } };

  var aside = document.querySelector('[data-admin-sidebar]');
  var shell = document.querySelector('.ida-admin-shell');
  if (!aside || !shell) return;
  var here = locate(window.location.pathname);

  // ---- sidebar -----------------------------------------------------------
  var collapseBtn = el('button', { type: 'button', class: 'ida-admin-sidebar-collapse', 'aria-controls': 'admin-sidebar',
    'aria-expanded': 'true', 'aria-label': 'Réduire le menu', title: 'Réduire le menu' }, icon('collapse'));
  var closeBtn = el('button', { type: 'button', class: 'ida-admin-drawer-close', 'aria-label': 'Fermer le menu' }, icon('close'));

  var list = el('ul', { class: 'ida-admin-nav-list' });
  NAV.forEach(function (m) {
    var isModule = here.module === m;
    var isPage = here.page === m;
    var link = el('a', { href: m.href, class: 'ida-admin-nav-link' + (isModule ? ' is-active' : ''), title: m.label,
      'aria-current': isPage ? 'page' : (isModule ? 'true' : null), 'data-module': m.href }, [icon(m.icon), el('span', { class: 'ida-admin-nav-label' }, m.label)]);
    var item = el('li', null, link);
    if (m.children) {
      item.appendChild(el('ul', { class: 'ida-admin-nav-sub' }, m.children.map(function (c) {
        return el('li', null, el('a', { href: c.href, class: 'ida-admin-nav-sublink' + (here.page === c ? ' is-active' : ''),
          'aria-current': here.page === c ? 'page' : null }, c.label));
      })));
    }
    list.appendChild(item);
  });

  var who = el('div', { class: 'ida-admin-identity', 'aria-live': 'polite' }, [
    el('span', { class: 'ida-admin-avatar', 'aria-hidden': 'true' }, '·'),
    el('span', { class: 'ida-admin-identity-text' }, [
      el('span', { class: 'ida-admin-identity-name', 'data-admin-identity-name': '' }, 'Session…'),
      el('span', { class: 'ida-admin-identity-role', 'data-admin-identity-role': '' }, '')
    ])
  ]);
  var themeBtn = el('button', { type: 'button', class: 'ida-admin-tool', 'data-theme-toggle': '', 'aria-label': 'Basculer entre le thème clair et le thème sombre', title: 'Thème clair / sombre' },
    [icon('theme'), el('span', { class: 'ida-sr-only' }, 'Thème')]);
  var logoutBtn = el('button', { type: 'button', class: 'ida-admin-tool', 'data-admin-logout': '', hidden: '', title: 'Se déconnecter', 'aria-label': 'Se déconnecter' },
    [icon('logout'), el('span', { class: 'ida-admin-nav-label' }, 'Déconnexion')]);

  aside.id = 'admin-sidebar';
  aside.appendChild(el('div', { class: 'ida-admin-brand' }, [
    el('a', { class: 'ida-wordmark', href: '/admin/dashboard', 'aria-label': 'IDauto — tableau de bord' },
      [el('span', { class: 'ida-wordmark-id', 'aria-hidden': 'true' }, 'ID'), el('span', { class: 'ida-admin-nav-label' }, 'auto')]),
    closeBtn,
    el('span', { class: 'ida-admin-brand-sub ida-admin-nav-label' }, 'Console d’administration')
  ]));
  aside.appendChild(el('nav', { class: 'ida-admin-nav', 'aria-label': 'Navigation administrateur' }, list));
  aside.appendChild(el('div', { class: 'ida-admin-sidebar-foot' }, [who, el('div', { class: 'ida-admin-tools' }, [themeBtn, logoutBtn, collapseBtn])]));

  // ---- mobile top bar + drawer ---------------------------------------------
  var menuBtn = el('button', { type: 'button', class: 'ida-admin-menu-btn', 'aria-controls': 'admin-sidebar', 'aria-expanded': 'false', 'aria-label': 'Ouvrir le menu' }, icon('menu'));
  var topbar = el('header', { class: 'ida-admin-topbar' }, [
    menuBtn,
    el('a', { class: 'ida-wordmark', href: '/admin/dashboard', 'aria-label': 'IDauto — tableau de bord' },
      [el('span', { class: 'ida-wordmark-id', 'aria-hidden': 'true' }, 'ID'), el('span', null, 'auto')]),
    el('span', { class: 'ida-admin-topbar-title' }, here.page ? here.page.label : (here.module ? here.module.label : 'Console'))
  ]);
  var backdrop = el('div', { class: 'ida-admin-backdrop', hidden: '' });
  shell.insertBefore(topbar, shell.firstChild);
  shell.appendChild(backdrop);

  var mobile = window.matchMedia('(max-width: 63.99rem)');
  function setDrawer(open) {
    shell.setAttribute('data-drawer', open ? 'open' : 'closed');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    backdrop.hidden = !open;
    syncInert();
    // Focus moves in only once the drawer is reachable (inert lifted) and
    // painted visible: an inert or hidden element cannot take focus.
    if (open) window.requestAnimationFrame(function () { var first = aside.querySelector('a[href], button:not([hidden])'); if (first) first.focus(); });
  }
  function setCollapsed(collapsed) {
    shell.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var label = collapsed ? 'Déployer le menu' : 'Réduire le menu';
    collapseBtn.setAttribute('aria-label', label); collapseBtn.setAttribute('title', label);
  }
  // On a small screen the drawer is a modal layer: hidden from assistive
  // technology and from Tab while closed (inert), focus kept inside while open.
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
    if (shell.getAttribute('data-drawer') !== 'open') return;
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key === 'Tab') {
      // Only what is on screen: the collapse button exists but is not shown in drawer mode.
      var f = Array.prototype.filter.call(aside.querySelectorAll('a[href], button:not([hidden])'), function (n) { return n.getClientRects().length > 0; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  aside.addEventListener('click', function (e) { if (e.target.closest('a[href]') && shell.getAttribute('data-mode') === 'drawer') setDrawer(false); });
  collapseBtn.addEventListener('click', function () { setCollapsed(shell.getAttribute('data-sidebar') !== 'collapsed'); });

  // ---- identity + logout ---------------------------------------------------
  (async function () {
    var me = await sessionPromise;
    var nameEl = aside.querySelector('[data-admin-identity-name]'), roleEl = aside.querySelector('[data-admin-identity-role]');
    if (!me || !me.user) { nameEl.textContent = 'Non connecté'; roleEl.textContent = ''; return; }
    nameEl.textContent = me.user.name || '—';
    roleEl.textContent = ROLE_FR[me.user.role] || me.user.role || '';
    aside.querySelector('.ida-admin-avatar').textContent = String(me.user.name || '?').trim().charAt(0).toUpperCase() || '?';
    logoutBtn.hidden = false;
    logoutBtn.addEventListener('click', async function () {
      logoutBtn.disabled = true;
      try { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); } catch (e) { /* the session is server-side; /login confirms */ }
      window.location.replace('/login');
    });
  }());

}());
