#!/usr/bin/env python3
"""Run behavioural suites and record an honest pass / fail / not-run result.

Each suite owns one ignored result file, ``deployments/suite-result-<suite>.json``.  The runner
merges every result file into ``deployments/suite-results.json`` under a lock, so a
partial run, a parallel run, or a run that only covers one suite cannot erase results
from another suite.

Exit codes: 0 all pass, 1 any failure, 2 any not-run and no failure.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "deployments" / "suite-results.json"
RESULT_DIR = ROOT / "deployments"
RESULT_PREFIX = "suite-result-"
LOCK = Path(tempfile.gettempdir()) / "rsure-suite-results.lock"
TIMEOUT = int(os.environ.get("RSURE_SUITE_TIMEOUT", "900"))
TRAILER = re.compile(r"^RSURE_RESULT (\{.*\})$", re.M)

SUITES = {
    "root": "unit_root.py",
    "payments": "unit_payments.py",
    "syndicate": "unit_syndicate.py",
    "capital": "unit_capital.py",
    "broker": "unit_broker.py",
    "risk": "unit_risk.py",
    "variance": "unit_variance.py",
    "curve": "unit_curve.py",
    "slip": "unit_slip.py",
    "subscription": "unit_subscription.py",
    "binding": "unit_binding.py",
    "line": "unit_line.py",
    "policy": "unit_policy.py",
    "distribution": "unit_distribution.py",
    "premium": "unit_premium.py",
    "fund": "unit_fund.py",
    "books": "unit_books.py",
    "signal": "unit_signal.py",
    "pause": "unit_pause.py",
    "pause_scope": "unit_pause_scope.py",
    "admin": "unit_admin.py",
    "admin_keys": "unit_admin_keys.py",
    "cell_liveness": "unit_cell_liveness.py",
    "factory_auth": "unit_factory_auth.py",
    "replay": "unit_replay.py",
    "expiry": "unit_expiry.py",
    "evidence": "unit_evidence.py",
    "oracle": "unit_oracle.py",
    "claim_lifecycle": "unit_claim_lifecycle.py",
    "claim_refusals": "unit_claim_refusals.py",
    "settlement": "unit_settlement.py",
    "shortfall": "unit_shortfall.py",
    "conservation": "unit_conservation.py",
    "behavior": "unit_behavior.py",
    "generality": "unit_generality.py",
    "share_reuse": "unit_share_reuse.py",
    "integration_rcash": "integration_rcash.py",
    "integration_rgen": "integration_rgen.py",
    "integration_rshare": "integration_rshare.py",
}
DEFAULT = list(SUITES)

# Explicit non-suite modes.  These are commands with a pass/fail exit code, not
# behavioural suites, so the trailer and zero-assertion rules do not apply.
PSEUDO = {
    "fixtures": [sys.executable, str(ROOT / "harness" / "placement_fixture.py"),
                 "--self-check"],
    "keystores": ["cargo", "test", "-p", "rsure-keystore"],
}


def normalize(name: str) -> str:
    """Map make targets such as ``unit-claim-lifecycle`` to ``claim_lifecycle``."""
    name = name.replace("-", "_")
    if name.startswith("unit_"):
        name = name[len("unit_"):]
    return name


ENV_NAMES = ("NODE", "ADMIN", "CONTAINER", "SHARD", "PHLO_LIMIT", "PHLO_PRICE", "KEYS")


def node_url() -> str:
    return (os.environ.get("RSURE_NODE")
            or os.environ.get("RSHARE_NODE")
            or "http://localhost:40403")


def child_env() -> dict[str, str]:
    """Export the canonical RSURE_* values under the legacy RSHARE_* names.

    Suites import ``preflight``/``deploy`` directly as well as through ``actors``, so the
    bridge is applied to the child environment rather than relying on import order.
    """
    value = os.environ.copy()
    for name in ENV_NAMES:
        canonical = os.environ.get(f"RSURE_{name}")
        if canonical is not None:
            value[f"RSHARE_{name}"] = canonical
    return value


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text)
    os.replace(temporary, path)


def _write_row(row: dict) -> Path:
    path = RESULT_DIR / f"{RESULT_PREFIX}{normalize(row['suite'])}.json"
    _atomic_write(path, json.dumps(row, indent=2, sort_keys=True) + "\n")
    return path


@contextlib.contextmanager
def _merge_lock():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _rows_from_disk() -> dict[str, dict]:
    rows: dict[str, dict] = {}
    if not RESULT_DIR.is_dir():
        return rows
    for path in sorted(RESULT_DIR.glob(f"{RESULT_PREFIX}*.json")):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(row, dict) and isinstance(row.get("suite"), str):
            rows[normalize(row["suite"])] = row
    return rows


def _rows_from_combined() -> dict[str, dict]:
    """Legacy rows from an existing combined file, so the first new run keeps them."""
    if not RESULTS.is_file():
        return {}
    try:
        doc = json.loads(RESULTS.read_text())
    except (OSError, ValueError):
        return {}
    rows = {}
    for row in doc.get("results", []):
        if isinstance(row, dict) and isinstance(row.get("suite"), str):
            rows[normalize(row["suite"])] = row
    return rows


def merge_results(extra: list[dict]) -> dict:
    """Merge every per-suite file plus this run's rows into the combined result."""
    with _merge_lock():
        rows = _rows_from_combined()
        rows.update(_rows_from_disk())
        for row in extra:
            rows[normalize(row["suite"])] = row
        order = list(SUITES) + sorted(set(rows) - set(SUITES))
        results = [rows[name] for name in order if name in rows]
        payload = {
            "schema": "rsure.suite-results/v1",
            "node": node_url(),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "results": results,
        }
        _atomic_write(RESULTS, json.dumps(payload, indent=2) + "\n")
    return payload


