# Client restructuring — five areas (2026-11-06)

**Scope:** the five areas the client asked for, and nothing else: dashboard, vehicle file, workshops, parts and
settings, in a menu of five sections. Existing tables, authentication, permissions, media storage and audit are reused.

- **No new table, column, migration or dependency.**
- **No page was removed.**
- **One page was added:** « Ateliers » (`/atelier/ateliers`).

## 1. Audit: what already existed, and what changed

| Area | Existed before | What changed |
|---|---|---|
| Dashboard | `GET /api/workspace/overview` (workshop users); admins were sent to `/admin/dashboard` (console indicators: audit, quality, observations) | One dashboard for every role with the five numbers asked for, each linked to its list. The console page stays under Paramètres (« Indicateurs de la console ») |
| Vehicle file | `/atelier/vehicule?ref=` + `GET /api/vehicles/:ref/dossier`: identity and technical fields, VIN (`vin:search`, audited), plates, Face 1 / Face 2 (private, own workshop), owner on request (audited), maintenance history (date, workshop, technician, work, parts) | **Nothing**: it already covers the request. OCR is not reintroduced |
| Workshops | `/admin/sources`: admin only, a list of organisations with counts. **No page showed a workshop's vehicles and repairs** | New page `/atelier/ateliers` (list → `?id=` detail) over existing records: `idauto_organizations`, `idauto_workshop_visits`, `idauto_workshop_operations`, `idauto_auth_user` |
| Parts | `/atelier/pieces-remplacees`: fitted parts with the declared source | Totals per source (database counts), workshop column, « source not recorded » shown as such, source displayed as a **declaration**, admin `?org=` filter |
| Settings | `/atelier/compte` (language, theme, password, sessions), `/admin/utilisateurs`, `/admin/roles`, `/admin/security`, `/admin/sources` | Grouped under « Paramètres »; no new screen |

**Menu (`reference/admin-shell.js`).** Nine sections became five. Every page of the previous menu keeps an entry, which
is enforced by `tests/ida-restructure-test.js` §4.

| Section | Entries (role) |
|---|---|
| Tableau de bord | Tableau de bord (all) |
| Véhicules | Véhicules, Ajouter un véhicule, Cartes grises (all); Registre (console), Qualité des données, Vérification et validation, Saisie technique (avancée) (admin) |
| Ateliers | Ateliers, Interventions (all); Techniciens (manager, admin); Historique de maintenance (console) (admin) |
| Pièces | Pièces posées, Catalogue des pièces (all) |
| Paramètres | Mon compte (all); Utilisateurs, Rôles et permissions, Journal d'activité et audit, Sources de données, Indicateurs de la console (admin) |

## 2. Dashboard: what each number counts

Scope: an admin sees every workshop; a manager or technician sees their own workshop only. Each number is the total
of the list it links to, and the tests check both equalities.

| Number | Counted in the database | Links to |
|---|---|---|
| Véhicules enregistrés | `idauto_vehicles` not merged (own workshop: the vehicles it visited, registered, documented or holds an owner contact for) | `/atelier/vehicules` |
| Véhicules avec données | the same, restricted to vehicles **with available data** (definition below) | `/atelier/vehicules?with_data=1` |
| Ateliers enregistrés | `idauto_organizations` whose status is not `cancelled` (own workshop: 1) | `/atelier/ateliers` |
| Interventions enregistrées | `idauto_workshop_visits`, every status | `/atelier/interventions` |
| Pièces enregistrées | `idauto_workshop_operations` that record a part (catalogue part, label or reference): **not** the catalogue | `/atelier/pieces-remplacees` |

**Definition chosen for « avec données » (open point D-1).** IDauto had no such notion. A vehicle counts when it
has at least one of:
- an identification or technical field (make, model, version, year, body, fuel, seats, weight, engine size, category);
- an active fact;
- a carte grise photo;
- an intervention.

Photos and interventions count only when the account may see them. A bare record, for example a plate seen by a
camera with nothing else, does not count. The definition sits in one place, `vehicleDataClause()` in
`workspace-repository.js`, which serves both the count and the filtered list.

