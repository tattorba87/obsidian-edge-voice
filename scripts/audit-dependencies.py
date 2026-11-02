"""Report advisories and coverage gaps without installing or changing locked packages."""

import argparse
import importlib.metadata
import json
import os
import re

# Runs fixed audit tool argv without a shell.
import subprocess  # nosec B404
import sys
from datetime import date
from pathlib import Path

PIP_AUDIT_VERSION = "2.10.1"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".scratch" / "security-audit"


def canonical(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def python_report(lock, data):
    """Check coverage against the input so skipped requirements cannot look clean."""
    text = lock.read_text()
    expected = {canonical(match[1]) for match in re.finditer(r"^([A-Za-z0-9_.-]+)==([^\s;\\]+)", text, re.MULTILINE)}
    if not expected:
        raise ValueError("Lock has no exact package pins")
    dependencies = data["dependencies"]
    if not isinstance(dependencies, list):
        raise ValueError("Invalid pip-audit dependencies")
    covered = set()
    package_gaps = {}
    findings = []
    seen_advisories = set()
    for item in dependencies:
        name = item["name"]
        if "skip_reason" in item:
            package_gaps[canonical(name)] = item["skip_reason"]
        else:
            covered.add(canonical(name))
            for vulnerability in item["vulns"]:
                key = (canonical(name), item["version"], vulnerability["id"])
                if key in seen_advisories:
                    continue
                seen_advisories.add(key)
                fixes = ", ".join(vulnerability.get("fix_versions", [])) or "none listed"
                findings.append(f"{name} {item['version']}: {vulnerability['id']} (fix: {fixes})")
    for name in sorted(expected - covered):
        package_gaps.setdefault(name, "absent from scanner results")
    if "moonshine-voice" in expected and lock.name in {"darwin-arm64.txt", "darwin-x64.txt"}:
        scanner_reason = package_gaps.get("moonshine-voice")
        # A skipped/missing package and the custom wheel are one package gap.
        package_gaps["moonshine-voice"] = "PyPI name/version lookup does not audit the custom Mac wheel" + (
            f"; scanner: {scanner_reason}" if scanner_reason else ""
        )
    gaps = [f"{name}: {reason}" for name, reason in sorted(package_gaps.items())]
    if "moonshine-voice" in expected:
        gaps.append(
            "Native library coverage: ONNX Runtime and libmoonshine bundled inside moonshine-voice "
            "are not audited by a PyPI name/version lookup"
        )
    if ";" in re.sub(r"#.*", "", text):
        gaps.append("Environment markers need platform-specific coverage review")
    return {"packages": len(covered), "findings": findings, "gaps": gaps}


def bun_report(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid Bun audit JSON")
    findings = []
    gaps = []
    records = []
    for name, advisories in data.items():
        if not isinstance(advisories, list):
            raise ValueError(f"Unrecognized Bun audit field: {name}")
        for advisory in advisories:
            if not isinstance(advisory, dict) or "url" not in advisory or "severity" not in advisory:
                gaps.append(f"{name}: unrecognized or skipped advisory record: {advisory}")
                continue
            findings.append(f"{name}: {advisory['severity']} — {advisory['url']}")
            records.append({"package": name, "url": advisory["url"], "severity": advisory["severity"]})
    return {"packages": "bun.lock", "findings": findings, "gaps": gaps, "advisories": records}


def run_scan(name, command, parser):
    report = {"packages": 0, "findings": [], "gaps": [], "errors": []}
    try:
        completed = subprocess.run(
            # command is built from fixed audit tools and paths, never note text.
            command,  # nosec B603
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=180,
            check=False,
        )
        (OUTPUT / f"{name}.json").write_text(completed.stdout)
        (OUTPUT / f"{name}.log").write_text(completed.stderr)
        if completed.returncode not in (0, 1):
            raise ValueError(f"Scanner exited {completed.returncode}; see {name}.log")
        report.update(parser(json.loads(completed.stdout)))
        if completed.returncode and not report["findings"] and not report["gaps"]:
            raise ValueError(f"Scanner failed without usable findings; see {name}.log")
        if "skipp" in completed.stderr.lower() and not report["gaps"]:
            report["gaps"].append(f"Scanner reported skipped packages; see {name}.log")
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as error:
        report["errors"].append(str(error))
    return report


def markdown(reports):
    lines = [
        "# Dependency advisory scan",
        "",
        "No locks are changed and no update PRs are opened.",
        "A name/version advisory lookup is not a code, artifact-integrity or native-library audit.",
        "",
        "| Input | Packages queried | Advisories | Gaps | Errors |",
        "| --- | --- | --- | --- | --- |",
    ]
    for name, report in reports.items():
        lines.append(
            f"| {name} | {report['packages']} | {len(report['findings'])} | "
            f"{len(report['gaps'])} | {len(report['errors'])} |"
        )
    for name, report in reports.items():
        for label, field in [("Advisories", "findings"), ("Coverage gaps", "gaps"), ("Scanner errors", "errors")]:
            if report[field]:
                lines.extend(["", f"## {name}: {label}", ""])
                lines.extend(f"- {message}" for message in report[field])
    incomplete = any(r["gaps"] or r["errors"] for r in reports.values())
    lines.extend(
        [
            "",
            "Coverage incomplete; do not interpret this as a clean audit."
            if incomplete
            else "All declared inputs were queried; no guarantee of vulnerability-free code.",
        ]
    )
    return "\n".join(lines) + "\n"


def release_gate(reports, policy, manifest, today=None):
    """Only reviewed, dated, moderate-or-lower dev exceptions can pass the gate."""
    today = today or date.today()
    reviewed, review_by = date.fromisoformat(policy["reviewed"]), date.fromisoformat(policy["reviewBy"])
    if not reviewed <= today <= review_by:
        raise ValueError("Advisory allowlist needs a current maintainer review")
    allowed = {}
    for entry in policy["advisories"]:
        if not entry["reason"].strip() or not re.fullmatch(r"GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}", entry["id"]):
            raise ValueError("Each allowlist entry needs an exact advisory ID and reason")
        key = (canonical(entry["package"]), "https://github.com/advisories/" + entry["id"])
        if key in allowed:
            raise ValueError("Duplicate advisory allowlist entry")
        allowed[key] = entry["reason"]
    blocked, accepted = [], []
    for name, report in reports.items():
        blocked.extend(f"{name}: scanner error: {error}" for error in report["errors"])
        if name != "bun.lock":
            blocked.extend(f"{name}: {finding}" for finding in report["findings"])
            continue
        blocked.extend(f"bun.lock: incomplete advisory coverage: {gap}" for gap in report["gaps"])
        records = report.get("advisories", [])
        if len(records) != len(report["findings"]):
            blocked.append("bun.lock: missing structured advisory records")
        production = any(manifest.get(key) for key in ("dependencies", "optionalDependencies", "peerDependencies"))
        for entry in records:
            key = (canonical(entry["package"]), entry["url"])
            if key in allowed and entry["severity"] in ("low", "moderate") and not production:
                accepted.append(f"{entry['package']}: {entry['url']} — {allowed[key]}")
            else:
                blocked.append(f"bun.lock: {entry['package']}: {entry['severity']} — {entry['url']}")
    return blocked, accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--enforce-policy",
        "--release",
        dest="release",
        action="store_true",
        help="enforce reviewed advisory exceptions; gaps stay visible",
    )
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    reports = {}
    try:
        installed = importlib.metadata.version("pip-audit")
    except importlib.metadata.PackageNotFoundError:
        installed = None
    locks = sorted((ROOT / "locks").glob("*.txt"))
    if not locks:
        reports["locks"] = {"packages": 0, "findings": [], "gaps": [], "errors": ["No locks found"]}
    for lock in locks:
        if installed != PIP_AUDIT_VERSION:
            reports[lock.name] = {
                "packages": 0,
                "findings": [],
                "gaps": [],
                "errors": [f"Requires pip-audit=={PIP_AUDIT_VERSION}; got {installed}"],
            }
            continue
        reports[lock.name] = run_scan(
            lock.stem,
            [
                sys.executable,
                "-m",
                "pip_audit",
                "--disable-pip",
                "--require-hashes",
                "-r",
                str(lock),
                "--format",
                "json",
                "--progress-spinner",
                "off",
            ],
            lambda data, lock=lock: python_report(lock, data),
        )
    reports["bun.lock"] = run_scan("bun", ["bun", "audit", "--json"], bun_report)
    summary = markdown(reports)
    gate_failed = False
    gate_error = False
    if args.release:
        try:
            policy = json.loads((ROOT / "scripts/advisory-allowlist.json").read_text())
            manifest = json.loads((ROOT / "package.json").read_text())
            blocked, accepted = release_gate(reports, policy, manifest)
            gate_failed = bool(blocked)
            summary += "\n## Advisory policy\n\n"
            summary += (
                "Gate failed.\n" if blocked else "Policy passed; documented coverage gaps above remain unaudited.\n"
            )
            summary += "\n".join("- Blocked: " + item for item in blocked) + "\n"
            summary += "\n".join("- Accepted dev-only advisory: " + item for item in accepted) + "\n"
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            gate_failed = True
            gate_error = True
            summary += f"\nRelease gate policy error: {error}\n"

    (OUTPUT / "summary.md").write_text(summary)
    (OUTPUT / "summary.json").write_text(json.dumps(reports, indent=2) + "\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write(summary)
    if gate_error or any(report["errors"] for report in reports.values()):
        return 2
    if args.release:
        return int(gate_failed)
    return int(any(report["findings"] or report["gaps"] for report in reports.values()))


if __name__ == "__main__":
    sys.exit(main())