def _decode_timeout(value) -> str:
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value or ""


def _trailer(output: str) -> dict | None:
    matches = TRAILER.findall(output)
    for raw in reversed(matches):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _base_row(name: str, script: str, started_at: str) -> dict:
    return {
        "suite": name,
        "script": script,
        "status": "fail",
        "returncode": None,
        "seconds": 0,
        "output": "",
        "started_at": started_at,
        "assertions": 0,
        "passed": 0,
        "failed": 0,
        "covered_arms": [],
        "env_reason": None,
    }


def run_suite(name: str) -> dict:
    """Run one behavioural suite and return its recorded row."""
    script = ROOT / "harness" / SUITES[name]
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    started = time.time()
    if not script.is_file():
        print(f"--- {name}: not_run (missing {script.name}) ---")
        row = _base_row(name, SUITES[name], started_at)
        row.update({"status": "not_run", "returncode": 2,
                    "output": "missing script",
                    "env_reason": "missing suite script"})
        _write_row(row)
        return row

    try:
        proc = subprocess.run([sys.executable, str(script)], cwd=ROOT, text=True,
                              capture_output=True, timeout=TIMEOUT,
                              env=child_env())
        output = (proc.stdout or "") + (proc.stderr or "")
        returncode = proc.returncode
    except subprocess.TimeoutExpired as exc:
        output = _decode_timeout(exc.stdout) + _decode_timeout(exc.stderr)
        returncode = 1
        output += f"\ntimeout after {TIMEOUT}s"
    except OSError as error:
        output = f"could not start {script}: {error}"
        returncode = 1

    trailer = _trailer(output)

    def _int(value) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    assertions = _int(trailer.get("assertions", 0)) if trailer else 0
    passed = _int(trailer.get("passed", 0)) if trailer else 0
    failed = _int(trailer.get("failed", 0)) if trailer else 0
    covered = trailer.get("covered_arms", []) if trailer else []
    if not isinstance(covered, list):
        covered = []
    covered = [arm for arm in covered if isinstance(arm, str)]
    env_reason = None
    if returncode == 2:
        reason = re.search(r"not[ _]run\s*[:—–-]\s*(.+)", output)
        env_reason = reason.group(1).strip() if reason else "suite reported not_run"
        status = "not_run"
    elif returncode == 0 and trailer and assertions > 0 and failed == 0:
        status = "pass"
    else:
        status = "fail"
        if returncode == 0 and (not trailer or assertions == 0):
            env_reason = (
                "zero assertions (missing RSURE_RESULT trailer or empty suite)")
        elif "Computation ran out of phlogistons" in output:
            env_reason = "deploy phlogiston exhaustion (devnet budget, not a defect)"
        elif "insufficient funds" in output:
            env_reason = "deploy precharge insufficient funds (devnet budget)"

    print(f"--- {name}: {status} ({returncode}) ---")
    print(output.rstrip())
    row = {
        "suite": name,
        "script": SUITES[name],
        "status": status,
        "returncode": returncode,
        "seconds": round(time.time() - started, 3),
        "output": output[-4000:],
        "started_at": started_at,
        "assertions": assertions,
        "passed": passed,
        "failed": failed,
        "covered_arms": covered,
        "env_reason": env_reason,
    }
    path = _write_row(row)
    print(f"  wrote {path.relative_to(ROOT)}")
    return row


