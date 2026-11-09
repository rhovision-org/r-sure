# Arm reference

> **Status:** Implemented (source + static/parser gates).

## Kernel and governance

- `SureRoot`: `resolve`, `get`, `keys`, `nonce`, `resolveMany`, `register`, `rotate`,
  `deprecate`, `freeze`, `admin`.
- `Clock`: `now`. `Verifier`: `hash`, `sigOk`. `Codec`: `adminPayload`, `canonical`, `hash`.
- `AdminGuard`: `verify`.
- `SureAdmin`: `keys`, `isPaused`, `nonce`, `admin` (`pauseAll`, `resumeAll`, `setAdmins`,
  `setThreshold`).

## Market

- `SyndicateBook`: `create`, `syndicateOf`, `syndicates`, `byClass`, `count`, `verify`.
- `Syndicate`: `info`, `capacity`, `quotes`, `quote`, `lines`, `line`, `members`, `member`,
  `setManager`, `contribute`, `withdrawCapital`, `revokeQuote`, `expireQuote`, `openLine`,
  `suspend`, `resume`.
- `LineGrant`: `get`, `consume`, `revoke`, `expire`.
- `BrokerBook`: `register`, `registerDone`, `brokerOf`, `brokers`.
- `Broker`: `info`, `profile`, `slips`, `addSlip`, `pause`, `resume`.
- `RiskBook`: `submit`, `risk`, `risks`, `byInsured`, `byBroker`.
- `Risk`: `info`, `evidence`, `addEvidence`, `assess`, `accept`, `decline`, `expire`,
  `variance`.

## Risk measure

- `SureMath`: `bpsSum`, `share`, `lineExposures`, `premiumSplit`, `lineShares`, `payable`,
  `settlePlan`, `varianceRate`, `varianceGap`, `loadedPremium`, `varianceStats`.
- `RgenAdapter`: `health`, `config`, `oracleFactory`, `credentialFactory`, `claimFactory`,
  `verifyCredential`, `verifyClaim`, `verifyProvenance`, `variance`, `admin`.

## Placing and policies

- `SlipFactory`: `open`.
- `Slip`: `info`, `subscriptions`, `subscription`, `premium`, `policy`, `accept`,
  `subscribe`, `fundPremium`, `bind`, `expire`.
- `LineFactory`: `create`.
- `Line`: `info`, `remaining`, `paidFor`, `credit`, `pay`, `release`.
- `PolicyFactory`: `create`.
- `Policy`: `info`, `terms`, `lines`, `line`, `claims`, `claim`, `payable`, `distribute`,
  `openClaim`, `settleClaim`, `expire`.

## Claims and cash flow

- `ClaimFactory`: `create`.
- `Claim`: `info`, `evidence`, `addEvidence`, `classify`, `assess`, `agree`, `dispute`,
  `settle`, `close`; `applyDecision` is private to the r-gen OracleCase.
- `DistributionFactory`: `create`.
- `Distribution`: `info`, `plan`, `paid`, `run`.
- `SureFund`: `info`, `balance`, `covered`, `shortfalls`, `contribute`, `cover`, `admin`
  (`setParams`, `setAdmins`).
- `PolicyBook`: `register`, `policy`, `policies`, `byInsured`, `byBroker`, `bySlip`.
- `ClaimBook`: `register`, `claim`, `claims`, `byPolicy`, `byInsured`.
- `VarianceSignalBook`: `register`, `signal`, `signals`, `byAsset`, `byClass`, `bySource`,
  `bySign`, `summary`.
- `SureMath`: `share`, `premiumSplit`, `lineExposures`, `lineShares`, `payable`,
  `settlePlan`, `varianceRate`, `varianceGap`, `loadedPremium`, `varianceStats`,
  `curveStats`, `curveDelta`.

## Authority

- Installer-gated: `SureRoot.register`.
- 2-of-3: `SureRoot` governance, `SureAdmin`, `Payments.admin`, `RgenAdapter.admin`,
  `SureFund.cover/admin`.
- Owner: syndicate, broker, risk, slip, line, policy and claim owner arms.
- Manager: syndicate quote and claim classification/agreement.
- Permissionless with guards: `Slip.bind`, `Slip.expire`, `Policy.expire`, `Claim.settle`,
  `Claim.close`, `Syndicate.expireQuote`, `LineGrant.expire`.
