'use strict';
/* IDauto — IDA-ADMIN-1 — the vehicle dossier (/admin/vehicle?ref=<IVID|internal_ref>).
 * Reads GET /api/admin/vehicles/:ref/dossier. The only other call is the
 * explicit « Afficher le numéro de châssis » button, which goes through the
 * EXISTING GET /api/vehicles/:ref/fiche — that route writes the
 * vehicle.vin.read audit row before it answers. Nothing else is written. */
(function () {
  if (typeof document === 'undefined') return;
  var C = window.IdAutoConsole;
  var el = C.el;
  function $(id) { return document.getElementById(id); }
  var ref = (new URLSearchParams(window.location.search).get('ref') || '').trim().slice(0, 64);

  function table(caption, headers, rows) {
    if (!rows.length) return null;
    return el('table', { class: 'ida-table' }, [
      el('caption', { class: 'ida-sr-only' }, caption),
      el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { scope: 'col' }, h); }))),
      el('tbody', null, rows)
    ]);
  }
  function fill(id, node, emptyMessage) {
    var target = C.clear($(id));
    if (node) target.appendChild(node);
    else target.appendChild(el('p', { class: 'ida-empty' }, emptyMessage));
  }
  function dt(dl, term, value) { dl.appendChild(el('dt', null, term)); dl.appendChild(el('dd', null, value === null || value === undefined || value === '' ? C.DASH : value)); }
  function pct(x) { return x === null || x === undefined ? C.DASH : Math.round(Number(x) * 100) + ' %'; }

  function renderOverview(d) {
    var v = d.vehicle;
    $('title').textContent = [v.manufacturer, v.model, v.version].filter(Boolean).join(' ') || 'Véhicule sans désignation';
    var sub = C.clear($('subtitle'));
    sub.appendChild(C.id(v.id));
    sub.appendChild(C.plate(v.plate_display, v.plate));
    sub.appendChild(C.badge('fiche_status', v.fiche_status));
    document.title = 'IDauto — ' + (v.id || 'Dossier véhicule');

    var dl = C.clear($('overview'));
    dt(dl, 'Vehicle ID', C.id(v.id));
    dt(dl, 'Référence interne', C.id(v.internal_ref));
    dt(dl, 'Marque', v.manufacturer);
    dt(dl, 'Modèle', v.model);
    dt(dl, 'Version', v.version);
    dt(dl, 'Motorisation', v.motorisation);
    dt(dl, 'Code moteur', v.engine_code);
    dt(dl, 'Année', v.year ? String(v.year) : (v.year_from || v.year_to ? (v.year_from || '?') + '–' + (v.year_to || '?') : null));
    dt(dl, 'Carburant', v.fuel_type);
    dt(dl, 'Cylindrée', v.engine_cc ? v.engine_cc + ' cm³' : null);
    dt(dl, 'Carrosserie', v.body_type);
    dt(dl, 'Places', v.seats ? String(v.seats) : null);
    dt(dl, 'Poids total en charge', v.gross_weight_kg ? v.gross_weight_kg + ' kg' : null);
    dt(dl, 'Catégorie', v.category_code);
    dt(dl, 'Identification', v.verified ? 'Vérifiée' + (v.verified_at ? ' le ' + C.date(v.verified_at) : '') : 'Non vérifiée');
    dt(dl, 'Source de l\'identification', v.source ? v.source + (v.verification_method ? ' · ' + v.verification_method : '') : null);
    dt(dl, 'Confiance de l\'identification', v.confidence === null || v.confidence === undefined ? null : pct(v.confidence));
    dt(dl, 'Enregistré le', C.date(v.created_at, true));
    dt(dl, 'Modifié le', C.date(v.updated_at, true));

    $('vin-line').textContent = v.vin_present ? 'Un numéro de châssis est enregistré. Il n\'est pas affiché par défaut.' : 'Aucun numéro de châssis enregistré.';
    $('vin-reveal').hidden = !v.vin_present;
  }

  function renderPlates(d) {
    fill('plates', table('Plaques du véhicule', ['Plaque', 'Statut', 'Format', 'Validité', 'Enregistrée le', 'Fiche'], d.plates.map(function (p) {
      return el('tr', null, [
        el('th', { scope: 'row' }, C.plate(p.plate_display, p.plate)),
        el('td', null, C.badge('plate_status', p.status)),
        el('td', null, C.text(p.format_code)),
        el('td', null, (p.valid_from ? C.date(p.valid_from) : '?') + ' → ' + (p.valid_until ? C.date(p.valid_until) : 'en cours')),
        el('td', null, C.date(p.recorded_at)),
        el('td', null, p.via_alias ? ['Fiche fusionnée ', C.id(p.recorded_on)] : 'Cette fiche')
      ]);
    })), 'Aucune plaque enregistrée pour ce véhicule.');
  }

  function renderMaintenance(d) {
    var m = d.maintenance;
    var box = C.clear($('maintenance'));
    if (!m.visits.length && !m.service_events.length) {
      box.appendChild(el('p', { class: 'ida-empty' }, 'Aucune visite atelier ni aucun événement d\'entretien n\'est enregistré. ' +
        'Cela ne prouve pas qu\'aucune intervention n\'a eu lieu : seules les interventions déclarées à IDauto apparaissent ici.'));
      return;
    }
    var list = el('ol', { class: 'ida-timeline', 'aria-label': 'Chronologie d\'entretien, la plus récente en premier' });
    m.timeline.forEach(function (t) {
      if (t.kind === 'workshop_visit') {
        var w = m.visits.filter(function (x) { return x.id === t.visit_id; })[0];
        list.appendChild(el('li', { class: 'ida-event' }, [
          el('p', { class: 'ida-label' }, C.date(w.opened_at, true) + ' · ' + C.text(w.org_name || ('Organisation ' + w.org_id))),
          el('p', null, ['Visite atelier n° ' + w.id + ' ', C.badge('visit_status', w.status)]),
          w.reason ? el('p', { class: 'ida-small' }, 'Motif : ' + w.reason) : null,
          el('p', { class: 'ida-caption' }, 'Kilométrage : non enregistré · Client : ' + (w.customer_ref_present ? 'référence opaque de l\'atelier' : 'aucune référence') +
            (w.closed_at ? ' · clôturée le ' + C.date(w.closed_at, true) : '')),
          w.operations.length ? el('ul', { class: 'ida-stack' }, w.operations.map(function (o) {
            return el('li', null, [
              C.badge('operation_status', o.status), ' ',
              el('strong', null, C.label('operation_type', o.operation_type)),
              o.description ? ' — ' + o.description : '',
              o.part ? el('span', { class: 'ida-caption ida-u-block' }, 'Pièce : ' + [o.part.brand, o.part.reference, o.part.name].filter(Boolean).join(' · ') + ' × ' + o.quantity) : null
            ]);
          })) : el('p', { class: 'ida-caption' }, 'Aucune opération saisie pour cette visite.')
        ]));
      } else {
        var e = m.service_events.filter(function (x) { return x.id === t.event_id; })[0];
        list.appendChild(el('li', { class: 'ida-event' }, [
          el('p', { class: 'ida-label' }, C.date(e.event_date) + ' · ' + C.text(e.org_name || ('Organisation ' + e.org_id))),
          el('p', null, ['Événement d\'entretien : ' + C.text(e.event_type) + ' ', e.outcome ? C.badge('outcome', e.outcome) : null]),
          e.description ? el('p', { class: 'ida-small' }, e.description) : null,
          el('p', { class: 'ida-caption' }, 'Kilométrage : ' + (e.odometer_km === null || e.odometer_km === undefined ? 'non enregistré' : e.odometer_km.toLocaleString('fr-FR') + ' km') +
            (e.next_service_due ? ' · prochain entretien prévu le ' + C.date(e.next_service_due) : '') +
            ' · ' + (e.is_public ? 'visible des autres organisations' : 'propre à l\'organisation'))
        ]));
      }
    });
    box.appendChild(list);
  }

  function renderFacts(d) {
    fill('facts', table('Données enregistrées', ['Donnée', 'Valeur', 'Vérification', 'Preuves', 'Source', 'Confiance', 'Portée', 'Vue le'], d.facts.map(function (f) {
      return el('tr', { class: f.is_active ? null : 'ida-admin-superseded' }, [
        el('th', { scope: 'row' }, [C.text(f.fact_key), f.is_active ? null : el('span', { class: 'ida-caption ida-u-block' }, 'remplacée')]),
        el('td', null, el('bdi', null, C.text(f.fact_value))),
        el('td', null, C.badge('verification_status', f.verification_status)),
        el('td', null, f.evidence.length ? el('ul', null, f.evidence.map(function (e) { return el('li', null, C.label('evidence_type', e.evidence_type)); }))
          : el('span', { class: 'ida-muted' }, 'Aucune preuve — déclaratif')),
        el('td', null, f.source ? C.label('source_type', f.source.source_type) + ' (' + f.source.code + ')' : C.DASH),
        el('td', null, pct(f.confidence_score)),
        el('td', null, C.label('access_scope', f.access_scope)),
        el('td', null, C.date(f.last_seen_at))
      ]);
    })), 'Aucune donnée publique ou professionnelle enregistrée.');
    $('restricted').textContent = d.restricted_fact_count
      ? d.restricted_fact_count + ' donnée(s) à portée restreinte (dont le numéro de châssis le cas échéant) ne sont pas affichées ici.'
      : '';
    fill('observations', table('Observations', ['N°', 'Statut', 'Méthode', 'Source', 'Organisation'], d.observations.map(function (o) {
      return el('tr', null, [
        el('th', { scope: 'row' }, String(o.id)),
        el('td', null, C.badge('observation_status', o.status)),
        el('td', null, C.label('capture_method', o.capture_method)),
        el('td', null, C.label('source_type', o.source_type)),
        el('td', null, o.org_id === null ? 'IDauto (administration)' : 'Organisation ' + o.org_id)
      ]);
    })), 'Aucune observation enregistrée.');
  }

  function renderDocuments(d) {
    fill('documents', d.documents.length ? el('ul', { class: 'ida-stack' }, d.documents.map(function (doc) {
      return el('li', null, (doc.document_type === 'carte_grise' ? 'Carte grise' : doc.document_type) + ' — face ' + doc.face +
        ' · ' + doc.width + '×' + doc.height + ' px · ' + Math.round(doc.byte_size / 1024) + ' Ko · OCR : ' + doc.ocr_status +
        ' · déposée par ' + (doc.org_name || 'l\'administration') + ' le ' + C.date(doc.recorded_at, true));
    })) : null, 'Aucun document enregistré. Les images restent dans le stockage privé ; elles s\'ouvrent depuis le passeport, connecté.');
  }

  function renderIdentification(d) {
    fill('aliases', d.aliases.length ? el('div', { class: 'ida-stack' }, [
      el('p', { class: 'ida-small' }, d.aliases.length + ' fiche(s) fusionnée(s) dans celle-ci — leurs références restent valides et désignent ce véhicule :'),
      el('ul', null, d.aliases.map(function (a) { return el('li', null, [C.id(a.ivid), ' (', C.id(a.internal_ref), ') → ', C.id(a.merged_into)]); }))
    ]) : null, 'Aucune fiche fusionnée dans celle-ci.');
    fill('identification', table('Historique d\'identification', ['Date', 'Action', 'Méthode', 'Source', 'Confiance', 'Acteur'], d.identification_history.map(function (h) {
      return el('tr', null, [
        el('th', { scope: 'row' }, C.date(h.at, true)),
        el('td', null, C.label('history_action', h.action)),
        el('td', null, C.text(h.method)),
        el('td', null, C.text(h.source)),
        el('td', null, pct(h.confidence)),
        el('td', null, C.label('actor_type', h.actor_type) + (h.org_id ? ' · organisation ' + h.org_id : ''))
      ]);
    })), 'Aucun événement d\'identification enregistré (fiche créée avant l\'historique, ou par saisie manuelle).');
  }

  function renderQuality(d) {
    var q = d.quality;
    var box = C.clear($('quality'));
    var items = [];
    if (q.conflict_facts) items.push(el('li', null, q.conflict_facts + ' donnée(s) marquée(s) en conflit.'));
    if (q.pending_review_facts) items.push(el('li', null, q.pending_review_facts + ' donnée(s) en attente de revue.'));
    q.disagreements.forEach(function (x) { items.push(el('li', null, '« ' + x.fact_key + ' » : ' + x.distinct_active_values + ' valeurs actives différentes.')); });
    if (q.pending_observations) items.push(el('li', null, [q.pending_observations + ' observation(s) à revoir — ', el('a', { href: '/admin/review' }, 'ouvrir la file de revue')]));
    if (q.alias_count) items.push(el('li', null, q.alias_count + ' fiche(s) fusionnée(s) dans celle-ci.'));
    if (!items.length) box.appendChild(el('p', { class: 'ida-empty' }, 'Aucun conflit ni aucune revue en attente n\'est enregistré pour ce véhicule.'));
    else box.appendChild(el('ul', { class: 'ida-stack' }, items));
    box.appendChild(el('p', { class: 'ida-caption' }, 'Les décisions (revue, fusion, séparation) passent par les opérations auditées existantes ; ' +
      'cette page n\'offre aucun bouton de modification.'));
  }

  function renderAudit(d) {
    fill('audit', table('Journal d\'audit', ['Date', 'Événement', 'Acteur', 'Cible', 'Résumé'], d.audit.map(function (a) {
      return el('tr', null, [
        el('th', { scope: 'row' }, C.date(a.at, true)),
        el('td', null, el('code', { class: 'ida-id' }, a.event_type)),
        el('td', null, C.label('actor_type', a.actor_type) + (a.org_id ? ' · organisation ' + a.org_id : '')),
        el('td', null, C.text(a.target_type)),
        el('td', null, C.text(a.summary))
      ]);
    })), 'Aucune entrée d\'audit trouvée pour ce véhicule.');
  }

  async function revealVin() {
    var button = $('vin-reveal');
    var out = $('vin-result');
    button.disabled = true;
    out.textContent = 'Lecture auditée en cours…';
    try {
      var fiche = await C.api('/api/vehicles/' + encodeURIComponent(ref) + '/fiche');
      C.clear(out);
      C.append(out, ['Numéro de châssis : ', C.id(fiche.vin || null), ' — cette lecture a été enregistrée au journal d\'audit.']);
      button.hidden = true;
    } catch (err) {
      out.textContent = err.message;
      button.disabled = false;
    }
  }

  (async function start() {
    var stateBox = $('page-state');
    var user = await C.sessionLine('session-line', '/admin/vehicle?ref=' + encodeURIComponent(ref));
    if (!user) return;
    if (!ref) { $('title').textContent = 'Dossier véhicule'; C.state(stateBox, 'error', 'Aucun véhicule demandé. Ouvrez un dossier depuis le registre.'); return; }
    C.state(stateBox, 'loading', 'Chargement du dossier…');
    try {
      var d = await C.api('/api/admin/vehicles/' + encodeURIComponent(ref) + '/dossier');
      C.clear(stateBox);
      stateBox.setAttribute('aria-busy', 'false');
      if (d.requested_alias) {
        $('alias-text').textContent = 'La référence ' + d.requested_alias + ' désigne une fiche fusionnée ; voici le véhicule auquel elle appartient désormais.';
        $('alias-note').hidden = false;
      }
      $('completeness').textContent = d.completeness_note;
      renderOverview(d); renderPlates(d); renderMaintenance(d); renderFacts(d);
      renderDocuments(d); renderIdentification(d); renderQuality(d); renderAudit(d);
      $('dossier').hidden = false;
      $('vin-reveal').addEventListener('click', revealVin);
    } catch (err) {
      $('title').textContent = err.status === 404 ? 'Véhicule introuvable' : 'Dossier indisponible';
      C.state(stateBox, 'error', err.status === 404 ? 'Aucun véhicule ne porte cette référence. Il n\'est peut-être pas encore enregistré.' : err.message);
    }
  }());
}());
