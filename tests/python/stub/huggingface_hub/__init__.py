"""A stand-in for huggingface_hub that refuses what server.py must never do.

It fails unless downloads are pinned to a commit, kept in the engine's own
folder, and anonymous, so the tests check server.py's settings for real.
"""

import os
from pathlib import Path


def check_private(revision):
    if not revision:
        raise RuntimeError("download not pinned to a revision")
    if not os.environ.get("HF_HOME", "").endswith("hf") or os.environ.get("HF_HOME") == os.environ.get("USER_HF_HOME"):
        raise RuntimeError(f"HF_HOME not forced: {os.environ.get('HF_HOME')}")
    if os.environ.get("HF_TOKEN") or os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN") != "1":
        raise RuntimeError("downloads would send a token")
    if os.environ.get("HF_HUB_DISABLE_TELEMETRY") != "1":
        raise RuntimeError("telemetry on")


def hf_hub_download(repo_id, filename, revision=None):
    check_private(revision)
    return str(Path(os.environ["HF_HOME"]) / repo_id / filename)
