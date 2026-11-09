# Proof map

> **Status:** Rendered from `spec/lean/claims.yaml` and `spec/flows/core.yaml`. The register
> is authoritative; this page is a reading aid. `proved-model` is not a Rholang refinement.

## Invariants

| ID | Predicate | Carrying theorems | Flow rules | Status |
|---|---|---|---|---|
| INV-1 | `Syndicate.SyndicateWF` | `synd_quote_WF`, `synd_openLine_WF`, `synd_release_restores`, `synd_payLoss_preserves_free` | F-001, F-002 | covered |
| INV-2 | `Slip.bind` | `slip_bind_requires_subscription`, `slip_bind_moves` | F-003 | covered |
| INV-3 | `Math.alloc` | `math_alloc_sums`, `distribution_plan_sums` | F-003, F-007 | covered (guard-conditional) |
| INV-4 | `Policy.distribute` | `math_premiumSplit_conserves`, `policy_distribute_conserves`, `policy_distribute_once` | F-003, F-004 | covered (guard-conditional) |
| INV-5 | `Math.payable` | `math_payable_le_agreed`, `math_payable_le_perClaim`, `math_payable_le_aggregate`, `math_payable_zero_of_le_deductible` | F-006 | covered |
| INV-6 | `System.system_settlement_conserves` | `system_settlement_conserves`, `policy_settle_conserves`, `fund_conserves` | F-006, F-007, F-008 | covered |
| INV-7 | `Line.LineWF` | `line_pay_bounded`, `synd_written_le_capital` | F-001, F-002, F-009 | covered |
| INV-8 | once-per-claim guards | `line_pay_once`, `line_pay_once_per_claim`, `policy_settle_once`, `fund_cover_once`, `claim_settle_once`, `oracle_execute_once` | F-005, F-008, F-009, F-011 | covered |
| INV-9 | `Policy.settleClaim` | `policy_settle_remaining`, `policy_settle_aggregate`, `policy_settle_guard` | F-006 | covered |
| INV-10 | terminal guards | `claim_settle_once`, `claim_terminal_sticky`, `policy_terminal`, `claim_agree_terminal`, `claim_applyDecision_terminal` | F-005, F-010 | covered |
| INV-11 | `System.transfer`, `Linear.Cell.commit` | `system_step_atomic`, `system_step_refuses`, `commit_all_or_none`, `commit_keeps_held` | none | partial (ERTP assumed) |
| INV-12 | pause boundary | `tools/check_pause_scope.py` | none | tool |
| INV-13 | `Variance.risk_is_variance` | `risk_is_variance`, `ssNum_reflect`, `ssNum_shift`, `qualityVariance_le`, `loadedPremium_ge_expected`, `gapFlag_sound` | C-041..C-047 | covered (estimator boundary) |
| INV-14 | `Curve.relativeVarianceGap` | `relativeVarianceGap_reflect`, `relativeVarianceGap_shift`, `l1Minus_nonneg`, `l1Plus_nonneg`, `maxDev_nonneg`, `signalPut_same`, `signalPut_stale`, `signalPut_replace` | none | model-only (curve boundary) |

## Cornerstone flows

| Rule | Arm | Primary theorem | Invariants |
|---|---|---|---|
| F-001 | `Syndicate@"quote"` | `Syndicate.synd_quote_WF` | INV-1, INV-7 |
| F-002 | `Syndicate@"openLine"` | `Syndicate.synd_openLine_WF` | INV-1, INV-7 |
| F-003 | `Slip@"bind"` | `Slip.slip_bind_requires_subscription` | INV-2, INV-3, INV-4 |
| F-004 | `Policy@"distribute"` | `Policy.policy_distribute_conserves` | INV-4 |
| F-005 | `Claim@"settle"` | `Claim.claim_settle_once` | INV-8, INV-10 |
| F-006 | `Policy@"settleClaim"` | `Policy.policy_settle_aggregate` | INV-6, INV-8, INV-9 |
| F-007 | `Distribution@"run"` | `Distribution.distribution_run_sums` | INV-4, INV-6 |
| F-008 | `SureFund@"cover"` | `Fund.fund_cover_once` | INV-6, INV-8 |
| F-009 | `Line@"pay"` | `Line.line_pay_once` | INV-7, INV-8 |
| F-010 | `Claim@"agree"` | `Claim.claim_agree_standard_lead` | INV-10 |
| F-011 | `Claim@"dispute"` | `Claim.claim_apply_uphold` | INV-8 |

