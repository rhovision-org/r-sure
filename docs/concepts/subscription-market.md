# Subscription market

> **Status:** Implemented (source + static/parser gates).

A slip is fully subscribed when its lines sum to 10000 bps. Each syndicate manager asks its
syndicate for a quote before the insured binds:

```
manager -> Slip.subscribe
Slip    -> Syndicate.quote(class, slip, shareBps, exposureCap, expiry, slipToken)
Syndicate -> LineGrant (one-shot, captures slipToken)
Slip    stores grantId/grantUri, shareBps and manager
```

The quote reserves capacity (`committed`). At bind, the slip opens every line:

```
Slip -> Syndicate.openLine(grantId, grantUri, policyId, slipId, slipToken, policyToken)
Syndicate -> LineGrant.consume(slipToken)
Syndicate moves committed -> written
Syndicate -> LineFactory.create(creditCap, settleCap, releaseCap, policyToken)
Slip -> PolicyFactory.create(lines, premiumPurse, policyToken, claimToken)
Slip -> Policy.distribute(policyToken)
```

The last line absorbs the aggregate remainder. A subscription is refused if it would push the
running share total above 10000 bps; the check runs before the syndicate quote, so a refused
share reserves no capacity. A grant that is not consumed is revoked by the manager or released
by `Syndicate.expireQuote` after its expiry, so capacity cannot be stuck forever.

`Slip.bind` pre-flights every grant before opening a line. A revoked or expired grant cannot
notify the slip directly, so bind prunes those shares, recomputes the lead, second and status,
and returns `(false, "quote closed")`; the insured can re-subscribe the freed share and bind
again. A grant already marked consumed is surfaced as `(false, "quote consumed")` without
pruning, because its line may already exist.

## Why a grant rather than a bare commitment

The grant captures the slip's private token in its closure. The grant URI is public, but only
the slip that created it can consume it. That is the same pattern as r-share's release token:
the capability is the name, not a record in a data map.
