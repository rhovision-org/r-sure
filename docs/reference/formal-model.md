# Formal model

> **Status:** Component model proved in Lean 4.12. `proved-model` means proved about the
> shallow model in `spec/lean`, not a refinement of the Rholang contracts. The devnet suite
> campaign and the local reducer are green; the contracts remain unaudited.

## What is proved

The Lean project at `spec/lean` contains 299 kernel-checked theorems over the insurance
economics. They answer six questions:

1. **Can the promise be backed?** Capacity, quote reservation, open-line and loss payment
   preserve `committed + written <= capital` (`INV-1`, `INV-7`).
2. **Is the risk fully placed?** A bound slip has non-empty shares summing to 10000 bps
   (`INV-2`), and the exposure plan sums to the aggregate when the contract's own
   `paid == amount` guard succeeds (`INV-3`).
3. **Is money conserved?** The premium split, line allocation, policy settlement and central
   fund cover conserve value (`INV-4`, `INV-6`); payouts are bounded by the agreed amount and
   the per-claim limit (`INV-5`).
4. **Is every payout once?** A line pays a claim at most once, a policy settles it at most
   once, the fund covers it at most once, and a claim settles once (`INV-8`).
5. **Is variance the same as risk?** A full indemnity preserves the value's variance
   (`INV-13`); the variance rate is scale-free and bounded under the K-Asset rubric; the
   engineering and insurer estimates and their signed gap are recorded; and the loaded
   premium never undercuts expected loss.
6. **Is the curve delta a real signal?** A reflection and a common shift leave the relative
   variance numerator gap at zero (`INV-14`); the curve L1 components and maximum deviation
   are non-negative; and the signal book's nonce transition is duplicate, stale or replace.

The register in `spec/lean/claims.yaml` is the authoritative claim list. `docs/reference/proof-map.md`
is the rendered view.

## What is not proved

This is **not** a Rholang refinement. The model abstracts maps to lists, URIs to `Nat` ids,
capabilities and purses to `Bool` guards, and block heights to `Nat`. It does not prove:

- that the Rholang source implements the model;
- ERTP or r-cash value conservation;
- r-gen credential truth or `OracleCase` binding;
- cryptographic unforgeability or 2-of-3 signature semantics;
- node rollback, deploy atomicity or scheduler fairness;
- phlo, gas, liveness or liveness under congestion;
- evidence quality, probability, reserve adequacy or regulatory solvency;
- the variance estimator: the quality-rubric mapping is an implied rate, not a statistical
  moment from observed values.

The assumptions are recorded in `claims.yaml` and repeated here:

| Assumption | Status | Meaning |
|---|---|---|
| `ertp.native_total` | assumed | an r-cash purse/issuer move conserves value or fails |
| `rgen.oracle_binding` | assumed | `OracleCase.execute` calls `applyDecision` once for the named case |
| `crypto.authority` | assumed | deployer identity and 2-of-3 signatures are unforgeable |
| `deploy.atomicity` | assumed | a failed deploy rolls back all state and value effects |
| `arithmetic.no_overflow` | assumed | Lean `Nat` is unbounded; contract integer bounds hold |
| `scheduler.fairness` | out of scope | safety only; no liveness claim |
| `pause.contract` | assumed | F-003 is closed in the contracts; INV-12 is enforced by the pause-scope source gate |
| `evidence.quality` | out of scope | evidence presence is checked, not loss quality |
| `variance.estimator` | assumed | the quality map is an implied variance-rate estimator, not a measured moment |
| `kasset.conventions` | assumed | r-gen passes quantity/quality/liability as conventions; r-sure validates them |
| `curve.conventions` | assumed | the 16-point risk curve is a declared convention; r-sure validates shape, not the statistical derivation |
| `curve.signal` | assumed | the signal book publishes the gap; it does not price or force a consensus |

## Module tree

