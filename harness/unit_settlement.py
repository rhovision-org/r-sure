#!/usr/bin/env python3
"""Settlement: payable, line payout, fund cover and policy aggregate."""

import sys

import actors
import assertions as A
import placement_fixture as F
import preflight


def main() -> int:
    if not preflight.require_devnet("settlement"):
        print("not_run: devnet unavailable")
        return 2
    try:
        p = F.bound("settle")

        A.cover('Policy@"payable"', "success")
        payable = actors.invoke(p.policy_uri, "payable", "500")
        A.expect("payable before settlement", payable, (True, 500))
        A.expect("payable is capped by per-claim",
                 actors.invoke(p.policy_uri, "payable", "5000")[1] <= p.per_claim, True)

        claim_id, claim_uri = p.open_claim(amount=500)
        p.classify_claim()
        p.assess_claim(500)
        p.agree_claim(500)

        A.cover('SureFund@"covered"', "refusal")
        A.expect_refusal("no central-fund cover for this claim", actors.invoke(
            p.component("component:fund"), "covered", f'"{claim_id}"'), "not covered")

        A.cover('Claim@"settle"', "success")
        A.expect("claim settles", p.settle_claim(), (True, 500))
        A.cover('Line@"pay"', "success")
        line = p.lines_info()[0]
        A.expect("line paid the claim", line.get("paid"), 500)
        A.expect("line records the claim", line.get("paidFor").get(claim_id), 500)

        A.cover('Policy@"settleClaim"', "success")
        policy = p.policy_info()
        A.expect("policy aggregate paid", policy.get("aggregatePaid"), 500)
        A.expect("policy aggregate remaining", policy.get("aggregateRemaining"), 4500)
        A.expect("policy claim settled", policy.get("claims").get(claim_id).get("status"),
                 "settled")

        A.cover('SureMath@"settlePlan"', "success")
        plan = actors.invoke(p.component("component:suremath"), "settlePlan",
                             f'500, [{{"uri": "line", "shareBps": 10000}}]')
        A.expect("settle plan sums to payable", plan[1][0].get("amount"), 500)

        A.cover('SureFund@"shortfalls"', "success")
        A.expect_ok("fund shortfalls", actors.invoke(
            p.component("component:fund"), "shortfalls"))

        # --- zero-payable settlement: a claim within the deductible ----------------
        A.cover('Policy@"payable"', "success")
        z = F.bound("settle0", syndicate_owner="key13", deductible=600)
        A.expect("payable within deductible is zero",
                 actors.invoke(z.policy_uri, "payable", "500"), (True, 0))

        claim_id0, _ = z.open_claim(amount=500)
        z.classify_claim()
        z.assess_claim(500)
        z.agree_claim(500)

        A.cover('LineSettle@"pay"', "success")
        A.expect("zero-payable claim settles", z.settle_claim(), (True, 0))
        line0 = z.lines_info()[0]
        A.expect("zero payment is recorded on the line",
                 line0.get("paidFor").get(claim_id0), 0)
        A.expect("line paid remains zero", line0.get("paid"), 0)

        policy0 = z.policy_info()
        A.expect("aggregate paid unchanged", policy0.get("aggregatePaid"), 0)
        A.expect("aggregate remaining unchanged",
                 policy0.get("aggregateRemaining"), z.aggregate)
        A.expect("policy records a settled zero claim",
                 policy0.get("claims").get(claim_id0).get("status"), "settled")
        A.expect("policy claim paid is zero",
                 policy0.get("claims").get(claim_id0).get("paid"), 0)

        A.cover('Claim@"settle"', "refusal")
        A.expect_refusal("settled zero claim cannot settle twice",
                         actors.invoke(z.claim_uri, "settle"), "not agreed")

        plan = actors.invoke(z.component("component:suremath"), "settlePlan",
                             '1, [{"uri":"a","shareBps":5000},'
                             '{"uri":"b","shareBps":5000}]')
        A.expect("rounded-away first line is zero", plan[1][0].get("amount"), 0)
        A.expect("last line absorbs the remainder", plan[1][1].get("amount"), 1)
    except Exception as error:
        print(f"settlement suite failed: {error}", file=sys.stderr)
        A.finish("settlement")
        return 1
    return A.finish("settlement")


if __name__ == "__main__":
    raise SystemExit(main())
