# IDauto — Miniature / Details and Cross-System Relations

## Miniature / Details
A vehicle Miniature shows stable IDauto identity, permitted registration plate, make/model summary, and passport/verification status, linking to the vehicle's IDauto Details. Details is authoritative for vehicle identity, validated facts, evidence, and provenance. It may show authorized CONTACT, GARAGE repair, and CMF order Miniatures for actual relations. Do not copy canonical vehicle facts or evidence into other systems. Include loading, empty, error, retry, and denied states.

## One-click workflow integration
Consumers resolve a vehicle through IDauto's approved resolver and evidence rules. Reuse an existing stable identifier when confidently identified. Create a vehicle identity only through IDauto's authorized confirmation/evidence flow. Return the canonical identifier for consumers to store as a reference. IDauto identifiers are protocol identities, not assumed numeric counters; consumers must not increment or invent IDs. A new order or repair does not automatically imply a new vehicle.

## Related Miniatures
Vehicle Details may show the authorized owner/contact Miniature, GARAGE repair Miniatures, and CMF order Miniatures. Relations must come from real associations, validated queries, or authorized API contracts. IDauto owns vehicle identity/passport/evidence; GARAGE owns repair history. Integrations use scoped APIs, idempotent requests/events, provenance, and retry/reconciliation.