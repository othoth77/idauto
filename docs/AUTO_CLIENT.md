# IDauto → MYTHOS AUTO client

**Status: IMPLEMENTED + CONTRACT-TESTED. Off unless configured. Not used by any IDauto feature yet** (§4
explains why). Code: [`reference/auto/auto-client.js`](../reference/auto/auto-client.js).

## 1. Why it exists

The ecosystem rule (`othoth77/agents` `docs/AUTO-INTEGRATION.md`):

```
IDauto → AUTO → AGENTS → agent (LENS, …) → AGENTS → AUTO → IDauto
```

An AUTO application asks AUTO for a *capability*. AUTO authenticates the application, validates the
request and forwards it to AGENTS. AGENTS resolves the agent, checks lifecycle, permissions and its
queue, admits the job (the HYBRID resource guard included) and dispatches it. IDauto never names an
agent and has no identity at AGENTS: there the caller is `svc:auto`. This client is IDauto's only
connection to that route.

## 2. Contract used — and nothing else

AUTO API v1 (`othoth77/auto` `docs/API.md`), with the AUTO ↔ AGENTS contract v1 behind it:

| Client function | AUTO route |
|---|---|
| `capabilities()` | `GET /api/v1/capabilities` (filtered to what AUTO grants `idauto`) |
| `requestCapability(capability, input, { idempotencyKey, correlationId?, deadlineS? })` | `POST /api/v1/capability-requests` |
| `getRequest(id)` / `cancelRequest(id)` / `waitForRequest(id, { timeoutMs, pollMs })` | `GET …/<req-…>` / `POST …/<req-…>/cancel` / polling |
| `startWorkflow(workflow, input, { idempotencyKey, correlationId? })` | `POST /api/v1/workflow-runs` |
| `getWorkflowRun(id)` / `cancelWorkflowRun(id)` / `waitForWorkflowRun(id, …)` | `GET …/<run-…>` / `POST …/cancel` / polling |

Today AUTO grants `idauto` two capabilities, `vision.ingest` and `data.extract`, and one workflow,
`vehicle-document-intake` (inspect, then extract). All three take a **LENS file reference**
`{ file_id: "f_…", sha256 }`, not a document.

Behaviour:

