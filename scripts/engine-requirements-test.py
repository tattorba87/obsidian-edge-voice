"""Generate release requirements from fixture wheels and reject version/source drift."""

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("requirements", Path(__file__).with_name("engine-requirements.py"))
requirements = importlib.util.module_from_spec(spec)
spec.loader.exec_module(requirements)


class ReleaseRequirements(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist, self.out = self.root / "dist", self.root / "out"
        self.dist.mkdir()
        (self.root / "engine").mkdir()
        (self.root / "locks").mkdir()
        (self.root / "engine/pyproject.toml").write_text('[project]\nversion = "0.2.0"\n')
        (self.root / "engine/pins.json").write_text(
            json.dumps(
                {
                    "mlx": {
                        "spacyModel": {
                            "url": "https://example.invalid/en_core_web_sm-3.8.0-py3-none-any.whl",
                            "sha256": "f" * 64,
                        }
                    }
                }
            )
        )
        self.wheel("edge_voice_engine-0.2.0-py3-none-any.whl")
        self.wheel("docopt-0.6.2-py2.py3-none-any.whl")
        for name, cpu in requirements.PLATFORMS.items():
            digest = "a" * 64
            if cpu:
                wheel = self.wheel(f"moonshine_voice-0.1.5-py3-none-macosx_13_0_{cpu}.whl")
                digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
            (self.root / f"locks/{name}.txt").write_text(
                self.pin("moonshine-voice", "0.1.5", digest) + self.pin("shared", "1.0", "b" * 64)
            )
        (self.root / "locks/darwin-arm64-mlx.txt").write_text(
            self.pin("shared", "1.0", "b" * 64)
            + self.pin("docopt", "0.6.2", "c" * 64)
            + self.pin("en-core-web-sm", "3.8.0", "f" * 64)
        )
        self.root_patch = patch.object(requirements, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        with patch.object(sys, "argv", ["fixture", str(self.dist), "https://example.invalid/release", str(self.out)]):
            requirements.main()

    def wheel(self, filename):
        path = self.dist / filename
        name, version = filename.split("-")[:2]
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(
                f"{name}-{version}.dist-info/METADATA", f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n"
            )
        return path

    def pin(self, name, version, digest):
        return f"{name}=={version} \\\n    --hash=sha256:{digest}\n"

    def test_all_six_outputs_match_base_and_mlx_versions(self):
        requirements.validate_release(self.out)
        self.assertEqual(len(list(self.out.glob("requirements-*.txt"))), 6)
        self.assertIn("edge-voice-engine[mlx] @", (self.out / "requirements-darwin-arm64-mlx.txt").read_text())

    def test_changed_missing_extra_and_duplicate_packages_are_rejected(self):
        path = self.out / "requirements-linux-x64.txt"
        original = path.read_text()
        for text in [
            original.replace("shared==1.0", "shared==2.0"),
            original.replace(self.pin("shared", "1.0", "b" * 64), ""),
            original + self.pin("extra", "1.0", "d" * 64),
            original + self.pin("shared", "1.0", "b" * 64),
        ]:
            with self.subTest(text=text):
                path.write_text(text)
                with self.assertRaises(SystemExit):
                    requirements.validate_release(self.out)
        path.write_text(original)

    def test_wrong_url_version_engine_source_hash_or_option_is_rejected(self):
        path = self.out / "requirements-darwin-arm64-mlx.txt"
        original = path.read_text()
        for text in [
            original.replace("docopt-0.6.2-", "docopt-0.6.3-"),
            original.replace(
                "edge-voice-engine[mlx] @ https://example.invalid/release/edge_voice_engine-0.2.0-py3-none-any.whl",
                "edge-voice-engine==0.2.0",
            ),
            original.replace("--hash=sha256:", "--invalid=sha256:", 1),
            original + "--extra-index-url https://example.invalid\n",
        ]:
            with self.subTest(text=text):
                path.write_text(text)
                with self.assertRaises(SystemExit):
                    requirements.validate_release(self.out)
        path.write_text(original)

    def test_missing_or_extra_platform_file_is_rejected(self):
        path = self.out / "requirements-unknown.txt"
        path.write_text("extra==1.0")
        with self.assertRaises(SystemExit):
            requirements.validate_release(self.out)
        path.unlink()
        (self.out / "requirements-linux-x64.txt").unlink()
        with self.assertRaises(SystemExit):
            requirements.validate_release(self.out)


if __name__ == "__main__":
    unittest.main()
