# Business Model

**Status:** SPECIFIED. No tier, subscription, billing integration or paid service is
implemented. No revenue exists.
**Last updated:** 2026-08-18

---

## 1. The constraint that shapes everything

**Truth and verification status are never monetised.**

Concretely, IDauto will not sell:

- **A trust level.** Paying for a verification *service* — an inspection, a document review,
  issuer onboarding — is legitimate; those cost real money to perform. Paying for a *level*
  is not. The moment T2 is purchasable, the ladder measures willingness to pay rather than
  corroboration, and every downstream user has been quietly defrauded.
- **Suppression.** No party can pay to hide, delay, downgrade or remove an adverse record.
  A passport whose bad news is purchasable is worthless precisely where it matters.
- **Preferential visibility of a claim.** A claim's prominence follows its trust level, not
  its payer.
- **Exclusive access to a citizen's own record.** A citizen can always retrieve and share
  their own vehicle's passport for free.

These are stated first because they are the constraints most likely to face pressure later,
and the pressure always arrives with a reasonable-sounding framing ("verified partner
badge", "priority review", "premium listing").

---

## 2. Tiers

### Citizen — free, permanently

| Included | Not included |
|---|---|
| Register a vehicle, receive an IVID | Bulk API access |
| Digital Vehicle Passport | Commercial redistribution |
| QR representation | Professional issuance rights |
| Add claims and evidence | Aggregate market analytics |
| View the full history of a vehicle they hold | |
| Export their own data | |
| Share a passport with a buyer | |

No card, no trial, no feature that expires. This is the volume that the network depends on;
charging for it is charging for the thing that makes everything else work.

### Professional — subscription

Garages, insurers, fleet operators, inspectors, dealers.

| Included | Priced on |
|---|---|
| Verified issuer identity (DID) and issuance rights | Seats, or vehicles handled |
| Workflow integration — record work as it is performed | |
| Their own service history across all vehicles they touched | |
| Professional-scope lookup within rate limits | |
| Verification request tooling | |

The value is workflow and reputation, not access to hidden data. A garage subscribes because
issuing verified records is worth something to *its own* customers, not because IDauto is
withholding something.

### Verification services — per unit

Human or expert-assisted verification: document review, physical inspection coordination,
issuer onboarding checks, dispute adjudication.

Priced per verification. Charged for the **work of verifying**, and the outcome is whatever
the evidence supports — a paid verification that finds against the payer returns that
finding. If it did not, the service would be worth nothing.

### Reports — per report

Structured pre-purchase or fleet reports: the passport rendered for a decision, with
conflicts and anomalies surfaced and completeness caveats stated. Never a score; see
[`TRUST_MODEL.md`](TRUST_MODEL.md) §7.

### API — metered

Programmatic access for marketplaces, financing, insurance and fleet software. Free tier for
development and for open-source implementers of the protocol. Metered above that.

### Enterprise — contracted

Insurers, fleet operators, manufacturers, public bodies: bulk integration, dedicated
support, SLAs, private deployment, custom workflows.

### Integrations — revenue share or fee

Marketplace, financing and insurance platforms embedding passports. IDauto is the identity
and evidence layer; it does not become a marketplace itself.

---

## 3. What IDauto does not do

| Not this | Why |
|---|---|
| Sell personal data | Structurally impossible: no owner-PII column exists anywhere in the schema |
| Sell aggregate data traceable to individuals | Aggregate analytics are aggregate or they are not sold |
| Advertise against citizen data | The relationship would invert immediately |
| Broker, list or price vehicles | Being a marketplace makes IDauto an interested party in the transactions it informs |
| Require a token or cryptocurrency | See [`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md) §3 |
| Charge a citizen to see their own vehicle's history | It is their vehicle |

The marketplace exclusion is a genuine cost. Marketplaces are where the money is in vehicle
data, and a credibility argument is being chosen over a revenue line: a verification layer
that also sells cars has an interest in the outcome, and everyone downstream can see that.

---

## 4. Open source and revenue

Publishing the schemas, protocol, verification rules and reference implementation means a
competent competitor can implement the protocol. That is intended. See
[`OPEN_SOURCE_STRATEGY.md`](OPEN_SOURCE_STRATEGY.md).

Defensibility therefore comes from:

1. **The network.** Passports, issuers and history accumulate where the users are.
2. **Verification capability.** Trained reviewers, tuned detectors, established issuer
   relationships. Hard to copy from a repository.
3. **Issuer trust.** Onboarding and accrediting professionals is slow, relational work.
4. **Operational quality.** Uptime, latency, support, integration depth.
5. **Institutional relationships.** T3 sources are negotiated, not forked.

Not from: schema secrecy, data lock-in, or export restrictions. Those are explicitly
foreclosed by the licence and by the portability commitment.

---

## 5. Unit economics — honest state

**No revenue model here has been validated.** Nothing is deployed, nothing is sold, no
customer has been asked to pay.

Known unknowns:

- Whether garages will pay for issuance rights before the network has buyers looking at
  passports, and whether buyers will look before garages issue. Standard cold-start, not
  solved by strategy alone.
- The willingness-to-pay of pre-purchase report buyers in the first market.
- The real cost of human verification at volume, which determines whether verification
  services are a business or a support cost.
- Whether a free citizen tier at national scale is affordable on professional revenue.
  Storage and evidence retention are the dominant costs and they grow with the free tier.

These are recorded because a business model document that presents projections as findings
is worse than none.

---

## 6. Implementation status

| Element | Status |
|---|---|
| Free citizen tier | **SPECIFIED** — no registration surface exists |
| Professional subscriptions | **SPECIFIED** — no billing integration exists |
| Verification services | **SPECIFIED** |
| Reports | **SPECIFIED** |
| API access tiers | **SPECIFIED** — no public API is deployed |
| Enterprise | **SPECIFIED** |
| Integrations | **SPECIFIED** |
| Rate limiting (the mechanism tiers depend on) | **IMPLEMENTED** |
| Organisation records | **IMPLEMENTED** (schema only) |
