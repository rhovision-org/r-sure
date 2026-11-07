# Claims and adjudication

> **Status:** Implemented (source + static/parser gates); the r-gen OracleCase path is
> scaffolded.

A claim starts with a first notification of loss from the insured or broker. The policy checks
that it is active and has aggregate limit remaining, then creates a `Claim` that holds a
private claim token.

```
notified -> classified -> assessed -> agreed -> settled -> closed
                              \-> disputed -> upheld | partially_upheld | denied
```

- **Classify**: the lead manager marks the claim `standard` or `complex`.
- **Assess**: the lead (standard) or lead and second (complex) record a recommended amount,
  rationale hash and evidence references.
- **Agree**: a standard claim needs the lead; a complex claim needs the lead and the second.
  Followers are bound by the agreement.
- **Dispute**: the insured or broker opens an r-gen `OracleCase` with a credentialed
  adjudicator. `OracleCase.execute` calls the claim's private `applyDecision` capability:
  - `uphold` -> the assessed amount is agreed;
  - `partial` -> the decision's amount is agreed;
  - `revoke` -> the claim is denied.
- **Settle**: once agreed, settlement is permissionless. The policy computes
  `payable = max(0, min(agreed, perClaimLimit, aggregateRemaining) - deductible)`, splits it
  across the lines, and each line pays from its syndicate's claims purse to the insured's
  r-cash deposit facet.

A claim URI can be paid at most once by a line, and the policy records the paid claim once.
A payable of zero (an agreed amount within the deductible) or a line share that rounds to
zero is a recorded zero payment: the line marks `paidFor[claimId] = 0`, moves no value, and
the claim settles at zero with the aggregate unchanged. A second settlement is refused by the
same terminal guards as a positive payout. If a syndicate purse is short, the line refuses
before moving value; the settlement rolls back and the claim stays agreed. The central fund
can cover a capped shortfall with 2-of-3 signatures, after which a retried settlement pays
only the remaining line shares.
