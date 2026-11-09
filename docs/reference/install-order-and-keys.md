# Install order and keys

> **Status:** Implemented; mirrored in `configs/devnet.json` and `harness/install.py`.

```
00_root.rho
01_kernel.rho
02_admin.rho
03_terms.rho
04_math.rho
05_rgen.rho
40_payments.rho
15_distribution.rho
16_fund.rho
10_syndicate.rho
11_broker.rho
12_risk.rho
13_slip.rho
14_line.rho
17_policy.rho
18_claim.rho
19_books.rho
```

Component keys registered in `SureRoot`:

```
component:root
component:clock
component:verifier
component:codec
component:admin-guard
component:admin
component:terms
component:suremath
component:rgen
component:payments
component:syndicate-book
component:broker-book
component:risk-book
component:slip-factory
component:line-factory
component:distribution-factory
component:fund
component:policy-factory
component:claim-factory
component:policy-book
component:claim-book
component:variance-signal-book
```

Placeholders: `__ROOT_URI__`, `__ADMINS__`, `__THRESHOLD__`, `__RCASH_ROOT_URI__`,
`__PLATFORM_OWNER__`, `__RGEN_ROOT_URI__`.

The installer uses the deployer key and two admin keys (2-of-3). `--dev-single-key` builds a
throwaway 2-of-3 set from one key and must never be used outside a devnet.
