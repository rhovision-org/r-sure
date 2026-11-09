# Contract map

> **Status:** Implemented; checked against `contracts/components.json`.

| Deploy file | Components | State cells |
|---|---|---|
| `00_root.rho` | SureRoot | `rootState` |
| `01_kernel.rho` | Clock, Verifier, Codec | none |
| `02_admin.rho` | AdminGuard, SureAdmin | `adminState` |
| `03_terms.rho` | CoverTerms | none |
| `04_math.rho` | SureMath | none |
| `05_rgen.rho` | RgenAdapter | `rgenState` |
| `40_payments.rho` | Payments | `paymentsState` |
| `10_syndicate.rho` | SyndicateBook, Syndicate, LineGrant | `syndicateBookState`, `syndicateState`, `grantState` |
| `11_broker.rho` | BrokerBook, Broker | `brokerBookState`, `brokerState` |
| `12_risk.rho` | RiskBook, Risk | `riskBookState`, `riskState` |
| `13_slip.rho` | SlipFactory, Slip | `slipState` |
| `14_line.rho` | LineFactory, Line | `lineState` |
| `15_distribution.rho` | DistributionFactory, Distribution | `distributionState` |
| `16_fund.rho` | SureFund | `fundState` |
| `17_policy.rho` | PolicyFactory, Policy | `policyState` |
| `18_claim.rho` | ClaimFactory, Claim | `claimState` |
| `19_books.rho` | PolicyBook, ClaimBook, VarianceSignalBook | `policyBookState`, `claimBookState`, `varianceSignalBookState` |

## Dependencies

```
SureRoot -> Clock/Verifier/Codec/AdminGuard/SureAdmin/CoverTerms/SureMath/Payments
Payments -> r-cash Root
RgenAdapter -> optional r-gen Root, SureMath (varianceRate/curveStats), KAsset (read-only get)
SyndicateBook -> Payments -> Syndicate -> LineGrant
BrokerBook -> Broker
RiskBook -> Risk -> SureMath (varianceGap/loadedPremium/curveStats/curveDelta), RgenAdapter (variance), Clock
SlipFactory -> BrokerBook/CoverTerms/Payments -> Slip -> Syndicate/Risk
LineFactory -> Line -> Syndicate capabilities
DistributionFactory -> Distribution -> Payments/SureFund/Line
PolicyFactory -> Policy -> SureMath/SureFund/Line/ClaimFactory
ClaimFactory -> Claim -> Policy/RgenAdapter
PolicyBook/ClaimBook -> Policy/Claim
VarianceSignalBook -> Risk/Clock
```

The graph is acyclic in `contracts/components.json`. Runtime resolution is per arm, so a
later-installed factory is safe for an earlier consumer.