```
spec/lean/
  lean-toolchain                 leanprover/lean4:v4.12.0
  lakefile.lean                  package rsure, no external requirements
  RSure.lean                     imports every module
  RSure/Basic.lean               bps shares, sums and monotonicity
  RSure/Model/Math.lean          premium split, payable, exposure allocation
  RSure/Model/Terms.lean         cover-terms validation postcondition
  RSure/Model/Types.lean         status inductives
  RSure/Model/Boundary.lean      explicit assumed externals
  RSure/Model/Grant.lean         one-shot LineGrant
  RSure/Model/Syndicate.lean     capital, quote, openLine, release, payLoss
  RSure/Model/Line.lean          credit/pay/release and paidFor
  RSure/Model/Slip.lean          subscription and funding
  RSure/Model/Distribution.lean  plan, remainder, run once
  RSure/Model/Fund.lean          capped one-shot cover
  RSure/Model/Policy.lean        premium distribution and settlement
  RSure/Model/Claim.lean         agreement, adjudication, settle once
  RSure/Model/Variance.lean      variance identity, derived rate, gap, loaded premium
  RSure/Model/Curve.lean         risk-curve delta, reflection/shift invariance, signal nonce
  RSure/Model/Oracle.lean        decide/execute/close
  RSure/Model/Books.lean         unique registration and lookup
  RSure/Model/System.lean        settlement composition and two-cell atomicity
  RSure/Linear/Cell.lean         linear cell rejection and commit theorems
  RSure/Linear/Protocol.lean     caller/helper protocol lemmas
  RSure/Invariants.lean          documentation aliases only
  RSure/Audit.lean               #print axioms for every theorem
  RSure/Emit.lean                deterministic vectors
```

## Invariant status

| ID | Invariant | Status | Primary theorem |
|---|---|---|---|
| INV-1 | Capacity and free capacity | covered | `synd_quote_WF`, `synd_openLine_WF` |
| INV-2 | Full subscription | covered | `slip_bind_requires_subscription` |
| INV-3 | Exposure plan sums to aggregate | covered | `math_alloc_sums` |
| INV-4 | Premium conservation | covered | `policy_distribute_conserves` |
| INV-5 | Payable bounds | covered | `math_payable_le_agreed`, `math_payable_le_perClaim`, `math_payable_le_aggregate` |
| INV-6 | Settlement conservation | covered | `system_settlement_conserves` |
| INV-7 | Line payout bounded | covered | `line_pay_bounded` |
| INV-8 | Exactly once | covered | `line_pay_once`, `policy_settle_once`, `fund_cover_once` |
| INV-9 | Aggregate non-negative | covered | `policy_settle_aggregate`, `policy_settle_guard` |
| INV-10 | Terminal states | covered | `claim_agree_terminal`, `claim_applyDecision_terminal` |
| INV-11 | Atomicity | partial | `system_step_atomic`; native ERTP is assumed |
| INV-12 | Pause does not block settlement | tool | `tools/check_pause_scope.py` |
| INV-13 | Variance is risk | covered (estimator boundary) | `risk_is_variance`, `qualityVariance_le`, `loadedPremium_ge_expected`, `gapFlag_sound` |
| INV-14 | Curve delta is a signal | model-only (curve boundary) | `relativeVarianceGap_reflect`, `relativeVarianceGap_shift`, `signalPut_same`, `signalPut_stale`, `signalPut_replace` |

F-020 and F-021 are fixed: the payable is the documented three-way minimum, the
aggregate guard propagates through Policy settlement, and terminal claim states are
rejected by agreement and adjudication. INV-9 and INV-10 are covered. INV-12 remains a
source-gated tool check because the Lean model does not prove the Rholang pause query.
INV-11 is partial because native ERTP and node rollback are outside the model.

## Reproduction

```sh
cd spec/lean && lake build && cd ../..
python3 tools/check_lean.py
python3 tools/check_vectors.py
python3 tools/check_flows.py --strict
python3 tools/check_claims.py --check --strict-audit
make formal-check audit-check
```

`check_lean.py` rejects `sorry`, `admit`, `native_decide`, local `axiom` declarations and
any axiom outside `propext`, `Classical.choice` and `Quot.sound`. `check_claims.py` rejects a
`covered` invariant without a substantive theorem, an unresolved theorem name, and a
`substantive` theorem whose body restates a hypothesis.

## Boundary and maintenance

- `spec/lean/claims.yaml` is authoritative; update it and the carrying theorem together.
- Flow rules in `spec/flows/core.yaml` must name real theorems; `check_flows --strict` fails
  on a `proved-model` target that is a definition.
- `RSure/Audit.lean` must name every source theorem; `check_lean.py` fails otherwise.
- The theorem register in `audit/registers/theorems.yaml` is generated from the source and
  the axiom audit; regenerate it when a theorem is added or renamed.
- Do not claim a Rholang refinement, a behavioural pass or an independent audit from these
  results.
