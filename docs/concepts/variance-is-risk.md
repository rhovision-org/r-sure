# Variance is risk

> **Status:** Implemented in contracts, the Lean model, vectors, tests and the local
> reducer. The estimator is a convention, not a market-calibrated actuarial model.

r-sure and r-gen meet at one idea: **the variance of a K-Asset's value is the risk of the
insurance product.** They are the same property seen from two sides. The conversion is an
identity, not an exchange rate.

## The identity

Let `V` be the K-Asset's value, with mean `μ > 0` and variance `σ²`. A full indemnity pays
the value, so the insurer's loss is `L = V` (or a constant shift of it). Shifting a random
variable does not change its variance, and reflecting it does not either:

```text
Var(V + c) = Var(V)
Var(C - V) = Var(V)
```

The second line is the full-indemnity case. r-sure's Lean model proves both on a finite
integer distribution, together with scale: `Var(cV) = c² Var(V)`. The on-chain measure is the
dimensionless **variance rate**

```text
varianceRate = σ² / μ²
varianceBps  = floor(varianceRate × 10000)
```

so the same number can be compared across an engineering asset and a policy. The rate is
scale-free: changing the unit of value does not move it. It is *not* shift-invariant — adding
a constant changes the mean — so the model proves the variance identity, not a false
shift identity for the rate.

`SureMath@"varianceStats"` computes the rate from a list of equally likely values. The Lean
vectors `variance.ss.*` and `variance.rate.*` run the same numbers through the deployed
contract, so the model and the Rholang agree.

## Two curves, one signal

A K-Asset's variance is not a scalar. It is the shape of the value distribution. The risk
an actuary prices is the shape of the loss distribution. Under full indemnity they are the
same object: `L = C - V` is a shift or reflection, so the variance numerator is unchanged
(`ssNum_shift`, `ssNum_reflect`, `risk_is_variance`). Both are carried as `risk-curve/v1`:

```json
{"kind": "quantiles", "unit": "bpsOfDeclaredValue", "n": 16,
 "points": [p0, "...", p15]}
```

The 16 points are equiprobable positions in bps of the declared value. The K-Asset curve is
the value proposition's snapshot; the actuarial curve is the assessment's `lossCurve`. The
primary signal is the signed relative variance gap:

```text
relativeVarianceGapBps = (SS_loss - SS_value) * 10000 / SS_value
```

where `SS` is the variance numerator, not the rate. Shape and tail metrics use the mirrored
alignment, so a reflection or a common shift is not a false difference. The mean gap is
descriptive only. `VarianceSignalBook` publishes the result; it does not average the curves,
rank them by who supplied them, or force a consensus. Disagreement is the signal.

## Scalar summaries, one visible gap

The scalar path below is the compatibility projection. When both curves are present, the
curve delta is the signal; the scalar gap remains the legacy projection.

An engineer and an insurer can reasonably disagree about variance. The design does not force
one to win; it makes the disagreement visible.

- **Engineering estimate.** r-sure reads the approved K-Asset through r-gen's public
  `KAsset("get")` arm and validates the conventions itself:
  - `quantity = {unit: non-empty, value ≥ 1}`;
  - `quality` with completeness, correctness, traceability and fitness, each 1..5;
  - `verdict`: `valid` or `partial` (`invalid` is not insurable);
  - `status == "approved"` with a non-nil `approval.liability` (the share is validated and
    recorded, but not used in the engineering rate).
  If the K-Asset carries a `variance` snapshot declared by its value proposition, that
  declared rate is the engineering estimate; if it carries a `variance.curve`, the curve and
  its stats are recorded and the curve path is used. Otherwise the rubric derivation below is
  the fallback.
- **Attestation.** The insured may submit a variance record bound to a `rgen:kasset`
  evidence entry `{kind, uri, hash}`. The attestation overrides the derivation and the source
  is recorded; it is an off-chain engineering claim, not a proof.
- **Insurer estimate.** `Risk.assess` requires an expected loss, the insurer's variance rate
  (or a `lossCurve` from which the rate is derived), a load in bps and a basis hash. It
  records the insurer's view separately.

The gap is signed:

```text
gapBps = insurerBps - engineeringBps
flagged = |gapBps| > toleranceBps     (default 2000 bps = 20 percentage points)
```

`Risk("variance")` returns both estimates, the gap, the flag and the loaded minimum, plus the
curve delta when both curves are present. `VarianceSignalBook` indexes the assessed risk and
publishes the signed gap; it never sets a price. The insured sees the difference before
accepting. Acceptance records the acknowledgement; a decline is the discussion path. This is
aimed at the common failure where an insurer with less
engineering knowledge loads a larger risk and the asset owner pays for it regardless of the
quality of their QA: good QA lowers the engineering measure, and any remaining difference is
an explicit, reviewable number rather than a silent margin.

