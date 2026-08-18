'use strict';

// S3-compatible HTTPS adapter (suitable for Cloudflare R2).
// User-local config (placeholders): ENDPOINT=https://example.invalid,
// REGION=auto, BUCKET=placeholder, ACCESS_KEY_ID=placeholder,
// SECRET_ACCESS_KEY=placeholder. Append-only or pull-based destinations are
// strongly preferred so a compromised source cannot delete both copies —
// retention in offhost-backup.js therefore stays report-only and never calls
// del(); del() exists for verification round-trips and explicitly authorised
// maintenance, and true append-only enforcement belongs to the credential
// scope at the provider, not to the absence of a client method.
var fs = require('fs');

var path = require('path');

var os = require('os');

var crypto = require('crypto');

var https = require('https');

var DEFAULT_CONFIG = path.join(os.homedir(), '.config/mythos/idauto-offhost.env');

function sha(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

function hmac(k, v, enc) {
  return crypto.createHmac('sha256', k).update(v).digest(enc);
}

function enc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}

function sign(p) {
  var u = new URL(p.url);
  // Refuse plaintext rather than offering an insecure fallback: request
  // signatures and backup contents must never cross the network unencrypted.
  if (u.protocol !== 'https:') throw new Error('non-HTTPS endpoint refused');
  var headers = {};
  Object.keys(p.headers || {}).forEach(function(k) {
    headers[k.toLowerCase()] = String(p.headers[k]).trim().replace(/\s+/g, ' ');
  });
  headers.host = u.host;
  headers['x-amz-date'] = p.amzDate;
  if ((p.service || 's3') === 's3') headers['x-amz-content-sha256'] = p.payloadHash;
  var names = Object.keys(headers).sort();
  // SigV4 hashes this exact canonical form. Header names and query pairs are
  // sorted, paths and values use AWS encoding, and the component order below
  // must remain method, path, query, headers, signed names, then payload hash.
  var canonicalHeaders = names.map(function(n) {
    return n + ':' + headers[n] + '\n';
  }).join('');
  var qs = Array.from(u.searchParams.entries()).sort().map(function(x) {
    return enc(x[0]) + '=' + enc(x[1]);
  }).join('&');
  var canonical = [
    p.method,
    u.pathname.split('/').map(enc).join('/'),
    qs,
    canonicalHeaders,
    names.join(';'),
    p.payloadHash
  ].join('\n');
  var date = p.amzDate.slice(0, 8);
  var scope = [ date, p.region, p.service || 's3', 'aws4_request' ].join('/');
  var stringToSign = [ 'AWS4-HMAC-SHA256', p.amzDate, scope, sha(canonical) ].join('\n');
  var signature = hmac(
    signingKey(p.secret, date, p.region, p.service || 's3'),
    stringToSign,
    'hex'
  );
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + p.accessKey + '/' + scope +
    ', SignedHeaders=' + names.join(';') + ', Signature=' + signature;
  return {
    headers: headers,
    canonicalRequest: canonical,
    stringToSign: stringToSign,
    signature: signature
  };
}

function loadConfig(file) {
  file = file || DEFAULT_CONFIG;
  var st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    throw new Error('configuration file missing or unreadable: ' + file);
  }
  if ((st.mode & 0o777) !== 0o600) throw new Error('configuration file must have mode 600: ' + file);
  var out = {};
  fs.readFileSync(file, 'utf8').split('\n').forEach(function(l) {
    var m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) out[m[1]] = m[2];
  });
  [ 'ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY' ].forEach(function(k) {
    if (!out[k]) throw new Error('configuration file is missing ' + k + ': ' + file);
  });
  if (new URL(out.ENDPOINT).protocol !== 'https:') throw new Error('non-HTTPS endpoint refused');
  return out;
}

