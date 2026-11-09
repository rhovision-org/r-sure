# VarianceSignalBook — concurrency and composition review

> **Status:** Internal review, 2026-11-09. Verdict: **safe-by-inspection**. This is a desk
> review, not an independent audit or a dynamic test.

## Ownership

- Deploy file: `contracts/src/deploy/19_books.rho`
- State cells: varianceSignalBookState
- Cross-cell writers: none
- Writers: register
- Readers: signal, signals, byAsset, byClass, bySource, bySign, summary
- Replay guard: nonce, plus the Risk nonce carried in each signal
- Bundle publication: top-level, closed

## Review

`register` resolves and reads the Risk `info` arm and the clock before it takes
`varianceSignalBookState`. The book never supplies a curve, delta or price: it copies the
signed Risk `variance` map and records the caller's deployer address as the indexer. The
caller supplies only the Risk URI.

Inside `signalPut`, the cell is consumed once, the old signal's contribution is subtracted
from the summary, the new contribution is added, and the cell is reposted exactly once. A
same-nonce registration refuses `"duplicate"` before any state change; a lower nonce refuses
`"stale"`; a higher nonce replaces the current signal and moves its summary contribution.
Read arms peek, so they never consume the cell.

No value moves. No capability is stored or handed out. The book does not call `Risk`
mutating arms, does not hold the Risk cell across an await, and does not write to any other
cell.

## Await / value-move notes

- Awaits while holding state: none. Risk info and Clock are read before the book take.
- Value moves: none.
- Refusals before effects: `"risk"`, `"not assessed"`, `"clock unavailable"`, `"duplicate"`
  and `"stale"` all reply before a state change.

## Evidence

- Source: `contracts/src/deploy/19_books.rho`
- Static scanners: `tools/check_take_repost.py`, `tools/check_bundle_closedness.py`,
  `tools/check_reply_shapes.py`
- Dynamic evidence: `make local-reducer` registers a scalar signal, refuses a duplicate,
  registers a curve signal, and reports summary count 2 with one positive and one negative
  gap.