## Components

| Component | What the model proves | What is assumed or out of scope |
|---|---|---|
| `SureRoot` | none | installer gate, 2-of-3 signatures and nonce are a boundary |
| `Clock` | block-height arithmetic is a `Nat` input | proposer clock and chain height are not modelled |
| `Verifier` | hash/signature interface is opaque | cryptography is assumed |
| `Codec` | terms are ids and lists | canonical hashing is assumed |
| `AdminGuard` | none | threshold and distinct-key semantics are assumed |
| `SureAdmin` | pause is a boundary flag | F-003 fixed; new-risk arms consult `isPaused` and fail closed |
| `CoverTerms` | `terms_validate_sound` extracts limits, deductible, bps and period bounds | class strings, evidence URIs and licence quality are off-chain |
| `SureMath` | premium split, payable, allocation, exposure sum | signed integer and overflow bounds are assumed |
| `RgenAdapter` | none | r-gen availability, credential truth and OracleCase binding are assumed |
| `Payments` | none | ERTP total conservation is assumed |
| `SyndicateBook` | none | registration authority and uniqueness are not modelled |
| `Syndicate` | capacity, quote, openLine, release, payLoss | purse custody and member withdrawal are ERTP |
| `LineGrant` | `grant_consume_once`, `grant_consume_moves` | grant URI resolution is assumed |
| `LineFactory` | constructor postcondition is `LineState` init | creation is Rholang, not modelled |
| `Line` | pay once, paid <= exposure, release credit | credit capability deposit is ERTP |
| `BrokerBook` | none | owner authority and licence validity are off-chain |
| `Broker` | commission cap is a terms bound | licence truth is off-chain |
| `RiskBook` | none | risk registration authority is not modelled |
| `Risk` | tri-test presence is a terms guard | probability and cost quality are off-chain |
| `DistributionFactory` | plan construction is `buildPlan` | purse creation is ERTP |
| `Distribution` | plan sums, last remainder, run once | native move is ERTP |
| `SureFund` | cover cap, balance conservation, one-shot, nonce advances | 2-of-3 signatures and discretionary cover policy are assumed |
| `SlipFactory` | constructor postcondition is `SlipState` init | creation is Rholang |
| `Slip` | full subscription, funding, bind, expiry refund | premium refund is ERTP |
| `PolicyFactory` | constructor postcondition is `PolicyState` init | creation is Rholang |
| `Policy` | premium conservation, payable bound, settle once, aggregate update | claimId/policy binding and fund lookup are assumed |
| `ClaimFactory` | constructor postcondition is `ClaimState` init | creation is Rholang |
| `Claim` | lead/follow agreement, adjudication mapping, settle once | r-gen truth and applyDecision binding are assumed |
| `PolicyBook` | unique register, lookup soundness | none material |
| `ClaimBook` | unique register, lookup soundness | none material |

## Capability sub-contracts

| Capability | Model theorem | Status |
|---|---|---|
| `LineCredit` | `Line.line_credit_sound`, `Line.line_credit_conserves` (conditional on `ertp.native_total`) | covered |
| `LineSettle` | `Line.line_pay_once`, `Line.line_pay_bounded` | covered |
| `LineRelease` | `Line.line_release_restores` | covered |
| `applyCap` | `Oracle.oracle_execute_once`, `Claim.claim_apply_case_bound` | covered |

## Critical path

The campaign gate is `spec/critical-path.yaml`; `tools/check_critical_path.py` joins it to
`claims.yaml`, the Lean declarations and axiom audit, the flow rules, the arm register and
the suite register. All 15 primitives are `covered` as model-only proofs.

