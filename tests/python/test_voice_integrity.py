"""Integrity checks must remove corrupt owned blobs without deleting outside files."""

import hashlib
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "voice_integrity", Path(__file__).parents[2] / "engine/src/edge_voice_engine/voice_integrity.py"
)
integrity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(integrity)
RECORD = {"size": 4, "sha256": hashlib.sha256(b"good").hexdigest()}


def test_same_size_corruption_is_deleted(tmp_path):
    path = tmp_path / "voice"
    path.write_bytes(b"evil")
    with pytest.raises(integrity.IntegrityError, match="SHA-256 verification failed"):
        integrity.verify(path, RECORD, tmp_path)
    assert not path.exists()


def link_or_skip(link, target):
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("symlinks unavailable for this Windows account")


def test_corrupt_hf_blob_and_snapshot_link_are_deleted(tmp_path):
    blob = tmp_path / "blob"
    blob.write_bytes(b"evil")
    link = tmp_path / "snapshot"
    link_or_skip(link, blob)
    with pytest.raises(integrity.IntegrityError, match="SHA-256 verification failed"):
        integrity.verify(link, RECORD, tmp_path)
    assert not blob.exists()
    assert not link.is_symlink()


def test_symlink_outside_cache_is_refused_without_deleting_target(tmp_path):
    root = tmp_path / "cache"
    root.mkdir()
    outside = tmp_path / "private"
    outside.write_bytes(b"evil")
    link = root / "voice"
    link_or_skip(link, outside)
    with pytest.raises(integrity.IntegrityError, match="escapes its cache"):
        integrity.verify(link, RECORD, root)
    assert outside.read_bytes() == b"evil"
    assert link.is_symlink()
