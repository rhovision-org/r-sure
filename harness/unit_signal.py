#!/usr/bin/env python3
"""VarianceSignalBook: register a signed Risk assessment, index it and summarise it."""

import json
import sys

import actors
import assertions as A
import preflight

KASSET = "rho:id:signal-fixture-kasset"

REQ = {
    "class": "engineering",
    "broker": "broker-signal",
    "assetRef": {"kind": "property", "hash": "asset-signal", "uri": KASSET},
    "evidence": [
        {"kind": "survey", "hash": "survey-signal"},
        {"kind": "rgen:kasset", "uri": KASSET, "hash": "kasset-signal"},
    ],
    "variance": {"source": "attested", "kassetUri": KASSET,
                 "varianceBps": 1000, "evidenceHash": "kasset-signal"},
    "triTest": {
        "exposureRef": "exposure-signal",
        "probabilityBasis": "claims-history",
        "consequenceBasis": "declared-value",
        "consequenceRef": "consequence-signal",
    },
    "periodStart": 0,
    "periodEnd": 1_000_000,
    "declaredValue": 100_000,
    "requestedLimit": 50_000,
    "requestedDeductible": 1_000,
}

ASSESSMENT = {
    "quotedPremium": 1200,
    "expectedLoss": 1000,
    "varianceBps": 2000,
    "loadBps": 2000,
    "basisHash": "underwriting:signal",
    "toleranceBps": 2000,
}


def submit(book: str, req: dict):
    return actors.invoke(book, "submit", f"*dId, {json.dumps(req)}")


def main() -> int:
    if not preflight.require_devnet("signal"):
        print("not_run: devnet unavailable")
        return 2
    try:
        book = actors.resolve("component:risk-book")
        signal_book = actors.resolve("component:variance-signal-book")

        created = submit(book, REQ)
        A.expect_ok("submit signal risk", created)
        risk_id, risk_uri = created[1], created[2]
        A.expect_ok("assess signal risk", actors.invoke(
            risk_uri, "assess", f"*dId, {json.dumps(ASSESSMENT)}"))
        A.expect_ok("accept signal risk", actors.invoke(risk_uri, "accept", "*dId"))

        A.cover('VarianceSignalBook@"register"', "success")
        registered = actors.invoke(signal_book, "register", f'"{risk_uri}"')
        A.expect_ok("register signal", registered)
        A.expect("signal key", registered[1], risk_id)

        A.cover('VarianceSignalBook@"signal"', "success")
        signal = actors.invoke(signal_book, "signal", f'"{risk_id}"')[1]
        A.expect("signal risk", signal.get("riskId"), risk_id)
        A.expect("signal curve source", signal.get("source"), "scalar-scalar")
        A.expect("signal value source", signal.get("valueSource"), "attested")
        A.expect("signal loss source", signal.get("lossSource"), "summary")
        A.expect("signal sign", signal.get("sign"), "positive")
        variable = signal.get("variance")
        A.expect("signal engineering", variable.get("engineeringBps"), 1000)
        A.expect("signal insurer", variable.get("insurerBps"), 2000)
        A.expect("signal gap", variable.get("gapBps"), 1000)

        A.cover('VarianceSignalBook@"signals"', "success")
        A.expect("signal listed", risk_id in actors.invoke(signal_book, "signals")[1], True)
        A.cover('VarianceSignalBook@"byAsset"', "success")
        A.expect("signal by asset", risk_id in actors.invoke(
            signal_book, "byAsset", '"asset-signal"')[1], True)
        A.cover('VarianceSignalBook@"byClass"', "success")
        A.expect("signal by class", risk_id in actors.invoke(
            signal_book, "byClass", '"engineering"')[1], True)
        A.cover('VarianceSignalBook@"bySource"', "success")
        A.expect("signal by source", risk_id in actors.invoke(
            signal_book, "bySource", '"scalar-scalar"')[1], True)
        A.cover('VarianceSignalBook@"bySign"', "success")
        A.expect("signal by sign", risk_id in actors.invoke(
            signal_book, "bySign", '"positive"')[1], True)

        A.cover('VarianceSignalBook@"summary"', "success")
        summary = actors.invoke(signal_book, "summary")[1]
        A.expect("summary count", summary.get("count"), 1)
        A.expect("summary positive", summary.get("positive"), 1)
        A.expect("summary signed gap", summary.get("sumGapBps"), 1000)
        A.expect("summary absolute gap", summary.get("sumAbsGapBps"), 1000)

        A.cover('VarianceSignalBook@"register"', "refusal")
        A.expect_refusal("duplicate signal",
                         actors.invoke(signal_book, "register", f'"{risk_uri}"'),
                         "duplicate")

        fresh = submit(book, dict(REQ, broker="broker-signal-2",
                                  assetRef={"kind": "property", "hash": "asset-signal-2",
                                            "uri": KASSET}))
        A.expect_ok("submit unassessed signal risk", fresh)
        A.expect_refusal("signal before assessment",
                         actors.invoke(signal_book, "register", f'"{fresh[2]}"'),
                         "not assessed")
    except Exception as error:
        print(f"signal suite failed: {error}", file=sys.stderr)
        A.finish("signal")
        return 1
    return A.finish("signal")


if __name__ == "__main__":
    raise SystemExit(main())
