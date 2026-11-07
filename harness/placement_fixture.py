#!/usr/bin/env python3
"""A real Lloyd's placement fixture: broker, syndicate, risk, slip, policy and claim.

The fixture funds real r-cash accounts and drives the deployed contracts.  It is the
shared setup for the syndicate, slip, premium, policy, claim and conservation suites.

One deployment actor owns the broker, the syndicate and the insured position.  That is
not a shortcut in the fixture: ``SlipFactory("open")`` looks the broker up by the
caller's owner id, ``Syndicate("quote")`` only accepts the syndicate manager, and a claim
is classified by the lead line manager.  A placement therefore plays those three roles
from one key unless a suite deliberately separates them.

Private capabilities (the slip and policy tokens) never leave the Slip contract, so
``quote`` and ``openLine`` cannot be called from Python.  ``subscribe`` performs the
quote and ``bind`` performs every openLine; the ``quote_info``/``line_info`` helpers read
the resulting records back.
"""

from __future__ import annotations

import json
import os
import time

import actors
from assertions import one

# ---------------------------------------------------------------------------------------
# Cover terms
# ---------------------------------------------------------------------------------------

DEFAULT_TERMS = {
    "coverageClass": "property",
    "assetId": "REV",
    "aggregateLimit": 5000,
    "perClaimLimit": 1000,
    "deductible": 0,
    "premiumTotal": 1000,
    "periodStartHeight": 0,
    "periodEndHeight": 1_000_000,
    "waitingBlocks": 0,
    "noticeBlocks": 1000,
    "runOffBlocks": 100,
    "standardClaimMax": 1000,
    "minSyndicates": 1,
    "maxSyndicates": 1,
    "brokerCommissionBps": 1000,
    "centralFundBps": 250,
    "evidencePolicy": "optional",
    "claimsLeadPolicy": "lead",
}

TERM_ALIASES = {
    "coverage_class": "coverageClass",
    "asset_id": "assetId",
    "aggregate_limit": "aggregateLimit",
    "per_claim_limit": "perClaimLimit",
    "premium_total": "premiumTotal",
    "period_start_height": "periodStartHeight",
    "period_end_height": "periodEndHeight",
    "waiting_blocks": "waitingBlocks",
    "notice_blocks": "noticeBlocks",
    "run_off_blocks": "runOffBlocks",
    "standard_claim_max": "standardClaimMax",
    "min_syndicates": "minSyndicates",
    "max_syndicates": "maxSyndicates",
    "broker_commission_bps": "brokerCommissionBps",
    "central_fund_bps": "centralFundBps",
    "evidence_policy": "evidencePolicy",
    "claims_lead_policy": "claimsLeadPolicy",
}

REQUIRED_TERMS = frozenset(DEFAULT_TERMS)


def terms(**overrides) -> dict:
    """Build a complete, valid cover-terms map from Python-style kwargs."""
    value = dict(DEFAULT_TERMS)
    for key, item in overrides.items():
        value[TERM_ALIASES.get(key, key)] = item
    return value


def validate_terms_local(value: dict) -> None:
    """Mirror the cheap checks in ``CoverTerms("validate")`` without a node."""
    missing = sorted(REQUIRED_TERMS - set(value))
    if missing:
        raise AssertionError(f"terms missing fields: {missing}")
    if value["coverageClass"] not in {
        "engineering", "property", "equipment", "liability", "marine", "cyber"}:
        raise AssertionError(f"terms class: {value['coverageClass']!r}")
    if not (1 <= value["aggregateLimit"] <= 1_000_000_000_000):
        raise AssertionError("terms aggregateLimit")
    if not (1 <= value["perClaimLimit"] <= value["aggregateLimit"]):
        raise AssertionError("terms perClaimLimit")
    if not (0 <= value["deductible"] < value["perClaimLimit"]):
        raise AssertionError("terms deductible")
    if not (1 <= value["premiumTotal"] <= 1_000_000_000_000):
        raise AssertionError("terms premiumTotal")
    if value["periodEndHeight"] <= value["periodStartHeight"]:
        raise AssertionError("terms period")
    if value["standardClaimMax"] > value["perClaimLimit"]:
        raise AssertionError("terms standardClaimMax")
    if value["minSyndicates"] > value["maxSyndicates"]:
        raise AssertionError("terms minSyndicates")
    if value["brokerCommissionBps"] + value["centralFundBps"] > 3000:
        raise AssertionError("terms bps")
    if value["evidencePolicy"] not in {"none", "optional", "required"}:
        raise AssertionError("terms evidencePolicy")
    if value["claimsLeadPolicy"] not in {"lead", "lead+second"}:
        raise AssertionError("terms claimsLeadPolicy")


