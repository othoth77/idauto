'use strict';
(function () {
  function value(form, name) { return form.elements[name].value.trim(); }
  function optionalNumber(form, name) {
    var raw = value(form, name);
    return raw === '' ? null : Number(raw);
  }
  function compact(object) {
    Object.keys(object).forEach(function (key) {
      if (object[key] === '' || object[key] === null) delete object[key];
    });
    return object;
  }
  // IDA-V13 — the console is authenticated by the session cookie the
  // server set at /login (HttpOnly, never readable here) plus the header
  // X-IDauto-Session: 1 on every API call. No token is read from the page.
  // The `token` parameter of the helpers below is kept for the callers'
  // shape and is always ignored.
  var SESSION_HEADERS = { 'X-IDauto-Session': '1', Accept: 'application/json' };
  function toLogin() { if (typeof window !== 'undefined' && window.location) window.location.replace('/login?next=' + encodeURIComponent('/admin')); }
  async function apiRequest(path, token, options) {
    var settings = options || {};
    settings.credentials = 'same-origin';
    settings.headers = Object.assign({}, settings.headers, SESSION_HEADERS);
    // Library use (a script holding a service credential): still allowed.
    if (token) settings.headers.Authorization = 'Bearer ' + token;
    var response = await fetch(path, settings);
    var body = await response.json().catch(function () { return {}; });
    if (response.status === 401) { toLogin(); throw new Error('Session expirée — reconnectez-vous.'); }
    if (!response.ok) throw new Error(body.message_fr || body.error || ('Request failed (' + response.status + ')'));
    return body;
  }
  function jsonPost(path, token, body) {
    return apiRequest(path, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  async function createEntry(form, token) {
    var vehicle = await jsonPost('/api/vehicles', token, compact({
      make: value(form, 'make'), model: value(form, 'model'), variant: value(form, 'variant'),
      year: optionalNumber(form, 'year'), body_type: value(form, 'body_type'), fuel_type: value(form, 'fuel_type'),
      colour: value(form, 'colour'), seats: optionalNumber(form, 'seats'),
      gross_weight_kg: optionalNumber(form, 'gross_weight_kg'), engine_cc: optionalNumber(form, 'engine_cc'),
      category_code: value(form, 'category_code')
    }));
    var plate = null;
    if (value(form, 'plate_number')) {
      if (!value(form, 'format_code')) throw new Error('Format code is required when a plate is entered.');
      plate = await jsonPost('/api/plates', token, compact({
        plate_number: value(form, 'plate_number'), format_code: value(form, 'format_code'),
        governorate_code: value(form, 'governorate_code'), vehicle_internal_ref: vehicle.internal_ref
      }));
    }
    var observation = await jsonPost('/api/observations', token, {
      vehicle_internal_ref: vehicle.internal_ref,
      plate_number: plate ? plate.plate_number : undefined,
      status: value(form, 'status')
    });
    var fact = null;
    if (value(form, 'fact_key') || value(form, 'fact_value')) {
      if (!value(form, 'fact_key') || !value(form, 'fact_value')) throw new Error('Fact key and value must be entered together.');
      fact = await jsonPost('/api/vehicles/' + encodeURIComponent(vehicle.internal_ref) + '/facts', token, compact({
        fact_key: value(form, 'fact_key'), fact_value: value(form, 'fact_value'),
        observation_id: observation.id,
        confidence_score: optionalNumber(form, 'confidence_score'), access_scope: value(form, 'access_scope'),
        evidence_type: value(form, 'evidence_type')
      }));
    }
    var media = null;
    var file = form.elements.media.files[0];
    if (file) {
      media = await apiRequest('/api/observations/' + observation.id + '/media', token, {
        method: 'POST', body: file,
        headers: {
          'Content-Type': file.type,
          'X-Idauto-Media-Type': value(form, 'media_type'),
          'X-Idauto-Access-Scope': value(form, 'media_access_scope'),
          'X-Idauto-Blurred': form.elements.blurred.checked ? 'true' : 'false'
        }
      });
    }
    return { vehicle: vehicle, plate: plate, observation: observation, fact: fact, media: media };
  }

  var exported = { createEntry: createEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.IdAutoAdminUI = exported;
  if (typeof document === 'undefined') return;

  var form = document.getElementById('entry-form');
  var result = document.getElementById('result');
  var button = document.getElementById('submit-button');

  // IDA-V3 — a plate that resolved to nothing on the public surface arrives
  // here as ?plate=SSS TUN NNNN, so the operator does not retype what they
  // just searched for. This PRE-FILLS ONLY: nothing is submitted, nothing is
  // invented, and every other field stays empty for a human to complete or
  // leave blank. The vehicle is created by the existing audited endpoints
  // when the form is submitted, and the IVID is issued server-side — there is
  // no field here, and no query parameter, that can propose one.
  (function prefillFromQuery() {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return;
    var params = new URLSearchParams(window.location.search);
    var plate = (params.get('plate') || '').trim();
    if (!plate) return;
    // Accepted only in the catalogue's canonical machine form (SSS TUN NNNN).
    // Anything else is ignored rather than pasted into the form, so a crafted
    // link cannot seed arbitrary text into an audited write.
    if (!/^\d{1,3} TUN \d{1,4}$/.test(plate)) return;
    if (form.elements.plate_number && !form.elements.plate_number.value) {
      form.elements.plate_number.value = plate;
    }
    if (form.elements.format_code && !form.elements.format_code.value) {
      form.elements.format_code.value = 'TUN_STD';
    }
    /* IDA-V11 — the notice belongs at the TOP of the page, where someone
     * arriving from the public search is actually looking, and in both
     * languages. #result is the SUBMIT outcome area at the foot of the form;
     * using it to announce an arrival put the message where nobody had reason
     * to look yet, and only in English. The banner is static markup revealed
     * here — no text is built in JavaScript, so neither language can be
     * mangled by string concatenation. */
    var notice = document.querySelector('[data-unregistered-notice]');
    if (notice) {
      var plateLine = notice.querySelector('[data-unregistered-plate]');
      if (plateLine) plateLine.textContent = 'Plaque reprise de la recherche — الرقم المنقول من البحث : ' + plate;
      notice.hidden = false;
    }
    if (result) {
      result.className = '';
      result.textContent = 'Plate ' + plate + ' carried over from the public search. Fill in only what you know.';
    }
  }());

  // IDA-V1B — owner session. Since IDA-V13 the enrolment is authenticated by
  // the signed-in web session (no token anywhere in the page); the server
  // answers with a Set-Cookie the browser keeps from then on.
  var enrollButton = document.getElementById('enroll-button');
  var forgetButton = document.getElementById('forget-button');
  var enrollResult = document.getElementById('enroll-result');

  function sessionRequest(path, headers) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-IDauto-Owner': '1', 'X-IDauto-Session': '1' }, headers || {})
    });
  }

  if (enrollButton) {
    enrollButton.addEventListener('click', async function () {
      enrollResult.className = '';
      enrollButton.disabled = true;
      try {
        // IDA-V13 — authenticated by the signed-in session, not by a token.
        var response = await sessionRequest('/session/enroll');
        if (response.status === 204) {
          enrollResult.className = 'success';
          enrollResult.textContent = 'This browser is recognised. Plate lookup now works on idauto.tn.';
        } else if (response.status === 401) {
          toLogin();
        } else if (response.status === 503) {
          enrollResult.className = 'error';
          enrollResult.textContent = 'Owner sessions are not configured on this host (IDAUTO_SESSION_SECRET is unset).';
        } else {
          enrollResult.className = 'error';
          enrollResult.textContent = 'Enrolment failed (' + response.status + ').';
        }
      } catch (err) {
        enrollResult.className = 'error';
        enrollResult.textContent = 'Network error — try again.';
      } finally {
        enrollButton.disabled = false;
      }
    });
  }

  if (forgetButton) {
    forgetButton.addEventListener('click', async function () {
      forgetButton.disabled = true;
      enrollResult.className = '';
      try {
        await sessionRequest('/session/logout');
        enrollResult.className = 'success';
        enrollResult.textContent = 'This browser is no longer recognised.';
      } catch (err) {
        enrollResult.className = 'error';
        enrollResult.textContent = 'Network error — try again.';
      } finally {
        forgetButton.disabled = false;
      }
    });
  }
  // IDA-V13 — who is signed in. Shown from the server's answer, never from
  // anything stored in the page; no session → the visitor is sent to /login.
  (async function () {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    var line = document.getElementById('session-line');
    var loginLink = document.getElementById('login-link');
    var logoutButton = document.getElementById('logout-button');
    var ROLE_FR = { admin: 'administrateur', manager: 'gestionnaire', technician: 'technicien' };
    var me = null;
    try { var r = await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); me = r.ok ? await r.json() : null; } catch (e) { me = null; }
    if (!me || !me.user) {
      if (line) line.textContent = 'Vous n\'êtes pas connecté.';
      if (loginLink) loginLink.hidden = false;
      toLogin();
      return;
    }
    if (line) line.textContent = 'Connecté : ' + me.user.name + ' · ' + (ROLE_FR[me.user.role] || me.user.role);
    if (logoutButton) {
      logoutButton.hidden = false;
      logoutButton.addEventListener('click', async function () {
        try { await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); } catch (e) { /* server-side session; /login confirms */ }
        window.location.replace('/login');
      });
    }
  }());

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    result.className = '';
    result.textContent = 'Creating entry…';
    button.disabled = true;
    try {
      // IDA-V1C — trim, then shape-check before spending a request. The
      // field was previously read raw while every other field went through
      // value(), which trims.
      var created = await createEntry(form, null);
      result.className = 'success';
      result.textContent = 'Created vehicle ' + created.vehicle.internal_ref + ' and observation ' + created.observation.id + '.';
      form.reset();
    } catch (err) {
      result.className = 'error';
      result.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}());
