/* IDauto — sign-in (IDA-V13)
 * ============================================================================
 * email + password → POST /api/auth/sign-in/email → the server sets an
 * HttpOnly session cookie → redirect to `next` (same-origin path only).
 * Nothing is stored in the browser by this script; the password never
 * leaves this form except in the sign-in request body; errors are French
 * and never echo what was typed.
 */
(function () {
  "use strict";
  var form = document.getElementById("login-form");
  var errorBox = document.getElementById("login-error");
  var errorBody = document.getElementById("login-error-body");
  var help = document.getElementById("login-help");
  var submit = document.getElementById("login-submit");

  function nextPath() {
    var m = /[?&]next=([^&]*)/.exec(location.search);
    var next = m ? decodeURIComponent(m[1]) : "/atelier";
    // Same-origin relative path only: never an absolute URL, never //host.
    return /^\/(?!\/)[A-Za-z0-9\/_\-?=&%.]*$/.test(next) ? next : "/atelier";
  }
  function showError(msg) { errorBody.textContent = msg; errorBox.hidden = false; }
  function clearError() { errorBox.hidden = true; errorBody.textContent = ""; }

  // Already signed in? Go straight on.
  fetch("/api/auth/get-session", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) { if (s && s.user) location.replace(nextPath()); })
    .catch(function () {});

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearError();
    var email = (document.getElementById("login-email").value || "").trim().toLowerCase();
    var password = document.getElementById("login-password").value || "";
    if (!email || !password) { showError("Indiquez votre identifiant et votre mot de passe."); return; }
    submit.disabled = true; help.textContent = "Connexion en cours…";
    try {
      var res = await fetch("/api/auth/sign-in/email", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });
      if (res.ok) { location.replace(nextPath()); return; }
      if (res.status === 429) showError("Trop de tentatives. Patientez une minute avant de réessayer.");
      else if (res.status === 401 || res.status === 400 || res.status === 403) showError("Identifiant ou mot de passe incorrect.");
      else showError("Le service de connexion ne répond pas. Réessayez dans un instant.");
    } catch (err) {
      showError("Problème de connexion au serveur. Réessayez dans un instant.");
    } finally {
      submit.disabled = false; help.textContent = "";
      document.getElementById("login-password").value = "";
    }
  });

  document.getElementById("login-forgot").addEventListener("click", function () {
    clearError();
    help.textContent = "La réinitialisation se fait par l'administrateur IDauto : contactez-le pour recevoir un nouveau mot de passe.";
  });
})();
