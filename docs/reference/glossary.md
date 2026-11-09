# Glossary

> **Status:** Stable.

Insurance terms first, then r-sure terms.

## Insurance

- **Aggregate limit**: the maximum total the policy pays across all claims in the period.
- **Broker**: the insured's intermediary; prepares the submission, negotiates terms and
  usually handles claims. Paid by commission.
- **Central fund**: a market-level protection fund for unpaid member liabilities. At
  Lloyd's it is a last-resort, governed arrangement, not an automatic guarantee.
- **Chain of security**: the layered capital behind a Lloyd's policy — syndicate assets,
  members' funds at Lloyd's, central assets, then the Central Fund.
- **Claim**: a notified loss, assessed and agreed before settlement.
- **Claims lead**: the lead managing agent that determines a standard claim on behalf of
  the following market; complex claims use the lead and a second syndicate.
- **Commission**: the broker's share of the premium.
- **Complex claim**: a claim requiring the lead and second managers to agree.
- **Deductible / excess**: the part of each loss the insured retains. It reduces small
  claims and moral hazard.
- **Exposure**: what can be lost, and to whom.
- **Variance rate**: `Var(value)/mean(value)^2`, expressed in basis points; the dimensionless
  measure r-sure uses for both a K-Asset and the insurance policy. See
  [Variance is risk](../concepts/variance-is-risk.md).
- **Engineering variance**: the rate implied by the K-Asset's quality rubric and verdict, or
  supplied by a bound attestation. The approver's liability share is recorded but is not an
  engineering-variance signal.
- **Insurer variance**: the underwriter's rate in the assessment. The signed difference from
  the engineering estimate is the **gap**; a gap beyond the tolerance is **flagged** and
  acknowledged by the insured at acceptance.
- **Variance attestation**: an off-chain engineering variance record
  `{source, kassetUri, varianceBps, evidenceHash}` bound to an `rgen:kasset` evidence entry.
- **Loaded premium**: expected loss plus a variance-principle load; `Risk.assess` refuses a
  quote below it.
- **Indemnity**: restoring the insured to the financial position before the loss, subject
  to the policy terms.
- **Insurable interest**: a real loss the insured would suffer if the event happened.
- **Limit**: the most the insurer pays; see per-claim and aggregate limit.
- **Moral hazard**: the change in behaviour caused by insurance; deductibles and conditions
  reduce it.
- **Per-claim limit**: the most the policy pays for one loss.
- **Policy**: the contract that turns a risk into a promise: period, coverage, limits,
  deductible, premium, conditions and claims basis.
- **Premium**: the price of transferring risk; expected claims plus expenses, capital cost
  and margin.
- **Reinsurance**: insurance for insurers; proportional or non-proportional. Not implemented
  by r-sure v1.
- **Risk**: the combination of exposure, probability and consequence.
- **Solvency**: the capital buffer that makes the insurer's promise credible.
- **Standard claim**: a claim the lead can agree for all followers.
- **Subscription**: several insurers each take a percentage of the same risk on the same
  terms; shares sum to 100%.
- **Underwriting**: deciding whether to accept a risk, on what terms and at what price;
  selection, pricing, terms and capacity.
- **Placing slip / MRC**: the placing document. The modern form is the Market Reform
  Contract (MRC), still called the slip. It records the risk, terms, premium and signed
  lines.
- **Member / Name**: a capital provider to a Lloyd's syndicate. Historically individual
  "Names"; now mostly corporate members.
- **Managing agent**: the company that runs a syndicate, employs its underwriters and
  manages its claims.

## r-sure

- **Bps**: basis points, denominator 10000.
- **CoverTerms**: the ordered coverage fields, validation and canonical hash.
- **Distribution**: an exactly-once cash-flow plan over a purse.
- **Free capacity**: `capital - committed - written`.
- **K-Asset**: an r-gen claim + validation pair.
- **Lead**: the first syndicate on a slip; it manages standard claims.
- **Levy**: the central fund's share of the premium.
- **Line**: one policy-syndicate share; holds credit/pay/release capabilities.
- **LineGrant**: a one-shot capacity reservation bound to a slip token.
- **Payable**: `max(0, min(agreed, perClaimLimit, aggregateRemaining) - deductible)`.
- **Policy**: a bound slip with lines, premium and aggregate accounting.
- **Risk**: the insured's submission with asset, evidence and insurability answers.
- **Risk curve**: a `risk-curve/v1` 16-point distribution in bps of the declared value;
  the K-Asset value curve and the actuarial `lossCurve` are the same object under full
  indemnity.
- **Curve delta**: the signed relative variance gap plus the reflection-invariant shape and
  tail metrics between two risk curves; the market signal, not a consensus.
- **VarianceSignalBook**: the published index of assessed risk deltas, versioned by the Risk
  nonce and summarised by count, sign, flags and gap sums.
- **Second**: the following syndicate that shares complex-claim agreement.
- **Slip**: the placing document; subscriptions sum to 10000 bps.
- **Syndicate**: capacity provider with a contract-owned claims purse.
- **Written**: capacity consumed by bound lines.
