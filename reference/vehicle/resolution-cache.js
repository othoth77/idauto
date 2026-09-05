'use strict';
// =====================================================
// IDauto — IDA-V12 — resolution cache (in-process, TTL, bounded)
// reference/vehicle/resolution-cache.js
//
// Request → CACHE → database → external provider → save → return. This is the
// first hop. It stores resolution OUTCOMES keyed by canonical plate or VIN,
// positive ones for `ttlSeconds` and negative ones ("not found") for the
// shorter `negativeTtlSeconds`, so a burst of lookups for one car costs one
// provider call and one database read. It is per-process and volatile by
// design: the durable memory is the database (Phase 6), this only saves
// latency and provider budget on top of it.
//
// Confirming or editing an identification invalidates the entry, so a
// correction is visible on the very next lookup.
// =====================================================

function envInt(name, fallback) {
  var v = parseInt(process.env[name] || '', 10);
  return isFinite(v) && v >= 0 ? v : fallback;
}

function createResolutionCache(options) {
  options = options || {};
  var ttl = (options.ttlSeconds !== undefined ? options.ttlSeconds : envInt('IDAUTO_RESOLUTION_CACHE_TTL_SECONDS', 300)) * 1000;
  var negTtl = (options.negativeTtlSeconds !== undefined ? options.negativeTtlSeconds : envInt('IDAUTO_RESOLUTION_CACHE_NEGATIVE_TTL_SECONDS', 60)) * 1000;
  var max = options.maxEntries !== undefined ? options.maxEntries : envInt('IDAUTO_RESOLUTION_CACHE_MAX_ENTRIES', 1000);
  var now = options.now || Date.now;
  var map = new Map();
  var stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

  function get(key) {
    var e = map.get(key);
    if (!e) { stats.misses++; return undefined; }
    if (e.expires <= now()) { map.delete(key); stats.misses++; return undefined; }
    // Refresh insertion order so the Map's first entry is the least recently used.
    map.delete(key); map.set(key, e);
    stats.hits++;
    return e.value;
  }

  function set(key, value, isNegative) {
    if (ttl === 0 && !isNegative) return;
    if (negTtl === 0 && isNegative) return;
    if (map.has(key)) map.delete(key);
    while (map.size >= max && max > 0) { map.delete(map.keys().next().value); stats.evictions++; }
    if (max > 0) { map.set(key, { value: value, expires: now() + (isNegative ? negTtl : ttl) }); stats.sets++; }
  }

  function invalidate(key) { return map.delete(key); }
  function clear() { map.clear(); }
  function size() { return map.size; }
  function snapshot() {
    var total = stats.hits + stats.misses;
    return { hits: stats.hits, misses: stats.misses, sets: stats.sets, evictions: stats.evictions, entries: map.size,
      hit_rate: total ? stats.hits / total : null, ttl_seconds: ttl / 1000, negative_ttl_seconds: negTtl / 1000, max_entries: max };
  }

  return { get: get, set: set, invalidate: invalidate, clear: clear, size: size, snapshot: snapshot };
}

function plateKey(canonical) { return 'plate:' + canonical; }
function vinKey(vin) { return 'vin:' + vin; }

module.exports = { createResolutionCache: createResolutionCache, plateKey: plateKey, vinKey: vinKey };
