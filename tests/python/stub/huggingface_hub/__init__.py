"""A stand-in for huggingface_hub that refuses what the engine must never do.

It fails unless downloads are pinned to a commit, kept in the engine's own
folder, and anonymous, so the tests check the engine's settings for real.
Files live under HF_HOME; with HF_HUB_OFFLINE=1 (the engine serving the
plugin) a missing file fails as the real library does, and nothing downloads.
"""

import os
from pathlib import Path


class LocalEntryNotFoundError(FileNotFoundError):
    pass


def check_private(revision):
    if not revision:
        raise RuntimeError("download not pinned to a revision")
    if not os.environ.get("HF_HOME", "").endswith("hf") or os.environ.get("HF_HOME") == os.environ.get("USER_HF_HOME"):
        raise RuntimeError(f"HF_HOME not forced: {os.environ.get('HF_HOME')}")
    expected = os.environ.get("EXPECTED_HF_HOME")
    if expected and os.environ.get("HF_HOME") != expected:
        raise RuntimeError(f"HF_HOME is {os.environ.get('HF_HOME')}, not {expected}")
    if os.environ.get("HF_TOKEN") or os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN") != "1":
        raise RuntimeError("downloads would send a token")
    if os.environ.get("HF_HUB_DISABLE_TELEMETRY") != "1":
        raise RuntimeError("telemetry on")


def fetch(repo_id, filename, revision):
    """The cached file, downloading it first unless offline."""
    check_private(revision)
    path = Path(os.environ["HF_HOME"]) / repo_id / revision / filename
    if not path.exists():
        if os.environ.get("HF_HUB_OFFLINE") == "1":
            raise LocalEntryNotFoundError(f"{filename} isn't in the cache and downloads are off")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("tampered" if os.environ.get("HF_STUB_TAMPER") == filename else "downloaded")
    return str(path)


def hf_hub_download(repo_id, filename, revision=None):
    return fetch(repo_id, filename, revision)


def try_to_load_from_cache(repo_id, filename, revision=None):
    path = Path(os.environ["HF_HOME"]) / repo_id / revision / filename
    return str(path) if path.is_file() else None
