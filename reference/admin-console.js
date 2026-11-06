'use strict';
/* IDauto — IDA-ADMIN-1 — shared helpers of the operator console pages
 * (/admin/vehicles, /admin/vehicle).
 *
 * RENDERING RULE: every value that came from the server is placed with
 * textContent (through el() below). No page of the console builds markup from
 * data — no innerHTML, no insertAdjacentHTML, no template string turned into
 * nodes — so a fact value, a workshop note or an organisation name that
 * contains markup is shown as text and never parsed. tests/ida-admin-registry
 * fails if any of the three console scripts uses one of those sinks.
 *
 * AUTH: the session cookie set at /login (HttpOnly, never readable here) plus
 * the header X-IDauto-Session: 1 on every API call (the CSRF belt of IDA-V13).
 * Nothing is read from or written to browser storage. */
(function (root) {
  var SESSION_HEADERS = { 'X-IDauto-Session': '1', Accept: 'application/json' };

  function toLogin(next) {
    window.location.replace('/login?next=' + encodeURIComponent(next || (window.location.pathname + window.location.search)));
  }

  // IDA-UI-3 — writes: JSON body (or raw bytes with their headers); a refusal carries the server's details.
  async function send(method, path, body, opts) {
    opts = opts || {};
    var headers = Object.assign({}, SESSION_HEADERS, opts.headers || {});
    if (body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json';
    var response = await fetch(path, { method: method, credentials: 'same-origin', headers: headers, body: body === undefined ? undefined : (opts.raw ? body : JSON.stringify(body)) });
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401) { toLogin(); throw new Error('Session expirée — reconnectez-vous.'); }
    if (!response.ok) throw Object.assign(new Error(data.message_fr || ('Le serveur n\'a pas pu répondre (' + response.status + '). Réessayez.')), { status: response.status, body: data });
    return data;
  }

  async function api(path) {
    var response = await fetch(path, { credentials: 'same-origin', headers: SESSION_HEADERS });
    var body = await response.json().catch(function () { return {}; });
    if (response.status === 401) { toLogin(); throw new Error('Session expirée — reconnectez-vous.'); }
    if (response.status === 403) throw Object.assign(new Error(body.message_fr || 'Accès réservé aux administrateurs.'), { status: 403 });
    if (response.status === 404) throw Object.assign(new Error(body.message_fr || 'Introuvable.'), { status: 404 });
    if (!response.ok) throw Object.assign(new Error(body.message_fr || 'Le serveur n\'a pas pu répondre (' + response.status + '). Réessayez.'), { status: response.status });
    return body;
  }

  // el('p', { class: 'x', dir: 'ltr' }, 'text' | node | [children])
  function el(tag, attrs, content) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === 'class') node.className = attrs[k];
      else if (k === 'hidden') node.hidden = true;
      else node.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]));
    });
    append(node, content);
    return node;
  }
  function append(node, content) {
    if (content === null || content === undefined) return node;
    if (Array.isArray(content)) { content.forEach(function (c) { append(node, c); }); return node; }
    if (typeof content === 'object' && content.nodeType) { node.appendChild(content); return node; }
    node.appendChild(document.createTextNode(String(content)));
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  var DASH = '—';
  function text(v) { return v === null || v === undefined || v === '' ? DASH : String(v); }
  // A mileage: Western digits, grouped, « km » (« كم » in Arabic). Kept left-to-right inside Arabic text.
  function km(n) {
    if (n === null || n === undefined || n === '') return DASH;
    var ar = root.IdAutoI18n && root.IdAutoI18n.lang() === 'ar';
    var s = Number(n).toLocaleString(ar ? 'ar-TN-u-nu-latn' : 'fr-FR') + (ar ? ' كم' : ' km');
    return typeof document !== 'undefined' ? el('bdi', { dir: 'ltr' }, s) : s;
  }
  function date(v, withTime) {
    if (!v) return DASH;
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    // The page language (i18n.js); Western digits in both.
    var loc = root.IdAutoI18n && root.IdAutoI18n.lang() === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-FR';
    return withTime ? d.toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(loc, { dateStyle: 'medium' });
  }

  // A plate keeps its left-to-right order whatever the surrounding direction
  // (the Arabic تونس between the digits would otherwise reorder them).
  function plate(display, canonical) {
    if (!display && !canonical) return el('span', { class: 'ida-muted' }, 'Aucune plaque');
    return el('bdi', { dir: 'ltr', class: 'ida-id ida-admin-plate', title: canonical || display, translate: 'no' }, display || canonical);
  }
  function id(value) { return el('code', { class: 'ida-id', translate: 'no' }, text(value)); }

  // Labels for values the schema actually allows — nothing invented.
  var LABELS = {
    verification_status: { unverified: 'Non vérifié', pending_review: 'En attente de revue', verified: 'Vérifié', conflict: 'Conflit', rejected: 'Rejeté' },
    fiche_status: { initial: 'Initiale', pending_review: 'En attente de revue', verified: 'Vérifiée', conflict: 'Conflit', merged: 'Fusionnée', archived: 'Archivée' },
    access_scope: { public: 'Public', professional: 'Professionnel', mythos_private: 'Restreint' },
    evidence_type: {
      user_confirmation: 'Déclaration de l\'utilisateur', document_scan: 'Appuyé par un document', professional_assertion: 'Attestation professionnelle',
      admin_validation: 'Validation administrateur', cross_source_match: 'Concordance entre sources', vin_decode: 'Décodage du numéro de châssis', automated_check: 'Contrôle automatique'
    },
    source_type: {
      public_upload: 'Envoi public', contributor_upload: 'Contributeur', smart_gate: 'Portique (Smart Gate)', professional_scan: 'Professionnel',
      manual_admin: 'Saisie administrateur', official_import: 'Import officiel', test: 'Test'
    },
    capture_method: {
      plate_scan: 'Scan de plaque', vehicle_scan: 'Scan du véhicule', carte_grise_scan: 'Scan de carte grise', smart_gate: 'Portique',
      manual_admin: 'Saisie administrateur', professional_scan: 'Scan professionnel', official_import: 'Import officiel'
    },
    observation_status: {
      received: 'Reçue', processing: 'En traitement', pending_confirmation: 'En attente de confirmation', pending_review: 'En attente de revue',
      accepted: 'Acceptée', rejected: 'Rejetée', duplicate: 'Doublon', conflict: 'Conflit', blocked: 'Bloquée'
    },
    plate_status: { active: 'Active', suspended: 'Suspendue', cancelled: 'Annulée', exported: 'Exportée', stolen: 'Déclarée volée', unknown: 'Inconnu' },
    visit_status: { open: 'Ouverte', in_progress: 'En cours', closed: 'Clôturée', cancelled: 'Annulée' },
    operation_type: { diagnosis: 'Diagnostic', replacement: 'Remplacement', service: 'Entretien', repair: 'Réparation', inspection: 'Contrôle', other: 'Autre' },
    operation_status: { planned: 'Prévue', done: 'Réalisée', cancelled: 'Annulée' },
    history_action: { resolved: 'Identifié', confirmed: 'Confirmé', edited: 'Modifié', refreshed: 'Actualisé', rejected: 'Rejeté' },
    actor_type: { system: 'Système', contributor: 'Contributeur', professional_user: 'Professionnel', admin: 'Administrateur', anonymous: 'Anonyme' },
    outcome: { pass: 'Conforme', fail: 'Non conforme', conditional: 'Sous réserve', informational: 'Information' },
    // IDA-UI-3 — the part source as DECLARED by the technician (no invoice is held by IDauto).
    // Shown as a DECLARATION wherever it is displayed: IDauto holds no sale or invoice, so « notre établissement »
    // is never presented as a proven purchase (client rule 2026-11-06). The radio buttons keep the plain wording.
    part_source: { our_shop: 'Achetée chez nous (déclarée)', customer_supplied: 'Fournie par le client (déclarée)', external_supplier: 'Autre fournisseur (déclarée, ancienne saisie)', unknown: 'Provenance non renseignée' },
    // Same declarations, short, for table cells.
    part_source_short: { our_shop: 'Achetée chez nous (déclarée)', customer_supplied: 'Fournie par le client (déclarée)', external_supplier: 'Autre fournisseur (déclarée)', unknown: 'Non renseignée' },
    part_condition: { new: 'Neuve', used: 'Occasion' },
    fuel_type: { petrol: 'Essence', diesel: 'Diesel', lpg: 'GPL', electric: 'Électrique', hybrid: 'Hybride', other: 'Autre' },
    role: { admin: 'Administrateur', manager: 'Gestionnaire', technician: 'Technicien' }
  };
  function label(group, value) {
    if (value === null || value === undefined || value === '') return DASH;
    var g = LABELS[group];
    // Labels come translated in the page language (i18n.js), so a label joined to other text stays whole.
    var tr = root.IdAutoI18n ? root.IdAutoI18n.t : function (x) { return x; };
    return g && Object.prototype.hasOwnProperty.call(g, value) ? tr(g[value]) : String(value);
  }

  // Badge tone from the Design System's four status tones.
  var TONE = { verified: 'verified', accepted: 'verified', done: 'verified', closed: 'verified', active: 'verified', pass: 'verified',
    conflict: 'anomaly', rejected: 'anomaly', stolen: 'anomaly', fail: 'anomaly', blocked: 'anomaly',
    pending_review: 'pending', pending_confirmation: 'pending', in_progress: 'pending', open: 'pending', planned: 'pending', conditional: 'pending' };
  function badge(group, value) {
    return el('span', { class: 'ida-status ida-status--' + (TONE[value] || 'neutral') }, label(group, value));
  }

  function state(node, kind, message) {
    clear(node);
    node.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
    var cls = kind === 'error' ? 'ida-alert ida-alert--danger' : kind === 'empty' ? 'ida-empty' : 'ida-muted';
    node.appendChild(el('p', { class: cls, role: kind === 'error' ? 'alert' : null }, message));
  }

  async function sessionLine(lineId, next) {
    var line = document.getElementById(lineId);
    var ROLE_FR = { admin: 'administrateur', manager: 'gestionnaire', technician: 'technicien' };
    var me = null;
    // The shell's shared session read when present (one /api/auth request per page).
    try { me = (window.IdAutoAdminShell ? await window.IdAutoAdminShell.session() : await fetch('/api/auth/get-session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (x) { return x.ok ? x.json() : null; })); } catch (e) { me = null; }
    if (!me || !me.user) { if (line) line.textContent = 'Vous n\'êtes pas connecté.'; toLogin(next); return null; }
    if (line) line.textContent = 'Connecté : ' + me.user.name + ' · ' + (ROLE_FR[me.user.role] || me.user.role);
    return me.user;
  }

  // A server refusal in words: its message, plus the field it concerns when known.
  var FIELD = { plate: 'Immatriculation', vin: 'Numéro de châssis (VIN)', make: 'Marque', model: 'Modèle', year: 'Année', engine_cc: 'Cylindrée', seats: 'Places',
    gross_weight_kg: 'Poids total', fuel_type: 'Énergie', category_code: 'Catégorie', 'owner.full_name': 'Nom du propriétaire', 'owner.phone': 'Téléphone du propriétaire',
    'owner.email': 'E-mail du propriétaire', part_source: 'Provenance de la pièce', performed_on: 'Date', quantity: 'Quantité', operation_type: 'Type d\'opération',
    odometer_km: 'Kilométrage', description: 'Description du travail effectué', technician: 'Technicien', notes: 'Informations complémentaires', org_id: 'Atelier', vehicle_ref: 'Véhicule' };
  var PART_FIELD = { label: 'nom de la pièce', source: 'provenance', quantity: 'quantité', reference: 'référence' };
  function errorText(e) {
    var d = e && e.body && e.body.details;
    var msg = (e && e.message) || 'La demande n\'a pas abouti.';
    if (d && d.field && FIELD[d.field]) msg += ' — ' + FIELD[d.field];
    var pm = d && d.field && /^parts\[(\d+)\]\.(\w+)$/.exec(d.field);
    if (pm) msg += ' — ' + 'Pièce ' + (Number(pm[1]) + 1) + ' : ' + (PART_FIELD[pm[2]] || pm[2]);
    if (d && d.reason === 'choose_source') msg = 'Choisissez la provenance de chaque pièce.' + (pm ? ' (Pièce ' + (Number(pm[1]) + 1) + ')' : '');
    if (d && d.reason === 'plate_required') msg = 'L\'immatriculation est obligatoire.';
    return msg;
  }

  root.IdAutoConsole = { api: api, send: send, errorText: errorText, FIELD: FIELD, el: el, append: append, clear: clear, text: text, date: date, km: km, plate: plate, id: id,
    label: label, badge: badge, state: state, sessionLine: sessionLine, LABELS: LABELS, DASH: DASH };
}(typeof window !== 'undefined' ? window : this));
