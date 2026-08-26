/* IDauto Design System — ui.js
 * Small, dependency-free behaviors: theme pin, tabs, modal/drawer, copy.
 * Everything degrades: pages remain readable and navigable without JS. */

(function () {
  "use strict";

  /* Theme pin — system preference by default; an explicit choice is pinned
   * on <html data-theme> and remembered per browser. Storage can throw
   * (private mode); the page must work with no stored value. */
  var THEME_KEY = "ida-theme";
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function applyTheme(value) {
    var rootEl = document.documentElement;
    if (value === "light" || value === "dark") rootEl.setAttribute("data-theme", value);
    else rootEl.removeAttribute("data-theme");
  }
  applyTheme(storedTheme());

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    var current = document.documentElement.getAttribute("data-theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var effective = current || (prefersDark ? "dark" : "light");
    var next = effective === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e2) { /* per-viewer convenience only */ }
  });

  /* Tabs — WAI-ARIA tabs pattern with roving arrow-key focus */
  document.querySelectorAll(".ida-tabs").forEach(function (tabsEl) {
    var tabs = Array.prototype.slice.call(tabsEl.querySelectorAll("[role='tab']"));
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab); });
      tab.addEventListener("keydown", function (e) {
        var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        select(tabs[(i + dir + tabs.length) % tabs.length]);
      });
    });
  });

  /* Modal / Drawer — native <dialog>; ESC and backdrop close for free */
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-dialog-open]");
    if (opener) {
      var dlg = document.getElementById(opener.getAttribute("data-dialog-open"));
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
      return;
    }
    var closer = e.target.closest("[data-dialog-close]");
    if (closer) {
      var host = closer.closest("dialog");
      if (host) host.close();
    }
  });

  /* Copy-to-clipboard for identifiers (IVID) */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn || !navigator.clipboard) return;
    navigator.clipboard.writeText(btn.getAttribute("data-copy")).then(function () {
      var live = document.getElementById("ida-live");
      if (live) live.textContent = btn.getAttribute("data-copy-done") || "Identifiant copié";
    });
  });
})();
