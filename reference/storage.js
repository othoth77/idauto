'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2F — object storage wiring
// reference/storage.js
//
// NOT the `mythos_documents` integration contract in
// docs/ARCHITECTURE.md §4.3 (Provider: "Mythos OS document
// storage", Activation: IDA-4) — that contract is for professional
// service-event document attachments and Fixpert carte grise storage,
// a later and separate concern. This module wires
// `idauto_observation_media`'s object-storage references specifically,
// per IDA-2's own Phase B roadmap item ("Object storage wiring —
// original image references"), scoped for the current admin-manual-entry
// phase only.
//
// No cloud object storage service (S3/MinIO/R2) exists anywhere on this
// VPS or in this codebase yet — confirmed by search before this stage
// began. Rather than invent a fictitious cloud integration, this follows
// the same pattern the main Mythos OS app already uses for file storage
// (see upload.php, which saves to a local directory): content-addressed
// local filesystem storage, kept in its own directory
// (IDAUTO_MEDIA_STORAGE_PATH, outside this repository) so it never
// collides with or depends on any host application's storage.
//
// "Content-addressed": the object_key is derived from the SHA-256 hash
// of the file content, nested two levels deep (hash[0:2]/hash[2:4]/hash)
// to avoid tens of thousands of files in one directory. Storing the same
// bytes twice produces the same key and does not duplicate the file —
// matching idauto_observation_media.image_hash's documented purpose
// ("SHA-256 for duplicate detection").
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
var MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — matches idauto.example.json's media_processing.max_upload_size_mb

function getStorageRoot() {
  var root = process.env.IDAUTO_MEDIA_STORAGE_PATH;
  if (!root) {
    throw new Error('storage.js: IDAUTO_MEDIA_STORAGE_PATH is not set');
  }
  return root;
}

function keyToPath(root, imageHash) {
  return path.join(root, imageHash.slice(0, 2), imageHash.slice(2, 4), imageHash);
}

// Validates mime type and size before touching disk. Throws with
// httpStatus set (mirrors the pattern api.js already uses for other
// validation errors) rather than a generic Error.
function validate(buffer, mimeType) {
  if (ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
    throw Object.assign(new Error('unsupported mime type — allowed: ' + ALLOWED_MIME_TYPES.join(', ')), { httpStatus: 400 });
  }
  if (buffer.length === 0) {
    throw Object.assign(new Error('empty file body'), { httpStatus: 400 });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('file too large — max ' + (MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB'), { httpStatus: 413 });
  }
}

// Writes `buffer` to content-addressed local storage. Returns
// { object_key, image_hash, file_size_bytes }. object_key and image_hash
// are the same value in this implementation (the content hash) — kept as
// two separate return fields because idauto_observation_media has two
// separate columns for them, and a future real object-storage backend
// might reasonably make them differ (e.g. a bucket-relative key vs. a
// content hash used only for dedup).
function store(buffer, mimeType) {
  validate(buffer, mimeType);
  var root = getStorageRoot();
  var imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  var filePath = keyToPath(root, imageHash);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer, { mode: 0o640 });
  }
  return { object_key: imageHash, image_hash: imageHash, file_size_bytes: buffer.length };
}

// Unconditionally removes the file for `imageHash`, if present. Callers
// MUST confirm no idauto_observation_media row still references this
// content-addressed key before calling this — storage.js has no database
// access and cannot check that itself. See writes.js's
// createObservationMedia() catch block, the only caller: because storage
// is content-addressed, the SAME bytes uploaded for two different
// observations produce the SAME key, so a naive "always delete on
// failure" would risk deleting a file another row still needs — the
// caller queries idauto_observation_media for other references first.
// Never throws — a cleanup failure must not mask the original DB error.
function removeUnconditionally(imageHash) {
  try {
    var root = getStorageRoot();
    var filePath = keyToPath(root, imageHash);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    // Intentionally swallowed — see comment above.
  }
}

module.exports = {
  store: store,
  removeUnconditionally: removeUnconditionally,
  ALLOWED_MIME_TYPES: ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES
};
