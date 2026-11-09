# Data schemas

> **Status:** Implemented (source + static/parser gates).

The canonical state shapes are in the contract sources. The important fields:

## Syndicate

`id`, `uri`, `ownerId`, `managerId`, `managerPubKey`, `name`, `assetId`, `capital`,
`committed`, `written`, `premiums`, `claimsPaid`, `members`, `quotes`, `lines`,
`riskAppetite`, `status`, `nonce`.

`free = capital - committed - written`.

## LineGrant

`grantId`, `syndicateId`, `slipId`, `class`, `shareBps`, `exposure`, `expiryHeight`,
`status` (`open|consumed|revoked|expired`). The slip token is in closure, not state.

## Risk

`id`, `insured`, `broker`, `class`, `assetRef` (`kind`, `hash`, optional `uri`),
`declaredValue`, `requestedLimit`, `requestedDeductible`, `periodStart`, `periodEnd`,
`evidence`, `triTest`, `varianceAttestation`, `variance`, `gapAcknowledged`, `assessment`,
`status`, `nonce`.

The optional submission `variance` attestation is
`{source:"attested", kassetUri, varianceBps 0..10000, evidenceHash}` and must match an
`rgen:kasset` evidence entry `{kind, uri, hash}`. The assessment (written by `Risk.assess`)
carries `quotedPremium`, `expectedLoss`, `varianceBps`, `loadBps`, `basisHash`,
`toleranceBps`, optional `shapeToleranceBps` and optional `lossCurve`, plus `engineering`,
`eval`, `gapBps`, `gapFlag`, `minimumPremium`, `by` and `at`. The `variance` read returns
`{engineeringBps, insurerBps, gapBps, flagged, acknowledged, source, minimumPremium,
expectedLoss, pricingBps, rateClamped, curveDelta, curveFlagged, curveSource,
engineeringCurve, engineeringCurveStats, lossCurve, lossCurveStats, kassetUri,
declaredSummaryBps}`; a flagged gap is visible before acceptance and acceptance sets
`acknowledged`.

`risk-curve/v1` is `{kind:"quantiles", unit:"bpsOfDeclaredValue", n:16, points:[...]}`:
16 nondecreasing integers `0..10000`, sum positive. The curve delta is
`{relativeVarianceGapBps, rateGapBps, meanGapBps, shapeL1Bps, maxPointGapBps,
maxDevGapBps, rateFlagged, varianceFlagged, shapeFlagged, tailFlagged, curveFlagged,
denominatorZero, toleranceBps, shapeToleranceBps, engineering, insurer}`.

## VarianceSignalBook

`varianceSignalBookState` is `{signals, summary, nonce}`. `signals` is keyed by `riskId`
and holds one current signal per risk: `{riskId, riskUri, nonce, insured, broker, class,
assetHash, assetUri, kassetUri, declaredValue, valueSource, lossSource, source, sign,
variance, assessmentBy, registeredAt, registeredBy}`. `summary` carries `count`, the signed
and absolute gap sums, the shape and maximum-deviation sums, and positive/negative/zero,
rateFlagged and curveFlagged counts. `register` versions by the Risk nonce: same → duplicate,
lower → stale, higher → replace.

## Slip

`id`, `riskId`, `insured`, `broker`, `brokerOwner`, `class`, `assetId`, `terms`, `termsHash`,
`premiumTotal`, `funded`, `shares` (keyed by syndicate), `lead`, `second`,
`insuredAccepted`, `expiryHeight`, `status`, `policyUri`.

## Policy

`id`, `slipId`, `riskId`, `insured`, `broker`, `brokerOwner`, `class`, `assetId`, `terms`,
`termsHash`, `premiumTotal`, `lines`, `aggregateLimit`, `aggregatePaid`,
`aggregateRemaining`, `perClaimLimit`, `deductible`, `claims`, `distributed`, `status`.

## Claim

`id`, `policyId`, `policyUri`, `insured`, `broker`, `lossHeight`, `claimedAmount`,
`evidence`, `classification`, `assessment`, `agreement`, `leadManager`, `secondManager`,
`status`, `agreedAmount`, `paid`, `oracleRef`.

## Line

`lineId`, `policy`, `syndicate`, `shareBps`, `exposure`, `status`, `credited`, `paid`,
`paidFor`.

## Distribution and fund

`Distribution`: `assetId`, `base`, `plan`, `status`, `paid`. `SureFund`: `assetId`, `balance`,
`levyBps`, `maxCoverPerClaim`, `maxCoverBps`, `contributions`, `covers`.
