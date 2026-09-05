'use strict';
// =====================================================
// IDauto — IDA-V12 — structured events and metrics
// reference/observability.js
//
// EVENTS. One JSON line per event on stdout (journald in production), the
// same channel the auth diagnostics already use. Names are the ones the
// order fixes (Phase 18): plate_resolution_started / _success / _failed,
// vehicle_resolved, vehicle_confirmed, tecdoc_lookup_started / _success /
// _failed. Every field goes through redact(): any key that looks like a
// credential (token, secret, key, password, captcha, authorization, cookie)
// is replaced, raw IPs are never accepted (callers pass the salted hash the
// limiter already uses), and a VIN is reduced to its first 3 + last 4.
//
// METRICS. In-process counters and reservoirs, read by GET /api/metrics
// (admin only). They restart with the process; a scraper that wants history
// keeps its own. Names: resolution_success_rate, resolution_latency_ms,
// provider_error_rate, ocr_confidence, local_cache_hit_rate.
// =====================================================

var SENSITIVE = /token|secret|key|password|captcha|authorization|cookie|bearer/i;
var MAX_SAMPLES = 512;

function redactValue(k, v) {
  if (SENSITIVE.test(k)) return '[redacted]';
  if (k === 'ip' || k === 'remote_address' || k === 'x_forwarded_for') return '[never logged]';
  if (k === 'vin' && typeof v === 'string' && v.length >= 7) return v.slice(0, 3) + '**********' + v.slice(-4);
  if (v && typeof v === 'object' && !Array.isArray(v)) return redact(v);
  return v;
}
function redact(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = redactValue(k, fields[k]); });
  return out;
}

function createObservability(options) {
  options = options || {};
  var sink = options.sink || function (line) { console.log(line); };
  var counters = Object.create(null);
  var samples = Object.create(null);
  var silent = !!options.silent;

  function event(name, fields) {
    if (silent) return;
    var record = Object.assign({ at: new Date().toISOString(), event: name }, redact(fields));
    sink(JSON.stringify(record));
  }
  function inc(name, by) { counters[name] = (counters[name] || 0) + (by || 1); }
  function observe(name, value) {
    if (typeof value !== 'number' || !isFinite(value)) return;
    var s = samples[name] || (samples[name] = { count: 0, sum: 0, values: [] });
    s.count++; s.sum += value;
    if (s.values.length >= MAX_SAMPLES) s.values.shift();
    s.values.push(value);
  }
  function percentile(values, p) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }
  function summary(name) {
    var s = samples[name];
    if (!s) return { count: 0, avg: null, p50: null, p95: null };
    return { count: s.count, avg: s.sum / s.count, p50: percentile(s.values, 0.5), p95: percentile(s.values, 0.95) };
  }
  function rate(num, den) { var n = counters[num] || 0, d = counters[den] || 0; return d ? n / d : null; }

  function snapshot(extra) {
    return Object.assign({
      generated_at: new Date().toISOString(),
      resolution_success_rate: rate('resolution_success', 'resolution_total'),
      resolution_latency_ms: summary('resolution_latency_ms'),
      provider_error_rate: rate('provider_error', 'provider_calls'),
      ocr_confidence: summary('ocr_confidence'),
      local_cache_hit_rate: rate('cache_hit', 'cache_lookups'),
      counters: Object.assign({}, counters)
    }, extra || {});
  }

  return { event: event, inc: inc, observe: observe, snapshot: snapshot, redact: redact };
}

var defaultInstance = null;
function shared() { return defaultInstance || (defaultInstance = createObservability()); }

module.exports = { createObservability: createObservability, shared: shared, redact: redact };
