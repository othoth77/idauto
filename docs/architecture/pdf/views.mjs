// Print views: splits a diagram that is too large for an A4 page into parts, WITHOUT changing it.
// A part keeps a subset of the source's nodes (or classes, or entities) exactly as written, and every
// edge that touches them. An endpoint that belongs to another part is repeated in dashed outline
// (flowchart) or as an empty box (class / ER diagram), so no relation is lost.
// `node views.mjs` writes ./views/*.mmd and fails unless the parts of each split diagram together
// contain every node and every edge of the source.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIAGRAMS = join(here, '../diagrams');

export const SPLITS = {
  // Actors are context: drawn, but only their links to the use cases of the part are kept.
  'use-case': [
    { id: 'use-case-1', title: 'Authentification, consultation, administration et API machine', keep: ['AUTH', 'DSH', 'ADMN', 'APIU'], context: ['VIS', 'TEC', 'MGR', 'ADM', 'OPS', 'SVC'] },
    { id: 'use-case-2', title: 'Gestion des véhicules', keep: ['VEH'], context: ['TEC', 'MGR', 'ADM'] },
    { id: 'use-case-3', title: 'Carte grise (document d\'immatriculation)', keep: ['DOC'], context: ['TEC', 'MGR', 'ADM'] },
    { id: 'use-case-4', title: 'Interventions d\'entretien et pièces', keep: ['INT', 'PRT'], context: ['TEC', 'MGR', 'ADM'] },
  ],
  'class-diagram': [
    { id: 'class-diagram-1', title: 'Organisations, comptes et sessions', keep: ['Organisation', 'UserAccount', 'Credential', 'Session', 'Role'] },
    { id: 'class-diagram-2', title: 'Véhicule, plaques, faits et historique d\'identification', keep: ['Vehicle', 'Plate', 'VehicleFact', 'IdentificationHistory'] },
    { id: 'class-diagram-3', title: 'Carte grise, contact propriétaire et note d\'atelier', keep: ['RegistrationDocument', 'OwnerContact', 'VehicleNote'] },
    { id: 'class-diagram-4', title: 'Interventions, opérations, pièces et audit', keep: ['Intervention', 'Operation', 'PartSource', 'CataloguePart', 'AuditEntry'] },
  ],
  'class-modules': [
    { id: 'class-modules-1', title: 'Routes de l\'espace de travail et services métier', keep: ['workspace_routes', 'registration_service', 'intervention_service', 'vehicle_details', 'owner_contacts', 'workspace_repository'] },
    { id: 'class-modules-2', title: 'Service des documents et dépôt des véhicules', keep: ['document_service', 'vehicle_repository'] },
    { id: 'class-modules-3', title: 'Dépôt de l\'atelier, écritures auditées et accès à la base', keep: ['workshop_repository', 'writes', 'db'] },
  ],
  'logical-architecture': [
    { id: 'logical-architecture-1', title: 'Couche présentation', keep: ['PRES'] },
    { id: 'logical-architecture-2', title: 'Chaîne de traitement de l\'API — étapes 1 à 5', keep: ['ASSETS', 'PGATE', 'ASSETS2', 'PUB', 'BA'] },
    { id: 'logical-architecture-3', title: 'Chaîne de traitement de l\'API — étapes 6 à 9 et aiguillage vers les modules', keep: ['OWN', 'AUTHN', 'AUTHZ', 'ROUTES'], header: 'flowchart LR' },
    { id: 'logical-architecture-4', title: 'Couche métier', keep: ['BIZ'], directions: { BIZ: 'TB' }, header: 'flowchart LR' },
    { id: 'logical-architecture-5', title: 'Accès aux données, stockage, journaux et adaptateurs non configurés', keep: ['DATA', 'PGSQL', 'MEDIA', 'LOGS', 'TECDOC', 'VPROV'], header: 'flowchart LR' },
  ],
  'er-vehicle': [
    { id: 'er-vehicle-1', title: 'Véhicules et plaques', keep: ['vehicles', 'plates', 'plate_formats'] },
    { id: 'er-vehicle-2', title: 'Faits et preuves', keep: ['vehicle_facts', 'fact_evidence'] },
    { id: 'er-vehicle-3', title: 'Historique, carte grise, contacts et notes par organisation', keep: ['vehicle_identification_history', 'vehicle_documents', 'vehicle_owner_contacts', 'vehicle_notes'] },
    { id: 'er-vehicle-4', title: 'Vérifications et événements de service', keep: ['verifications', 'service_events'] },
  ],
  'er-capture': [
    { id: 'er-capture-1', title: 'Observations, médias et scans de documents', keep: ['observations', 'observation_media', 'document_scans'] },
    { id: 'er-capture-2', title: 'Localisations, soumissions, file de revue et consentements', keep: ['observation_locations', 'submissions', 'review_queue', 'consent_records'] },
    { id: 'er-capture-3', title: 'Sources de capture, sessions, contributeurs, caméras et mouvements', keep: ['capture_sources', 'capture_sessions', 'contributors', 'camera_sources', 'vehicle_movements'] },
  ],
  'sequence-intervention': [
    { id: 'sequence-intervention-1', title: 'Phase 1 — authentification et contrôle des droits (messages 1 à 7)', until: 'A->>R: postIntervention(req)' },
    { id: 'sequence-intervention-2', title: 'Phase 2 — service métier et transaction (messages 7 à 21)', from: 'A->>R: postIntervention(req)' },
  ],
};

