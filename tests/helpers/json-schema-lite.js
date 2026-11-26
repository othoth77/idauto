'use strict';
/* A small JSON Schema (draft 2020-12) checker for the contract suites.
 *
 * Why not a library: the repository has three runtime dependencies and no
 * devDependency, and the contract (docs/contracts/*.openapi.json) uses a small,
 * fixed subset of the vocabulary. This checker implements exactly that subset
 * and THROWS on any keyword it does not know, so a schema can never rely on a
 * keyword that is silently ignored here. tests/ida-openapi-contract-test.js
 * proves it rejects what it must (§1) before trusting it to accept anything.
 *
 * $ref forms: "#/json/pointer" (same document), "relative/file.json[#pointer]"
 * (resolved against the referring file), and an absolute $id of any schema
 * registered with addSchemaDir() (the protocol schemas reference each other
 * that way).
 *
 * Keywords starting with "x-" are vendor annotations (OpenAPI extensions, and
 * x-serverDerived in protocol/schemas) and are ignored, as 2020-12 ignores
 * unknown keywords; every other unknown keyword throws.
 */
var fs = require('fs');
var path = require('path');

var ANNOTATIONS = ['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly'];
var KEYWORDS = ['$ref', 'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'unevaluatedProperties',
  'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format',
  'allOf', 'anyOf', 'oneOf', 'not'];

