# Line — concurrency and composition review

> **Status:** Internal review, 2026-11-05. Verdict: **finding**. This is a desk review, not
> an independent audit or a dynamic test.

## Ownership

- Deploy file: `contracts/src/deploy/14_line.rho`
- State cells: lineState
- Cross-cell writers: none
- Writers: credit, pay, release
- Readers: info, remaining, paidFor
- Replay guard: `policyToken/paidFor`
- Bundle publication: bundle+{*Line} unclosed: captures lineState/caps/token

## Review

`credit`/`pay`/`release` call a capability first, then consume `lineState` to update it. If the capability succeeds and the state update cannot complete, value has moved without a matching line record (P1; the deploy should roll back on failure, but the arm is not structured as a single take/repost). `pay` is one-shot per claim via `paidFor`; a zero settlement is recorded as `paidFor[claimId] = 0` and moves no value (F-029). `bundle+{*Line}` is unclosed.

## Await / value-move notes

- Awaits while holding state: credit/pay/release: capability call before lineState update
- Value moves: pay
- Refusals before effects? Reviewed arm by arm in the source; see `components.yaml` for the
  per-arm inventory and `../composition/interfaces.yaml` for callee reply shapes.

## Evidence

- Source: `contracts/src/deploy/14_line.rho`
- Static scanners: `tools/check_take_repost.py`, `tools/check_bundle_closedness.py`,
  `tools/check_reply_shapes.py`, `tools/check_pause_scope.py`
- Dynamic evidence: not run (devnet install blocked at the P0 bundle defect).
