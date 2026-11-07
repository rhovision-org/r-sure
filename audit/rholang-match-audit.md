# Rholang match audit

> **Status:** Internal audit, 2026-11-07. Static gate only; behavioural coverage is in the
> suite registers. No production claim.

## Scope

Every `.rho` file under `contracts/src` (24 files, 17 deploy terms plus six library
fragments). The audit measures non-let `match` and tag-dispatch `if`, classifies each match
as a let or a dispatch, and checks depth, state ownership, arm reachability and duplicated
work. The scanner is `tools/rholang_match.py`; the gate is `tools/check_match_style.py`.

## Measured inventory

| | Before | After |
|---|---|---|
| Match sites | 397 | 411 |
| Lets | 109 | 113 |
| Dispatch | 288 | 298 |
| Depth histogram | `{0:73,1:163,2:81,3:30,4:24,5:12,6:9,7:5}` | `{0:79,1:214,2:97,3:21}` |
| Violations | 64 (41 M-001, 19 M-004, 4 M-005) | 0 |
| Suppressions | 0 | 0 |

The site count rose because staged helpers introduce one explicit `match` for the reply
they forward; the dispatch depth fell by construction. The maximum was 7 (`SlipFactory.open`,
`Policy.settleClaim`); it is now 3. The 2026-11-07 admission fixes added five private slip
helpers, the zero-payment branch and the stale-share pre-flight, raising the count from 403
to 411 while keeping the maximum at 3.

## Rules

| ID | Gated | Rule |
|---|---|---|
| M-001 | yes | Non-let dispatch depth > 3 (nested non-let `match` or tag-dispatch `if`; `contract` resets; `for`, `new`, guards, `else` and lets do not count). |
| M-002 | yes | Same-enum `else if` ladder; one membership `\|\|` test is allowed. |
| M-003 | yes | A mutating match has no total arm. |
| M-004 | yes | The total arm does not repost the held cell and reply; `1/0` is an accepted abort; forwarding the cell and reply to a checked helper is accepted. |
| M-005 | yes | Identical bodies, duplicate patterns, or a catch-all before the last arm. |
| M-006 | yes | A single `_`/binder arm followed by a presence test on the same scrutinee. |
| M-007 | yes | A match token that cannot be parsed or count drift. |
| M-008 | yes | A match with no arms. |
| A-001 | advice | Map pattern without `..._`. |
| A-002 | advice | Class list duplicated across files. |

A match is **mutating** when a state cell was consumed (`<-`, not `<<-`) on the path to the
match and not reposted, or when the enclosing helper takes a state-cell parameter. A consume
or repost inside a sibling arm or the other side of a guard is not on the path and does not
count; this removed the false positives that a purely textual repost search produced.

## Findings

| Finding | Severity | Summary | Fix |
|---|---|---|---|
| F-026 | P2 | 41 dispatch sites above depth 3; deep ladders hid repost ownership. | R-026 |
| F-027 | P1 | Mutating matches replied on refusal paths without reposting; duplicate registration and failed component lookup leave the instance cell empty. | R-027 |
| F-028 | P3 | Four identical recursion arms; wildcard-then-presence-test arms; a duplicated settlement block. | R-028 |
| R-029 | tooling | The scanner, gate, docs and `spec-check` wiring. | — |

The 19 missing-repost sites span Syndicate, Broker, Distribution, SureFund, Policy and
LineSettle. F-027 is a concurrency finding, not code hygiene: the duplicate-owner arms in
`BrokerBook.create` and `SyndicateBook.create` are reachable by registering the same owner
twice, and the component-unavailable arms are reachable when a registry lookup fails. In
both cases the only datum in the cell was consumed, so every later call blocks. HZ-037 and
RCA-002 record it.

## Refactor record

| File | Before | After |
|---|---|---|
| `03_terms.rho` | `CoverTerms.validate` depth 4, identical evidence/claims arms | One membership arm per policy and a top-level `termsPolicyOk` helper. |
| `05_rgen.rho` | Variance status ladder depth 5 and identical status arms | `varianceStatusOk`, `varianceFirstFailure`, `varianceVerdict`, `varianceApproved`, `rgenApplyAction`; first-failure order kept as nested matches. |
| `10_syndicate.rho` | `lineSettleCap` 4–6, `withdrawCapital` 4–6, `openLine` 4–6, duplicate-owner state loss | `lineSettleBalance/Payments/Move`, `syndicateWithdrawCheck/Payments/Move`, `syndicateOpenLineFactory/Grant/Create/Bind`; every refusal reposts. |
| `11_broker.rho` | Duplicate-owner arm consumed `brokerBookState` and replied | Reposts the snapshot before the refusal. |
| `13_slip.rho` | `expireQuotes` four identical arms; `refund` 4, `fundDeposit` 4, `bindPolicy` 6, `SlipFactory.open` 7 | `slipExpireQuotes` recurses once; `slipRefund*`, `slipFundIssuer/Amount`, `slipBindTerms/Lines/Create/Distribute`, `slipOpenBroker/Terms/Payments/Purse/Height`; issuer, purse and height failures now reply instead of stalling. |
| `15_distribution.rho` | `run` catch-all did not repost `distState` | Reposts before the refusal. |
| `16_fund.rho` | `contribute`/`cover` depth 5–6 | `fundContributeIssuer/Amount`, `fundContributionNew`, `fundCoverFacet/Move`. |
| `17_policy.rho` | `distribute` 7, `settleClaim` 7, duplicated settlement block, refusal arms without repost | `policyDistributeResolve/Shares/Plan/Factory/Run`, `policySettleMath/Cover/Apply`; the covered and uncovered branches share `policySettleApply`. |
| `40_payments.rho` | Health nested tuple unwrap, admin action depth | One `(a,b,c)` match; `paymentsApplyAction`. |

Preserved at every site: public arm signatures, first-match order, refusal strings, reply
arity, capability names, one consume and one repost owner, and every deliberate `1/0`.
Where a refusal previously left the caller waiting (a receive pattern that could not match),
the refactor replies with the failure tuple instead; that is the M-003/M-004 intent.

## Limitations

- The scanner is a brace/token heuristic, not a parser. Comments, strings and backtick URIs
  are masked; match bodies are found at brace level. `make parse-check` remains the syntax
  gate.
- M-004 accepts a total arm that forwards the cell and reply channel to a helper defined in
  the same file. The helper is checked on its own; the checker does not prove the forwarded
  call completes.
- The ladder rule recognises a same-enum comparison with a literal; it does not evaluate
  computed tags.
- The audit has no behavioural suite of its own. The existing suites and the local reducer
  prove the refactors preserve behaviour; the gate prevents regressions in shape.
- The audit is internal, not independent.

## Evidence

`audit/evidence/2026-11-07-match-style/` holds the before and after reports, the self-test,
the gate output and the manifest. Reproduce with:

```sh
make check-match-style
make check-match-style-report
```
