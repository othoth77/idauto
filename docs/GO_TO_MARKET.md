# Go To Market

**Status:** SPECIFIED. Nothing here is executed. No public surface is deployed, no
professional is onboarded, no citizen has registered a vehicle.
**Last updated:** 2026-08-18

---

## 1. The growth loop

```
Citizen  →  Vehicle Passport  →  Garage  →  Verified Maintenance
        →  Buyer  →  New vehicle  →  More users
```

Read as a sequence of individually rational decisions rather than a diagram:

1. A **citizen** registers their vehicle. Free, a few minutes, and they get a passport and a
   QR they can show a buyer.
2. The **passport** starts mostly T0 — their own declarations. Visibly thin, which is the
   point: thinness is the motivation to enrich it.
3. They take the vehicle to a **garage**. The garage records the work as a verified claim,
   which costs the garage almost nothing at the point of work if the integration is right.
4. **Verified maintenance** raises the passport from T0 toward T2, and materially raises the
   vehicle's evidenced value.
5. At sale, the **buyer** checks the passport. A vehicle with a T2 service history sells
   better than one without — that difference is the entire economic engine.
6. That buyer now holds a **vehicle** with a passport, and registers their next one.
7. Buyers who saw the value ask their garage to participate. **More users.**

The loop closes at step 7, and only there. Steps 1–6 are a linear funnel; the compounding
comes from buyers becoming registrants and demanding issuers.

---

## 2. Where the loop actually breaks

Stated before the phases, because a plan that only describes the working case is not a plan.

| Break | Severity | Response |
|---|---|---|
| **Garages don't record.** Step 3 is work for the garage and value for someone else. | **Critical.** The loop cannot close. | Recording must be near-zero effort at the point of work — integrated into what the garage already does, not a separate portal. If it takes more than a few seconds, it will not happen. |
| **Buyers don't check.** Step 5 gives the passport its value. | **Critical.** Without it, garages have no reason to issue. | Passport-checking must be the default at the point of sale — QR at the vehicle, embedded in marketplace listings. |
| **Thin passports look useless.** A T0-only passport shows almost nothing. | High. Early users churn. | Be honest that it is thin, and make enrichment obviously worthwhile. Do not fake density. |
| **Cold start.** No buyers → no garages → no records → no buyers. | High. | Seed density in one geography rather than spreading thin (§3). |
| **Free rider.** A marketplace consumes passports without contributing. | Medium. | Acceptable — consumption drives step 5. Bulk API consumption is metered. |
| **Fraudulent issuers.** A garage issues false records for a fee. | Medium, rising with success. | Verifiable issuer identity, reputational stake, retroactive issuer-wide reassessment. |

Nothing in this document solves the first two. They are execution problems, and if they are
not solved, the strategy does not matter.

---

## 3. Sequencing

Deliberately geography-first, not segment-first. Vehicle history is only useful where a
buyer can plausibly find a passport for the vehicle in front of them, so density in one
market beats presence in five.

### Phase 1 — Foundation *(current)*
Schema, API, ingestion, review queue, tests. Synthetic data only. No public surface.
**Blocked from going further by:** legal review, off-host backup, real authentication.

### Phase 2 — Citizen passport, single geography
Citizen registration, passport, QR. Free. One market (Tunisia). Success is measured by
registrations and by return visits, not by passport richness — the passports will be thin
and that is expected.

### Phase 3 — Professional issuers, same geography
Onboard garages, starting with a pilot workshop already integrated (Fixpert). Issuance must
be integrated into existing workflow. Success is the proportion of registered vehicles with
at least one T2 claim.

### Phase 4 — Buyer-side demand
Passport-checking at the point of sale: QR, marketplace embedding, pre-purchase reports.
This is where the loop closes, and the phase most likely to reveal that steps 1–3 built
something nobody consults.

### Phase 5 — Institutional sources
Registry, inspection authority, insurers — T3 claims. Slow, relational, and dependent on
having demonstrated the earlier phases work.

### Phase 6 — Interoperability and second market
Only once the loop demonstrably closes in the first. A second market before that multiplies
an unproven model.

---

## 4. Why citizen-first rather than professional-first

The obvious alternative is to start with garages, who have data and can be sold to.

Rejected because it makes coverage a function of professional adoption, and professional
adoption is the slowest variable in the system. It also reaches exactly the vehicles
professionals already see — newer, formally maintained — and misses the older, informally
maintained vehicles whose history is hardest to establish and most valuable to surface.

The cost of citizen-first is real: citizen-created passports start at T0, so early data is
thin and low-trust. That is accepted. A thin passport that exists can be enriched; a passport
that was never created cannot.

---

## 5. What is deliberately not the strategy

| Not doing | Why |
|---|---|
| Becoming a marketplace | Being an interested party in the transactions IDauto informs destroys the credibility that is the product |
| Buying a database to look populated | Imported records with no provenance are T0 claims wearing a suit, and would poison the trust model at its foundation |
| Launching in many markets at once | Density beats breadth; a sparse passport network is useless everywhere |
| A token launch for growth | See [`BLOCKCHAIN_ARCHITECTURE.md`](BLOCKCHAIN_ARCHITECTURE.md) §3 |
| Paying for records | Paid records are records optimised for payment |
| Claiming coverage before it exists | The one asset that cannot be rebuilt after it is spent |

---

## 6. Measurement

Metrics chosen so they cannot be satisfied by activity that does not close the loop:

| Metric | Measures | Why not the obvious alternative |
|---|---|---|
| Registered vehicles | Step 1 | — |
| Passports with ≥1 T1 claim | Citizens attaching evidence | Registration count alone is vanity |
| Passports with ≥1 T2 claim | Step 3 working | The single most important number |
| Active issuers, and issuance per issuer | Whether issuers stay | Onboarded-issuer count hides dormancy |
| Passport views at point of sale | Step 5 | — |
| Registrations attributable to a prior passport view | **Loop closure** | The only metric that shows compounding |
| Median claims per passport | Density | — |
| Conflicts surfaced | The trust model doing work | Zero conflicts means the checks are not running |

The sixth is the one that matters. The others can all rise in a system that never closes the
loop.

---

## 7. Implementation status

**Nothing in this document is executed.** No citizen registration surface, no issuer
onboarding, no buyer-side product, no marketplace integration, no institutional agreement.
Phase 1 is incomplete and blocked on the three items in §3.
