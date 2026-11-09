# r-sure, as exos

r-sure's open insurance market (syndicates, placing slips, policies, claims, and a central fund), ported from Rholang to exos in [toybox](https://github.com/dckc/vattr97/tree/toybox-kernel/packages/toybox) zones on [workerd](https://github.com/cloudflare/workerd). Where r-sure checks who signed a deploy, each party here holds a facet: a syndicate's manager holds its `manager` facet, the insured holds the slip's `insured` facet, and only the policy holds its lines' `policy` facets.

## Scope

The canonical r-sure implementation is the Rholang in [contracts](../contracts) for the rholo
node. This `js/` tree is a sibling, non-canonical port for the toybox/Endo/Agoric ecosystem:
a separate implementation that shares r-sure's semantics and test vectors, not the rholo
implementation. It does not run on rholo and is outside rholo's verification, audit, status
and coverage claims.

The rails differ. This port uses Agoric's
[`@agoric/ertp`](https://github.com/Agoric/agoric-sdk/tree/master/packages/ERTP); r-sure on
rholo uses rholo's native `rho:rchain:ertp` through
[r-cash](https://github.com/rhovision-org/r-cash). This port does not use
[OCapN](https://ocapn.org); an OCapN/Agoric bridge would be a separate interop path, not the
same thing.

Objects here are exos in toybox zones on workerd; `durable` means toybox's durable zone
storage, not a Cloudflare Durable Object and not Endo's durable objects generally.

CI for this tree is [`.github/workflows/js.yml`](../.github/workflows/js.yml), advisory and
separate from the rholo gates.

## Getting started

```sh
cd js
corepack yarn install
corepack yarn test
```

The tests tell [the engineering cover case study](../docs/case-studies/engineering-cover.md) with actors, each holding only her own authority ([test/actors.js](test/actors.js)): Ines insures her project through Bea, the broker, with Lena's, Sol's, and Tess's syndicates at 50/30/20, which Mia backs; Otto runs the market and its central fund. A defect is claimed, adjusted by Lena and Sol, and paid, all in Bucks, an [ertp-books](https://github.com/dckc/vattr97/tree/ertp-books-escrow/packages/ertp-books) issuer over a GnuCash ledger in memory, in a heap zone; in one test the vat restarts between binding and the claim.

## From Rholang to exos

| r-sure in Rholang                                            | here                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `authOwner(deployerId)`: is the signer the owner or manager? | a facet: whoever holds `manager` is the manager                                                     |
| slip, policy, and claim tokens, compared `*a != *b`          | the facet itself; a line's `policy` facet is held by its policy alone                               |
| `LineGrant` captures the slip's token                        | the grant's `slip` facet goes to the slip; its `manager` facet, to revoke, goes to the manager      |
| one state cell per object: consume, check, repost            | exo state: check, change, then await the money, undoing the change if the payment fails             |
| `1/0` aborts the deploy after a value move                   | a payment that fails goes back to the purse it came from; settlement and distribution can run again |
| `Root.resolve` by component name, per arm                    | references the market hands out; a syndicate finds a slip's own facet by the slip's view            |
| block height from `rho:block:data`                           | a `clock` power, `getHeight()`                                                                      |
| 2-of-3 admin signatures on `SureFund.cover`                  | the fund's `governor` facet; a multisig contract could hold it                                      |
| r-cash accounts and deposit facets                           | ERTP purses and deposit facets of one issuer (ertp-books' in the tests)                             |
| a `(brand, Int)` pair                                        | an ERTP `Amount<'nat'>`, `{ brand, value }`, checked against the market's brand                     |

[CoverTerms](src/terms.js) and [SureMath](src/math.js) are plain functions, tested against r-sure's own vectors, which its Lean model emits. Its syndicate, grant, line, slip, distribution, policy, fund, and claim vectors are met by the kinds themselves, in [test/vectors.test.js](test/vectors.test.js).

## Where it differs

- A subscription past 10000 bps is refused. In r-sure it's recorded, and the slip can't bind.
- A revoked quote drops out of its slip, so another syndicate can take up the share. In r-sure the share stays, and the slip can't bind.
- `fundPremium` takes exactly the premium, and sends anything else back.
- A claim whose payable is 0 (within the deductible) settles, paying nothing. In r-sure each line refuses to pay 0, so the settlement aborts.
- `minSyndicates` and `maxSyndicates` are enforced, at bind and subscribe.
- Lead is the first syndicate to subscribe; second is the largest share of the rest.
- A market takes one issuer, so its records carry no `assetId`.

## Not yet ported

Risks and the variance measure, r-gen disputes (`OracleCase` and `applyDecision`), the broker, policy, and claim books, the global pause, `Distribution` as an object of its own for r-share, and the Rust and web clients.

## License

AGPL-3.0-only, as the rest of r-sure; see [LICENSE](../LICENSE). Ported from the Rholang in [contracts](../contracts) at 1160bc7.
