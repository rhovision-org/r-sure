# Project status

> **Status:** Contracts, formal model, audit, behavioural campaign and web client are
> implemented; the gates below are green on the local devnet. This page is the single
> status summary for the repository.

## At a glance

| Area | Current state |
|---|---|
| Contracts | 17 deploy terms installed on devnet; 30 catalogue components and 19 state cells; static, parser, normalize and size gates pass. |
| Formal model | 288 Lean theorems, 48 vectors, 58 flow rules and 11 `proved-model` core arms; 15 critical primitives covered. Claims register: 26 covered, 1 partial, 1 tool; 176 substantive theorems, 1 weak, 0 unaudited. |
| Audit | 25 findings (22 fixed, 3 accepted boundaries), 36 hazards, 25 improvements; 30/30 concurrency reviews and 46/46 composition interfaces. |
| Tests | 42 registered suites; 37 passing, 3 `not_run` process gates and 2 implemented static gates. The campaign records 38 runs, 438 assertions and 0 assertion failures. |
| Coverage | 128/151 public arms (84.8%), 141/168 all registered arms (83.9%), 8/11 core-flow arms; 23/28 fixed findings have a passing regression suite. |
| Web client | React/Vite app with wallet, reads, placement, policy, claim, fund and 2-of-3 admin flows; typecheck, Vitest, ESLint, production build and Playwright pass. |
| Documentation | mdBook under `docs/`; `make docs-check` passes. |

Measured 2026-11-06 from `deployments/suite-results.json`, the audit registers and the
formal gate output. The coverage report is generated from the same results file.

## What is verified

The devnet install completes all 17 terms and the node proposes blocks. The campaign runs
the unit, integration and fault suites against the installed contracts: capital, quotes and
lines, broker registration, risk submission and assessment, slip subscription and binding,
premium distribution, policy aggregate, the claim lifecycle and refusals, central-fund
shortfalls, settlement conservation, pause scope, replay and the r-cash/r-gen/r-share
boundaries.

The local reducer installs all 17 terms in the node's own in-memory runtime and drives a
placement from syndicate creation through claim settlement and close, with no devnet. It
executes the 10 `math.*` and 15 `variance.*` model vectors against `SureMath`, drives the
variance conversion from a stub K-Asset through assessment and acceptance, asserts 24
refusal vectors with their exact reasons, signs a 2-of-3 pause and resume, pauses writes
while reads stay available, and asserts that the root resolves all 21 components. See
[Local reducer](../reference/local-reducer.md).

The formal model proves the insurance economics over a shallow state model: capacity,
subscription, premium allocation, payable bounds, settlement conservation, exactly-once
guards, terminal claim states, the central fund, the linear cell and the variance/risk
identity. It is **not** a refinement of the Rholang contracts. The 15 critical primitives
are model-covered, not mechanically linked to the deployed terms. See [Formal model](../reference/formal-model.md),
[Proof map](../reference/proof-map.md) and [Invariants](../reference/invariants.md).

The web client is exercised by Playwright against the same devnet: it boots, creates and
funds a wallet, reads the books, creates a syndicate and contributes capital, registers a
broker, submits a risk, opens a slip, subscribes the syndicate, accepts, funds the premium,
binds the policy, opens a claim, classifies, assesses, agrees, settles and closes it,
contributes to the central fund, and pauses and resumes the market with two of three admin
signatures. See [Use the web client](../guides/use-the-web-client.md).

## Boundaries

- **F-014 (P2, accepted).** `Line.pay` trusts the `claimId` supplied by the policy; the
  policy and claim factories are the only callers, and the line is private to the policy
  closure.
- **F-017 (P2, accepted).** The risk tri-test checks that the three answers are present,
  not that they are substantively correct; the variance measure now adds a quantitative
  magnitude, but correctness remains an evidence-layer concern.
- **F-018 (P2, accepted).** External reply shapes (r-cash, r-gen, purse and account
  capabilities) are assumed to match their published interfaces.
- **`not_run` process gates.** T-037 (install pipeline), T-038 (deep Par codec) and T-039
  (no manual propose) are Rust/process checks run by `cargo test` and the install
  scripts, not by the behavioural campaign. They are registered as `not_run` rather than
  claimed as passing suites.
- **Variance estimator (boundary).** The quality-rubric mapping is an implied rate, not a
  statistical moment from observed K-Asset values. `approval.liability.shareBps` is a
  declared indemnity share and is excluded from the engineering rate. The K-Asset hash is a reference, not a
  recomputed digest; an attestation is an off-chain claim that r-sure records but does not
  verify. The measured variance identity is about the modelled value distribution.
- **Evidence.** The tabletop HAZOP is an internal simulation, not an independent audit.
  Dynamic audit evidence for the accepted boundaries remains limited to the campaigns
  recorded under `audit/evidence/`.

## How to verify

```sh
make check          # static, parser, normalize and docs gates
make formal-check   # Lean, vectors, flows, claims and critical path
make audit-check    # registers, traceability, concurrency, interfaces, guards and pause
make unit-all       # behavioural suites against the installed devnet
make client-check   # Rust fmt/clippy/tests/wasm
make web-lint web-test web-build
make web-e2e        # Playwright against the installed devnet
```

The detailed gate list and honesty rule are in [Verification](../reference/verification.md).

## Audit and test records

- [Audit report](https://github.com/rhovision-org/r-sure/blob/main/audit/report.md)
- [Findings register](https://github.com/rhovision-org/r-sure/blob/main/audit/registers/findings.yaml)
- [Hazards register](https://github.com/rhovision-org/r-sure/blob/main/audit/registers/hazards.yaml)
- [Improvements register](https://github.com/rhovision-org/r-sure/blob/main/audit/registers/improvements.yaml)
- [Test register](https://github.com/rhovision-org/r-sure/blob/main/audit/registers/tests.yaml)
- [Theorem register](https://github.com/rhovision-org/r-sure/blob/main/audit/registers/theorems.yaml)
- [Concurrency reviews](https://github.com/rhovision-org/r-sure/tree/main/audit/concurrency)
- [Composition interfaces](https://github.com/rhovision-org/r-sure/blob/main/audit/composition/interfaces.yaml)

## Next milestones

1. Run the three `not_run` process gates as first-class campaign rows.
2. Exercise the derivation against a live r-gen-approved K-Asset; the devnet test currently
   uses a stub, and the integration suite covers the read shape but not a real approval.
3. Separate the insurer role from the insured/broker in `Risk.assess`; the two estimates and
   the gap are recorded, but the caller authorization is still the current owner guard.