## 3. Vehicle file

Unchanged. It already shows:
- every identification and technical field held;
- the VIN to accounts with `vin:search`, with each read audited;
- the plates;
- Face 1 and Face 2, which are private, visible to the uploading workshop and admins only, and served only by an
  authenticated route;
- the owner, shown on request: name, phone, e-mail, address and notes; own workshop and admins; every read audited
  (PRIVACY_ARCHITECTURE §1a);
- the maintenance history: date, workshop, technician, work done, parts and their source.

## 4. Workshops

`GET /api/workspace/workshops[/:id]`, scope `workshop:read`.
- An admin sees every workshop not cancelled.
- A manager or technician sees their own workshop, and opening « Ateliers » goes straight to it. Any other id
  answers 404.

The detail page shows:
- name, type, status, city and governorate;
- number of accounts;
- the vehicles it worked on (interventions, last date);
- every intervention, with its date, work done and parts;
- its technicians, only for roles with `team:read` (manager, admin), as on « Techniciens ».

**Open point D-2: the workshop's contact e-mail is not shown.** The existing rule IDA-ADMIN-3 (ADMIN_CONSOLE §9) has
never returned an organisation's contact e-mail or tax id, only whether one is recorded. The page follows that rule and
shows « Enregistré (non affiché) ». Showing the e-mail is a privacy-policy change; it needs the owner's decision, and
is then a one-line change in `workshopRows()`. No phone number is stored for a workshop.

Not added, as the client asked: finance, scheduling, staff management, approvals.

## 5. Parts

For each part fitted at an intervention the page shows:
- date, part, reference and quantity;
- vehicle, intervention and workshop;
- source, condition and technician.

Totals per source are counted over the same scope.

**Business rules applied.**
- **Every source is a declaration.** It is the technician's choice at the intervention (radio buttons, workflow
  unchanged). IDauto holds **no sale and no invoice**, so « achetée auprès de notre établissement » is displayed as
  **(déclarée)** and never as a proven purchase.
- **Missing sources are not guessed.** An operation recorded before the source existed (IDA-V12) shows « Provenance
  non renseignée »; no source is invented for it.
- **A catalogue entry is not a purchase**, and a supplier order is not a fitted part. Neither is counted as one.

**Open point D-3: price.** No price is recorded for a fitted part, so the page shows no price column. The only prices
in the database are:
- `idauto_org_stock.price_millimes`, a workshop's stock price;
- `idauto_workshop_order_lines.unit_price_millimes`, a supplier order line.

Neither is linked to an intervention, so showing either one as the price of a fitted part would invent it. Recording
a sale price per fitted part would need a new column and a business rule (who sets it, and with which invoice). That
is the owner's call, and outside this update.

Not added, as the client asked: Piece.Autos, Casse.Autos, supplier integrations.

## 6. Settings

No new screen. Paramètres groups:
- the existing account page (language FR/AR, theme, password, sessions);
- users and roles (read-only on the web, managed with `ops/auth-users.js`);
- the audit log;
- data sources;
- the console indicators.

## 7. Tests

| File | Result |
|---|---|
| New `tests/ida-restructure-test.js` (in `test:db`) | 59/0 |
| `tests/ida-ui-browser-test.js`, extended | 69 passed, 1 failed — see below |

**`ida-restructure-test.js` checks:**
- each dashboard number against the database and against the total of its list;
- the workshop scope (own workshop only, 404 for another, cancelled ones hidden);
- that the contact e-mail is never returned;
- technicians only with `team:read`;
- the part totals, including the « not recorded » source;
- that no price is returned, and that `?org=` cannot widen a manager's scope;
- the five menu sections, and every previous page still in the menu.

**`ida-ui-browser-test.js` additions:**
- the five tiles and their links;
- the numbers equal the API;
- the menu sections;
- the parts totals and the « (déclarée) » wording;
- the workshop page;
- the Arabic completeness check and the responsive check now include the workshop page.

**The browser failure** is the « visible focus indicator » check, which fails identically on `main`. It comes from the
headless Chrome rebuilt after the 2026-11-06 restart (version 153), not from this change.
