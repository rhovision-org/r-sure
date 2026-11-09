#!/usr/bin/env python3
"""r-gen boundary: the adapter is either healthy or explicitly disabled."""

import sys

import actors
import assertions as A
import preflight


def main() -> int:
    if not preflight.require_devnet("integration_rgen"):
        print("not_run: devnet unavailable")
        return 2
    try:
        rgen = actors.resolve("component:rgen")
        health = actors.invoke(rgen, "health")
        config = actors.invoke(rgen, "config")
        A.cover('RgenAdapter@"health"', "success")
        A.cover('RgenAdapter@"config"', "success")
        A.expect_ok("adapter config", config)
        if health[0] is True:
            A.expect_ok("r-gen factories", health)
            A.expect("r-gen reports factories", "oracle" in health[1], True)
        else:
            A.expect_refusal("r-gen disabled by configuration", health, "disabled")
            A.expect("config records disabled", config[1].get("enabled"), False)

        # The variance read takes a K-Asset URI directly, so it can be exercised
        # with a stub even when r-gen is disabled by configuration.
        approved = A.one("""
new rs(`rho:registry:insertArbitrary`), uriCh, deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {"quantity": {"unit": "inspections", "value": 12},
                 "quality": {"completeness": 3, "correctness": 3,
                             "traceability": 3, "fitness": 3},
                 "verdict": "valid", "status": "approved",
                 "approval": {"liability": {"responsible": "approver",
                                            "shareBps": 10000}}}))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!(u) }
}""")
        A.cover('RgenAdapter@"variance"', "success")
        derived = actors.invoke(rgen, "variance", f'"{approved}"')
        A.expect_ok("kasset variance", derived)
        A.expect("quality-derived rate", derived[1].get("varianceBps"), 4000)
        A.expect("quality sum is reported", derived[1].get("qualitySum"), 12)
        A.expect("source is recorded", derived[1].get("source"), "derived")

        # A value proposition declares its variance; the claim snapshots it and the
        # K-Asset carries the snapshot, so the read uses the declared rate directly.
        declared = A.one("""
new rs(`rho:registry:insertArbitrary`), uriCh, deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {"quantity": {"unit": "m3", "value": 100},
                 "quality": {"completeness": 3, "correctness": 3,
                             "traceability": 3, "fitness": 3},
                 "variance": {"quantityBps": 400, "qualityBps": 1200, "n": 30},
                 "verdict": "valid", "status": "approved",
                 "approval": {"liability": {"responsible": "approver",
                                            "shareBps": 10000}}}))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!(u) }
}""")
        stated = actors.invoke(rgen, "variance", f'"{declared}"')
        A.expect_ok("declared variance read", stated)
        A.expect("declared rate is used", stated[1].get("varianceBps"), 1600)
        A.expect("declared source is recorded", stated[1].get("source"),
                 "kasset-variance")
        A.expect("declared snapshot is echoed", stated[1].get("declared").get("n"), 30)

        malformed = A.one("""
new rs(`rho:registry:insertArbitrary`), uriCh, deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {"quantity": {"unit": "m3", "value": 100},
                 "quality": {"completeness": 3, "correctness": 3,
                             "traceability": 3, "fitness": 3},
                 "variance": {"quantityBps": 6000, "qualityBps": 6000, "n": 30},
                 "verdict": "valid", "status": "approved",
                 "approval": {"liability": {"responsible": "approver",
                                            "shareBps": 10000}}}))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!(u) }
}""")
        A.expect_refusal("declared rates must sum to at most 10000 bps",
                         actors.invoke(rgen, "variance", f'"{malformed}"'), "variance")

        unapproved = A.one("""
new rs(`rho:registry:insertArbitrary`), uriCh, deployId(`rho:rchain:deployId`), KAsset in {
  contract KAsset(@"get", ret) = {
    ret!((true, {"quantity": {"unit": "inspections", "value": 12},
                 "quality": {"completeness": 3, "correctness": 3,
                             "traceability": 3, "fitness": 3},
                 "verdict": "valid", "status": "validated", "approval": Nil}))
  } |
  rs!(bundle+{*KAsset}, *uriCh) |
  for (@u <- uriCh) { deployId!(u) }
}""")
        A.cover('RgenAdapter@"variance"', "refusal")
        A.expect_refusal("unapproved kasset needs an attestation",
                         actors.invoke(rgen, "variance", f'"{unapproved}"'),
                         "approval")
    except Exception as error:
        print(f"integration_rgen suite failed: {error}", file=sys.stderr)
        A.finish("integration_rgen")
        return 1
    return A.finish("integration_rgen")


if __name__ == "__main__":
    raise SystemExit(main())
