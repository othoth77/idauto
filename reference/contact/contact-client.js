/* VENDORED from othoth77/contact integrations/sdk/contact-client.js @ 2fc5599.
 * Do not edit locally: change it upstream in CONTACT and re-vendor. */
'use strict';

/* CONTACT client SDK — the one way a Mythos project talks to CONTACT.
 *
 * Zero dependencies (Node >= 20 global fetch), CommonJS (usable from ESM via
 * `import contact from '.../contact-client.js'`). Vendor this file into the
 * consumer repository (see integrations/README.md); do not re-implement it.
 *
 * Guarantees for consumers:
 *  - It never fabricates a CNT id. Every id it returns came from CONTACT.
 *  - When CONTACT is unreachable it throws ContactUnavailableError; the caller
 *    must stop or queue the request in a NON-canonical pending queue
 *    (createPendingQueue) — never create a local contact instead.
 *  - Writes carry an Idempotency-Key, so retries cannot create duplicates.
 *  - Credentials are never logged; error messages never include PII.
 */

var crypto = require('crypto');

var CNT_RE = /^CNT[0-9]{6,}$/;

function ContactError(name, message, extra) {
  var e = new Error(message);
  e.name = name;
  Object.assign(e, extra || {});
  return e;
}

function isContactId(v) { return typeof v === 'string' && CNT_RE.test(v); }
function assertContactId(v) {
  if (!isContactId(v)) throw ContactError('ContactReferenceError', 'not a CONTACT id (expected CNT000001 format)');
  return v;
}

function configFromEnv(env) {
  env = env || process.env;
  return {
    baseUrl: env.CONTACT_BASE_URL,
    token: env.CONTACT_TOKEN,
    projectId: env.CONTACT_PROJECT_ID,
    apiVersion: env.CONTACT_API_VERSION || 'v1',
    timeoutMs: Number(env.CONTACT_TIMEOUT_MS || 3000),
    retries: Number(env.CONTACT_RETRIES || 2)
  };
}