If no engineering source is available, the risk is `insurer-only` and the flag is set, so the
missing second opinion is visible too.

## The declared rate

A value proposition describes its asset as a quantity, a quality and a variance around the
mean. The claim snapshots that variance and the K-Asset carries it:

```json
"variance": {"quantityBps": 400, "qualityBps": 1200, "n": 30}
```

`quantityBps` and `qualityBps` are the two dimensionless branch rates (`σ²/μ²` in bps); `n`
is the sample size. The engineering estimate is their sum:

```text
engineeringBps = quantityBps + qualityBps      (each 0..10000, sum ≤ 10000)
source         = "kasset-variance"
```

The adapter validates each branch and the sum, records `n`, and refuses a malformed
snapshot with `"variance"`. The rate is used as declared rather than recomputed: the value
proposition is the statement of expected variance, and the K-Asset's realized quality is
still visible in `quality` for the fallback and for the approver.

## The derived rate

When there is no snapshot — an older K-Asset, or a claim without a value proposition — the
derivation maps the K-Asset conventions to a bounded rate:

```text
Q = completeness + correctness + traceability + fitness     (4..20)
D = 20 - Q                                                  (0..16)
verdictPenalty = 0 for valid, 1000 for partial
engineeringBps = D×500 + verdictPenalty                     (0..9000)
```

Better QA and a valid verdict can only lower the measure. Perfect quality with a valid
verdict is 0; the worst rubric with a partial verdict is 9000.

`approval.liability.shareBps` is **not** part of this measure. It is a declared
liability/indemnity share, so r-sure validates and records it (the approved status requires
the approval record) but does not treat it as an engineering-variance signal. Retained risk
is a separate co-insurance/indemnity input if a later design prices it; putting it in the
engineering rate would conflate QA with the allocation of liability.

## The loaded premium

The insurer's assessment also carries the mean-variance load. With expected loss `E`,
variance rate `varianceBps` and an explicit loading `loadBps`:

```text
minimumPremium = E + E × varianceBps × loadBps / 10000²
```

At 100% loading and a 10000-bps rate the load is 100% of the expected loss; at zero variance it
is zero. `Risk.assess` refuses a quoted premium below the minimum (`premium floor`). The
commercial `CoverTerms.premiumTotal` is unchanged in this pass; the floor and the gap live on
the Risk, where the insured accepts them.

## Worked example

A value proposition declares quantity 400 bps and quality 1200 bps; the K-Asset snapshot
makes the engineering estimate `400 + 1200 = 1600`.

Without a snapshot, an approved K-Asset with quality 3/3/3/3 (sum 12) and a valid verdict
derives:

```text
engineeringBps = (20-12)×500 + 0 = 4000
```

The insurer assesses `varianceBps = 5000`, `expectedLoss = 800` and `loadBps = 2000`:

```text
gapBps = 5000 - 4000 = 1000       (not flagged at tolerance 2000)
minimumPremium = 800 + 800×5000×2000/10000² = 880
```

A quoted premium of 1200 clears the floor. If the insurer had used 6500 bps, the gap would be
2500, flagged; the insured would see it before accepting.

## What is proved, and what is assumed

Proved in Lean over the shallow model (`RSure.Model.Variance` and `RSure.Model.Curve`):

- variance is invariant under shift and reflection, and scales by `c²`;
- the derived rate is bounded under the rubric bounds and monotone in quality;
- the declared rate is bounded by 10000 bps and the cross-repo fixture is exactly 1600;
- the loaded premium never undercuts expected loss and is monotone in the rate;
- the gap flag is exactly the tolerance comparison;
- the relative variance gap is zero for a full-indemnity reflection and for a common shift;
- the curve L1 components and maximum deviation are non-negative;
- the signal book's nonce transition is duplicate, stale or replace, as the Risk nonce says;
- a soundness statement joins the load bound and the gap flag.

Assumed, and recorded in `spec/lean/claims.yaml`:

- **variance.estimator** — the declared snapshot is trusted as the value proposition's
  statement of variance, and the quality mapping is an implied rate for K-Assets without
  one, not a statistical moment from observed values; `liability.shareBps` is deliberately
  excluded from both;
- **kasset.conventions** — r-gen passes quantity/quality/liability as conventions; r-sure
  validates them, and the K-Asset hash is a reference, not a recomputed digest;
- **attestation trust** — r-sure records the source and binding but does not verify the
  engineer's credential or measurement.

This is not a refinement of the Rholang, and it is not a calibrated actuarial model. It is the
shared property, made explicit and checkable on both sides.
