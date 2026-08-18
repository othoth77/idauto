'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2 Phase A — plate format validator
// reference/plate-validator.js
//
// Pure, offline, no database/network dependency. Loads format rules from
// config/idauto.example.json (the same source the IDA-2
// PostgreSQL migration's idauto_plate_formats seed data mirrors) rather
// than hardcoding patterns, per IDA-0 AD-3 ("Plate formats as configurable
// rules... not hardcoded").
//
// All formats loaded from idauto.example.json are UNVERIFIED DRAFTS per
// that file's own _note — this module validates structurally against the
// configured patterns, it does not assert the patterns are officially
// correct.
//
// CACHING (added IDA-2A-CORRECTION-0): loadFormats() reads+parses the
// config and compiles all regexes only once per configPath, then serves
// every subsequent call for that same path from an in-memory cache. This
// makes the matchPlateFormat(raw)/isValidPlate(raw) single-argument form
// (no pre-loaded `formats` passed in) safe to call per-lookup — e.g. from
// a future IDA-2 Phase B API route handler — without re-hitting the
// filesystem or recompiling 7 regexes on every call. The cached RegExp
// objects carry no 'g' flag, so they have no mutable lastIndex state and
// are safe to share across concurrent callers. clearFormatCache() exists
// for tests and for the rare case a config file changes on disk during a
// long-running process (not expected in this repo's plain-file setup).
// =====================================================

var path = require('path');
var fs = require('fs');

var DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'idauto.example.json');
var _formatCache = Object.create(null);

function loadFormats(configPath) {
  var resolvedPath = configPath || DEFAULT_CONFIG_PATH;
  if (_formatCache[resolvedPath]) {
    return _formatCache[resolvedPath];
  }
  var raw = fs.readFileSync(resolvedPath, 'utf8');
  var config = JSON.parse(raw);
  var formats = (config.plate_formats && config.plate_formats.formats) || [];
  var compiled = formats.map(function (f) {
    return {
      code: f.code,
      name_fr: f.name_fr,
      name_ar: f.name_ar,
      pattern: new RegExp(f.pattern),
      example: f.example,
      active: f.active !== false,
      verified: f.verified === true
    };
  });
  _formatCache[resolvedPath] = compiled;
  return compiled;
}

// Drops one cached configPath (or every cached path if none given). Tests
// use this to verify loadFormats() re-reads from disk when the cache is
// empty; a future long-running process could use it if the underlying
// config file is ever replaced without a process restart.
function clearFormatCache(configPath) {
  if (configPath) {
    delete _formatCache[configPath];
  } else {
    _formatCache = Object.create(null);
  }
}

// Normalizes raw plate text for matching: trims, collapses internal
// whitespace runs to a single space, uppercases. Does not strip spaces
// entirely — several format patterns rely on an optional single space
// between segments (`\s?`), and collapsing to zero spaces would still
// match those patterns correctly, but collapsing multiple spaces first
// keeps the normalized form stable and human-readable for storage in
// idauto_plates.plate_number / idauto_observations.plate_normalised.
function normalizePlate(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

// Matches normalized plate text against the loaded (or provided) format
// list, in list order, returning the first active match. Returns null if
// no active format matches. Does not mutate input.
function matchPlateFormat(raw, formats) {
  var normalized = normalizePlate(raw);
  if (!normalized) return null;
  var list = formats || loadFormats();
  for (var i = 0; i < list.length; i++) {
    var fmt = list[i];
    if (!fmt.active) continue;
    var match = normalized.match(fmt.pattern);
    if (match) {
      return {
        plate_normalised: normalized,
        format_code: fmt.code,
        verified: fmt.verified,
        groups: match.slice(1)
      };
    }
  }
  return null;
}

// Convenience boolean wrapper for callers that only need a yes/no answer
// (e.g. review-queue "unknown_format" trigger from idauto.example.json's
// review_queue.auto_queue_triggers).
function isValidPlate(raw, formats) {
  return matchPlateFormat(raw, formats) !== null;
}

module.exports = {
  loadFormats: loadFormats,
  clearFormatCache: clearFormatCache,
  normalizePlate: normalizePlate,
  matchPlateFormat: matchPlateFormat,
  isValidPlate: isValidPlate
};
