/* IDauto — homepage: « Rechercher par carte grise » (IDA-V14, home search)
 * ============================================================================
 * Reuses the V14 scanner in mode "identify": capture (camera / gallery /
 * Ctrl+V) → Scanic → perspective / crop → rotation → compression → OCR
 * fra+ara — all in the browser — then the raw reads go to the server, which
 * parses the TECHNICAL fields and looks the vehicle up: VIN (signed-in users
 * with the VIN right), then plate, then make / model. Nothing is stored and
 * no vehicle is created by a search.
 *
 * Signed in (V13 session cookie): POST /api/identify/registration-document.
 * Anonymous visitor: the plate read from the card goes through the same
 * public route the plate form uses (GET /public/plates/:plate); VIN and
 * make/model lookups need an account — the page says so and links to /login.
 * Nothing is kept in the browser; previews are blob: URLs.
 */
(function () {
  "use strict";
  var scanner = window.IdaRegistrationScanner;
  var root = document.querySelector("[data-cg-root]");
  var openBtn = document.querySelector("[data-cg-home-open]");
  var card = document.querySelector("[data-cg-home-result]");
  var live = document.getElementById("ida-live");
  if (!scanner || !root || !openBtn || !card) return;
  scanner.configure({ engineBase: "/assets/tesseract/", scanicUrl: "/assets/scanic.umd.js" });
  scanner.mount(root);
  openBtn.hidden = false;
  var $ = function (sel) { return card.querySelector(sel); };
  function say(t) { if (live) live.textContent = t; }
  function show(state) { card.hidden = false; card.setAttribute("data-state", state); ["found", "notfound", "signin", "error"].forEach(function (n) { var e = $("[data-cg-home-" + n + "]"); if (e) e.hidden = n !== state; }); card.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function text(sel, v) { var e = $(sel); if (e) e.textContent = v === null || v === undefined || v === "" ? "—" : String(v); }

  async function session() {
    try { var r = await fetch("/api/auth/get-session", { credentials: "same-origin", headers: { Accept: "application/json" } }); var s = r.ok ? await r.json() : null; return s && s.user ? s.user : null; } catch (e) { return null; }
  }
  async function identifySignedIn(reads) {
    var r = await fetch("/api/identify/registration-document", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-IDauto-Session": "1" }, body: JSON.stringify({ faces: reads }) });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 401) return { status: "signin" };
    if (!r.ok) throw new Error((j && j.message_fr) || "Le service a répondu " + r.status + ".");
    return j;
  }
  // Anonymous: only the plate can be looked up, through the public route.
  async function identifyAnonymous(reads) {
    var plate = null;
    // Canonical spelling (SSS TUN NNNN / SSS RS NNNN) for display, the prefill and the public route.
    reads.forEach(function (rd) { if (plate) return; var t = String(rd.text || "").replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }); var m = /(\d{1,4})\s*(TUN|TU|تونس|RS)\s*(\d{1,4})/i.exec(t); if (m) plate = m[1] + " " + (/^RS$/i.test(m[2]) ? "RS" : "TUN") + " " + m[3]; });
    if (!plate) return { status: "signin", reason: "no_plate" };
    var r = await fetch("/public/plates/" + encodeURIComponent(plate.replace(/\s+/g, " ")));
    if (r.status === 404) return { status: "not_found", identified_by: null, ocr: { registration: plate }, options: { search_plate: plate } };
    if (!r.ok) throw new Error("Le service a répondu " + r.status + ".");
    var j = await r.json();
    var passport = null; try { var p = await fetch("/public/passport/" + encodeURIComponent(j.ivid)); passport = p.ok ? await p.json() : null; } catch (e) {}
    var s = passport && passport.vehicle && passport.vehicle.summary ? passport.vehicle.summary : {};
    return { status: "found", identified_by: "plate", vehicle: { id: j.ivid, plate_display: j.plate_number, manufacturer: s.make, model: s.model, version: s.variant, motorisation: null, year: s.year }, ocr: { registration: plate } };
  }

  function renderFound(res) {
    var v = res.vehicle;
    text("[data-cg-home-plate]", v.plate_display || v.plate);
    text("[data-cg-home-make]", v.manufacturer); text("[data-cg-home-model]", [v.model, v.version].filter(Boolean).join(" ") || null);
    text("[data-cg-home-motor]", v.motorisation); text("[data-cg-home-ivid]", v.id);
    var vinRow = $("[data-cg-home-chassis-row]"); if (vinRow) { vinRow.hidden = !v.vin; text("[data-cg-home-chassis]", v.vin || null); }
    text("[data-cg-home-by]", { vin: "identifié par le numéro de châssis", plate: "identifié par la plaque", make_model: "identifié par marque et modèle" }[res.identified_by] || "");
    var a = $("[data-cg-home-passport]"); if (a) a.href = "/passport?ivid=" + encodeURIComponent(v.id);
    show("found"); say("Véhicule trouvé");
  }
  function renderNotFound(res) {
    var o = res.ocr || {}, opt = res.options || {};
    text("[data-cg-home-nf-plate]", o.registration); text("[data-cg-home-nf-make]", [o.manufacturer, o.model].filter(Boolean).join(" ") || null); var nfVin = $("[data-cg-home-nf-chassis-row]"); if (nfVin) { nfVin.hidden = !(o.vin && o.vin !== "(présent)"); text("[data-cg-home-nf-chassis]", o.vin && o.vin !== "(présent)" ? o.vin : null); } text("[data-cg-home-nf-year]", o.year);
    var plateLink = $("[data-cg-home-nf-plate-link]"); if (plateLink) { plateLink.hidden = !opt.search_plate; if (opt.search_plate) { plateLink.href = "#verif-title"; plateLink.setAttribute("data-plate", opt.search_plate); } }
    var vinLink = $("[data-cg-home-nf-chassis-link]"); if (vinLink) vinLink.href = "/atelier";
    var mmLink = $("[data-cg-home-nf-mm-link]"); if (mmLink) mmLink.href = "/atelier";
    show("notfound"); say("Véhicule introuvable");
  }
  // Prefill the plate form from the not-found card ("saisir / valider la plaque").
  card.addEventListener("click", function (e) {
    var t = e.target.closest("[data-cg-home-nf-plate-link]"); if (!t) return;
    var plate = t.getAttribute("data-plate") || ""; var m = /^(\d{1,3})\s(?:TUN|RS)\s(\d{1,4})$/.exec(plate);
    var serie = document.getElementById("plate-serie"), numero = document.getElementById("plate-numero");
    if (m && serie && numero) { serie.value = m[1]; numero.value = m[2]; serie.dispatchEvent(new Event("input", { bubbles: true })); numero.dispatchEvent(new Event("input", { bubbles: true })); }
  });

  async function onIdentify(reads) {
    show("error"); text("[data-cg-home-error]", "Identification en cours…");
    try {
      var user = await session();
      var res = user ? await identifySignedIn(reads) : await identifyAnonymous(reads);
      if (res.status === "found") return renderFound(res);
      if (res.status === "signin") { show("signin"); say("Connexion requise"); return; }
      renderNotFound(res);
    } catch (e) {
      text("[data-cg-home-error]", (e && e.message) || "La recherche n'a pas abouti. Réessayez dans un instant."); show("error");
    }
  }
  openBtn.addEventListener("click", function () { card.hidden = true; scanner.open({ root: root, mode: "identify", onIdentify: onIdentify }); });
})();
