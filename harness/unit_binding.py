#!/usr/bin/env python3
"""Slip binding: full subscription, policy creation, line opening and one-shot bind."""

import sys

import actors
import assertions as A
import placement_fixture as F
import preflight


def main() -> int:
    if not preflight.require_devnet("binding"):
        print("not_run: devnet unavailable")
        return 2
    try:
        p = F.started("binding", syndicate_owner="deployer")

        A.cover('Slip@"accept"', "success")
        A.expect_ok("accept", p.accept())
        A.cover('Slip@"subscribe"', "success")
        p.subscribe()
        A.cover('Slip@"fundPremium"', "success")
        A.expect("fund the exact premium", p.fund_premium(), p.premium)
        A.expect("fully funded", p.slip_info().get("funded"), p.premium)

        A.cover('Slip@"bind"', "success")
        policy_uri = p.bind()
        A.expect("slip bound", p.slip_info().get("status"), "bound")
        A.expect("policy URI", policy_uri.startswith("rho:id:"), True)
        A.cover('PolicyFactory@"create"', "success")
        A.expect("policy created", p.policy_info().get("id"), f"pol:{p.slip_id}")
        A.cover('LineFactory@"create"', "success")
        A.expect("one line created", len(p.policy_lines()), 1)
        A.cover('Slip@"bind"', "refusal")
        A.expect_refusal("bind is one-shot", actors.invoke(p.slip_uri, "bind"),
                         "closed")
        A.cover('Slip@"policy"', "success")
        A.expect("slip points at the policy", actors.invoke(p.slip_uri, "policy"),
                 (True, policy_uri))

        # --- revoked grant: bind prunes the dead share and stays recoverable ------
        r = F.started("binding-revoked", syndicate_owner="key14")
        grant, _ = r.subscribe()

        A.cover('Syndicate@"revokeQuote"', "success")
        A.expect_ok("manager revokes the grant", actors.invoke(
            r.syndicate_uri, "revokeQuote", f'*dId, "{grant}"',
            key=r.syndicate_owner))
        A.expect("grant is revoked", r.quote_info().get("status"), "revoked")
        A.expect("revoke frees capacity",
                 r.syndicate_capacity().get("committed"), 0)

        r.accept()
        r.fund_premium()
        A.cover('Slip@"bind"', "refusal")
        A.expect_refusal("bind prunes the revoked share",
                         actors.invoke(r.slip_uri, "bind"), "quote closed")
        info = r.slip_info()
        A.expect("revoked share removed", info.get("shares"), {})
        A.expect("slip stays open", info.get("status"), "open")
        A.expect("removed share is not lead",
                 info.get("lead") != r.syndicate_id, True)
        A.expect("removed share is not second",
                 info.get("second") != r.syndicate_id, True)

        A.cover('Slip@"subscribe"', "success")
        r.subscribe()
        A.expect("resubscribed", r.slip_info().get("status"), "subscribed")
        A.expect("rebind returns a policy", r.bind().startswith("rho:id:"), True)
        A.expect("slip bound after rebind", r.slip_info().get("status"), "bound")
    except Exception as error:
        print(f"binding suite failed: {error}", file=sys.stderr)
        A.finish("binding")
        return 1
    return A.finish("binding")


if __name__ == "__main__":
    raise SystemExit(main())