const OP = /\s*(-\.\s*"[^"]*"\s*\.->|--\s*"[^"]*"\s*-->|-\.->|-->|---|==>)\s*/;

function stripFrontMatter(src) { return src.replace(/^---\n.*?\n---\n/s, ''); }

// ---------- flowchart ----------
function parseFlowchart(src) {
  const lines = stripFrontMatter(src).split('\n');
  const header = lines.shift();
  const nodes = new Map(); const subgraphs = new Map(); const edges = []; const stack = [];
  const root = { id: null, children: [], line: null, direction: null };
  const cur = () => (stack.length ? subgraphs.get(stack[stack.length - 1]) : root);
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^\s*subgraph\s+(\w+)/))) {
      const sg = { id: m[1], line: line.trim(), children: [], direction: null, parent: cur().id };
      cur().children.push({ sg: m[1] }); subgraphs.set(m[1], sg); stack.push(m[1]);
    } else if (/^\s*end\s*$/.test(line)) stack.pop();
    else if ((m = line.match(/^\s*direction\s+(\w+)/))) cur().direction = m[1];
    else if (OP.test(line)) {
      const parts = line.trim().split(OP);
      for (let i = 0; i + 2 < parts.length; i += 2) edges.push({ a: parts[i].trim(), op: parts[i + 1].trim(), b: parts[i + 2].trim() });
    } else if ((m = line.match(/^\s*([A-Za-z_]\w*)\s*[\[\(\{]/))) {
      nodes.set(m[1], { id: m[1], line: line.trim(), parent: cur().id }); cur().children.push({ node: m[1] });
    } else throw new Error('unparsed flowchart line: ' + line);
  }
  return { header, nodes, subgraphs, edges, root };
}

function nodesUnder(fc, sgId) {
  const out = [];
  for (const c of fc.subgraphs.get(sgId).children) out.push(...(c.node ? [c.node] : [c.sg, ...nodesUnder(fc, c.sg)]));
  return out;
}

function flowchartView(fc, keep, spec = {}) {
  const kept = new Set();
  for (const k of keep) {
    if (fc.subgraphs.has(k)) { kept.add(k); nodesUnder(fc, k).forEach((n) => kept.add(n)); }
    else if (fc.nodes.has(k)) kept.add(k);
    else throw new Error('unknown node ' + k);
  }
  // Context nodes are drawn without pulling in their other links: an edge is kept when it touches the
  // core of the part, or joins two context nodes (an actor generalisation, for instance).
  const ctx = new Set(spec.context || []);
  ctx.forEach((c) => { if (!fc.nodes.has(c)) throw new Error('unknown context node ' + c); });
  const edges = fc.edges.filter((e) => kept.has(e.a) || kept.has(e.b) || (ctx.has(e.a) && ctx.has(e.b)));
  const used = new Set(edges.flatMap((e) => [e.a, e.b]));
  ctx.forEach((c) => { if (used.has(c)) kept.add(c); });
  // A subgraph that is drawn (it holds a kept node) is an edge endpoint as it is; it is not repeated.
  const drawn = (x) => fc.subgraphs.has(x) && nodesUnder(fc, x).some((n) => kept.has(n));
  const ext = [...new Set(edges.flatMap((e) => [e.a, e.b]).filter((x) => !kept.has(x) && !drawn(x)))];
  const out = [spec.header || fc.header];
  const emit = (container, indent) => {
    for (const c of container.children) {
      if (c.node && kept.has(c.node)) out.push(indent + fc.nodes.get(c.node).line);
      if (c.sg) {
        const sg = fc.subgraphs.get(c.sg);
        const has = nodesUnder(fc, c.sg).some((n) => kept.has(n));
        if (!has) continue;
        out.push(indent + sg.line);
        const dir = (spec.directions || {})[c.sg] || sg.direction;
        if (dir) out.push(indent + '    direction ' + dir);
        emit(sg, indent + '    ');
        out.push(indent + 'end');
      }
    }
  };
  emit(fc.root, '    ');
  for (const x of ext) {
    if (fc.nodes.has(x)) out.push('    ' + fc.nodes.get(x).line + ':::ext');
    else { const sg = fc.subgraphs.get(x); out.push('    ' + sg.line.replace(/^subgraph\s+/, '') + ':::ext'); }
  }
  for (const e of edges) out.push(`    ${e.a} ${e.op} ${e.b}`);
  out.push('    classDef ext stroke-dasharray: 5 4');
  return { text: out.join('\n') + '\n', nodes: [...kept].filter((n) => fc.nodes.has(n)), edges };
}

// ---------- class diagram ----------
function parseClass(src) {
  const body = stripFrontMatter(src);
  const lines = body.split('\n'); const head = []; const classes = new Map(); const rels = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    if ((m = l.match(/^\s*class\s+(\w+)(\[[^\]]*\])?\s*\{\s*$/))) {
      const block = [l]; while (!/^\s*\}\s*$/.test(lines[i])) block.push(lines[++i]);
      classes.set(m[1], { id: m[1], label: m[2] || '', block: block.join('\n') });
    } else if (/^\s*(classDiagram|direction)\b/.test(l)) head.push(l);
    else if ((m = l.match(/^\s*(\w+)\s+(?:"[^"]*"\s+)?(?:<--|\*--|\.\.>|-->|<\|--)\s+(?:"[^"]*"\s+)?(\w+)/))) rels.push({ a: m[1], b: m[2], line: l });
    else if (l.trim()) throw new Error('unparsed class line: ' + l);
  }
  return { head, classes, rels };
}
function classView(cd, keep, spec = {}) {
  keep.forEach((k) => { if (!cd.classes.has(k)) throw new Error('unknown class ' + k); });
  const kept = new Set(keep);
  const rels = cd.rels.filter((r) => kept.has(r.a) || kept.has(r.b));
  const ext = [...new Set(rels.flatMap((r) => [r.a, r.b]).filter((x) => !kept.has(x)))];
  const out = [...cd.head];
  for (const [id, c] of cd.classes) if (kept.has(id)) out.push(c.block);
  for (const x of ext) out.push(`    class ${x}${cd.classes.get(x).label}`);
  rels.forEach((r) => out.push(r.line));
  return { text: out.join('\n') + '\n', nodes: keep, edges: rels };
}