- **Authentication:** `X-Auto-Caller: idauto` and `Authorization: Bearer <token>`.
- **Idempotency:** an idempotency key is mandatory (`^[a-z0-9][a-z0-9-]{7,63}$`, AUTO's rule). Keep the same key across retries: a replay returns the original request (`duplicate: true`), and the same key with a different input is `409 idempotency_key_reused`.
- **Correlation:** pass your own correlation id, or the client generates `idauto-<uuid>`. It reaches the AGENTS task unchanged.
- **Retries:** bounded, 3 attempts by default, with exponential backoff. `Retry-After` is honoured in both forms of RFC 9110: delay-seconds and HTTP-date (IMF-fixdate, RFC 850 and asctime, all UTC). A past date means retry now; any wait is capped at 60 s; an invalid value (negative, decimal, unparsable date) is ignored in favour of the backoff. `Retry-After` never adds attempts and never makes a final error retryable. Only transport errors, timeouts, 429, 502, 503 and 504, and FICHES errors marked `retryable: true` are retried. Everything else (validation, `capability_not_granted`, `NOT_DISPATCHABLE`, `unauthenticated`, …) is returned at once.
- **Timeouts:** each call has one (10 s by default). An unanswered POST is an unknown outcome (`AUTO_TIMEOUT`, retryable) that the same key resolves safely. `waitFor…` ends with `AUTO_WAIT_TIMEOUT` and the last state; the work continues in AUTO.
- **No fallback:** if AUTO or AGENTS does not execute, IDauto gets the non-execution code. The client never calls an agent, LENS or a provider itself.
- **Observability:** a `log` callback receives one structured event per HTTP call (`op`, `status`, `attempt`, `ms`, `code`, `retryable`, `correlation_id`). It never contains the token or the request input.

## 3. Configuration (server environment; never in Git)

| Variable | Meaning |
|---|---|
| `IDAUTO_AUTO_URL` | AUTO's base URL. `https://` to any host, a tailnet listener included (for example through `tailscale serve`). Plain `http://` is accepted only on loopback (`127.0.0.0/8`, `localhost`, `::1`), so the bearer never leaves this host unencrypted. |
| `IDAUTO_AUTO_TOKEN_FILE` | IDauto's caller token for AUTO: a regular file, mode 0600 or tighter, ≥ 16 characters. The same file AUTO reads as `<AUTO_CALLER_TOKENS_DIR>/idauto`. Re-read on every call (rotation needs no restart), never logged. |

With either unset, `enabled()` is false and every call fails with `AUTO_NOT_CONFIGURED` before any
network use. Production has neither set: AUTO is not deployed (AUTO gap AUTO-8), and AUTO ↔ AGENTS is
not enabled (owner decision D-6).

## 4. Direct paths that remain, and why

`tests/ida-auto-client-test.js` §11 pins these two files. A new direct path to a model provider or to
LENS fails that test.

| Path | What it does | Why it is not routed through AUTO yet | What would unblock it |
|---|---|---|---|
| `reference/recognition/vehicle-vision.js` (AUTO gap IDA-G1) | Shows one vehicle photo to Anthropic and gets make, model, colour, body type and a readable plate. **Off by default** (`IDAUTO_VISION_PROVIDER` unset in production). | No AUTO or AGENTS capability performs vehicle-photo recognition. `vision.ingest` and `data.extract` inspect and extract a document already stored in LENS. A new capability would need a contract in AUTO and AGENTS, and an agent that implements it. | Owner decision: define a vehicle-recognition capability (name, input, result, which agent implements it) in AUTO and AGENTS. Until then, keep the provider unset. |
| `ops/haddad/idauto-media-receiver.js` (AUTO gap IDA-G2) | On Haddad, uploads a carte grise to the local LENS (`POST /v1/files`), starts `extract_fields` (`POST /v1/jobs`) and reads back the **technical fields** for `archive-service`. **Off unless** `IDAUTO_LENS_URL` and `IDAUTO_LENS_TOKEN_FILE` are set. | Starting and following the extraction *can* go through AUTO: `data.extract` and `vehicle-document-intake` do exactly that, and the contract test proves it. Two things the v1 contracts do not provide: (1) **handing the document over.** AUTO takes only a `file_id`, and AGENTS' upload route is operator-only (AUTO ↔ AGENTS contract §5, AGENTS gap AG-4). (2) **Reading the extracted fields back.** By AGENTS' design a task result carries the LENS job id, its state and `has_result`, never a value. Routing only the middle step would still leave two direct LENS calls and remove nothing. | Owner decisions: a service document hand-off (AG-4, plus a LENS storage policy, plus the matching AUTO API), and a service read path for extraction results (which values, under which data policy). The owner decision of 2026-11-18 that LENS is not integrated into the IDauto API process (`reference/lens/lens-adapter.js`) also stays as it is. |

## 5. Evidence

| Suite | What it proves |
|---|---|
| `tests/ida-auto-client-test.js` (offline, 111 assertions) | Against a scripted AUTO: off by default; the URL rule (plain http only on loopback) with readable boundary values (the whole loopback range, `localhost`, `::1`; RFC 1918 and documentation addresses refused); token-file rules; the exact v1 headers and body; input refused before the network; final errors not retried; transient errors retried with the same key; `Retry-After` in both RFC 9110 forms (delay-seconds and all three HTTP-date forms; past dates, invalid values and the 60 s cap), never adding attempts; timeouts and refused connections; malformed answers rejected; waiting and workflow runs; logs without secrets; token rotation; the guard of §4. |
| `tests/ida-auto-contract-test.js` (offline; replay 32 assertions, live 27) | Section 6 below. |

## 6. The contract suite in CI: a recorded, pinned contract

`othoth77/auto` and `othoth77/agents` are private, so CI cannot check them out, and copying their code into this
public repository would publish it. The suite therefore has two modes with the same 26 assertions:

- **Live**, where checkouts exist (`../auto` and `../agents`, or `AUTO_REPO` / `AGENTS_REPO`). It runs IDauto's client → the real AUTO server (its own registry) → the real AGENTS server (service authentication and policy). Only the Haddad worker is a stand-in. Every IDauto ↔ AUTO exchange, and every provider-side fact an assertion reads (the AGENTS task, the jobs the worker received), is recorded and normalised: credentials become roles, and random ids and times become stable placeholders. The recording is then compared with the committed fixture [`tests/fixtures/auto-agents-contract-v1.json`](../tests/fixtures/auto-agents-contract-v1.json). If AUTO or AGENTS changed behaviour, the suite fails with the first differing exchange (assertion 27).
- **Replay**, everywhere else, CI included. The same scenarios run IDauto's real client against a strict replay of the fixture: every request must equal the recorded one (method, path, `X-Auto-Caller`, credential role, body), in order, and every recorded exchange and fact must be used (2 assertions per scenario). The provider-side assertions read the recorded facts of the real providers at the pinned commits.

The fixture names the commits it was recorded against: AUTO `f89165d` and AGENTS `a5200c8`, both clean `main`. Re-record it only after reviewing a drift: `IDAUTO_CONTRACT_RECORD=1 node tests/ida-auto-contract-test.js`. `IDAUTO_CONTRACT_MODE=replay` forces replay where checkouts exist. The suite never skips: without a fixture and without providers it fails.
