# Invariants

> **Status:** Implemented (source + static/parser gates); a Lean component model now proves
> the economic core. `proved-model` is not a Rholang refinement. See
> `formal-model.md` and `proof-map.md`.

The simulator and the audit use the same numbering as `spec/invariants.md`.

| ID | Invariant | Business meaning | Lean status |
|---|---|---|---|
| INV-1 | Capacity | A syndicate never promises more than its capital: `committed + written <= capital` and free capacity is non-negative. | covered |
| INV-2 | Subscription | A slip that binds is fully placed: shares sum to 10000 bps and every line is bound. | covered |
| INV-3 | Exposure | Line exposures add up to the policy aggregate; the last line absorbs the integer remainder. | covered (model) |
| INV-4 | Premium | Commission, central-fund levy and line credits add up to the premium, with no value created or lost. | covered |
| INV-5 | Payable | The payable is the agreed amount after the per-claim, aggregate and deductible caps the contract applies. | covered |
| INV-6 | Settlement | Line payouts plus the central-fund cover equal the payable. | covered |
| INV-7 | Line | A line never pays more than its exposure, and exposure never exceeds the written capital behind it. | covered (model) |
| INV-8 | Exactly once | A claim is paid at most once per line, once per policy, and the fund covers it at most once. | covered |
| INV-9 | Aggregate | Each settlement reduces the aggregate remaining and never drives it negative. | covered |
| INV-10 | Terminal | Settled/denied claims and expired policies cannot be re-opened or re-paid. | covered |
| INV-11 | Atomicity | A failed deploy leaves no partial value move. | partial: native ERTP assumed |
| INV-12 | Pause | New risk is blocked; settlement, close, expiry and refunds are not. | tool-checked (F-003 fixed) |
| INV-13 | Variance is risk | A K-Asset's value variance is the insurance risk. The engineering and insurer estimates and their signed gap are recorded; acceptance acknowledges the gap. | covered (model; estimator boundary) |
| INV-14 | Curve delta is a signal | The value curve and the loss curve are the same normalized object. The relative variance gap, shape and tail are published; a reflection or common shift is not a false difference; the signal book versions by the Risk nonce. | model-only (curve boundary) |

## Modelling notes

- The model is list-based and uses `Nat` identifiers and amounts. Rholang maps, URIs,
  capabilities and purses are abstracted or kept as boundary assumptions.
- `payable` follows the contract's branch order. The prose `min(agreed, perClaimLimit,
  aggregateRemaining)` is only equivalent when `agreed < perClaimLimit` or
  `aggregateRemaining >= perClaimLimit`; the contract itself caps at the per-claim limit when
  the agreed amount reaches it.
- INV-10 is guarded after F-021: `Claim@"agree"`, `addEvidence`, `classify`, `assess`,
  `dispute` and `applyDecision` reject settled/denied/closed claims.
- INV-11 is a boundary, not a theorem over ERTP or the node.
- INV-12 is a narrow pause: new-risk arms fail closed; claims handling and value-out paths
  remain available. It is enforced by `tools/check_pause_scope.py`, not a Lean theorem.
- INV-14 is a model-only signal: the curve shape, order and bounds are validated by the
  contracts, and the delta invariants are proved in `RSure.Model.Curve`. The book's Rholang
  wiring is exercised by the local reducer, not refined from the Lean model.
