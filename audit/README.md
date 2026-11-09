# r-sure audit and HAZOP

> **Status:** Internal desk, tabletop, install-RCA and match-style review, 2026-11-07. This is not an
> independent audit and does not certify the contracts, r-cash, r-gen or any deployment.
> The 17-term install is E2 green. The behavioural campaign is incomplete: the root suite
> passes, the other registered suites are `not_run` or implemented. Install evidence is
> not behavioural coverage.

This directory is the working audit record. The registers are the editable source of truth;
the book chapters summarise them.

## Start here

| Artifact | Purpose |
|---|---|
| [charter.md](charter.md) | scope, roles and evidence standard |
| [method.md](method.md) | desk, concurrency, composition and HAZOP method |
| [report.md](report.md) | verdict, counts, P0/P1 status, install evidence and residual risk |
| [concurrency/README.md](concurrency/README.md) | per-component concurrency review method |
| [concurrency/components.yaml](concurrency/components.yaml) | one row per component (30) |
| [composition/interfaces.yaml](composition/interfaces.yaml) | one row per interface (46) |
| [hazop/nodes.yaml](hazop/nodes.yaml) | 19 nodes, guide words and parameters |
| [hazop/tabletop-2026-11-05.md](hazop/tabletop-2026-11-05.md) | internal tabletop record |
| [hazop/worksheet-install-2026-11-05.md](hazop/worksheet-install-2026-11-05.md) | install guide-word worksheet for N16–N19 |
| [registers/findings.yaml](registers/findings.yaml) | 31 findings |
| [registers/hazards.yaml](registers/hazards.yaml) | 40 hazards |
| [registers/improvements.yaml](registers/improvements.yaml) | 33 fixes/deferred items |
| [registers/tests.yaml](registers/tests.yaml) | 42 tests: 37 passing, 3 `not_run`, 2 implemented |
| [registers/rca.yaml](registers/rca.yaml) | RCA-001 install, RCA-002 match state-loss and RCA-003 admission/terminal-state root causes |
| [registers/experiments.yaml](registers/experiments.yaml) | 10 RCA experiments with artifacts |
| [rca/template.md](rca/template.md) | RCA template |
| [registers/theorems.yaml](registers/theorems.yaml) | 299 registered Lean component-model theorems |
| [traceability/matrix.md](traceability/matrix.md) | generated arm/hazard/finding/test matrix |
| [evidence/2026-11-05-install-rca/rca.md](evidence/2026-11-05-install-rca/rca.md) | readable install RCA |
| [evidence/2026-11-05-install-rca/manifest.json](evidence/2026-11-05-install-rca/manifest.json) | `rsure.evidence/v2` install evidence manifest |
| [rholang-match-audit.md](rholang-match-audit.md) | match-style audit and refactor record |
| [evidence/2026-11-07-match-style/rca.md](evidence/2026-11-07-match-style/rca.md) | readable match state-loss RCA |

## What to read for the verdict

1. `report.md` — install is E2 green for 17 terms; behavioural coverage is still absent.
2. `findings.yaml` — F-022/F-023/F-024 (install blockers) and F-025 (masked proposer) are fixed.
3. `registers/rca.yaml` — fault tree, five whys, escape analysis and residual risk.
4. `concurrency/reviews/` — one review per component; no component is un-reviewed.
5. `hazop/tabletop-2026-11-05.md` — decisions and the internal-only limitation.

## Reproduce the evidence

```sh
make audit-check
python3 tools/check_take_repost.py
python3 tools/check_bundle_closedness.py
python3 tools/check_reply_shapes.py
python3 tools/check_pause_scope.py
python3 tools/check_match_style.py --check
python3 tools/check_call_arity.py
python3 tools/check_evidence.py
python3 tools/check_rca.py
python3 tools/check_experiments.py
make unit-all
```

The evidence, RCA and experiment checkers run in `make audit-check`.

`deployments/suite-results.json` records the root suite passing; the other registered
suites remain `not_run` or implemented. The install E2 is recorded in
`evidence/2026-11-05-install-rca/`, not in the suite register.

Known gate exception: `python3 tools/check_audit.py` currently fails on Lean
theorem-register drift (more than 100 source theorems are not in `theorems.yaml`) from
concurrent work outside the install RCA. Every other audit gate passes.
