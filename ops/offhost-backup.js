'use strict';

// Provider-neutral ID Auto off-host backup tooling. Exit codes: 0 clean,
// 1 usage/environment, 2 anomaly/verification failure, 3 refused.
var fs = require('fs');

var path = require('path');

var crypto = require('crypto');

var os = require('os');

var FORMAT_VERSION = '1.0.0';

var TOOL_VERSION = '1.0.0';

// Deployment-neutral. The live media root is supplied by the operator
// through IDAUTO_MEDIA_STORAGE_PATH (or opts.liveMediaPath); no deployment
// path is hardcoded here. See ops/runbooks/STORAGE_RUNBOOK.md.
var LIVE_MEDIA = process.env.IDAUTO_MEDIA_STORAGE_PATH || null;

// Paths a restore must never be written into, independent of deployment.
var PROTECTED_DESTS = ['/', '/home', '/root', '/etc', '/var', '/usr', '/bin',
  '/boot', '/opt', '/srv', '/lib', '/sbin', '/proc', '/sys', '/dev'];

// A direct child of /home is a user's home root (e.g. /home/deploy) — never
// a restore destination. Expressed as a rule rather than a hardcoded name so
// it holds on every host.
function isHomeRoot(d) {
  return path.dirname(d) === '/home';
}

function hash(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

function fileHash(p) {
  return hash(fs.readFileSync(p));
}

function safeRel(r) {
  return typeof r === 'string' && !path.isAbsolute(r) && r.split(/[\\/]/).every(function(x) {
    return x && x !== '.' && x !== '..';
  });
}

function redact(v) {
  return String(v || '')
    .replace(
      /(access[_ -]?key|secret|token|signature|credential|password)(\s*[=:]\s*|%3[dD])[^\s&,]+/gi,
      '$1$2[REDACTED]'
    )
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]');
}

function problem(kind) {
  var e = new Error(redact(kind));
  e.safe = true;
  return e;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(p, b) {
  fs.mkdirSync(path.dirname(p), {
    recursive: true,
    mode: 0o700
  });
  fs.writeFileSync(p, b, {
    mode: 0o600
  });
}

function discoverDb(dir) {
  var a = fs.readdirSync(dir).filter(function(n) {
    return fs.statSync(path.join(dir, n)).isFile() && n !== 'manifest.json';
  }).sort();
  if (a.length !== 1) throw problem('database dump discovery failed');
  return path.join(dir, a[0]);
}

function mediaEntries(mediaDir) {
  var checks = fs.readFileSync(path.join(mediaDir, 'checksums.sha256'), 'utf8')
    .split('\n')
    .filter(Boolean);
  return checks.map(function(line) {
    var m = /^([0-9a-f]{64})  (media\/.+)$/.exec(line);
    if (!m || !safeRel(m[2])) throw problem('invalid media checksum entry');
    var p = path.join(mediaDir, m[2]);
    return {
      rel: 'media-backup/' + m[2],
      source: p,
      sha256: m[1],
      size: fs.statSync(p).size
    };
  });
}

function buildManifest(opts) {
  var db = discoverDb(opts.dbDir);
  var mmPath = path.join(opts.mediaDir, 'manifest.json');
  var mm = readJson(mmPath);
  var entries = mediaEntries(opts.mediaDir);
  var dbTime = new Date(opts.databaseCapturedAt || fs.statSync(db).mtime).toISOString();
  var mediaTime = new Date(opts.mediaCapturedAt || mm.created_at_utc).toISOString();
  if (Date.parse(dbTime) > Date.parse(mediaTime)) throw problem('capture order must be database-before-media');
  var unique = {};
  entries.forEach(function(e) {
    unique[path.basename(e.rel)] = true;
  });
  var rows = Number(
    mm.database && (mm.database.row_count != null ? mm.database.row_count : mm.database.media_rows)
  );
  var distinct = Number(mm.database && mm.database.distinct_object_keys);
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(distinct) ||
    distinct !== Object.keys(unique).length ||
    rows < distinct
  ) throw problem('media-row consistency failure');
  var dbRel = 'database/' + path.basename(db);
  var mediaManifestRel = 'media-backup/manifest.json';
  var objects = [ {
    rel: dbRel,
    source: db,
    sha256: fileHash(db),
    size: fs.statSync(db).size
  }, {
    rel: mediaManifestRel,
    source: mmPath,
    sha256: fileHash(mmPath),
    size: fs.statSync(mmPath).size
  } ].concat(entries);
  return {
    format_version: FORMAT_VERSION,
    created_at_utc: new Date(opts.now || Date.now()).toISOString(),
    tool_version: TOOL_VERSION,
    source_host_identifier: String(opts.host || os.hostname()),
    database: {
      dump_filename: path.basename(db),
      dump_sha256: objects[0].sha256,
      media_row_count: rows
    },
    media: {
      manifest_sha256: objects[1].sha256,
      object_count: entries.length,
      distinct_object_key_count: distinct
    },
    capture: {
      order: [ 'database', 'media' ],
      database_captured_at_utc: dbTime,
      media_captured_at_utc: mediaTime,
      window_seconds: (Date.parse(mediaTime) - Date.parse(dbTime)) / 1000,
      separately_captured: true
    },
    consistency: {
      state: mm.consistency && mm.consistency.state === 'CONSISTENT' ? 'CONSISTENT' : 'DEGRADED',
      claim: 'separately captured; not a transactional filesystem snapshot'
    },
    objects: objects.map(function(o) {
      return {
        path: o.rel,
        sha256: o.sha256,
        size: o.size
      };
    })
  };
}