def run_command(name: str, argv: list[str], label: str | None = None) -> dict:
    """Run an explicit non-suite command and record pass/fail/not-run."""
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    started = time.time()
    script = label or " ".join(argv)
    try:
        proc = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True,
                              timeout=TIMEOUT, env=child_env())
        output = (proc.stdout or "") + (proc.stderr or "")
        returncode = proc.returncode
    except subprocess.TimeoutExpired as exc:
        output = _decode_timeout(exc.stdout) + _decode_timeout(exc.stderr)
        output += f"\ntimeout after {TIMEOUT}s"
        returncode = 1
    except OSError as error:
        output = f"could not start {argv[0]}: {error}"
        returncode = 2
    status = {0: "pass", 2: "not_run"}.get(returncode, "fail")
    print(f"--- {name}: {status} ({returncode}) ---")
    print(output.rstrip())
    row = _base_row(name, script, started_at)
    row.update({
        "status": status,
        "returncode": returncode,
        "seconds": round(time.time() - started, 3),
        "output": output[-4000:],
        "kind": "command",
        "env_reason": output.strip().splitlines()[-1] if status == "not_run" else None,
    })
    path = _write_row(row)
    print(f"  wrote {path.relative_to(ROOT)}")
    return row


def _parse_names(raw: list[str]) -> tuple[list[str], list[str]]:
    names: list[str] = []
    unknown: list[str] = []
    for item in raw:
        name = normalize(item)
        if name == "all":
            names.extend(SUITES)
        elif name in SUITES or name in PSEUDO:
            names.append(name)
        else:
            unknown.append(item)
    return names, unknown


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*",
                    help="suite names (hyphens accepted); default: all suites")
    ap.add_argument("--all", action="store_true", help="run every registered suite")
    ap.add_argument("--list", action="store_true", help="list the suite map")
    ap.add_argument("--fixtures", action="store_true",
                    help="run the offline placement-fixture self-check")
    ap.add_argument("--keystores", action="store_true",
                    help="run the Rust keystore test suite")
    args = ap.parse_args(argv)

    if args.list:
        for name, script in SUITES.items():
            print(f"{name:20} {script}")
        for name, command in PSEUDO.items():
            print(f"{name:20} {' '.join(command)}")
        return 0

    if args.fixtures and args.keystores:
        print("run_suites: choose --fixtures or --keystores, not both",
              file=sys.stderr)
        return 1

    if args.fixtures or args.keystores:
        if args.names or args.all:
            print("run_suites: --fixtures/--keystores do not take suite names",
                  file=sys.stderr)
            return 1
        name = "fixtures" if args.fixtures else "keystores"
        row = run_command(name, PSEUDO[name])
        merge_results([row])
        print(f"run_suites: merged into {RESULTS.relative_to(ROOT)}")
        return 0 if row["status"] == "pass" else (2 if row["status"] == "not_run" else 1)

    requested = list(SUITES) if args.all else (args.names or DEFAULT)
    names, unknown = _parse_names(requested)
    if unknown:
        print(f"run_suites: unknown suites {unknown}", file=sys.stderr)
        print("run_suites: use --list to see the mapped suites", file=sys.stderr)
        return 1
    # Preserve canonical suite order regardless of command-line order.
    names = [name for name in list(SUITES) + list(PSEUDO) if name in names]

    rows = [run_suite(name) for name in names if name in SUITES]
    rows += [run_command(name, PSEUDO[name]) for name in names if name in PSEUDO]
    payload = merge_results(rows)
    print(f"run_suites: wrote {RESULTS.relative_to(ROOT)} "
          f"({len(payload['results'])} result rows)")

    statuses = [row["status"] for row in rows]
    if "fail" in statuses:
        return 1
    if "not_run" in statuses:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
