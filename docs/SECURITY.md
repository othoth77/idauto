# Security — implementation notes

**Last updated:** 2026-09-05 (IDA-V12 audit). Vulnerability disclosure policy: root `SECURITY.md`. Threat model: `THREAT_MODEL.md`.

| Area | State | Where |
|---|---|---|
| Secrets | none in git, frontend, logs or docs. Env file 0600 outside the worktree; `.env*` ignored; `.env.example` placeholders only. Grep of the tree on 2026-09-05: only per-run test tokens and the public AWS documentation example key in the backup test. | `.gitignore`, `.env.example` |
| Environment variables | all read once at startup; provider/TecDoc keys never echoed; mock providers refuse `NODE_ENV=production` | `reference/vehicle/providers/*`, `reference/parts/*` |
| Authentication | Bearer → admin identity or organisation principal; owner cookie limited to two reads; RFC-conformant parsing; safe auth logging | `reference/identity.js`, `session.js`, `api.js` |
| Authorisation | exact scopes per route (`ROUTE_SCOPES` + V12 scopes); a route absent from the table is admin-only; VIN behind `vin:search` and audited on search **and** on fiche disclosure; workshop and stock rows scoped by `org_id` in every query | `api.js`, `v12-routes.js`, repositories |
| Input validation | plate → normaliser + catalogue; VIN → ISO charset/length; bounded strings, integer ranges, enum CHECK constraints in SQL; JSON bodies capped at 64 KB; `customer_ref` restricted to an opaque token pattern (no spaces) | `plate-normalizer.js`, `vin.js`, `vehicle-repository.js`, migration CHECKs |
| Injection | parameterised SQL only; no string concatenation of user input into SQL (dynamic column lists come from a fixed whitelist); no shell | repositories |
| Rate limiting | public surface per-client bucket (trusted-proxy IP extraction); authenticated V12 routes rely on credentials + nginx; no counter machinery in route modules (asserted) | `rate-limit.js` |
| CORS | none needed and none enabled: same-origin pages, `connect-src 'self'`; a cross-site fetch with a Bearer header is a preflight the server never answers | CSP headers |
| CSRF | owner cookie is `SameSite=Strict` + custom header; Bearer routes are immune by construction | `api.js` |
| SSRF | provider and catalogue URLs come from configuration only; callers contribute a validated plate/VIN/id that is URL-encoded into a fixed template; `https` only (loopback `http` for tests) | `http-vehicle-provider.js`, `tecdoc-adapter.js` |
| CSP | citizen and atelier: `script-src 'self' 'wasm-unsafe-eval'` (OCR engine), everything else `'self'`; admin: no wasm; all pinned whole by tests | `api.js`, `v12-routes.js`, `tests/ida-v11`, `tests/ida-v12` |
| Database access | one pool, loopback, least-privilege user from the env; write verbs never inline in `api.js` or `v12-routes.js` (asserted); audit rows in the same transaction as the write | `db.js`, `writes.js` |
| Logs | structured events with redaction of credential-shaped keys, truncated VIN, no IP (only the limiter's salted hash elsewhere) | `observability.js` |
| Public surface | the passport route selects columns by name and never reads the V12 identification columns; VIN and plate facts on the deny-list; asserted | `api.js`, `public-surface-policy.js`, `tests/ida-v12` §9 |
| Dependencies | `pg` only; `npm audit --omit=dev`: 0 vulnerabilities (2026-09-05) | `package.json` |
| Third-party sites | no credential of any other service is used or stored; no captcha handling; no scraping | `docs/VEHICLE_RESOLUTION.md` §3 |
