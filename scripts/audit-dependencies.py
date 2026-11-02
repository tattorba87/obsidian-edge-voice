"""Report advisories and coverage gaps without installing or changing locked packages."""

import importlib.metadata
import json
import os
import re
import subprocess
import sys
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
    gaps = []
    findings = []
    seen_advisories = set()
    for item in dependencies:
        name = item["name"]
        if "skip_reason" in item:
            gaps.append(f"{name}: {item['skip_reason']}")
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
        if not any(canonical(item["name"]) == name and "skip_reason" in item for item in dependencies):
            gaps.append(f"{name}: absent from scanner results")
    if ";" in re.sub(r"#.*", "", text):
        gaps.append("Environment markers need platform-specific coverage review")
    if lock.name in {"darwin-arm64.txt", "darwin-x64.txt"}:
        gaps.append(
            "moonshine-voice: PyPI name/version lookup does not audit the custom Mac wheel "
            "or its bundled native libraries"
        )
    return {"packages": len(covered), "findings": findings, "gaps": gaps}


def bun_report(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid Bun audit JSON")
    findings = []
    gaps = []
    for name, advisories in data.items():
        if not isinstance(advisories, list):
            raise ValueError(f"Unrecognized Bun audit field: {name}")
        for advisory in advisories:
            if not isinstance(advisory, dict) or "url" not in advisory or "severity" not in advisory:
                gaps.append(f"{name}: unrecognized or skipped advisory record: {advisory}")
                continue
            findings.append(f"{name}: {advisory['severity']} — {advisory['url']}")
    return {"packages": "bun.lock", "findings": findings, "gaps": gaps}


def run_scan(name, command, parser):
    report = {"packages": 0, "findings": [], "gaps": [], "errors": []}
    try:
        completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180, check=False)
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
        "Reports only; no locks are changed and no update PRs are opened.",
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


def main():
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
    (OUTPUT / "summary.md").write_text(summary)
    (OUTPUT / "summary.json").write_text(json.dumps(reports, indent=2) + "\n")
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write(summary)
    if any(report["errors"] for report in reports.values()):
        return 2
    return int(any(report["findings"] or report["gaps"] for report in reports.values()))


if __name__ == "__main__":
    sys.exit(main())
