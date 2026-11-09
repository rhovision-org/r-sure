#!/usr/bin/env python3
"""Risk curves: the 16-point distribution, its stats and the curve delta."""

import json
import sys

import actors
import assertions as A
import preflight

VALUE = {
    "kind": "quantiles",
    "unit": "bpsOfDeclaredValue",
    "n": 16,
    "points": [0, 500, 1000, 1500, 2000, 2500, 3000, 3500,
               4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500],
}
LOSS = {
    "kind": "quantiles",
    "unit": "bpsOfDeclaredValue",
    "n": 16,
    "points": [2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000,
               6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000],
}


def call(math: str, arm: str, value) -> tuple:
    return actors.invoke(math, arm, json.dumps(value))


def main() -> int:
    if not preflight.require_devnet("curve"):
        print("not_run: devnet unavailable")
        return 2
    try:
        math = actors.resolve("component:suremath")

        A.cover('SureMath@"curveStats"', "success")
        stats = call(math, "curveStats", VALUE)[1]
        A.expect("curve variance rate", stats.get("varianceBps"), 3777)
        A.expect("curve variance numerator", stats.get("ss"), 21760000000)
        A.expect("curve mean", stats.get("meanBps"), 3750)
        A.expect("curve lower tail", stats.get("minBps"), 0)
        A.expect("curve upper tail", stats.get("maxBps"), 7500)
        A.expect("curve maximum deviation", stats.get("maxDevNum"), 60000)
        A.expect("curve sum", stats.get("sum"), 60000)
        A.expect("curve unit", stats.get("unit"), "bpsOfDeclaredValue")

        A.cover('SureMath@"curveStats"', "refusal")
        unsorted = dict(VALUE, points=list(reversed(VALUE["points"])))
        A.expect_refusal("unsorted curve", call(math, "curveStats", unsorted),
                         "curve order")
        A.expect_refusal("all-zero curve",
                         call(math, "curveStats", dict(VALUE, points=[0] * 16)),
                         "curve")

        A.cover('SureMath@"curveDelta"', "success")
        delta = call(math, "curveDelta", [LOSS, VALUE, 2000, 2000])[1]
        A.expect("reflection has no relative variance gap",
                 delta.get("relativeVarianceGapBps"), 0)
        A.expect("reflection has no shape gap", delta.get("shapeL1Bps"), 0)
        A.expect("reflection has no tail gap", delta.get("maxDevGapBps"), 0)
        A.expect("reflection is not a curve flag", delta.get("curveFlagged"), False)
        A.expect("the rate projection still moves", delta.get("rateFlagged"), True)
        A.expect("the mean is descriptive", delta.get("meanGapBps"), 4000)
        A.expect("the rate gap is descriptive", delta.get("rateGapBps"), -2417)

        A.cover('SureMath@"curveDelta"', "refusal")
        other_unit = dict(LOSS, unit="bpsOfSomethingElse")
        A.expect_refusal("curve unit mismatch",
                         call(math, "curveDelta", [other_unit, VALUE, 2000, 2000]),
                         "curve unit")
        A.expect_refusal("bad curve tolerance",
                         call(math, "curveDelta", [LOSS, VALUE, 10001, 2000]),
                         "tolerance")
    except Exception as error:
        print(f"curve suite failed: {error}", file=sys.stderr)
        A.finish("curve")
        return 1
    return A.finish("curve")


if __name__ == "__main__":
    raise SystemExit(main())
