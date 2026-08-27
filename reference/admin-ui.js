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
  async function apiRequest(path, token, options) {
    var settings = options || {};
    settings.headers = Object.assign({}, settings.headers, { Authorization: 'Bearer ' + token });
    var response = await fetch(path, settings);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(path + ': ' + (body.error || ('Request failed (' + response.status + ')')));
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

  // IDA-V1B — owner session. The Bearer token is read from the same
  // in-page field as every other admin action and is never stored; the
  // server answers with a Set-Cookie the browser keeps from then on.
  var enrollButton = document.getElementById('enroll-button');
  var forgetButton = document.getElementById('forget-button');
  var enrollResult = document.getElementById('enroll-result');

  function sessionRequest(path, headers) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-IDauto-Owner': '1' }, headers || {})
    });
  }

  if (enrollButton) {
    enrollButton.addEventListener('click', async function () {
      var token = document.getElementById('admin-token').value.trim();
      enrollResult.className = '';
      if (!token) {
        enrollResult.className = 'error';
        enrollResult.textContent = 'Enter the Bearer token above first.';
        return;
      }
      enrollButton.disabled = true;
      try {
        var response = await sessionRequest('/session/enroll', { Authorization: 'Bearer ' + token });
        if (response.status === 204) {
          enrollResult.className = 'success';
          enrollResult.textContent = 'This browser is recognised. Plate lookup now works on idauto.tn.';
        } else if (response.status === 401) {
          enrollResult.className = 'error';
          enrollResult.textContent = 'Token refused.';
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
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    result.className = '';
    result.textContent = 'Creating entry…';
    button.disabled = true;
    try {
      var created = await createEntry(form, document.getElementById('admin-token').value);
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
