"""Optional ASR operations, against the same offline native stub as TTS."""

import base64
import struct

import pytest
from test_server import answer

# Register shared fixtures without shadowing an imported function in each test.
pytest_plugins = ["test_server"]


@pytest.fixture
def model(tmp_path):
    for name in (
        "tokenizer.bin",
        "encoder.ort",
        "decoder_kv.ort",
        "frontend.ort",
        "cross_kv.ort",
        "adapter.ort",
        "streaming_config.json",
    ):
        (tmp_path / name).touch()
    return str(tmp_path)


def test_streaming_updates_finalize_and_return_to_tts(server, model):
    assert answer(server, op="asr_start", modelPath=model, model="medium")["text"] == ""
    assert "error" in answer(server, op="load", voice="kokoro_af_heart")
    assert "error" in answer(server, op="synth", text="Do not speak")
    assert "error" in answer(server, op="asr_start", modelPath=model, model="tiny")
    audio = base64.b64encode(struct.pack("<ff", 0.1, -0.1)).decode()
    for _ in range(2):
        assert answer(server, op="asr_audio", audio=audio, sampleRate=16000)["text"] == "Hello"
    assert answer(server, op="asr_stop")["text"] == "Hello world. Next line."
    assert answer(server, op="load", voice="kokoro_af_heart")["ok"]
    assert answer(server, op="synth", text="Still works")["ok"]


@pytest.mark.parametrize(
    "path,architecture", [("relative", "medium"), ("/missing", "medium"), ("/missing", "fr"), ("/missing", "base")]
)
def test_missing_or_non_english_selection_is_refused(server, path, architecture):
    assert "error" in answer(server, op="asr_start", modelPath=path, model=architecture)
    assert answer(server, op="load", voice="kokoro_af_heart")["ok"]


@pytest.mark.parametrize(
    "audio,rate",
    [
        ("!!!", 16000),
        ("", 16000),
        ("AAAA", 16000),
        ("AAAAAA==", True),
        ("AAAAAA==", 1),
        ("AAAAAA==", 16000.0),
        (base64.b64encode(struct.pack("<f", float("nan"))).decode(), 16000),
        (base64.b64encode(struct.pack("<f", float("inf"))).decode(), 16000),
    ],
)
def test_invalid_audio_is_refused_without_crashing(server, model, audio, rate):
    answer(server, op="asr_start", modelPath=model, model="tiny")
    assert "error" in answer(server, op="asr_audio", audio=audio, sampleRate=rate)
    assert answer(server, op="asr_stop")["ok"]


def test_audio_requires_start(server):
    assert "error" in answer(server, op="asr_audio", audio="AAAAAA==", sampleRate=16000)
    assert "error" in answer(server, op="asr_stop")


def test_managed_model_missing_gives_manual_download_command(server):
    result = answer(server, op="asr_start", modelPath="", model="medium")
    assert "models get medium" in result["error"]
    assert answer(server, op="load", voice="kokoro_af_heart")["ok"]


def test_split_frontend_supported(server, model):
    from pathlib import Path

    root = Path(model)
    (root / "frontend.ort").unlink()
    (root / "frontend.model.ort").touch()
    (root / "frontend.weights.ort").touch()
    assert answer(server, op="asr_start", modelPath=model, model="medium")["ok"]
    assert answer(server, op="asr_stop")["ok"]


@pytest.mark.parametrize("rate", [16000, 44100, 48000, 96000])
def test_loud_finite_samples_are_clamped(server, model, rate):
    answer(server, op="asr_start", modelPath=model, model="medium")
    audio = base64.b64encode(struct.pack("<ffff", 1.5, -2.0, 0.1, -0.1)).decode()
    assert answer(server, op="asr_audio", audio=audio, sampleRate=rate)["text"] == "Hello"
    assert answer(server, op="asr_stop")["ok"]
