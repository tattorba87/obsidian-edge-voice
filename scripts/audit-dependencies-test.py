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


if __name__ == "__main__":
    unittest.main()
