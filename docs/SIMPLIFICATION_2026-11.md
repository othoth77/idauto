# Simplification of IDauto (IDA-UI-4, 2026-11-06)

**Goal set by the client:** a simple, fast application to record vehicles, record interventions, and know whether
each part used was bought from us or supplied by the customer. This replaces the five-section restructuring
(PR #46, never merged) and the IDA-UI-3 menu.

- **No new module and no new dependency.**
- **One additive migration.** Nothing is deleted: the pages that left the menu still answer at their URL.

## 1. What the user sees

| Menu | Content |
|---|---|
| Tableau de bord | Five database counts, each opening its list: vehicles, interventions, parts used, parts « achetées chez nous », parts « fournies par le client » |
| Véhicules | The list, with a search by registration number, make or model, and the « Ajouter un véhicule » button. A vehicle file can be opened and edited (« Modifier ») |
| Interventions | The list with a search, and one form (described below). An intervention opens for editing, or to cancel it |
| Pièces | Part, reference, vehicle, date and declared source. Filter by source, and a search |
| Paramètres | Mon compte (profile, password), Langue, and for an administrator: Gestion des utilisateurs, Rôles et permissions |

**Vehicle form.** Only the **registration number is required**. The other fields:
- make, model, year;
- VIN (optional) and mileage;
- « Informations complémentaires »;
- the owner's contact;
- carte grise face 1 / face 2 photos (optional).

**Intervention form:**
- the vehicle (chosen from the base);
- the date (today by default, never in the future);
- the mileage;
- the description of the work done;
- the technician: the account recording it by default, and a manager or admin may choose another account of the
  workshop;
- the parts used, as many as needed. Each part has a name, a reference and a quantity, and its **source, with two
  choices only**: « Achetée chez nous » or « Fournie par le client ».

**What the source means.** It is a **declaration**: IDauto keeps no sales, invoices, stock, suppliers or catalogue in
this version. It is therefore displayed as « … (déclarée) ». The rule « never claim a sale without proof of sale » is
kept.

**Design:**
- one **light** theme, pinned on every page of the application (`<html data-theme="light">`); the dark switch is
  removed;
- a cool palette (neutral greys and a blue accent), defined in the design tokens and so shared by staging and
  production;
- the top bar keeps search, language and profile; the notification bell is removed;
- French and Arabic, with correct LTR/RTL; desktop, tablet and phone.

## 2. Reused, not rebuilt

| Need | Existing piece reused |
|---|---|
| Vehicle, plate, VIN, duplicate check | `registration-service.js` (IDA-UI-3), now with only the plate required |
| Owner contact (private, per workshop, audited) | `owner-contacts.js`, unchanged |
| Carte grise photos (private store, D6 backup) | IDA-V14 documents, unchanged |
| Intervention | the IDA-V12 visit (`idauto_workshop_visits`), recorded as done |
| Part used | the IDA-V12 operation, with the IDA-UI-3 `part_source` |
| Counts and lists | `workspace-repository.js` (overview, lists, search), filtered by workshop in SQL |
| Accounts, roles, language | Better Auth, `principal.js`, the `ida_lang` cookie |

## 3. Database: `ida-ui4-simplification.sql`

The migration is additive and idempotent, and changes no existing row. It adds only what the forms need and the schema
could not hold:

| Change | Why |
|---|---|
| `idauto_vehicles.odometer_km`, `odometer_at` | No vehicle mileage existed (only legacy `idauto_service_events`). The vehicle keeps its **highest** reading, because an odometer only goes up; an edit of the file can still correct it |
| `idauto_vehicle_notes` (vehicle, workshop, text ≤ 500) | « Informations complémentaires ». **A table, not a column:** vehicles are shared between workshops, and a free-text note must not cross them (the rule of the owner contact, PRIVACY_ARCHITECTURE §1a). It never appears on the passport |
| `idauto_workshop_visits.performed_on`, `odometer_km`, `technician_ref`; `reason` widened to 1000 | The intervention's date, mileage and technician, and the description of the work |

**Rollback:** the previous code ignores the new columns and table. Never run the DOWN block (data loss).

## 4. API (all filtered by workshop; admin: all)

| Route | Scope | Notes |
|---|---|---|
| `PUT /api/vehicles/:ref/details` | `vehicle:write` | make, model, year, mileage, the workshop's note. Plate and VIN are not edited here. Another workshop's vehicle → 404. Audited, with field names only |
| `POST /api/workspace/interventions` | `workshop:write` | one transaction: the intervention and its parts. An admin names `org_id` when there are several workshops |
| `PUT /api/workspace/interventions/:id` | `workshop:write` | edits it. A listed part id is updated; an unlisted part is **cancelled (kept)**; a part without id is added |
| `DELETE /api/workspace/interventions/:id` | `workshop:write` | cancels it: the record is kept, and it and its parts leave the counts and lists |
| `GET /api/workspace/interventions?q&id` | `workshop:read` | search; cancelled ones hidden unless asked by id |
| `GET /api/workspace/parts-used?source&q` | `workshop:read` | `matching` = rows for the filter; `totals` per source |
| `GET /api/workspace/overview` | `vehicle:read` | `vehicles`, `interventions`, `parts`, `parts_our_shop`, `parts_customer` |

## 5. Left out of the menu, still reachable

These pages still answer at their URL, so nothing that worked is broken:
- the operator console (`/admin/*`);
- the carte grise list (`/atelier/documents`);
- the catalogue (`/atelier/catalogue`);
- the team page (`/atelier/techniciens`);
- the plate-reading workshop page (`/atelier`).

They are simply not part of the simplified application. Older records with the « fournisseur externe » source, or
with no source, stay as recorded. The parts filter offers them only when such records exist.

## 6. Not done, by request or by rule

- **Billing:** no billing, sale, stock, supplier or catalogue management.
- **Identity fields:** plate and VIN are not edited from the vehicle form. They are the vehicle's identity; changing
  them goes through the existing admin tools.
- **User management:** it stays on the operator CLI (`ops/auth-users.js`), because a password never crosses a web
  page. The « Gestion des utilisateurs » page lists the accounts.
