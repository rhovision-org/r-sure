# RCA-003: zero-payable settlement, over-subscription and stale-grant bind wedge

> **Status:** Internal review record, 2026-11-07. Linked findings F-029, F-030 and F-031;
> hazards HZ-038, HZ-039 and HZ-040.

## Incident

A reviewer reading the Rholang (without running it) reported three terminal-state traps:

1. A claim within the deductible can never settle. `SureMath.payable` returns zero, the
   settlement plan is all zeros, `LineSettle.pay` refuses `amount < 1`, and `payLinePlan`
   turns the refusal into `1/0`, aborting the deploy.
2. A subscription past 10000 bps is accepted. The slip checks only the individual share
   bound and computes the running total only after the quote and store. `bind` requires
   exactly 10000 and the slip has no removal arm, so the slip is permanently un-bindable.
3. A revoked quote stays in the slip. `revokeQuote` and `expireQuote` free capacity and mark
   the quote dead, but cannot notify the slip. `bind` calls `openLine` for the stale grant,
   gets `"closed"`, and aborts with `1/0`, retrying the same grant forever.

## Root cause

Three admission and terminal-state invariants were validated on only one side of a component
boundary:

- `SureMath` legally produces zero; `LineSettle` treated zero as an invalid amount.
- `Slip.subscribe` validated the line share but not the placement total.
- `Syndicate` marked a grant dead; the slip never learned it.

Each caller assumed its input was in the success state and had no recovery path.

## Corrective actions

| Action | Change | Finding |
|---|---|---|
| CA-01 | `LineSettle.pay` accepts zero; `lineSettlePayments` records `paidFor[claimId] = 0` with a nonce bump and no purse move. | F-029 |
| CA-02 | `slipSubscribe` computes the existing total before `Syndicate.quote` and refuses a prospective total above 10000 with no capacity reserved. | F-030 |
| CA-03 | `Slip.bind` pre-flights quote liveness before opening any line, prunes revoked/expired/unknown shares, recomputes lead/second/status/nonce and replies `"quote closed"`. A consumed grant is surfaced as `"quote consumed"` without pruning. | F-031 |
| CA-04 | The settlement, subscription and binding suites now cover the three paths. | F-029/F-030/F-031 |
| CA-05 | Follow-up: a consumed grant from a partially executed bind is surfaced but not repaired. | F-031 (open action) |

## Verification

- `settlement-zero.log`: a within-deductible claim settles at `(true, 0)`; the line records
  `paidFor = 0`, the policy aggregate is unchanged, the claim is settled, and a replay is
  refused.
- `subscription-over.log`: an over-subscription is refused with `"share"`; the extra
  syndicate has `committed == 0` and no quote.
- `binding-revoked.log`: a revoked grant is pruned at bind; the slip returns `"quote closed"`
  with no shares and status `"open"`; a resubscription rebinds successfully.
- `gate.txt`: build, parse, normalize, arity and match-style gates pass.
- `local-reducer.txt`: the node's in-memory reducer installs and drives the journey.

## Residual risk

- The consumed-grant repair path is not implemented; a partially executed bind is surfaced
  but needs an operator or a follow-up change.
- The bind pre-flight is atomic because the node does not interleave deploys.
- This is an internal review on the shared devnet, not an independent audit.
