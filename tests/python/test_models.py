"""Managed ASR assets must be verified before the native library can parse them."""

import hashlib
import importlib.util
import io
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "models", Path(__file__).parents[2] / "engine/src/edge_voice_engine/models.py"
)
models = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(models)


def test_pinned_catalog_has_only_english_streaming_models():
    catalog = models.catalog()
    assert set(catalog) == {"tiny", "small", "medium"}
    for name, entry in catalog.items():
        assert f"/{name}-streaming-en/quantized_" in entry["base_url"]
        assert len(entry["files"]) == 8


@pytest.fixture
def managed(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "model_root", lambda: tmp_path / "models")
    record = {"size": 4, "sha256": hashlib.sha256(b"good").hexdigest()}
    monkeypatch.setattr(
        models,
        "catalog",
        lambda: {"tiny": {"base_url": "https://download.moonshine.ai/test", "files": {"model.ort": record}}},
    )
    return models.model_path("tiny")


def test_offline_verification_rejects_same_size_corruption_without_deleting(managed):
    managed.mkdir(parents=True)
    path = managed / "model.ort"
    path.write_bytes(b"good")
    assert models.checked_model("tiny") == managed
    path.write_bytes(b"evil")
    with pytest.raises(ValueError, match="missing or damaged"):
        models.checked_model("tiny")
    assert path.read_bytes() == b"evil"


@pytest.mark.parametrize("body", [b"evil", b"go", b"goodtoo"])
def test_failed_download_preserves_old_file_and_cleans_temporary(managed, monkeypatch, body):
    managed.mkdir(parents=True)
    (managed / "model.ort").write_bytes(b"old")
    response = io.BytesIO(body)
    response.geturl = lambda: "https://download.moonshine.ai/test/model.ort"
    monkeypatch.setattr(models.urllib.request, "urlopen", lambda *args, **kwargs: response)
    with pytest.raises(ValueError):
        models.download("tiny")
    assert (managed / "model.ort").read_bytes() == b"old"
    assert list(managed.iterdir()) == [managed / "model.ort"]


def test_download_verifies_then_reuses_without_network(managed, monkeypatch):
    response = io.BytesIO(b"good")
    response.geturl = lambda: "https://download.moonshine.ai/test/model.ort"

    def open_model(request, **kwargs):
        # Moonshine refuses Python-urllib's default user agent with HTTP 403.
        assert request.get_header("User-agent") == "edge-voice-engine"
        assert kwargs["timeout"] == 60
        return response

    monkeypatch.setattr(models.urllib.request, "urlopen", open_model)
    models.download("tiny")

    def network_forbidden(*args, **kwargs):
        raise AssertionError("must not redownload verified models")

    monkeypatch.setattr(models.urllib.request, "urlopen", network_forbidden)
    models.download("tiny")
    assert models.checked_model("tiny") == managed
    assert models.main(["remove", "tiny"]) == 0
    assert not managed.exists()


def test_managed_symlink_is_refused_without_deleting_target(managed, tmp_path):
    outside = tmp_path / "keep"
    outside.mkdir()
    (outside / "private").write_bytes(b"keep")
    managed.parent.mkdir()
    try:
        managed.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable")
    assert models.main(["remove", "tiny"]) == 1
    assert (outside / "private").read_bytes() == b"keep"
