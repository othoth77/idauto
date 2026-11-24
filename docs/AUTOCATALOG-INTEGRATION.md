# AutoCatalog Integration

IDAUTO may consume AutoCatalog (MAPI) to support vehicle-based parts lookup and fitment. AutoCatalog is the canonical parts catalog; IDAUTO remains the canonical vehicle identity and passport system.

## Ownership boundaries
- AutoCatalog: canonical part catalog, taxonomy, technical part descriptors, OEM/aftermarket references, fitment evidence and provenance.
- IDAUTO: stable vehicle identity, VIN/registration, vehicle technical attributes, Digital Vehicle Passport and evidence-backed vehicle lifecycle claims.
- CMF: commercial order, supplier sourcing, order pricing, procurement and delivery.
- GARAGE: repair and workshop records, required parts and installed-parts confirmation.

## Integration
- Use IDAUTO vehicle attributes as query context for AutoCatalog lookup, with user confirmation where vehicle attributes are incomplete or uncertain.
- AutoCatalog returns catalog entries and compatibility evidence; IDAUTO must not present unverified matches as confirmed.
- IDAUTO may show AutoCatalog Miniatures and link to canonical part Details.
- IDAUTO's existing parts/stock/workshop functions, where implemented, remain local operational features (such as organization stock or parts used in workshop operations); they do not make IDAUTO the owner of the global catalog.
- Avoid copying catalog master records. Store stable catalog IDs and limited, timestamped snapshots when needed for historical integrity.
- Handle unavailable catalog data and unmatched parts transparently.

## Decision
AutoCatalog is the central parts catalog. IDAUTO is the vehicle identity/passport authority. A separate PARTS repository is not required.