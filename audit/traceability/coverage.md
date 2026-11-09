# Coverage report

> **Status:** Generated from `deployments/suite-results.json`; not line coverage.

| Metric | Covered |
|---|---|
| Passed suites | 37/42 |
| Public arms asserted by passing suites | 128/152 (84.2%) |
| All registered arms asserted | 141/169 (83.4%) |
| Core flow arms asserted | 8/11 (72.7%) |
| Fixed findings with a passing regression suite asserting a linked arm | 23/28 |
| Invariants tracked | 13/13 |

A suite contributes only when it is `pass`, has at least one assertion and
emits `covered_arms` in its `RSURE_RESULT` trailer. Stubs and zero-assertion
suites contribute nothing. A fixed finding is counted only when a linking arm
appears in that asserted set, so the metric is zero before any suite runs.
