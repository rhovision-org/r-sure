# Slip — concurrency and composition review

> **Status:** Internal review, updated 2026-11-07. Verdict: **concern**. This is a desk review, not
> an independent audit or a dynamic test.

## Ownership

- Deploy file: `contracts/src/deploy/13_slip.rho`
- State cells: slipState
- Cross-cell writers: none
- Writers: accept, subscribe, fundPremium, bind, expire
- Readers: info, subscriptions, subscription, premium, policy
- Replay guard: `nonce/tokens`
- Bundle publication: bundle+{*Slip}; the contract body rebinds state, purse and tokens, and check_bundle_closedness reports no candidates

## Review

`bind` consumes `slipState`, validates status, acceptance, funding and subscription, pre-flights grant liveness, then runs the staged `slipBindTerms`, `slipBindLines`, `slipBindCreate` and `slipBindDistribute` helpers and reposts on success and on every refusal. A revoked or expired share is pruned, lead/second/status recomputed and the refusal returned; a consumed grant is surfaced without pruning (F-031). `subscribe` holds the cell across `Syndicate.quote` (P2) and refuses a prospective total above 10000 bps before the quote, so a refused share reserves no capacity (F-030). `fundPremium` requires the insured (F-007), and `expire` refunds a funded premium (F-011) and reposts. The 2026-11-07 refactor flattened bind to depth 3 and merged the four identical `slipExpireQuotes` arms.

Slip-level pause gates were omitted because the term is near the parser-depth budget. Binding is blocked through the gated `Syndicate.quote`/`openLine` capacity path; this is recorded in F-003 and R-003.

## Await / value-move notes

- Awaits while holding state: subscribe: Syndicate.quote while state held, bind: lines/policy/distribution
- Value moves: fundPremium
- Refusals before effects? Reviewed arm by arm in the source; see `components.yaml` for the
  per-arm inventory and `../composition/interfaces.yaml` for callee reply shapes.

## Evidence

- Source: `contracts/src/deploy/13_slip.rho`
- Static scanners: `tools/check_take_repost.py`, `tools/check_bundle_closedness.py`,
  `tools/check_reply_shapes.py`, `tools/check_pause_scope.py`
- Dynamic evidence: the 2026-11-07 campaign on the refactored tree passed 38/38 run suites, and the local reducer passes; CI run 42386549218 is green.
