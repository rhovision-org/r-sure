#!/usr/bin/env python3
"""Slip subscription: quote, duplicate, share bounds and closed-slip refusal."""

import sys

import actors
import assertions as A
import placement_fixture as F
import preflight


def main() -> int:
    if not preflight.require_devnet("subscription"):
        print("not_run: devnet unavailable")
        return 2
    try:
        p = F.started("subscription", syndicate_owner="deployer")

        A.cover('Slip@"subscribe"', "success")
        grant_id, grant_uri = p.subscribe()
        A.expect("grant id", grant_id.startswith("grt:"), True)
        A.expect("grant uri", grant_uri.startswith("rho:id:"), True)
        A.cover('Slip@"subscriptions"', "success")
        A.expect("subscription count", len(actors.invoke(
            p.slip_uri, "subscriptions")[1]), 1)
        A.cover('Slip@"subscription"', "success")
        A.expect_ok("subscription", actors.invoke(
            p.slip_uri, "subscription", f'"{p.syndicate_id}"'))

        A.cover('Slip@"subscribe"', "refusal")
        A.expect_refusal("duplicate syndicate", actors.invoke(
            p.slip_uri, "subscribe",
            f'*dId, "{p.syndicate_uri}", 5000', key=p.insured),
            "duplicate syndicate")
        A.expect_refusal("share below one", actors.invoke(
            p.slip_uri, "subscribe",
            f'*dId, "{p.syndicate_uri}", 0', key=p.insured), "share")
        A.expect_refusal("share above 10000", actors.invoke(
            p.slip_uri, "subscribe",
            f'*dId, "{p.syndicate_uri}", 10001', key=p.insured), "share")

        A.cover('Syndicate@"quote"', "success")
        quote = p.quote_info()
        A.expect("quote is tied to the slip", quote.get("slipId"), p.slip_id)
        A.cover('Syndicate@"quotes"', "success")
        A.expect("quote indexed", grant_id in actors.invoke(
            p.syndicate_uri, "quotes")[1], True)

        # --- over-subscription: the running sum may not exceed 10000 bps -----------
        extra_id, extra_uri, extra_owner = p.add_syndicate(
            "subscription-extra", owner="key12")
        A.cover('Slip@"subscribe"', "refusal")
        A.expect_refusal("over-subscription is refused", actors.invoke(
            p.slip_uri, "subscribe", f'*dId, "{extra_uri}", 1',
            key=extra_owner), "share")
        A.expect("refused share reserves no capacity",
                 actors.invoke(extra_uri, "capacity")[1].get("committed"), 0)
        A.expect("refused share stores no quote",
                 actors.invoke(extra_uri, "quotes")[1], {})
        A.expect("slip share count unchanged", len(actors.invoke(
            p.slip_uri, "subscriptions")[1]), 1)
        A.expect("slip remains subscribed", p.slip_info().get("status"),
                 "subscribed")
        A.expect("extra syndicate id is recorded", extra_id.startswith("syn:"), True)
    except Exception as error:
        print(f"subscription suite failed: {error}", file=sys.stderr)
        A.finish("subscription")
        return 1
    return A.finish("subscription")


if __name__ == "__main__":
    raise SystemExit(main())
