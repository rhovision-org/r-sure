# Syndicate — concurrency and composition review

> **Status:** Internal review, updated 2026-11-07. Verdict: **concern**. This is a desk review, not
> an independent audit or a dynamic test.

## Ownership

- Deploy file: `contracts/src/deploy/10_syndicate.rho`
- State cells: syndicateState
- Cross-cell writers: none
- Writers: setManager, contribute, withdrawCapital, quote, revokeQuote, expireQuote, openLine, suspend, resume
- Readers: info, capacity, quotes, quote, lines, line, members, member
- Replay guard: `nonce/quotes`
- Bundle publication: bundle+{*Syndicate}; the contract body rebinds state and capabilities, and check_bundle_closedness reports no candidates

## Review

Every writer takes `syndicateState` once and reposts it on every terminal path, including refusals. `openLine` holds the snapshot across LineGrant, LineFactory and the capability creations and reposts in each arm; the staged helpers keep dispatch at depth 3. `withdrawCapital` and `lineSettleCap.pay` delegate to helpers that receive the snapshot as data and the cell name only to repost; every refusal now reposts, closing HZ-037. `lineSettleCap.pay` records a zero payment (`paidFor[claimId] = 0`) with no purse move, so a within-deductible claim or a rounded-away line share settles instead of aborting (F-029). `contribute` deposits before the consume and updates with a Nil/value match. `expireQuote` holds the cell across Clock and reposts. The pause gate covers `SyndicateBook.create`, the 8-arg `quote` and `openLine`; `revokeQuote`, `expireQuote`, `suspend/resume` and capital flows remain exempt.

The pause gate covers `SyndicateBook.create`, the 8-arg `quote` and `openLine`; `revokeQuote`, `expireQuote`, `suspend/resume` and capital flows remain exempt.

## Await / value-move notes

- Awaits while holding state: openLine: LineGrant, LineFactory, quote: rs grant publication after repost, withdrawCapital: Payments, expireQuote: Clock
- Value moves: contribute, withdrawCapital, lineSettleCap.pay
- Refusals before effects? Reviewed arm by arm in the source; see `components.yaml` for the
  per-arm inventory and `../composition/interfaces.yaml` for callee reply shapes.

## Evidence

- Source: `contracts/src/deploy/10_syndicate.rho`
- Static scanners: `tools/check_take_repost.py`, `tools/check_bundle_closedness.py`,
  `tools/check_reply_shapes.py`, `tools/check_pause_scope.py`
- Dynamic evidence: the 2026-11-07 campaign on the refactored tree passed 38/38 run suites, and the local reducer passes; CI run 42386549218 is green.
