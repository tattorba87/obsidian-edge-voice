"""Reporting checks: findings, skipped artifacts and tool failures must stay visible."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("audit-dependencies.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ReportingTests(unittest.TestCase):
    def report(self, text, dependencies, name="linux-x64.txt"):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / name
            lock.write_text(text)
            return audit.python_report(lock, {"dependencies": dependencies})

    def test_clean_query(self):
        report = self.report(
            "example==1.0 \\\n --hash=sha256:abc\n", [{"name": "example", "version": "1.0", "vulns": []}]
        )
        self.assertEqual(report, {"packages": 1, "findings": [], "gaps": []})

    def test_advisory_and_fix(self):
        report = self.report(
            "example==1.0",
            [{"name": "example", "version": "1.0", "vulns": [{"id": "TEST-1", "fix_versions": ["2.0"]}]}],
        )
        self.assertIn("TEST-1 (fix: 2.0)", report["findings"][0])

    def test_missing_and_skipped_are_gaps(self):
        report = self.report("missing==1.0\nskipped==2.0", [{"name": "skipped", "skip_reason": "not on PyPI"}])
        self.assertEqual(report["packages"], 0)
        self.assertEqual(len(report["gaps"]), 2)

    def test_duplicate_advisory_ids_are_counted_once(self):
        vulnerability = {"id": "TEST-1", "fix_versions": []}
        report = self.report(
            "example==1.0",
            [{"name": "example", "version": "1.0", "vulns": [vulnerability, vulnerability]}],
        )
        self.assertEqual(len(report["findings"]), 1)

    def test_custom_mac_wheel_is_gap_even_with_pypi_result(self):
        report = self.report(
            "moonshine-voice==0.1.5", [{"name": "moonshine-voice", "version": "0.1.5", "vulns": []}], "darwin-arm64.txt"
        )
        self.assertIn("custom Mac wheel", report["gaps"][0])

    def test_skipped_or_missing_mac_package_has_one_wheel_gap(self):
        for dependencies in [
            [],
            [{"name": "moonshine-voice", "skip_reason": "not on PyPI"}],
            [{"name": "moonshine_voice", "skip_reason": "not on PyPI"}] * 2,
        ]:
            for platform in ["darwin-arm64.txt", "darwin-x64.txt"]:
                with self.subTest(dependencies=dependencies, platform=platform):
                    report = self.report("moonshine-voice==0.1.5", dependencies, platform)
                    wheel_gaps = [gap for gap in report["gaps"] if gap.startswith("moonshine-voice:")]
                    self.assertEqual(len(wheel_gaps), 1)
                    self.assertIn("custom Mac wheel", wheel_gaps[0])
                    self.assertIn("scanner:", wheel_gaps[0])
                    self.assertEqual(len(report["gaps"]), 2)  # wheel plus native libraries

    def test_native_libraries_are_gap_on_every_engine_platform(self):
        for platform in ["darwin-arm64.txt", "darwin-x64.txt", "linux-arm64.txt", "linux-x64.txt", "win32-x64.txt"]:
            with self.subTest(platform=platform):
                report = self.report(
                    "moonshine-voice==0.1.5",
                    [{"name": "moonshine-voice", "version": "0.1.5", "vulns": []}],
                    platform,
                )
                native_gaps = [gap for gap in report["gaps"] if gap.startswith("Native library coverage:")]
                self.assertEqual(len(native_gaps), 1)
                self.assertIn("ONNX Runtime and libmoonshine", native_gaps[0])

    def test_lock_without_moonshine_does_not_claim_bundled_library_coverage(self):
        report = self.report(
            "example==1.0", [{"name": "example", "version": "1.0", "vulns": []}], "darwin-arm64-mlx.txt"
        )
        self.assertEqual(report["gaps"], [])

    def test_names_are_normalized(self):
        report = self.report("Some_Package==1.0", [{"name": "some-package", "version": "1.0", "vulns": []}])
        self.assertEqual(report["gaps"], [])

    def test_marker_coverage_is_not_silently_assumed(self):
        report = self.report('example==1.0; sys_platform == "win32"', [])
        self.assertTrue(report["gaps"])

    def test_bun_findings_and_unknown_skips(self):
        report = audit.bun_report(
            {
                "example": [{"url": "https://example.org/advisory", "severity": "high"}],
                "skipped": [{"reason": "unsupported"}],
            }
        )
        self.assertEqual(len(report["findings"]), 1)
        self.assertEqual(len(report["gaps"]), 1)

    def test_scanner_error_and_empty_failed_result(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(audit, "OUTPUT", Path(directory)):
            for code, output in [(2, ""), (1, "{}"), (0, "not json")]:
                with (
                    self.subTest(code=code, output=output),
                    patch.object(
                        audit.subprocess,
                        "run",
                        return_value=subprocess.CompletedProcess([], code, output, "diagnostic"),
                    ),
                ):
                    report = audit.run_scan("fake", ["fake"], audit.bun_report)
                    self.assertTrue(report["errors"])

    def test_timeout_is_error(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(audit, "OUTPUT", Path(directory)),
            patch.object(audit.subprocess, "run", side_effect=subprocess.TimeoutExpired("fake", 180)),
        ):
            self.assertTrue(audit.run_scan("fake", ["fake"], audit.bun_report)["errors"])

    def test_summary_labels_incomplete_coverage(self):
        report = {"packages": 0, "findings": [], "gaps": ["custom wheel"], "errors": []}
        self.assertIn("Coverage incomplete", audit.markdown({"test": report}))


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.policy = {
            "reviewed": "2026-11-02",
            "reviewBy": "2026-12-02",
            "advisories": [{"package": "moment", "id": "GHSA-4p3w-j4w9-5jqw", "reason": "dev SDK pin"}],
        }
        self.manifest = {"devDependencies": {"obsidian": "1.14.4"}}
        self.today = audit.date(2026, 11, 2)

    def reports(self, package="moment", advisory="GHSA-4p3w-j4w9-5jqw", severity="moderate"):
        bun = audit.bun_report({package: [{"url": "https://github.com/advisories/" + advisory, "severity": severity}]})
        bun["errors"] = []
        return {
            "linux-x64.txt": {"packages": 1, "findings": [], "gaps": ["native library gap"], "errors": []},
            "bun.lock": bun,
        }

    def gate(self, reports):
        return audit.release_gate(reports, self.policy, self.manifest, self.today)

    def test_reviewed_dev_exception_passes_without_hiding_gaps(self):
        blocked, accepted = self.gate(self.reports())
        self.assertEqual(blocked, [])
        self.assertEqual(len(accepted), 1)

    def test_any_python_advisory_blocks_even_if_id_allowed_for_bun(self):
        reports = self.reports()
        reports["linux-x64.txt"]["findings"] = ["moment: GHSA-4p3w-j4w9-5jqw"]
        self.assertTrue(self.gate(reports)[0])

    def test_new_bun_advisory_blocks_even_on_same_package(self):
        self.assertTrue(self.gate(self.reports(advisory="GHSA-aaaa-bbbb-cccc"))[0])
        self.assertTrue(self.gate(self.reports(package="other"))[0])

    def test_high_severity_or_production_dependency_disables_exception(self):
        self.assertTrue(self.gate(self.reports(severity="high"))[0])
        self.manifest["dependencies"] = {"something": "1.0"}
        self.assertTrue(self.gate(self.reports())[0])

    def test_expired_future_or_missing_review_fails(self):
        for changes in [{"reviewBy": "2026-11-01"}, {"reviewed": "2026-11-03"}, {"reviewed": "invalid"}]:
            with self.subTest(changes=changes):
                policy = {**self.policy, **changes}
                with self.assertRaises(ValueError):
                    audit.release_gate(self.reports(), policy, self.manifest, self.today)

    def test_missing_reason_or_wildcard_advisory_rejected(self):
        for changes in [{"reason": ""}, {"id": "*"}]:
            with self.subTest(changes=changes):
                self.policy["advisories"][0].update(changes)
                with self.assertRaises(ValueError):
                    self.gate(self.reports())

    def test_scanner_errors_bun_gaps_and_missing_records_block(self):
        for field, value in [("errors", ["network error"]), ("gaps", ["unmapped registry"]), ("advisories", [])]:
            reports = self.reports()
            reports["bun.lock"][field] = value
            self.assertTrue(self.gate(reports)[0])


if __name__ == "__main__":
    unittest.main()