function stage(opts) {
  var m = buildManifest(opts);
  if (opts.dryRun) return {
    ok: true,
    dry_run: true,
    manifest: m
  };
  if (fs.existsSync(opts.dest)) throw problem('stage destination already exists');
  m.objects.forEach(function(o) {
    var source = o.path.indexOf('database/') === 0
      ? path.join(opts.dbDir, path.basename(o.path))
      : path.join(opts.mediaDir, o.path.replace(/^media-backup\//, ''));
    write(path.join(opts.dest, o.path), fs.readFileSync(source));
  });
  write(path.join(opts.dest, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  return verifyLocal(opts.dest);
}

function regenerate(dir, dryRun) {
  var old = readJson(path.join(dir, 'manifest.json'));
  old.objects.forEach(function(o) {
    if (!safeRel(o.path)) throw problem('path traversal in manifest');
    var p = path.join(dir, o.path);
    o.size = fs.statSync(p).size;
    o.sha256 = fileHash(p);
  });
  old.database.dump_sha256 = old.objects[0].sha256;
  old.media.manifest_sha256 = old.objects[1].sha256;
  if (!dryRun) write(path.join(dir, 'manifest.json'), JSON.stringify(old, null, 2) + '\n');
  return old;
}

function verifyLocal(dir) {
  var m;
  try {
    m = readJson(path.join(dir, 'manifest.json'));
  } catch (e) {
    return {
      ok: false,
      problems: [ 'manifest unavailable' ]
    };
  }
  var p = [];
  if (m.format_version !== FORMAT_VERSION) p.push('unsupported format');
  var seen = {};
  (m.objects || []).forEach(function(o) {
    if (!safeRel(o.path)) {
      p.push('path traversal');
      return;
    }
    if (seen[o.path]) {
      p.push('duplicate entry');
      return;
    }
    seen[o.path] = true;
    var f = path.join(dir, o.path);
    if (!fs.existsSync(f)) {
      p.push('missing object');
    } else if (fs.statSync(f).size !== o.size || fileHash(f) !== o.sha256) {
      p.push('checksum mismatch');
    }
  });
  if (m.database && m.database.dump_sha256 !== (m.objects[0] || {}).sha256) p.push('database dump checksum mismatch');
  if (m.media && m.media.manifest_sha256 !== (m.objects[1] || {}).sha256) p.push('media manifest checksum mismatch');
  if (
    m.database &&
    m.media &&
    m.database.media_row_count < m.media.distinct_object_key_count
  ) p.push('media-row consistency failure');
  return {
    ok: !p.length,
    problems: p,
    manifest: m,
    verified_objects: (m.objects || []).length
  };
}

async function push(dir, adapter, opts) {
  // The adapter boundary keeps staging, verification, and the offline suite
  // independent of any provider, credentials, or network connection.
  opts = opts || {};
  var v = verifyLocal(dir);
  if (!v.ok) return v;
  if (opts.dryRun) return {
    ok: true,
    dry_run: true,
    writes: 0
  };
  var prefix = opts.prefix || v.manifest.created_at_utc.replace(/[:.]/g, '-');
  var uploaded = [];
  try {
    for (var i = 0; i < v.manifest.objects.length; i++) {
      var o = v.manifest.objects[i];
      var key = prefix + '/' + o.path;
      await adapter.put(key, fs.readFileSync(path.join(dir, o.path)), {
        sha256: o.sha256
      });
      var h = await adapter.head(key);
      if (!h || h.size !== o.size || h.sha256 !== o.sha256) throw problem('remote verification failure');
      uploaded.push(key);
    }
    var mb = fs.readFileSync(path.join(dir, 'manifest.json'));
    await adapter.put(prefix + '/manifest.json', mb, {
      sha256: hash(mb)
    });
    var mh = await adapter.head(prefix + '/manifest.json');
    if (!mh || mh.size !== mb.length || mh.sha256 !== hash(mb)) throw problem('remote manifest verification failure');
    // COMPLETE is deliberately last: a partially uploaded set must never be
    // advertised as restorable, even when every earlier object was accepted.
    await adapter.put(prefix + '/COMPLETE', Buffer.from(hash(mb) + '\n'), {
      sha256: hash(Buffer.from(hash(mb) + '\n'))
    });
    return {
      ok: true,
      prefix: prefix,
      uploaded: uploaded.length
    };
  } catch (e) {
    return {
      ok: false,
      partial: uploaded.length > 0,
      complete: false,
      problems: [ redact(e.message || 'transfer failure') ]
    };
  }
}

async function verifyRemote(prefix, adapter) {
  try {
    var mb = await adapter.get(prefix + '/manifest.json');
    var m = JSON.parse(Buffer.from(mb).toString());
    var complete = await adapter.get(prefix + '/COMPLETE');
    if (Buffer.from(complete).toString().trim() !== hash(mb)) throw problem('completion marker mismatch');
    for (var i = 0; i < m.objects.length; i++) {
      var o = m.objects[i];
      if (!safeRel(o.path)) throw problem('path traversal in manifest');
      var h = await adapter.head(prefix + '/' + o.path);
      if (!h || h.size !== o.size || h.sha256 !== o.sha256) throw problem('remote checksum mismatch');
    }
    return {
      ok: true,
      manifest: m
    };
  } catch (e) {
    return {
      ok: false,
      problems: [ redact(e.message || 'provider unavailable') ]
    };
  }
}

async function restoreVerify(prefix, dest, adapter, opts) {
  opts = opts || {};
  var d = path.resolve(dest);
  var configuredLive = opts.liveMediaPath || LIVE_MEDIA;
  var live = configuredLive ? path.resolve(configuredLive) : null;
  var repo = path.resolve(__dirname, '..');
  var unsafe = (live !== null && (d === live || d.indexOf(live + path.sep) === 0)) ||
    PROTECTED_DESTS.indexOf(d) !== -1 ||
    isHomeRoot(d) ||
    d === repo ||
    d.indexOf(repo + path.sep) === 0;
  if (unsafe) return {
    ok: false,
    refused: true,
    problems: [ 'unsafe restore path' ]
  };
  var vr = await verifyRemote(prefix, adapter);
  if (!vr.ok) return vr;
  if (opts.dryRun) return {
    ok: true,
    dry_run: true
  };
  try {
    for (var i = 0; i < vr.manifest.objects.length; i++) {
      var o = vr.manifest.objects[i];
      if (!safeRel(o.path)) throw problem('path traversal in manifest');
      var b = Buffer.from(await adapter.get(prefix + '/' + o.path));
      if (b.length !== o.size || hash(b) !== o.sha256) throw problem('corrupted object');
      var target = path.join(d, o.path);
      if (fs.existsSync(target) && fileHash(target) !== o.sha256) return {
        ok: false,
        refused: true,
        problems: [ 'restore conflict' ]
      };
      if (!fs.existsSync(target)) write(target, b);
    }
    write(path.join(d, 'manifest.json'), JSON.stringify(vr.manifest, null, 2) + '\n');
    return verifyLocal(d);
  } catch (e) {
    return {
      ok: false,
      problems: [ redact(e.message) ]
    };
  }
}

function retention(sets) {
  // Retention is report-only. Deletion requires separate authorisation and is
  // intentionally outside this disaster-recovery tool's capabilities.
  var sorted = sets.slice().sort(function(a, b) {
    return Date.parse(b.created_at_utc) - Date.parse(a.created_at_utc);
  });
  var keep = {};
  var daily = {};
  var weekly = {};
  var monthly = {};
  sorted.forEach(function(s) {
    var d = new Date(s.created_at_utc);
    var day = s.created_at_utc.slice(0, 10);
    var jan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var wk = d.getUTCFullYear() + '-W' + Math.ceil(((d - jan) / 86400000 + jan.getUTCDay() + 1) / 7);
    var mon = s.created_at_utc.slice(0, 7);
    if (Object.keys(daily).length < 7 && !daily[day]) daily[day] = keep[s.id] = true;
    if (Object.keys(weekly).length < 4 && !weekly[wk]) weekly[wk] = keep[s.id] = true;
    if (Object.keys(monthly).length < 3 && !monthly[mon]) monthly[mon] = keep[s.id] = true;
  });
  return {
    keep: sorted.filter(function(s) {
      return keep[s.id];
    }),
    drop: sorted.filter(function(s) {
      return !keep[s.id];
    }),
    policy: '7 daily / 4 weekly / 3 monthly',
    deleted: 0
  };
}

function argv(name) {
  var i = process.argv.indexOf('--' + name);
  return i < 0 ? null : process.argv[i + 1];
}

function has(name) {
  return process.argv.indexOf('--' + name) >= 0;
}

function loadAdapter() {
  var mod = argv('adapter');
  if (!mod) throw problem('remote command requires --adapter <module>');
  var factory = require(path.resolve(mod));
  return factory.create ? factory.create() : factory;
}

async function main() {
  var cmd = process.argv[2];
  var dry = has('dry-run');
  var r;
  try {
    if (has('destructive')) {
      process.stderr.write('REFUSED: deletion is not authorised by this tool\n');
      process.exitCode = 3;
      return;
    }
    switch (cmd) {
     case 'stage':
      r = stage({
        dbDir: argv('database'),
        mediaDir: argv('media'),
        dest: argv('dest'),
        databaseCapturedAt: argv('database-captured-at'),
        mediaCapturedAt: argv('media-captured-at'),
        host: argv('host'),
        dryRun: dry
      });
      break;

     case 'manifest':
      r = regenerate(path.resolve(argv('stage')), dry);
      break;

     case 'verify-local':
      r = verifyLocal(path.resolve(argv('stage')));
      break;

     case 'push':
      r = await push(path.resolve(argv('stage')), loadAdapter(), {
        prefix: argv('prefix'),
        dryRun: dry
      });
      break;

     case 'verify-remote':
      r = await verifyRemote(argv('prefix'), loadAdapter());
      break;

     case 'list':
      r = {
        ok: true,
        sets: await loadAdapter().list(argv('prefix') || '')
      };
      break;

     case 'retention':
      r = retention(readJson(path.resolve(argv('sets'))));
      break;

     case 'restore-verify':
      r = await restoreVerify(argv('prefix'), argv('dest'), loadAdapter(), {
        dryRun: dry
      });
      break;

     default:
      process.stdout.write(
        'Usage: offhost-backup.js ' +
        '<stage|manifest|verify-local|push|verify-remote|list|retention|restore-verify> ' +
        '[options] [--dry-run]\n' +
        'Exit codes: 0 clean · 1 usage/env · 2 anomaly/verification failure · 3 refused\n'
      );
      process.exitCode = cmd ? 1 : 0;
      return;
    }
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exitCode = r && r.ok === false ? 2 : 0;
  } catch (e) {
    process.stderr.write('ERROR: ' + redact(e && e.message || 'operation failed') + '\n');
    process.exitCode = e && e.refused ? 3 : 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildManifest: buildManifest,
  stage: stage,
  regenerate: regenerate,
  verifyLocal: verifyLocal,
  push: push,
  verifyRemote: verifyRemote,
  restoreVerify: restoreVerify,
  retention: retention,
  redact: redact,
  safeRel: safeRel,
  FORMAT_VERSION: FORMAT_VERSION
};
