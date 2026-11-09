# Third-party notices

r-sure is licensed AGPL-3.0-only. It adapts architectural patterns from three AGPL-3.0
projects.

## r-share — https://github.com/rhovision-org/r-share

Local reference checkout: `/home/patrick/RShare`.

Patterns referenced: the component directory and installer gate, consume-then-repost state
discipline, owner-auth helpers, the r-cash Payments adapter, the per-object escrow payout
sequence, the Keystore port and the static-gate/harness structure. r-sure writes its own
contracts and does not modify r-share.

## r-gen — https://github.com/rhovision-org/r-gen

Local reference checkout: `/home/patrick/RGen`, commit `c0ae67d`.

Patterns referenced: `OracleFactory.openBound`, the one-shot subject snapshot and the private
`applyDecision` execution protocol (`contracts/src/deploy/30_oracle.rho`); the
claim/validation/K-Asset evidence model; the insurability tri-test in
`legacy/lib/RiskMath.rho`; and the public `KAsset("get")` state shape under
`kasset.conventions/v1`, including the optional `variance` snapshot declared by a value
proposition. The normative artifacts in r-gen `c0ae67d` are
`docs/src/reference/kasset-conventions.md`, `spec/schemas/kasset-conventions.json`,
`spec/fixtures/kasset-conventions-v1.json` and `spec/vectors/kasset-conventions.tsv`. r-sure
consumes the interface only; it validates the conventions itself and has no compile-time
r-gen dependency.

## r-cash — https://github.com/rhovision-org/r-cash

Local reference checkout: `/home/patrick/Rholphin`, commit `49b441d`.

The Rust client uses `rcash-core`, `rcash-chain` and `rcash-sdk` as git dependencies pinned to
`49b441dea4f5561992387ed670ab263fcd5dd164` (AGPL-3.0-only). They provide amounts, deploy
signing, the rholo HTTP client, finality polling and `RhoValue` decoding. `rcash-keystore`
patterns are ported from the same family. The rholo crates `rchain-crypto`/`rchain-shared` are
pinned to `841cb842876369deaa63e3b3e26c20d60e6c74c6`.

## rchain-rust — https://github.com/rchain-community/rchain-rust

Local reference checkout: `/home/patrick/RNodeRust`. The parser gate uses the node parser at
`e2d073dcd02f1e560ccb84749937138a1e184b0b`. Platform facts referenced: `select` desugars to
parallel receives; the 64 KiB deploy cap; ERTP receive-only deposit facets; and the
`rho:block:data`, deployerId, registry, secp256k1 and blake2b system channels.

## Papers

`docs/papers/NAIC_CIPR_2C_20July_2016.pdf` is third-party background: Daniel R. Robles,
"Insurance: The Highest and Best Use Case for Blockchain Technology," NAIC CIPR Newsletter,
July 2016, pp. 17–27. It is not relicensed and is not a source of the contracts. It is cited
on pp. 17, 20, 22 and 25 for the capital-cost, insurability and adjudication rationale; it
is an opinion column, not an NAIC standard or specification, and its views are the author's,
not the NAIC's. The page-level extract is `docs/papers/extracts/robles2016naic.md`.