| ID | Primitive | Arms | Model | Soundness theorem | Classes |
|---|---|---|---|---|---|
| CP-01 | RootAuthority | `SureRoot` register/rotate/freeze/admin | `Model/Root.lean` | `root_register_sound` | authority |
| CP-02 | AdminAuthority | `AdminGuard@"verify"`, `SureAdmin` admin/isPaused | `Model/Admin.lean` | `admin_sound` | authority |
| CP-03 | PaymentsRail | `Payments` issuer/depositFacet/ensureAccount | `Model/Payments.lean` | `payments_deposit_sound` | authority, conservation |
| CP-04 | SyndicateCapacity | `Syndicate` quote/openLine/expireQuote | `Model/Syndicate.lean` | `synd_quote_sound` | capacity |
| CP-05 | LineGrant | `LineGrant@"consume"` | `Model/Grant.lean` | `grant_consume_sound` | binding, exactly-once |
| CP-06 | SlipSubscription | `Slip` accept/subscribe | `Model/Slip.lean` | `slip_accept_sound` | authority, binding |
| CP-07 | SlipFunding | `Slip` fundPremium/expire | `Model/Slip.lean` | `slip_fund_sound` | conservation, terminal |
| CP-08 | SlipBinding | `Slip@"bind"` | `Model/Slip.lean` | `slip_bind_sound` | binding |
| CP-09 | LineSettlement | `Line` pay/release/credit, `LineCredit` | `Model/Line.lean` | `line_pay_sound` | conservation, exactly-once, terminal |
| CP-10 | PremiumDistribution | `Distribution` plan/run, `Policy@"distribute"` | `Model/Distribution.lean` | `distribution_run_sound` | conservation, exactly-once |
| CP-11 | PolicySettlement | `Policy` settleClaim/expire/payable, `SureMath@"payable"` | `Model/Policy.lean` | `policy_settle_sound` | conservation, exactly-once, terminal |
| CP-12 | ClaimStateMachine | `Claim` agree/assess/dispute/settle | `Model/Claim.lean` | `claim_agree_sound` | binding, terminal, exactly-once |
| CP-13 | FundCover | `SureFund` cover/contribute/admin | `Model/Fund.lean` | `fund_cover_sound` | conservation, exactly-once, authority |
| CP-14 | OracleDecision | `RgenAdapter` verifyClaim/verifyCredential, `Claim@"dispute"`, `applyCap@"applyDecision"` | `Model/Oracle.lean` | `oracle_decision_sound` | binding, exactly-once, terminal |
| CP-15 | VarianceConversion | `SureMath` varianceRate/varianceGap/loadedPremium, `RgenAdapter@"variance"`, `Risk` assess/variance/accept | `Model/Variance.lean` | `variance_sound` | binding, bound |

The variance flows are C-041..C-047 in `spec/flows/critical.yaml`; every target is a
substantive theorem in `Model/Variance.lean`, and the arm register and suites join through
`check_critical_path.py`.

`Model/Curve.lean` carries the INV-14 curve-delta theorems and the signal nonce transition.
It is a model-only extension: it is registered in `theorems.yaml` and the local reducer, but
it is not yet joined to a critical-path claim.

The composed settlement path `Claim -> Policy -> lines -> Fund` is modelled in
`Model/System.lean` by `EngineState`/`settleEngine`. It calls the component
`Policy.settleClaim`, `Claim.settleExact` and `Fund.cover` functions and proves
`system_composition_sound` (claim paid = payable, line book paid, fund balance
conservation, aggregate decrease, payable bounds) and `system_composition_once`
(a settled claim refuses a second settlement).

`Model/Math.lean` also models the deployed `SureMath@"payable"` refusal arm as
`payableGuarded`: `math_payableGuarded_accepts` proves the non-negative path returns
`payable`, `math_payableGuarded_agrees` proves the guarded result agrees with the model,
and `math_payableGuarded_aggregate_unreachable` proves the aggregate refusal branch cannot
fire on non-negative inputs.

## Maintenance

`spec/lean/claims.yaml` is the source of truth. Update it with the carrying theorem, the
flow manifest and `RSure/Audit.lean` in the same change. Run:

```sh
python3 tools/check_claims.py --check --strict-audit
python3 tools/check_flows.py --strict
python3 tools/check_audit.py
python3 tools/check_critical_path.py --check
```