function createChecker() {
  var docs = {};   // absolute file path -> parsed document
  var ids = {};    // $id -> { file }

  function load(file) {
    file = path.resolve(file);
    if (!docs[file]) {
      docs[file] = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (docs[file].$id) ids[docs[file].$id] = file;
    }
    return docs[file];
  }

  function addSchemaDir(dir) {
    fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) { load(path.join(dir, f)); });
  }

  function pointer(root, frag, where) {
    if (!frag || frag === '/') return root;
    var node = root;
    frag.replace(/^\//, '').split('/').forEach(function (raw) {
      var key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (node === null || typeof node !== 'object' || !(key in node)) throw new Error('unresolvable $ref pointer #' + frag + ' in ' + where);
      node = node[key];
    });
    return node;
  }

  // -> { schema, file }
  function resolveRef(ref, file) {
    var hash = ref.indexOf('#');
    var target = hash === -1 ? ref : ref.slice(0, hash);
    var frag = hash === -1 ? '' : ref.slice(hash + 1);
    var targetFile;
    if (!target) targetFile = file;
    else if (/^https?:\/\//.test(target)) {
      targetFile = ids[target];
      if (!targetFile) throw new Error('unknown $id ' + target + ' (referenced from ' + file + ')');
    } else targetFile = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(targetFile)) throw new Error('$ref ' + ref + ' points at a missing file (from ' + file + ')');
    return { schema: pointer(load(targetFile), frag, targetFile), file: targetFile };
  }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return typeof v;
  }
  function typeMatches(t, v) {
    var actual = typeOf(v);
    return t === actual || (t === 'number' && actual === 'integer');
  }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* Returns { errors: [...], evaluated: {propName: true} } */
  function check(schema, value, file, at) {
    var errors = [], evaluated = {};
    if (schema === true) return { errors: errors, evaluated: evaluated };
    if (schema === false) return { errors: [at + ': no value is allowed here'], evaluated: evaluated };
    if (!schema || typeof schema !== 'object') throw new Error('not a schema at ' + at + ' in ' + file);
    Object.keys(schema).forEach(function (k) {
      if (KEYWORDS.indexOf(k) === -1 && ANNOTATIONS.indexOf(k) === -1 && k.indexOf('x-') !== 0) throw new Error('unsupported keyword "' + k + '" at ' + at + ' in ' + file);
    });
    function sub(s, v, where, f) { return check(s, v, f || file, where); }
    function merge(r) { Object.keys(r.evaluated).forEach(function (k) { evaluated[k] = true; }); }

    if (schema.$ref !== undefined) {
      var target = resolveRef(schema.$ref, file);
      var rr = sub(target.schema, value, at, target.file);
      errors = errors.concat(rr.errors);
      if (!rr.errors.length) merge(rr);
    }
    if (schema.type !== undefined) {
      var types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some(function (t) { return typeMatches(t, value); })) errors.push(at + ': expected ' + types.join('|') + ', got ' + typeOf(value));
    }
    if (schema.enum !== undefined && !schema.enum.some(function (e) { return equal(e, value); })) errors.push(at + ': ' + JSON.stringify(value) + ' is not one of ' + JSON.stringify(schema.enum));
    if (schema.const !== undefined && !equal(schema.const, value)) errors.push(at + ': expected ' + JSON.stringify(schema.const) + ', got ' + JSON.stringify(value));
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(at + ': shorter than ' + schema.minLength);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(at + ': longer than ' + schema.maxLength);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errors.push(at + ': ' + JSON.stringify(value) + ' does not match ' + schema.pattern);
      if (schema.format === 'date-time' && !(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !isNaN(Date.parse(value)))) errors.push(at + ': ' + JSON.stringify(value) + ' is not an RFC 3339 date-time');
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(at + ': below ' + schema.minimum);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(at + ': above ' + schema.maximum);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(at + ': fewer than ' + schema.minItems + ' items');
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(at + ': more than ' + schema.maxItems + ' items');
      if (schema.items !== undefined) value.forEach(function (item, i) { errors = errors.concat(sub(schema.items, item, at + '[' + i + ']').errors); });
    }
    if (typeOf(value) === 'object') {
      (schema.required || []).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(value, k)) errors.push(at + ': missing required property "' + k + '"'); });
      var props = schema.properties || {};
      Object.keys(value).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(props, k)) {
          errors = errors.concat(sub(props[k], value[k], at + '.' + k).errors);
          evaluated[k] = true;
        } else if (schema.additionalProperties !== undefined) {
          errors = errors.concat(sub(schema.additionalProperties, value[k], at + '.' + k).errors.map(function (e) {
            return schema.additionalProperties === false ? at + ': property "' + k + '" is not allowed' : e;
          }));
          evaluated[k] = true;
        }
      });
    }
    if (schema.allOf) schema.allOf.forEach(function (s, i) { var r = sub(s, value, at + '/allOf' + i); errors = errors.concat(r.errors); if (!r.errors.length) merge(r); });
    if (schema.anyOf) {
      var anyOk = schema.anyOf.map(function (s) { return sub(s, value, at); }).filter(function (r) { return !r.errors.length; });
      if (!anyOk.length) errors.push(at + ': matches none of anyOf'); else anyOk.forEach(merge);
    }
    if (schema.oneOf) {
      var results = schema.oneOf.map(function (s) { return sub(s, value, at); });
      var oneOk = results.filter(function (r) { return !r.errors.length; });
      if (oneOk.length !== 1) {
        errors.push(at + ': matches ' + oneOk.length + ' of oneOf (exactly 1 required)' + (oneOk.length ? '' : ' — closest: ' +
          results.slice().sort(function (a, b) { return a.errors.length - b.errors.length; })[0].errors.slice(0, 3).join('; ')));
      } else merge(oneOk[0]);
    }
    if (schema.not !== undefined && !sub(schema.not, value, at).errors.length) errors.push(at + ': matches a schema it must not match');
    if (schema.unevaluatedProperties !== undefined && typeOf(value) === 'object') {
      Object.keys(value).forEach(function (k) {
        if (evaluated[k]) return;
        if (schema.unevaluatedProperties === false) errors.push(at + ': property "' + k + '" is not allowed');
        else errors = errors.concat(sub(schema.unevaluatedProperties, value[k], at + '.' + k).errors);
        evaluated[k] = true;
      });
    }
    return { errors: errors, evaluated: evaluated };
  }

  /* Walk every schema reachable from `node` (in `file`), resolving every $ref
   * and checking every keyword is supported — without any instance. */
  function lint(node, file, at, seen) {
    seen = seen || {};
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (n, i) { lint(n, file, at + '[' + i + ']', seen); }); return; }
    if (node.$ref !== undefined) {
      var t = resolveRef(node.$ref, file);
      var key = t.file + '#' + node.$ref;
      if (!seen[key]) { seen[key] = true; lint(t.schema, t.file, node.$ref, seen); }
    }
    Object.keys(node).forEach(function (k) {
      if (KEYWORDS.indexOf(k) === -1 && ANNOTATIONS.indexOf(k) === -1 && k.indexOf('x-') !== 0) throw new Error('unsupported keyword "' + k + '" at ' + at + ' in ' + file);
    });
    ['properties'].forEach(function (k) { if (node[k]) Object.keys(node[k]).forEach(function (p) { lint(node[k][p], file, at + '.' + p, seen); }); });
    ['additionalProperties', 'unevaluatedProperties', 'items', 'not'].forEach(function (k) { if (node[k] && typeof node[k] === 'object') lint(node[k], file, at + '/' + k, seen); });
    ['allOf', 'anyOf', 'oneOf'].forEach(function (k) { if (node[k]) lint(node[k], file, at + '/' + k, seen); });
  }

  return {
    load: load,
    addSchemaDir: addSchemaDir,
    resolveRef: resolveRef,
    validate: function (schema, value, file) { return check(schema, value, path.resolve(file), '$').errors; },
    lint: function (schema, file, at) { lint(schema, path.resolve(file), at || '$'); }
  };
}

module.exports = { createChecker: createChecker };
