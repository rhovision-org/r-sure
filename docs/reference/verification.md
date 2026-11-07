# Verification

> **Status:** Static, parser, Lean, audit, behavioural and web gates run and pass locally.
> The Lean model is a shallow component model, not a Rholang refinement.

## Static and parser gates

```sh
make build-check      # no drift in contracts/build
make measure-check    # every term <= 56 KiB
make normalize-check  # every rendered term normalizes through the rholo parser
make spec-check       # arch, captures, select, placeholders, money, suites, arity, match style
make parse-check      # target node parser on built and rendered terms
```

Recorded locally: 17 terms parse; 30 components; 19 state cells; acyclic; all terms within
budget; 168 source arms registered; 285 Lean theorems, 48 vectors and 58 flow rules with
11 `proved-model` core arms. The claims register reports 26 covered, 1 partial and 1 tool
entry, with 176 substantive theorems, 1 weak and no unaudited theorem. The Rust core, keystore, SDK,
CLI and WASM crates compile; `cargo test --workspace` passes 13 tests (5 core, 3 keystore,
4 SDK, 1 CLI). The web app typechecks, runs 8 Vitest tests, lints with no errors and builds;
the three Playwright journeys (wallet and books, placement through claim and fund, admin
pause and resume) pass against the installed devnet.

## Match-style gate (2026-11-07)

```sh
make check-call-arity
make check-match-style
```

```text
check-match-style: self-test: 14 fixture groups passed
check-match-style: 24 files, 411 match sites (113 let, 298 dispatch), 0 violation(s), 0 suppression(s)
  depth histogram: {'0': 79, '1': 214, '2': 97, '3': 21}
```

The scanner is heuristic, not a parser; the self-test covers every rule and the parse gate
still runs the target parser. `make check-call-arity` closes the other silent-stall class
introduced by helper extraction: a call whose argument count differs from the declared
parameter list does not reduce. The audit record is `audit/rholang-match-audit.md`; the rules
are in [Rholang match style](rholang-style.md).

## Audit gates (2026-11-05)

`make audit-check` enforces a concurrency review per component, a composition row per
interface, the F-020/F-021 guard checks and the narrow pause scope, with no unresolved
register IDs. `make audit-scan` runs the heuristic scanners for unclosed bundles,
take-await-take, reply shapes and pause scope.

Current audit state: 30/30 component reviews, 46 interfaces, 40 hazards, 31 findings (28
fixed, 3 accepted boundaries), 33 improvements, 42 registered suites and 285 registered
theorems. `check_bundle_closedness.py` reports zero candidates. The devnet install completes
all 17 terms and the node proposes blocks; the install root-cause analysis is recorded under
`audit/evidence/2026-11-05-install-rca`. F-003 (narrow, fail-closed pause), F-020 (payable
minimum and aggregate guard) and F-021 (terminal claim guards) are fixed; INV-9 and INV-10
are covered, and INV-12 is a source-gated tool check. The tabletop HAZOP is an internal
simulation, not an independent audit. See `audit/report.md`.

## Behavioural, formal and client gates

```sh
make unit-all         # honest pass/fail/not-run
make formal-check     # Lean build, axioms, vectors, flows, claims, critical path
make audit-check      # registers, traceability, concurrency, interfaces, guards and pause scope
make client-check     # Rust fmt/clippy/tests/wasm and the client-term normalizer
make local-reducer    # install the built terms in the node's in-memory reducer
make web-lint web-test web-build
make web-e2e          # Playwright, devnet-gated
```

The behavioural campaign's current output is recorded in `deployments/suite-results.json`:
38 run rows (37 behavioural suites plus the fixture self-check), 438 assertions, 0
assertion failures (2026-11-07, on the refactored tree). The
coverage report derives 37/42 registered suites passing (the rest are three `not_run`
process gates and two implemented static gates), 128/151 public arms, 141/168 all registered
arms and 8/11 core-flow arms asserted. `make web-e2e` passes 3/3 journeys.

The formal gate's current output:

```text
lean: built, 285 axiom audits, 285 source theorems, no sorry/admit/axiom/native_decide
vectors: 48 vectors current
check-flows: 58 rules, 47 arms, 11 core arms proved-model, 0 proof-quality warnings
claims: covered=26, partial=1, deferred=0, tool=1, substantive=176, weak=1, unaudited=0
check-critical-path: 15 critical primitives covered, arms/flows/suites/hazards joined
```

`make client-terms-check` prints the read, resolve, write, funding and payment terms the
SDK builds and runs the node's normalizer over them. The rendered contract terms have the
same gate in `make normalize-check`; the client terms are checked separately because they
are assembled at runtime.

`make local-reducer` goes one step further: it installs all 17 built terms in the node's
own in-memory runtime, executes the 10 `math.*` and 15 `variance.*` model vectors against
`SureMath`, drives a syndicate, broker, risk, slip, bind, claim and settlement, runs 24
refusal vectors and a signed pause/resume, and fails on a reduction error, a wrong refusal or an unexpected state. It needs an RNodeRust
checkout and `protoc`; see [Local reducer](local-reducer.md) for its fixtures and limits.

The suite inventory is in `harness/run_suites.py`. A suite that has not been run must report
`not_run`, not `pass`. The audit evidence directory holds campaign snapshots.

## Honesty rule

"Implemented" means the source plus the static/parser gates and, where stated, a passing
devnet campaign. "Tested" requires a named suite with a passing result. The Lean model is
`proved-model`: it is proved about a shallow state model, not refined to the Rholang terms.
