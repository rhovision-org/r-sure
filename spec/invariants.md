# Invariants

The canonical list is in `docs/reference/invariants.md`. This file is the formal target.
The Lean names are in `spec/lean/claims.yaml` and `spec/lean/RSure/Invariants.lean`.

| ID | Invariant | Formal predicate |
|---|---|---|
| INV-1 | Capacity | `committed + written <= capital` and `free = capital - committed - written >= 0`. |
| INV-2 | Subscription | A bound slip has `sum(shareBps) = 10000` and at least one line. |
| INV-3 | Exposure | At bind, `sum(line exposure) = aggregateLimit`; the last line absorbs the allocation remainder. |
| INV-4 | Premium | `commission + levy + sum(line credits) = premiumTotal`. |
| INV-5 | Payable | `payable = max(0, min(agreed, perClaimLimit, aggregateRemaining) - deductible)`. |
| INV-6 | Settlement | `sum(line payouts) + fund cover = payable`. |
| INV-7 | Line | `paid <= exposure <= written <= capital`. |
| INV-8 | Exactly once | Per claim per line, per claim per policy, per claim per fund. |
| INV-9 | Aggregate | `aggregateRemaining' = aggregateRemaining - payable >= 0`. |
| INV-10 | Terminal | A settled/denied claim or expired policy cannot be re-opened or re-paid. |
| INV-11 | Atomicity | No partial value move survives a failed deploy. |
| INV-12 | Pause | Settlement, close, expiry and refunds are not blocked by global pause. |
| INV-13 | Variance is risk | A K-Asset's value variance is the insurance risk: the rate is `Var/mean^2` in bps, the engineering and insurer estimates and their signed gap are recorded, and acceptance acknowledges the gap. |
| INV-14 | Curve delta is a signal | The value curve and the loss curve are compared by the variance numerator, not the rate; a reflection or common shift leaves the relative gap at zero, and `VarianceSignalBook` versions a signal by the Risk nonce. |

## Model scope

INV-3 and INV-7 are stated over the allocation and line models: the plan sums exactly when
the contract's `paid == amount` guard succeeds, and line exits are guarded by
`paid <= exposure`. INV-5 is the documented three-way minimum after F-020 corrected
`SureMath@"payable"`. INV-10 is guarded in `agree`, `addEvidence`, `classify`, `assess`,
`dispute` and `applyDecision` after F-021. INV-11 remains a boundary: native ERTP moves and
node rollback are assumed. INV-12 is a narrow, fail-closed pause checked by
`tools/check_pause_scope.py`; it is not a Lean theorem. INV-14 is model-only: the curve
shape and tail metrics are validated structurally by the contracts and proved only in the
shallow `RSure.Model.Curve` model; the signal book's Rholang wiring is covered by the local
reducer, not by a refinement proof.