def _rl(value) -> str:
    """Rholang literal for the JSON-shaped maps, lists, strings and ints used here."""
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _ok(label: str, reply):
    if not (isinstance(reply, tuple) and reply[0] is True):
        raise AssertionError(f"{label}: {reply!r}")
    return reply


def _uri(label: str, reply) -> str:
    found = None
    for item in reply[1:]:
        if isinstance(item, str) and item.startswith("rho:id:"):
            found = item
    if not found:
        raise AssertionError(f"{label}: no URI in {reply!r}")
    return found


def _id(label: str, reply) -> str:
    for item in reply[1:]:
        if isinstance(item, str) and not item.startswith("rho:id:"):
            return item
    raise AssertionError(f"{label}: no id in {reply!r}")


# ---------------------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------------------


class Placement:
    """One insured, one broker, one syndicate, one risk, one slip and its policy."""

    def __init__(self, name: str, *, insured: str = "business",
                 syndicate_owner: str | None = None, platform: str = "deployer",
                 class_: str = "property", premium: int = 1000,
                 aggregate: int = 5000, per_claim: int = 1000,
                 deductible: int = 0, capital: int | None = None,
                 share_bps: int = 10000, broker_bps: int = 1000,
                 fund_bps: int = 250, period_blocks: int = 1000,
                 expiry_blocks: int = 1000, notice_blocks: int = 1000,
                 asset_id: str = "REV", **term_overrides):
        self.name = name
        self.token = f"{int(time.time() * 1000)}-{os.getpid()}"
        self.insured = insured
        self.broker_owner = insured
        self.syndicate_owner = syndicate_owner or insured
        self.platform = platform
        self.class_ = class_
        self.premium = premium
        self.aggregate = aggregate
        self.per_claim = per_claim
        self.deductible = deductible
        self.capital = capital if capital is not None else aggregate + 1000
        self.share_bps = share_bps
        self.broker_bps = broker_bps
        self.fund_bps = fund_bps
        self.period_blocks = period_blocks
        self.expiry_blocks = expiry_blocks
        self.notice_blocks = notice_blocks
        self.asset_id = asset_id
        self.kasset_ref = f"rho:id:fixture-kasset-{self.token}"
        self.kasset_hash = f"kasset:{self.name}"
        self.variance_bps = 1000
        self.term_overrides = term_overrides

        self.terms = terms(
            coverageClass=class_, assetId=asset_id, aggregateLimit=aggregate,
            perClaimLimit=per_claim, deductible=deductible, premiumTotal=premium,
            standardClaimMax=per_claim, brokerCommissionBps=broker_bps,
            centralFundBps=fund_bps, noticeBlocks=notice_blocks,
            **term_overrides)
        validate_terms_local(self.terms)

        self.start = 0
        self.end = 0
        self.expiry_height = 0
        self.owner_id = ""
        self.syndicate_owner_id = ""
        self.broker_id = ""
        self.broker_uri = ""
        self.syndicate_id = ""
        self.syndicate_uri = ""
        self.risk_id = ""
        self.risk_uri = ""
        self.slip_id = ""
        self.slip_uri = ""
        self.grant_id = ""
        self.grant_uri = ""
        self.policy_id = ""
        self.policy_uri = ""
        self.claim_id = ""
        self.claim_uri = ""
        self._ops = 0
        self._components: dict[str, str] = {}

    # ---- bookkeeping --------------------------------------------------------------

    def op(self, label: str) -> str:
        self._ops += 1
        return f"{self.name}:{self.token}:{label}:{self._ops}"

    def component(self, key: str) -> str:
        if key not in self._components:
            self._components[key] = actors.resolve(key)
        return self._components[key]

    def _ensure_signer(self, key: str | None = None) -> None:
        """Keep the signing key's node vault able to precharge the next deploy."""
        actors.ensure_vault(key or self.insured)

    # ---- setup --------------------------------------------------------------------

    def setup(self) -> "Placement":
        for name in dict.fromkeys((self.insured, self.syndicate_owner, self.platform)):
            actors.ensure_vault(name)
        self.owner_id = actors.ensure_account(self.insured)
        self.syndicate_owner_id = actors.ensure_account(self.syndicate_owner)
        actors.ensure_account(self.platform)
        if self.syndicate_owner == self.insured:
            actors.ensure_funds(self.insured, self.capital + self.premium + 2000)
        else:
            actors.ensure_funds(self.insured, self.premium + 2000)
            actors.ensure_funds(self.syndicate_owner, self.capital + 2000)
        # Deploy phlo is paid by this key for every suite; top it up so a long campaign
        # does not fail with "Computation ran out of phlogistons" on the last suites.
        actors.ensure_funds(self.platform, 100_000)

        now = actors.block_height()
        self.start = now
        self.end = now + self.period_blocks
        self.expiry_height = now + self.expiry_blocks
        self.terms["periodStartHeight"] = now
        self.terms["periodEndHeight"] = self.end
        validate_terms_local(self.terms)

        self.ensure_broker()
        self.ensure_syndicate()
        self.contribute(self.capital)
        self.submit_risk()
        self.open_slip()
        return self

    def ensure_broker(self) -> str:
        self._ensure_signer(self.insured)
        book = self.component("component:broker-book")
        profile = {
            "name": f"broker:{self.name}"[:64],
            "licenceHash": f"licence:{self.name}",
            "credentialUri": f"credential:{self.name}",
            "commissionBps": self.broker_bps,
            "classes": [self.class_],
        }
        reply = actors.invoke(
            book, "register", f"*dId, {_rl(profile)}", key=self.insured)
        if isinstance(reply, tuple) and reply[0] is True:
            self.broker_id = _id("broker register", reply)
            self.broker_uri = _uri("broker register", reply)
        else:
            # A persistent devnet keeps the owner's broker across runs.
            found = actors.invoke(
                book, "brokerOf", _rl(self.owner_id), key=self.insured)
            _ok("broker reuse", found)
            self.broker_id, self.broker_uri = found[1], found[2]
        return self.broker_uri

    def ensure_syndicate(self) -> str:
        self._ensure_signer(self.syndicate_owner)
        book = self.component("component:syndicate-book")
        profile = {
            "name": f"syndicate:{self.name}"[:64],
            "assetId": self.asset_id,
            "riskAppetite": [self.class_],
        }
        reply = actors.invoke(
            book, "create", f"*dId, {_rl(profile)}", key=self.syndicate_owner)
        if isinstance(reply, tuple) and reply[0] is True:
            self.syndicate_id = _id("syndicate create", reply)
            self.syndicate_uri = _uri("syndicate create", reply)
        else:
            found = actors.invoke(
                book, "syndicateOf", _rl(self.syndicate_owner_id),
                key=self.syndicate_owner)
            _ok("syndicate reuse", found)
            self.syndicate_id, self.syndicate_uri = found[1], found[2]
        return self.syndicate_uri

    def add_syndicate(self, name: str, *, owner: str = "key12",
                      class_: str | None = None,
                      capital: int | None = None) -> tuple[str, str, str]:
        """Create and fund an extra syndicate under a distinct signing key.

        Suites use this to exercise a second subscription without a second placement.
        Returns ``(syndicate_id, syndicate_uri, owner_key)``.
        """
        actors.ensure_vault(owner)
        owner_id = actors.ensure_account(owner)
        amount = self.capital if capital is None else capital
        actors.ensure_funds(owner, amount + 2000)
        book = self.component("component:syndicate-book")
        profile = {
            "name": f"syndicate:{name}"[:64],
            "assetId": self.asset_id,
            "riskAppetite": [class_ or self.class_],
        }
        reply = actors.invoke(book, "create", f"*dId, {_rl(profile)}", key=owner)
        if isinstance(reply, tuple) and reply[0] is True:
            syndicate_id = _id("extra syndicate create", reply)
            syndicate_uri = _uri("extra syndicate create", reply)
        else:
            found = actors.invoke(book, "syndicateOf", _rl(owner_id), key=owner)
            _ok("extra syndicate reuse", found)
            syndicate_id, syndicate_uri = found[1], found[2]
        _ok("extra syndicate contribute",
            actors.contribute_syndicate(syndicate_uri, amount, key=owner))
        return syndicate_id, syndicate_uri, owner

    def contribute(self, amount: int) -> tuple:
        self._ensure_signer(self.syndicate_owner)
        reply = actors.contribute_syndicate(
            self.syndicate_uri, amount, key=self.syndicate_owner)
        return _ok("syndicate contribute", reply)

    def submit_risk(self) -> str:
        self._ensure_signer(self.insured)
        book = self.component("component:risk-book")
        req = {
            "class": self.class_,
            "assetRef": {"kind": "site", "hash": f"asset:{self.name}",
                         "uri": self.kasset_ref},
            "evidence": [
                {"kind": "loss-run", "hash": f"loss:{self.name}"},
                {"kind": "rgen:kasset", "uri": self.kasset_ref,
                 "hash": self.kasset_hash}],
            "variance": {"source": "attested", "kassetUri": self.kasset_ref,
                         "varianceBps": self.variance_bps,
                         "evidenceHash": self.kasset_hash},
            "triTest": {
                "exposureRef": f"exposure:{self.name}",
                "probabilityBasis": "claims-history",
                "consequenceBasis": "declared-value",
                "consequenceRef": f"consequence:{self.name}",
            },
            # Use the placement's start, not the submit-time height: broker and syndicate
            # setup can take longer than a short test period under load, and RiskBook
            # refuses start >= end. The period begins when the placement began.
            "periodStart": self.start,
            "periodEnd": self.end,
            "declaredValue": self.aggregate,
            "requestedLimit": self.per_claim,
            "requestedDeductible": self.deductible,
            "broker": self.broker_id,
        }
        reply = actors.invoke(
            book, "submit", f"*dId, {_rl(req)}", key=self.insured)
        if not (isinstance(reply, tuple) and reply[0] is True and len(reply) >= 3):
            raise AssertionError(f"risk submit: {reply!r}")
        self.risk_id, self.risk_uri = reply[1], reply[2]
        return self.risk_uri

    def assess_risk(self, quoted_premium: int | None = None) -> tuple:
        premium = quoted_premium or self.premium
        assessment = {
            "quotedPremium": premium,
            "recommendedLimit": self.per_claim,
            "expectedLoss": max(1, premium * 9 // 10),
            "varianceBps": 2000,
            "loadBps": 2000,
            "basisHash": f"underwriting:{self.name}",
            "toleranceBps": 2000,
        }
        reply = actors.invoke(
            self.risk_uri, "assess", f"*dId, {_rl(assessment)}", key=self.insured)
        return _ok("risk assess", reply)

    def accept_risk(self) -> tuple:
        reply = actors.invoke(self.risk_uri, "accept", "*dId", key=self.insured)
        return _ok("risk accept", reply)

    def open_slip(self) -> str:
        self._ensure_signer(self.insured)
        factory = self.component("component:slip-factory")
        req = {
            "riskId": self.risk_id,
            "riskUri": self.risk_uri,
            "insured": self.owner_id,
            "class": self.class_,
            "terms": self.terms,
            "expiryHeight": self.expiry_height,
        }
        reply = actors.invoke(
            factory, "open", f"*dId, {_rl(req)}", key=self.insured)
        if not (isinstance(reply, tuple) and reply[0] is True and len(reply) >= 3):
            raise AssertionError(f"slip open: {reply!r}")
        self.slip_id, self.slip_uri = reply[1], reply[2]
        return self.slip_uri

    # ---- placement lifecycle -------------------------------------------------------

    def subscribe(self, share_bps: int | None = None) -> tuple[str, str]:
        """Quote capacity and subscribe the slip (``Slip("subscribe")``)."""
        # The syndicate quote only accepts the manager, so the manager signs this arm.
        self._ensure_signer(self.syndicate_owner)
        share = self.share_bps if share_bps is None else share_bps
        reply = actors.invoke(
            self.slip_uri, "subscribe",
            f'*dId, {_rl(self.syndicate_uri)}, {int(share)}',
            key=self.syndicate_owner)
        if not (isinstance(reply, tuple) and reply[0] is True and len(reply) >= 3):
            raise AssertionError(f"slip subscribe: {reply!r}")
        self.grant_id, self.grant_uri = reply[1], reply[2]
        return self.grant_id, self.grant_uri

    def accept(self) -> tuple:
        self._ensure_signer(self.insured)
        reply = actors.invoke(self.slip_uri, "accept", "*dId", key=self.insured)
        return _ok("slip accept", reply)

    def fund_premium(self, amount: int | None = None) -> int:
        """Withdraw REV from the insured account and fund the slip purse."""
        amount = self.premium if amount is None else amount
        self._ensure_signer(self.insured)
        reply = actors.pay_premium(self.slip_uri, amount, key=self.insured)
        _ok("slip fundPremium", reply)
        return int(reply[1])

    # Alias used by suites that speak in premium rather than the contract arm name.
    fund = fund_premium

    def bind(self) -> str:
        """Open every line, create the policy and distribute the premium."""
        reply = actors.invoke(self.slip_uri, "bind")
        if not (isinstance(reply, tuple) and reply[0] is True and len(reply) >= 2):
            raise AssertionError(f"slip bind: {reply!r}")
        self.policy_uri = reply[1]
        self.policy_id = f"pol:{self.slip_id}"
        return self.policy_uri

    def bind_all(self) -> str:
        """The whole retail flow: subscribe, accept, fund and bind."""
        self.subscribe()
        self.accept()
        self.fund_premium()
        return self.bind()

    # ---- reads --------------------------------------------------------------------

    def slip_info(self) -> dict:
        return _ok("slip info", actors.invoke(self.slip_uri, "info"))[1]

    def risk_info(self) -> dict:
        return _ok("risk info", actors.invoke(self.risk_uri, "info"))[1]

    def syndicate_info(self) -> dict:
        return _ok("syndicate info", actors.invoke(self.syndicate_uri, "info"))[1]

    def syndicate_capacity(self) -> dict:
        return _ok("syndicate capacity",
                   actors.invoke(self.syndicate_uri, "capacity"))[1]

    def quote_info(self, grant_id: str | None = None) -> dict:
        return _ok("syndicate quote", actors.invoke(
            self.syndicate_uri, "quote", _rl(grant_id or self.grant_id)))[1]

    def quotes(self) -> dict:
        return _ok("syndicate quotes",
                   actors.invoke(self.syndicate_uri, "quotes"))[1]

    def policy_info(self) -> dict:
        if not self.policy_uri:
            raise AssertionError("placement has no policy; call bind() first")
        return _ok("policy info", actors.invoke(self.policy_uri, "info"))[1]

    def policy_lines(self) -> list:
        return _ok("policy lines", actors.invoke(self.policy_uri, "lines"))[1]

    def line_uri(self, line_id: str) -> str:
        for line in self.policy_lines():
            if line.get("lineId") == line_id:
                return line["uri"]
        raise AssertionError(f"unknown line {line_id!r}")

    def line_info(self, line: str) -> dict:
        uri = line if line.startswith("rho:id:") else self.line_uri(line)
        return _ok("line info", actors.invoke(uri, "info"))[1]

    def lines_info(self) -> list[dict]:
        if not self.policy_uri:
            return []
        return [self.line_info(line["uri"]) for line in self.policy_lines()]

    def fund_info(self) -> dict:
        return _ok("fund info",
                   actors.invoke(self.component("component:fund"), "info"))[1]

    def fund_balance(self) -> int:
        reply = _ok("fund balance", actors.invoke(
            self.component("component:fund"), "balance"))
        return int(reply[1])

    def fund_cover(self, claim_id: str | None = None) -> int:
        claim_id = claim_id or self.claim_id
        reply = actors.invoke(
            self.component("component:fund"), "covered", _rl(claim_id))
        if isinstance(reply, tuple) and reply[0] is True and isinstance(reply[1], dict):
            return int(reply[1].get("amount", 0))
        return 0

    # ---- claims -------------------------------------------------------------------

    def open_claim(self, amount: int | None = None,
                   loss_height: int | None = None,
                   evidence: list | None = None) -> tuple[str, str]:
        self._ensure_signer(self.insured)
        amount = self.per_claim if amount is None else amount
        if amount < 1:
            raise ValueError("claimed amount must be positive")
        req = {
            "lossHeight": actors.block_height() if loss_height is None else loss_height,
            "claimedAmount": amount,
            "evidence": evidence or [{"kind": "loss", "hash": f"claim:{self.name}"}],
        }
        reply = actors.invoke(
            self.policy_uri, "openClaim", f"*dId, {_rl(req)}", key=self.insured)
        if not (isinstance(reply, tuple) and reply[0] is True and len(reply) >= 3):
            raise AssertionError(f"claim open: {reply!r}")
        self.claim_id, self.claim_uri = reply[1], reply[2]
        return self.claim_id, self.claim_uri

    def classify_claim(self, kind: str = "standard") -> tuple:
        # The lead line manager is the syndicate manager, not necessarily the insured.
        self._ensure_signer(self.syndicate_owner)
        return _ok("claim classify", actors.invoke(
            self.claim_uri, "classify", f"*dId, {_rl(kind)}",
            key=self.syndicate_owner))

    def assess_claim(self, recommended: int | None = None) -> tuple:
        self._ensure_signer(self.syndicate_owner)
        value = {
            "recommendedAmount": self.per_claim if recommended is None else recommended,
            "basisHash": f"assessment:{self.name}",
        }
        return _ok("claim assess", actors.invoke(
            self.claim_uri, "assess", f"*dId, {_rl(value)}",
            key=self.syndicate_owner))

    def agree_claim(self, amount: int | None = None) -> tuple:
        self._ensure_signer(self.syndicate_owner)
        amount = self.per_claim if amount is None else amount
        return _ok("claim agree", actors.invoke(
            self.claim_uri, "agree",
            f'*dId, {int(amount)}, "agreement:{self.name}"',
            key=self.syndicate_owner))

    def settle_claim(self) -> tuple:
        return _ok("claim settle", actors.invoke(self.claim_uri, "settle"))

    def close_claim(self) -> tuple:
        return _ok("claim close", actors.invoke(self.claim_uri, "close"))

    def claim(self, amount: int | None = None, *, close: bool = True) -> str:
        """Open, classify, assess, agree, settle and optionally close one claim."""
        self.open_claim(amount=amount)
        self.classify_claim()
        self.assess_claim()
        self.agree_claim(amount=amount)
        self.settle_claim()
        if close:
            self.close_claim()
        return self.claim_uri

    def claim_info(self) -> dict:
        return _ok("claim info", actors.invoke(self.claim_uri, "info"))[1]


def started(name: str, **kwargs) -> Placement:
    """A placement through slip open: broker, funded syndicate, risk and slip exist."""
    return Placement(name, **kwargs).setup()


def bound(name: str, **kwargs) -> Placement:
    """A placement through policy bind: one subscribed line with distributed premium."""
    placement = started(name, **kwargs)
    placement.bind_all()
    return placement


# ---------------------------------------------------------------------------------------
# Refusal-only fixture
# ---------------------------------------------------------------------------------------


class Refusals:
    """A lighter fixture that owns no contracts, so every call is expected to refuse.

    Suites use it for malformed requests, unknown ids, unregistered owners and other
    negative paths that must not create state on the devnet.
    """

    def __init__(self, name: str = "refusals", *, actor: str = "sender",
                 platform: str = "deployer"):
        self.name = name
        self.actor = actor
        self.platform = platform
        self._components: dict[str, str] = {}

    def setup(self) -> "Refusals":
        actors.ensure_vault(self.actor)
        actors.ensure_account(self.actor)
        actors.ensure_account(self.platform)
        return self

    def component(self, key: str) -> str:
        if key not in self._components:
            self._components[key] = actors.resolve(key)
        return self._components[key]

    def invoke(self, uri: str, binding: str, args: str | None = None,
               key: str | None = None):
        return actors.invoke(uri, binding, args, key=key or self.actor)

    def refuse(self, label: str, uri: str, binding: str, args: str | None,
               reason: str, key: str | None = None):
        """Assert ``(false, reason)`` and return the observed reply."""
        from assertions import expect_refusal

        reply = self.invoke(uri, binding, args, key=key)
        expect_refusal(label, reply, reason)
        return reply

    def ok(self, label: str, uri: str, binding: str, args: str | None = None,
           key: str | None = None):
        from assertions import expect_ok

        reply = self.invoke(uri, binding, args, key=key)
        expect_ok(label, reply)
        return reply

    def owner_id(self) -> str:
        return actors.ensure_account(self.actor)


def started_refusals(name: str = "refusals", **kwargs) -> Refusals:
    return Refusals(name, **kwargs).setup()


# ---------------------------------------------------------------------------------------
# Offline self-check (used by `run_suites.py --fixtures`)
# ---------------------------------------------------------------------------------------


def self_check() -> int:
    value = terms()
    validate_terms_local(value)
    assert value["premiumTotal"] == 1000
    assert value["brokerCommissionBps"] + value["centralFundBps"] <= 3000
    print(f"  ok terms {len(value)} fields")

    try:
        import admin
        keys = actors.keys()
    except Exception as error:  # no keys or chain config: the shape check still ran
        print(f"  ok admin literal skipped ({error})")
        return 0
    literal = admin.admin_literal(keys)
    if not literal.startswith("[") or "hexToBytes()" not in literal:
        raise AssertionError(f"admin literal: {literal!r}")
    print("  ok admin literal")
    return 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-check", action="store_true",
                    help="validate terms and the admin literal without a node")
    args = ap.parse_args(argv)
    if args.self_check:
        print("placement_fixture")
        return self_check()
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