// ---------- ER diagram ----------
function parseER(src) {
  const lines = stripFrontMatter(src).split('\n'); const ents = new Map(); const rels = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    if ((m = l.match(/^\s*(\w+)\s*\{\s*$/))) {
      const block = [l]; while (!/^\s*\}\s*$/.test(lines[i])) block.push(lines[++i]);
      ents.set(m[1], block.join('\n'));
    } else if ((m = l.match(/^\s*(\w+)\s+[|}o]{2}--[|{o]{2}\s+(\w+)\s*:/))) rels.push({ a: m[1], b: m[2], line: l });
    else if (l.trim() && !/^\s*erDiagram/.test(l)) throw new Error('unparsed ER line: ' + l);
  }
  return { ents, rels };
}
function erView(er, keep, spec = {}) {
  keep.forEach((k) => { if (!er.ents.has(k)) throw new Error('unknown entity ' + k); });
  const kept = new Set(keep);
  const rels = er.rels.filter((r) => kept.has(r.a) || kept.has(r.b));
  const out = ['erDiagram', ...keep.map((k) => er.ents.get(k)), ...rels.map((r) => r.line)];
  return { text: out.join('\n') + '\n', nodes: keep, edges: rels };
}


// ---------- sequence diagram ----------
// A sequence is split by message range: part 1 ends with the `until` message, part 2 starts with the
// `from` message (repeated, so the hand-over is visible). Only the participants a part uses are declared;
// autonumber continues from the right number. Every message must appear in at least one part.
function parseSeq(src) {
  const lines = stripFrontMatter(src).split('\n').filter((l) => l.trim());
  const head = []; const parts = new Map(); const body = [];
  for (const l of lines) {
    let m;
    if (/^\s*(sequenceDiagram|autonumber)\b/.test(l)) head.push(l);
    else if ((m = l.match(/^\s*(?:actor|participant)\s+(\w+)/))) parts.set(m[1], l);
    else body.push(l);
  }
  return { head, parts, body };
}
const MSG = /^\s*(\w+)\s*-{1,2}>>\s*(\w+)\s*:/;
function seqView(sq, _keep, spec) {
  const at = (needle) => { const i = sq.body.findIndex((l) => l.trim() === needle); if (i < 0) throw new Error('message not found: ' + needle); return i; };
  const lo = spec.from ? at(spec.from) : 0; const hi = spec.until ? at(spec.until) : sq.body.length - 1;
  const body = sq.body.slice(lo, hi + 1);
  const before = sq.body.slice(0, lo).filter((l) => MSG.test(l)).length;
  const used = new Set(body.flatMap((l) => { const m = l.match(MSG); return m ? [m[1], m[2]] : (l.match(/\b(?:over|of)\s+(\w+)/) || []).slice(1); }));
  const head = sq.head.map((l) => (/autonumber/.test(l) && before ? l.replace(/autonumber\b.*/, 'autonumber ' + (before + 1)) : l));
  const out = [...head, ...[...sq.parts].filter(([id]) => used.has(id)).map(([, l]) => l), ...body];
  return { text: out.join('\n') + '\n', nodes: [...used], edges: body.filter((l) => MSG.test(l)) };
}

