'use strict';
(function () {
  // IDA-V13 — authenticated by the session cookie (HttpOnly, set at /login)
  // plus X-IDauto-Session: 1. The `token` parameter is kept for the callers'
  // shape and ignored.
  async function apiRequest(path, token, options) {
    var settings = options || {};
    settings.credentials = 'same-origin';
    settings.headers = Object.assign({}, settings.headers, { 'X-IDauto-Session': '1', Accept: 'application/json' });
    if (token) settings.headers.Authorization = 'Bearer ' + token;   // library use from a script
    var response = await fetch(path, settings);
    var body = await response.json().catch(function () { return {}; });
    if (response.status === 401 && typeof window !== 'undefined') { window.location.replace('/login?next=' + encodeURIComponent('/admin/review')); }
    if (!response.ok) throw new Error(body.message_fr || body.error || ('Request failed (' + response.status + ')'));
    return body;
  }
  function loadQueue(token) { return apiRequest('/api/review/observations', token); }
  function loadDetail(id, token) { return apiRequest('/api/review/observations/' + encodeURIComponent(id), token); }
  function decide(id, decision, token) {
    return apiRequest('/api/review/observations/' + encodeURIComponent(id) + '/decision', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: decision })
    });
  }
  var exported = { loadQueue: loadQueue, loadDetail: loadDetail, decide: decide };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof window !== 'undefined') window.IdAutoReviewUI = exported;
  if (typeof document === 'undefined') return;

  var loadButton = document.getElementById('load-queue');
  var status = document.getElementById('queue-status');
  var list = document.getElementById('queue-list');
  var detail = document.getElementById('review-detail');
  var activeId = null;
  function token() { return null; }
  (async function () {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    var line = document.getElementById('session-line');
    try { var r = await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }); var me = r.ok ? await r.json() : null; if (line) line.textContent = me && me.user ? 'Connecté : ' + me.user.name + ' · ' + me.user.role : 'Vous n\'êtes pas connecté.'; if (!me || !me.user) window.location.replace('/login?next=' + encodeURIComponent('/admin/review')); } catch (e) { if (line) line.textContent = 'Session : vérification impossible.'; }
  }());
  function text(tag, value, className) {
    var node = document.createElement(tag);
    node.textContent = value == null ? '—' : String(value);
    if (className) node.className = className;
    return node;
  }
  function field(label, value) {
    var row = document.createElement('div');
    row.className = 'detail-field';
    row.appendChild(text('strong', label));
    row.appendChild(text('span', value));
    return row;
  }
  async function refresh() {
    status.className = '';
    status.textContent = 'Loading queue…';
    loadButton.disabled = true;
    list.replaceChildren();
    try {
      var data = await loadQueue(token());
      if (!data.observations.length) {
        list.appendChild(text('p', 'No observations need review.', 'empty'));
        status.textContent = 'Queue is empty.';
      } else {
        data.observations.forEach(function (item) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'queue-item';
          button.appendChild(text('strong', '#' + item.id + ' · ' + item.status));
          button.appendChild(text('span', [item.make, item.model, item.plate_number].filter(Boolean).join(' · ') || 'Unlinked observation'));
          button.addEventListener('click', function () { showDetail(item.id); });
          list.appendChild(button);
        });
        status.textContent = data.observations.length + ' observation(s) pending review.';
      }
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
      list.appendChild(text('p', 'Queue could not be loaded.', 'empty'));
    } finally { loadButton.disabled = false; }
  }
  async function showDetail(id) {
    activeId = id;
    detail.className = '';
    detail.textContent = 'Loading observation…';
    try {
      var data = await loadDetail(id, token());
      if (activeId !== id) return;
      detail.replaceChildren();
      var observation = data.observation;
      detail.appendChild(field('Observation', '#' + observation.id));
      detail.appendChild(field('Status', observation.status));
      detail.appendChild(field('Vehicle', [observation.make, observation.model, observation.variant, observation.year].filter(Boolean).join(' ')));
      detail.appendChild(field('Internal ref', observation.vehicle_internal_ref));
      detail.appendChild(field('Plate', observation.plate_number));
      detail.appendChild(text('h3', 'Non-private facts'));
      detail.appendChild(text('p', data.facts.length ? data.facts.map(function (fact) { return fact.fact_key + ': ' + fact.fact_value; }).join(' · ') : 'No visible facts.', 'detail-copy'));
      detail.appendChild(text('h3', 'Allowed media metadata'));
      detail.appendChild(text('p', data.media.length ? data.media.map(function (media) { return media.media_type + ' · ' + media.mime_type + ' · ' + media.file_size_bytes + ' bytes'; }).join(' · ') : 'No visible media.', 'detail-copy'));
      var actions = document.createElement('div');
      actions.className = 'review-actions';
      ['accept', 'reject'].forEach(function (decision) {
        var button = text('button', decision === 'accept' ? 'Accept' : 'Reject', decision);
        button.type = 'button';
        button.addEventListener('click', async function () {
          actions.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
          status.textContent = 'Saving decision…';
          try {
            await decide(id, decision, token());
            if (activeId !== id) {
              await refresh();
              return;
            }
            activeId = null;
            status.className = 'success';
            status.textContent = 'Observation ' + id + ' ' + (decision === 'accept' ? 'accepted.' : 'rejected.');
            detail.className = 'empty';
            detail.textContent = 'Decision saved. Select another observation.';
            await refresh();
          } catch (err) {
            if (activeId !== id) return;
            status.className = 'error';
            status.textContent = err.message;
            actions.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
          }
        });
        actions.appendChild(button);
      });
      detail.appendChild(actions);
    } catch (err) {
      if (activeId !== id) return;
      detail.className = 'error';
      detail.textContent = err.message;
    }
  }
  loadButton.addEventListener('click', refresh);
}());
