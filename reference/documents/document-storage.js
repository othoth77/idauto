'use strict';
// =====================================================
// IDauto — IDA-V14 — RegistrationDocumentStorage
// reference/documents/document-storage.js
//
// The business code (document-service.js) never touches a filesystem: it
// calls put / get / remove on this interface. The only adapter today is the
// LOCAL one, built on reference/storage.js — the same content-addressed,
// private media root the observation media already use
// (IDAUTO_MEDIA_STORAGE_PATH, mode 0640, never served as a path). A future
// S3-compatible / MinIO adapter implements the same three functions and is
// selected by IDAUTO_DOCUMENT_STORAGE (default 'local').
//
// Keys are generated HERE (the sha256 of the bytes), never from the client.
// A key is an opaque handle: the browser only ever sees route URLs.
// =====================================================

var fs = require('fs');
var path = require('path');
var storage = require('../storage.js');

function createLocalAdapter() {
  function keyPath(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Object.assign(new Error('invalid storage key'), { httpStatus: 400 });
    var root = process.env.IDAUTO_MEDIA_STORAGE_PATH;
    if (!root) throw new Error('IDAUTO_MEDIA_STORAGE_PATH is not set');
    return path.join(root, key.slice(0, 2), key.slice(2, 4), key);
  }
  return {
    name: 'local',
    // → { key, byte_size } ; content-addressed, so the same bytes stored twice share one file.
    put: async function (buffer, mime) { var s = storage.store(buffer, mime); return { key: s.object_key, byte_size: s.file_size_bytes }; },
    get: async function (key) { var p = keyPath(key); return fs.existsSync(p) ? fs.readFileSync(p) : null; },
    // Removes the bytes; the caller decides whether another row still references the key.
    remove: async function (key) { keyPath(key); storage.removeUnconditionally(key); },
    exists: async function (key) { return fs.existsSync(keyPath(key)); }
  };
}

var _adapter = null;
function getStorage() {
  if (_adapter) return _adapter;
  var kind = process.env.IDAUTO_DOCUMENT_STORAGE || 'local';
  if (kind === 'local') _adapter = createLocalAdapter();
  else throw new Error('IDAUTO_DOCUMENT_STORAGE=' + kind + ' is not implemented (local only)');
  return _adapter;
}

module.exports = { getStorage: getStorage, createLocalAdapter: createLocalAdapter, _reset: function () { _adapter = null; } };
