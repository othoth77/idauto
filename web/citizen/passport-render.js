/* IDauto citizen UI — passport-render.js
 * Renders a Digital Vehicle Passport (protocol/schemas/passport.schema.json,
 * as emitted by reference/passport-assembly.js) into the IDauto Design System
 * passport document language.
 *
 * Honesty rules implemented here, not just documented:
 * - only fields present in the response are rendered — nothing is invented;
 * - trust_summary renders T0–T3 counts and the SEPARATE `anchored` count;
 *   the two are never merged (docs/TRUST_MODEL.md §2.1 forbids conflating);
 * - the completeness_note is rendered verbatim;
 * - qr payload is asserted to equal the requested IVID before rendering;
 * - every dynamic value lands via textContent (never via HTML string injection). */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IdaPassportRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUMMARY_LABELS = {
    make: "Marque", model: "Modèle", variant: "Variante", year: "Année",
    body_type: "Carrosserie", fuel_type: "Énergie", colour: "Couleur",
    category_code: "Catégorie"
  };
  /* vocabularies mirror the REAL schema constraints (database/schema.sql):
   * chk_vehicle_status and chk_fact_status — no invented states. */
  var STATUS_LABELS = {
    initial: ["Fiche initiale", "neutral"],
    pending_review: ["En revue", "pending"],
    verified: ["Vérifiée", "verified"],
    conflict: ["Conflit", "anomaly"],
    merged: ["Fusionnée", "neutral"],
    archived: ["Archivée", "neutral"]
  };
  var VERIF_LABELS = {
    unverified: ["Non vérifié", "neutral"],
    pending_review: ["En revue", "pending"],
    verified: ["Vérifié", "verified"],
    conflict: ["Conflit", "anomaly"],
    rejected: ["Rejeté", "anomaly"]
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function statusChip(value, table) {
    var entry = table[value] || [String(value), "neutral"];
    return el("span", "ida-status ida-status--" + entry[1], entry[0]);
  }

  /* QR as inline SVG (CSP img-src stays 'self'; no data: URI). Quiet zone:
   * 2 modules, per the vendored generator's own documented minimum for
   * reliable scanning at this size. */
  function renderQrSvg(payload) {
    var qrcodegen = (typeof self !== "undefined" ? self : root).qrcodegen;
    var qr = qrcodegen.QrCode.encodeText(payload, qrcodegen.QrCode.Ecc.MEDIUM);
    var border = 2;
    var size = qr.size + border * 2;
    var svgNs = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR du véhicule — encode l'IVID " + payload);
    var bg = document.createElementNS(svgNs, "rect");
    bg.setAttribute("width", String(size));
    bg.setAttribute("height", String(size));
    bg.setAttribute("class", "ida-qr-light");
    svg.appendChild(bg);
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) parts.push("M" + (x + border) + "," + (y + border) + "h1v1h-1z");
      }
    }
    var path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", parts.join(" "));
    path.setAttribute("class", "ida-qr-dark");
    svg.appendChild(path);
    return svg;
  }

  function renderPlate(plateNumber) {
    /* canonical "SSS TUN NNNN" → the Design System plate object */
    var m = /^([0-9]{1,3})\s?TUN\s?([0-9]{1,4})$/.exec(String(plateNumber || ""));
    var plate = el("span", "ida-plate ida-plate--sm");
    if (!m) { plate.appendChild(el("span", "", plateNumber)); return plate; }
    plate.appendChild(el("span", "", m[1]));
    plate.appendChild(el("span", "ida-plate-word", "تونس"));
    plate.appendChild(el("span", "", m[2]));
    return plate;
  }

  function section(labelText) {
    var s = el("section", "ida-passport-section");
    s.appendChild(el("h2", "ida-label", labelText));
    return s;
  }

  function humanizeFactKey(key) {
    return String(key).replace(/_/g, " ");
  }

  /* render(passport, requestedIvid) → DOM element */
  function render(passport, requestedIvid) {
    if (passport.qr && requestedIvid && passport.qr.payload !== requestedIvid) {
      throw new Error("passport-render: qr.payload does not match the requested IVID");
    }

    var article = el("article", "ida-passport");

    /* header */
    var header = el("header", "ida-passport-header ida-trame");
    var headLeft = el("div", "ida-stack");
    headLeft.appendChild(el("p", "ida-label", "Passeport Véhicule IDauto"));
    var summary = (passport.vehicle && passport.vehicle.summary) || {};
    var title = [summary.make, summary.model].filter(Boolean).join(" ") || "Véhicule";
    headLeft.appendChild(el("h1", "ida-h3", title));
    var ividRow = el("p", "ida-ivid");
    ividRow.appendChild(el("span", "", "IVID"));
    ividRow.appendChild(el("span", "", passport.ivid));
    var copyBtn = el("button", "ida-ivid-copy", "⧉");
    copyBtn.type = "button";
    copyBtn.setAttribute("data-copy", passport.ivid);
    copyBtn.setAttribute("data-copy-done", "IVID copié");
    copyBtn.setAttribute("aria-label", "Copier l'IVID");
    ividRow.appendChild(copyBtn);
    headLeft.appendChild(ividRow);
    header.appendChild(headLeft);

    var headRight = el("div", "ida-stack ida-u-center");
    if (Array.isArray(passport.plates) && passport.plates.length > 0) {
      /* PRIVATE phase only — the public assembly never includes plates */
      headRight.appendChild(renderPlate(passport.plates[0].plate_number));
    }
    if (passport.vehicle && passport.vehicle.status) {
      headRight.appendChild(statusChip(passport.vehicle.status, STATUS_LABELS));
    }
    header.appendChild(headRight);
    article.appendChild(header);

    /* identité technique */
    var ident = section("Identité");
    var dl = el("dl", "ida-passport-facts");
    Object.keys(SUMMARY_LABELS).forEach(function (key) {
      var v = summary[key];
      if (v === undefined || v === null || v === "") return;
      var wrap = el("div");
      wrap.appendChild(el("dt", "", SUMMARY_LABELS[key]));
      wrap.appendChild(el("dd", "", v));
      dl.appendChild(wrap);
    });
    if (passport.vehicle && passport.vehicle.created_at) {
      var wrapC = el("div");
      wrapC.appendChild(el("dt", "", "Fiche créée le"));
      wrapC.appendChild(el("dd", "ida-id", String(passport.vehicle.created_at).slice(0, 10)));
      dl.appendChild(wrapC);
    }
    if (passport.vehicle && typeof passport.vehicle.observation_count === "number") {
      var wrapO = el("div");
      wrapO.appendChild(el("dt", "", "Observations enregistrées"));
      wrapO.appendChild(el("dd", "ida-id", passport.vehicle.observation_count));
      dl.appendChild(wrapO);
    }
    ident.appendChild(dl);
    article.appendChild(ident);

    /* facts / preuves */
    var factsSection = section("Faits et vérification");
    var facts = Array.isArray(passport.facts) ? passport.facts : [];
    if (facts.length === 0) {
      var empty = el("div", "ida-empty");
      empty.appendChild(el("p", "", "Aucun fait n'est enregistré à ce niveau d'accès."));
      factsSection.appendChild(empty);
    } else {
      var grid = el("div", "ida-grid ida-grid-2");
      facts.forEach(function (fact) {
        var card = el("div", "ida-evidence");
        var vs = fact.verification_status;
        if (vs === "pending_review" || vs === "unverified") card.className += " ida-evidence--pending";
        if (vs === "conflict" || vs === "rejected" || (fact.anomalies && fact.anomalies.length)) card.className += " ida-evidence--anomaly";
        var body = el("div", "ida-stack");
        body.appendChild(el("p", "ida-label", humanizeFactKey(fact.fact_key)));
        body.appendChild(el("p", "", fact.fact_value));
        var meta = el("p", "ida-event-meta");
        meta.appendChild(statusChip(vs, VERIF_LABELS));
        if (typeof fact.confidence_score === "number") {
          meta.appendChild(el("span", "ida-caption", "confiance " + fact.confidence_score));
        }
        body.appendChild(meta);
        if (Array.isArray(fact.anomalies)) {
          fact.anomalies.forEach(function (a) {
            body.appendChild(el("p", "ida-caption", "Anomalie signalée" + (a && a.anomaly_type ? " — " + a.anomaly_type : "")));
          });
        }
        card.appendChild(body);
        grid.appendChild(card);
      });
      factsSection.appendChild(grid);
    }
    article.appendChild(factsSection);

    /* trust — T0–T3 + anchored SEPARATE (never merged) */
    if (passport.trust_summary) {
      var trustSection = section("Confiance — échelle du protocole");
      var row = el("div", "ida-u-row");
      ["T0", "T1", "T2", "T3"].forEach(function (level) {
        var count = passport.trust_summary[level];
        if (typeof count !== "number") return;
        var t = el("span", "ida-trust");
        t.appendChild(el("span", "ida-trust-level", level));
        t.appendChild(el("span", "ida-small", count + " fait(s)"));
        row.appendChild(t);
      });
      if (typeof passport.trust_summary.anchored === "number") {
        var anchored = el("span", "ida-status ida-status--neutral",
          "Ancrés : " + passport.trust_summary.anchored + " (intégrité, pas vérité)");
        row.appendChild(anchored);
      }
      trustSection.appendChild(row);
      article.appendChild(trustSection);
    }

    /* completeness — verbatim */
    if (passport.completeness_note) {
      var noteSection = section("Complétude");
      noteSection.appendChild(el("p", "ida-small ida-muted", passport.completeness_note));
      article.appendChild(noteSection);
    }

    /* QR — payload is the IVID, nothing else */
    if (passport.qr && passport.qr.payload) {
      var qrSection = section("Accès public");
      var qrRow = el("div", "ida-u-row-lg");
      var fig = el("figure", "ida-qr");
      var zone = el("div", "ida-qr-svg");
      zone.appendChild(renderQrSvg(passport.qr.payload));
      fig.appendChild(zone);
      var cap = el("figcaption", "ida-qr-caption", passport.qr.payload);
      fig.appendChild(cap);
      qrRow.appendChild(fig);
      qrRow.appendChild(el("p", "ida-small ida-muted ida-u-maxch-40",
        "Le QR encode uniquement l'IVID du véhicule. La consultation publique par plaque n'existe pas."));
      qrSection.appendChild(qrRow);
      article.appendChild(qrSection);
    }

    return article;
  }

  return { render: render, renderQrSvg: renderQrSvg, renderPlate: renderPlate };
});
