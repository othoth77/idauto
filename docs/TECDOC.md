# TecDoc / parts catalogue

**Stage:** IDA-V12 · **Last updated:** 2026-09-05 · **Status:** adapter IMPLEMENTED · supplier access **NOT CONFIGURED** · local catalogue IMPLEMENTED

## 1. What is real and what is not

| Component | State |
|---|---|
| `TecDocAdapter` interface (`reference/parts/tecdoc-adapter.js`) | implemented; **not configured** on any IDauto deployment |
| Local parts catalogue + organisation stock (`reference/parts/local-parts-catalog.js`) | implemented, tested, in use |
| `PartsCatalog` (`reference/parts/parts-catalog.js`) — merges local + supplier | implemented |
| `MockTecDocProvider` | tests only; refuses to construct in production |
| TecAlliance licence | **not held**; TecDoc data is licensed per contract (see `tecalliance.net/tecdoc-catalogue`) |

**No TecDoc reference is ever invented.** Without a configured gateway, `status()` reports `configured:false` and every supplier method throws `CATALOG_NOT_CONFIGURED`; the UI shows **« Catalogue fournisseur non configuré. »** and continues with the local catalogue. The only parts data on this host that is not the workshop's own (an autopart.tn URL frontier held by the SPY project) was **not** used: its robots.txt forbids automated catalogue collection without written authorisation.

## 2. Interface

```
status()                        → { configured, provider, message_fr }
getManufacturers()              → [{ id, name }]
getModels(manufacturerId)       → [{ id, name, year_from, year_to }]
getSubmodels(modelId)           → [{ id (carId), name, motorisation, engine_code, kw, year_from, year_to }]
getVehicleDetails(carId)        → { car_id, manufacturer, model, version, motorisation, engine_code, year_from, year_to, fuel_type }
getCompatibleParts(carId, {category}) → [Part]
searchParts(query)              → [Part]
getPartDetails(articleId)       → Part
Part = { id:'tecdoc:<articleId>', reference, brand, oe_reference, category, name, source:'tecdoc', compatibility, attributes }
```

## 3. Gateway contract (what a configured deployment must expose)

TecAlliance licenses its webservice per reseller and the wire format differs by contract; this adapter therefore speaks a small JSON gateway contract that a reseller-specific mapping satisfies. **It has not been verified against a live TecAlliance account.**

```
GET {IDAUTO_TECDOC_BASE_URL}/manufacturers                     → [{id,name}]
GET …/manufacturers/{id}/models                                 → [{id,name,year_from,year_to}]
GET …/models/{id}/vehicles                                      → [{car_id,name,motorisation,engine_code,kw,year_from,year_to}]
GET …/vehicles/{carId}                                          → {car_id,manufacturer,model,version,motorisation,engine_code,year_from,year_to,fuel_type}
GET …/vehicles/{carId}/articles?category=                      → [{article_id,reference,brand,oe_reference,category,name}]
GET …/articles?q=                                               → same
GET …/articles/{articleId}                                      → one article
Headers: X-Api-Key: {IDAUTO_TECDOC_API_KEY}, X-Provider-Id: {IDAUTO_TECDOC_PROVIDER_ID}
```
`https` only (loopback `http` for tests). A different shape: pass `options.map(what, json)` to `createTecDocAdapter()`.

## 4. Vehicle → parts (Phase 8)

```
Vehicle ──► tecdoc_car_id ──► supplier compatible parts ─┐
        ──► local compatibility (vehicle_id | tecdoc_car_id | make+model+motorisation+years) ─┴─► parts list (each item labelled `source`)
                                                                     └─► availability / price from idauto_org_stock (the caller's organisation only)
```
Displayed per part: reference, brand, OE reference, category, compatibility, availability and price when the organisation has stock. **Catalogue ≠ stock**: `idauto_parts` / `idauto_part_compatibility` say what a part is and fits; `idauto_org_stock` says what one organisation holds.

## 5. Routes

See `docs/API.md` §Catalogue. Scopes: `parts:read`, `parts:write`, `stock:write`.
