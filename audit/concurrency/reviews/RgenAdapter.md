# RgenAdapter — concurrency and composition review

> **Status:** Internal review, updated 2026-11-07. Verdict: **concern**. This is a desk review, not
> an independent audit or a dynamic test.

## Ownership

- Deploy file: `contracts/src/deploy/05_rgen.rho`
- State cells: rgenState
- Cross-cell writers: none
- Writers: admin
- Readers: health, config, oracleFactory, credentialFactory, claimFactory, verifyCredential, verifyClaim, verifyProvenance
- Replay guard: `nonce`
- Bundle publication: top-level, closed

## Review

`rgenResolve` peeks `rgenState` for the Root URI and awaits the r-gen Root; reads are advisory and a concurrent admin change can make one use a stale URI. `admin` consumes the cell across `AdminGuard` and delegates to `rgenApplyAction`, which reposts on success and refusal. `variance` is read-only: it peeks `rgenState`, reads the K-Asset, validates conventions and calls SureMath; the 2026-11-07 refactor split status, verdict and first-failure stages into helpers at depth 3 or less. `verifyProvenance` leaves a missing or refusing r-gen to the caller.

## Await / value-move notes

- Awaits while holding state: rgenResolve: registry + r-gen Root, admin: AdminGuard
- Value moves: none
- Refusals before effects? Reviewed arm by arm in the source; see `components.yaml` for the
  per-arm inventory and `../composition/interfaces.yaml` for callee reply shapes.

## Evidence

- Source: `contracts/src/deploy/05_rgen.rho`
- Static scanners: `tools/check_take_repost.py`, `tools/check_bundle_closedness.py`,
  `tools/check_reply_shapes.py`, `tools/check_pause_scope.py`
- Dynamic evidence: the 2026-11-07 campaign on the refactored tree passed 38/38 run suites, and the local reducer passes; CI run 42386549218 is green.

## Variance read (2026-11-06)

`RgenAdapter("variance", kassetUri, ret)` is a read-only arm. It peeks `rgenState`, reads the K-Asset at the supplied URI via `KAsset("get")`, validates the conventions (quantity, the four quality dimensions, verdict, approved status and liability), then derives the rate. When the K-Asset carries a value-proposition `variance` snapshot the adapter validates `{quantityBps, qualityBps, n}`, bounds each branch and their sum to 10000 bps and returns their sum with `source:"kasset-variance"`; otherwise it calls SureMath `varianceRate` with `source:"derived"`. The snapshot is read as one immutable map value, so a concurrent write cannot split the branches. It does not hold `rgenState` across the await and takes no capability from r-gen. An unresolvable URI blocks the caller, as the existing provenance read does; that is recorded as a boundary in the local-reducer notes.
