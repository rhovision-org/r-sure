# r-gen integration

> **Status:** Implemented (contract interface); the devnet integration suite passes,
> including a K-Asset stub for the variance read.

r-sure does not link r-gen Rust crates. It speaks the Rholang interface and defines minimal
wire types in `rsure-core`.

## Evidence

`RgenAdapter` resolves these r-gen components from the configured r-gen Root:

- `component:oracle-factory`
- `component:credential-factory`
- `component:claim-factory`
- `component:provenance-factory`

Reads: `verifyCredential(uri)`, `verifyClaim(uri)`, `verifyProvenance(uri, hash)` and
`variance(kassetUri)`. `health` reports the resolved versions; `config` returns the adapter
state.

## Variance is risk

`RgenAdapter("variance", kassetUri, ret)` is the primary interoperation. It reads the
K-Asset through the public `KAsset("get")` arm and returns
`(true, {source, kasset, varianceBps, quantity, qualitySum, verdict, status,
liabilityBps})`. When the K-Asset carries a `variance` snapshot from its value proposition
the source is `"kasset-variance"`, `varianceBps` is `quantityBps + qualityBps`, and the
snapshot is echoed as `declared`; `qualitySum` is `Nil` because the declared rate does not
use the rubric. Without a snapshot the source is `"derived"` and the rubric formula below
is used. The rate is `Var(value)/mean(value)^2` in bps; both paths are in
[Variance is risk](../concepts/variance-is-risk.md).

The conventions are versioned as **`kasset.conventions/v1`** and pinned to r-gen
`c0ae67d`. The normative artifacts are `docs/src/reference/kasset-conventions.md`,
`spec/schemas/kasset-conventions.json`, `spec/fixtures/kasset-conventions-v1.json` and
`spec/vectors/kasset-conventions.tsv`; the conformance fixture yields 4000 bps for quality 12,
a valid verdict and an approved asset. They are a convention, not core enforcement.

The adapter validates the conventions itself, because the core passes them through without
shape checks:

- `quantity = {unit: non-empty string, value: integer ≥ 1}`;
- the four quality dimensions, each 1..5;
- `verdict` `valid` or `partial`; `invalid` is refused;
- optional `variance = {quantityBps, qualityBps, n}`: each branch 0..10000, their sum at most
  10000, and `n ≥ 1`; a malformed snapshot is refused with `"variance"`;
- `status == "approved"` with a non-nil `approval.liability`; its `shareBps` is validated and
  recorded, but it is a declared indemnity share, not an engineering-variance signal. The
  engineering rate is `(20 - qualitySum)×500 + (0 for valid, 1000 for partial)`, bounded to
  9000.

`validated` and `conditional` have no liability record, so they refuse derivation with
`"approval"`; `disputed`, `upheld`, `revoked` and `partially_revoked` refuse with
`"status"`. A bound variance attestation on the risk submission is the fallback and records
`source:"attested"`. The adapter never writes to r-gen, never takes a capability, and does not
require the r-gen root: the K-Asset URI is read directly.

## OracleCase

`Claim.dispute(dId, caseReq)` resolves `component:oracle-factory`, mints a one-shot subject
snapshot in the claim closure, and calls the bound arm:

```rholang
OracleFactory!("openBound", *dId, *proofCh, req, *ClaimApply, *ret)
```

The snapshot carries `subjectRef` (the r-sure claim URI), `subjectUri`, `parties`
(insured and broker) and the caller's `discipline`/`jurisdiction` (both optional); r-gen
derives `subjectRef`, `parties` and the oracle requirement from it, so a caller cannot
substitute a different subject. The proof is consumed once (`Proof!("take", ...)`), which
matches r-gen's `openBound` contract. `ClaimApply(@"applyDecision", caseId, decision, ret)`
is private to the claim. The r-gen `OracleCase.execute` calls it once. Outcomes map to
`upheld`, `partially_upheld` or `denied`.