export function buildViews() {
  const outDir = join(here, 'views');
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const [src, parts] of Object.entries(SPLITS)) {
    const text = readFileSync(join(DIAGRAMS, src + '.mmd'), 'utf8');
    const kind = stripFrontMatter(text).trim().split(/\s/)[0];
    const P = { flowchart: [parseFlowchart, flowchartView], classDiagram: [parseClass, classView], erDiagram: [parseER, erView], sequenceDiagram: [parseSeq, seqView] }[kind];
    const parsed = P[0](text); const view = P[1];
    const allNodes = kind === 'flowchart' ? [...parsed.nodes.keys()] : kind === 'classDiagram' ? [...parsed.classes.keys()] : kind === 'erDiagram' ? [...parsed.ents.keys()] : [...parsed.parts.keys()];
    const allEdges = kind === 'flowchart' ? parsed.edges : kind === 'sequenceDiagram' ? parsed.body.filter((l) => MSG.test(l)) : parsed.rels;
    const seenN = new Set(); const seenE = new Set();
    for (const p of parts) {
      const v = view(parsed, p.keep, p);
      v.nodes.forEach((n) => seenN.add(n)); v.edges.forEach((e) => seenE.add(e));
      writeFileSync(join(outDir, p.id + '.mmd'), `---\ntitle: "${p.title}"\n---\n` + v.text);
    }
    const missingN = allNodes.filter((n) => !seenN.has(n));
    const missingE = allEdges.filter((e) => !seenE.has(e)).map((e) => `${e.a}→${e.b}`);
    report.push({ source: src, parts: parts.length, nodes: allNodes.length, edges: allEdges.length, missingNodes: missingN, missingEdges: missingE });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildViews();
  console.log(JSON.stringify(r, null, 1));
  if (r.some((x) => x.missingNodes.length || x.missingEdges.length)) process.exit(1);
}