function createClient(cfg) {
  cfg = Object.assign({ apiVersion: 'v1', timeoutMs: 3000, retries: 2, retryBaseMs: 200 }, cfg || {});
  if (!cfg.baseUrl) throw ContactError('ContactConfigError', 'CONTACT_BASE_URL is not configured');
  var u = new URL(cfg.baseUrl);
  var loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(loopback && u.protocol === 'http:')) throw ContactError('ContactConfigError', 'CONTACT_BASE_URL must be https (http allowed on loopback only)');
  if (!cfg.token || !/^[a-z][a-z0-9-]{1,39}\.[A-Za-z0-9_-]{20,128}$/.test(cfg.token)) throw ContactError('ContactConfigError', 'CONTACT_TOKEN is missing or malformed');
  var tokenProject = cfg.token.split('.')[0];
  if (cfg.projectId && cfg.projectId !== tokenProject) throw ContactError('ContactConfigError', 'CONTACT_PROJECT_ID does not match the token');
  var base = cfg.baseUrl.replace(/\/+$/, '') + '/api/' + cfg.apiVersion;
  var fetchImpl = cfg.fetch || fetch;
  var sleep = cfg.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  async function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var idem = opts.idempotencyKey || (method === 'POST' || method === 'PATCH' ? tokenProject + ':' + crypto.randomUUID() : null);
    if (idem && opts.idempotent !== false) headers['Idempotency-Key'] = idem;
    if (opts.correlationId) headers['X-Correlation-Id'] = opts.correlationId;
    if (opts.actor) headers['X-Contact-Actor'] = String(opts.actor).slice(0, 80);
    var retryable = method === 'GET' || method === 'PUT' || !!headers['Idempotency-Key'];   // PUT record upserts are idempotent by key
    var attempts = 1 + (retryable ? cfg.retries : 0);
    var lastErr;
    for (var i = 0; i < attempts; i++) {
      if (i > 0) await sleep(Math.min(5000, cfg.retryBaseMs * Math.pow(2, i - 1)) * (0.5 + Math.random()));
      var ac = new AbortController();
      var timeoutMs = opts.timeoutMs || cfg.timeoutMs;
      var timer = setTimeout(function () { ac.abort(); }, timeoutMs);
      var res;
      try {
        res = await fetchImpl(base + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ac.signal });
      } catch (e) {
        clearTimeout(timer);
        lastErr = ContactError('ContactUnavailableError', e.name === 'AbortError' ? 'CONTACT timed out after ' + timeoutMs + 'ms' : 'CONTACT unreachable', { retryable: true, kind: e.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE' });
        continue;
      }
      var text;
      try { text = await res.text(); } finally { clearTimeout(timer); }
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      if (res.status >= 200 && res.status < 300) {
        if (opts.raw) return { body: text, contentType: res.headers.get('content-type'), nextCursor: res.headers.get('x-next-cursor') };
        return json;
      }
      var err = json && json.error ? json.error : { code: 'bad_status', message: 'HTTP ' + res.status };
      var extra = { status: res.status, code: err.code, details: err.details, requestId: err.request_id };
      if (res.status === 429 || res.status >= 500) {
        lastErr = ContactError('ContactUnavailableError', 'CONTACT ' + res.status + ' ' + err.code, Object.assign(extra, { retryable: true, kind: res.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR' }));
        if (res.status === 429 && err.details && err.details.retry_after_s && i + 1 < attempts) await sleep(Math.min(10000, err.details.retry_after_s * 1000));
        continue;
      }
      if (res.status === 401) throw ContactError('ContactAuthError', 'CONTACT rejected the service credentials', extra);
      if (res.status === 403) throw ContactError('ContactPermissionError', 'CONTACT denied: ' + ((err.details && err.details.required_scope) || err.code), extra);
      if (res.status === 404) throw ContactError('ContactNotFoundError', err.message, extra);
      if (res.status === 409) throw ContactError('ContactConflictError', err.message, extra);
      throw ContactError('ContactValidationError', err.message, extra);
    }
    throw lastErr;
  }

  function q(params) {
    var s = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { if (params[k] !== undefined && params[k] !== null && params[k] !== '') s.set(k, String(params[k])); });
    var out = s.toString();
    return out ? '?' + out : '';
  }

  return {
    projectId: tokenProject,
    health: function () { return request('GET', '/health'); },
    resolve: function (input, o) { return request('POST', '/contacts/resolve', input, o); },
    create: function (input, o) { return request('POST', '/contacts', input, o); },
    get: function (id, o) { return request('GET', '/contacts/' + assertContactId(id), undefined, o); },
    update: function (id, patch, o) { return request('PATCH', '/contacts/' + assertContactId(id), patch, o); },
    archive: function (id, o) { return request('DELETE', '/contacts/' + assertContactId(id), undefined, o); },
    search: function (params, o) { return request('GET', '/contacts/search' + q(params), undefined, o); },
    organizations: function (params, o) { return request('GET', '/organizations' + q(params), undefined, o); },
    addChannel: function (id, ch, o) { return request('POST', '/contacts/' + assertContactId(id) + '/channels', ch, o); },
    updateChannel: function (id, chId, patch, o) { return request('PATCH', '/contacts/' + assertContactId(id) + '/channels/' + Number(chId), patch, o); },
    relationships: function (id, o) { return request('GET', '/contacts/' + assertContactId(id) + '/relationships', undefined, o); },
    addRelationship: function (id, rel, o) { return request('POST', '/contacts/' + assertContactId(id) + '/relationships', rel, o); },
    updateRelationship: function (id, relId, patch, o) { return request('PATCH', '/contacts/' + assertContactId(id) + '/relationships/' + Number(relId), patch, o); },
    associate: function (id, assoc, o) { return request('POST', '/contacts/' + assertContactId(id) + '/associations', assoc, o); },
    associations: function (id, o) { return request('GET', '/contacts/' + assertContactId(id) + '/associations', undefined, o); },
    // One event, or { events: [...] }. event_id gives a stable idempotency key across retries/restarts.
    recordEvents: function (evOrBatch, o) { return request('POST', '/events', evOrBatch, Object.assign({ idempotencyKey: evOrBatch.event_id ? tokenProject + ':ev:' + evOrBatch.event_id : undefined }, o)); },
    // Project record references (e.g. a CMF order on the contact fiche). Idempotent upsert per (project, record_type, record_id, contact).
    upsertRecord: function (id, rec, o) { return request('PUT', '/contacts/' + assertContactId(id) + '/records', rec, o); },
    records: function (id, params, o) { return request('GET', '/contacts/' + assertContactId(id) + '/records' + q(params), undefined, o); },
    profile: function (id, o) { return request('GET', '/contacts/' + assertContactId(id) + '/profile', undefined, o); },
    timeline: function (id, params, o) { return request('GET', '/contacts/' + assertContactId(id) + '/timeline' + q(params), undefined, o); },
    notes: function (id, o) { return request('GET', '/contacts/' + assertContactId(id) + '/notes', undefined, o); },
    addNote: function (id, note, o) { return request('POST', '/contacts/' + assertContactId(id) + '/notes', note, o); },
    tags: function (id, change, o) { return request('POST', '/contacts/' + assertContactId(id) + '/tags', change, o); },
    reference: function (recordId, refKind, o) { return request('GET', '/references' + q({ record_id: recordId, ref_kind: refKind }), undefined, o); },
    previewImport: function (body, o) { return request('POST', '/imports/preview', body, o); },
    commitImport: function (body, o) { return request('POST', '/imports', body, o); },
    exportContacts: function (params, o) { return request('GET', '/contacts/export' + q(params), undefined, Object.assign({ raw: true }, o)); },
    _request: request
  };
}

/* Pending queue for "CONTACT unavailable": holds the REQUEST, never a
 * contact. Entries have no CNT id and must not be shown as contacts. The
 * consumer persists them with its own store ({ add, list, remove }) and
 * calls drain() when CONTACT is back. Each entry keeps its idempotency key,
 * so a request that did reach CONTACT before the outage is not duplicated. */
function createPendingQueue(store) {
  store = store || (function () { var m = new Map(); return { add: async function (e) { m.set(e.id, e); }, list: async function () { return Array.from(m.values()); }, remove: async function (id) { m.delete(id); } }; })();
  return {
    enqueue: async function (op, payload, meta) {
      if (['resolve', 'recordEvents', 'update', 'addChannel', 'associate', 'addRelationship'].indexOf(op) < 0) throw ContactError('ContactConfigError', 'operation ' + op + ' cannot be queued');
      var e = { id: crypto.randomUUID(), op: op, payload: payload, meta: meta || {}, idempotencyKey: 'pending:' + crypto.randomUUID(), queued_at: new Date().toISOString(), canonical: false };
      await store.add(e);
      return { pending_id: e.id, canonical: false };
    },
    list: function () { return store.list(); },
    // onDone(entry, result) lets the consumer write the confirmed CNT id onto its own record.
    drain: async function (client, onDone) {
      var done = 0, failed = 0, items = await store.list();
      for (var i = 0; i < items.length; i++) {
        var e = items[i];
        try {
          var args = e.op === 'update' || e.op === 'addChannel' || e.op === 'associate' || e.op === 'addRelationship' ? [e.payload.contact_id, e.payload.body] : [e.payload];
          var res = await client[e.op].apply(null, args.concat([{ idempotencyKey: e.idempotencyKey }]));
          if (onDone) await onDone(e, res);
          await store.remove(e.id); done++;
        } catch (err) {
          if (err.name === 'ContactUnavailableError') { failed++; break; }   // still down: keep order, stop
          if (onDone) await onDone(e, null, err);
          await store.remove(e.id); failed++;                              // permanent error: surfaced to the consumer
        }
      }
      return { done: done, failed: failed, remaining: (await store.list()).length };
    }
  };
}

module.exports = { createClient: createClient, configFromEnv: configFromEnv, createPendingQueue: createPendingQueue, isContactId: isContactId, assertContactId: assertContactId, CNT_RE: CNT_RE };