// Translates the adapter's {method, url, headers} request object into the
// options shape https.request() actually consumes. Node's request options
// have no `url` key — passing {url} silently connects to localhost:443, which
// is exactly the defect this function exists to prevent. Exported for tests.
function transportOptions(o, bodyLength) {
  var u = new URL(o.url);
  if (u.protocol !== 'https:') throw new Error('non-HTTPS endpoint refused');
  var headers = o.headers;
  if (typeof bodyLength === 'number') {
    // Without an explicit Content-Length Node switches to chunked
    // transfer-encoding, which S3-compatible providers reject for object
    // writes (R2 answers 411 MissingContentLength once the body exceeds
    // what the edge will buffer). Content-Length is not a signed header,
    // so adding it after sign() does not disturb the signature.
    headers = Object.assign({}, o.headers, {
      'content-length': bodyLength
    });
  }
  return {
    hostname: u.hostname,
    port: u.port ? Number(u.port) : 443,
    path: u.pathname + u.search,
    method: o.method,
    headers: headers,
    // A backup transport that can hang forever fails open; a bounded wait
    // fails closed into the existing 'provider unavailable' path.
    timeout: 60000
  };
}

function create(config, requestImpl) {
  // Injecting the transport lets the provider adapter and core suite run
  // offline while production still defaults to Node's HTTPS implementation.
  config = config || loadConfig();
  var base = new URL(config.ENDPOINT);
  if (base.protocol !== 'https:') throw new Error('non-HTTPS endpoint refused');
  requestImpl = requestImpl || function(o, b) {
    return new Promise(function(resolve, reject) {
      var r = https.request(transportOptions(o, b ? b.length : 0), function(res) {
        var a = [];
        res.on('data', function(x) {
          a.push(x);
        });
        res.on('end', function() {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(a)
          });
        });
      });
      r.on('timeout', function() {
        r.destroy();
        reject(new Error('provider unavailable'));
      });
      r.on('error', function() {
        reject(new Error('provider unavailable'));
      });
      if (b && b.length) r.write(b);
      r.end();
    });
  };
  async function req(method, key, body, extra) {
    body = body || Buffer.alloc(0);
    var q = '';
    var raw = key || '';
    var qi = raw.indexOf('?');
    if (qi >= 0) {
      q = raw.slice(qi);
      raw = raw.slice(0, qi);
    }
    var pathname = '/' + enc(config.BUCKET) + (raw ? '/' + raw.split('/').map(enc).join('/') : '') + q;
    var url = new URL(pathname, base).toString();
    var amz = (new Date).toISOString().replace(/[:-]|\.\d{3}/g, '');
    var s = sign({
      method: method,
      url: url,
      headers: extra || {},
      amzDate: amz,
      payloadHash: sha(body),
      region: config.REGION,
      accessKey: config.ACCESS_KEY_ID,
      secret: config.SECRET_ACCESS_KEY
    });
    var r = await requestImpl({
      method: method,
      url: url,
      headers: s.headers
    }, body);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(r.status === 404 ? 'missing object' : 'provider request failed');
    }
    return r;
  }
  return {
    put: async function(k, b, m) {
      b = Buffer.from(b);
      var sum = m && m.sha256 || sha(b);
      var r = await req('PUT', k, b, {
        'x-amz-meta-sha256': sum
      });
      return {
        size: b.length,
        sha256: sum,
        response: r.status
      };
    },
    get: async function(k) {
      return (await req('GET', k)).body;
    },
    head: async function(k) {
      var r = await req('HEAD', k);
      var size = Number(r.headers['content-length']);
      var sum = r.headers['x-amz-meta-sha256'];
      if (!Number.isFinite(size) || !sum) throw new Error('remote metadata missing');
      return {
        size: size,
        sha256: sum
      };
    },
    list: async function(prefix) {
      var r = await req('GET', '?list-type=2&prefix=' + enc(prefix || ''));
      return r.body;
    },
    del: async function(k) {
      // S3 DELETE answers 204 (also for an already-absent key); req() accepts
      // any 2xx. Used by verification round-trips and explicitly authorised
      // maintenance only — core retention never calls this (report-only).
      var r = await req('DELETE', k);
      return {
        response: r.status
      };
    },
    capabilities: function() {
      return {
        put: true,
        get: true,
        head: true,
        list: true,
        delete: true,
        https_only: true
      };
    }
  };
}

module.exports = {
  create: create,
  loadConfig: loadConfig,
  sign: sign,
  signingKey: signingKey,
  transportOptions: transportOptions,
  DEFAULT_CONFIG: DEFAULT_CONFIG
};
