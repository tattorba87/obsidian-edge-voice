"""`edge-voice-engine storage`: listing downloads and removing them, only inside the engine's folders."""

import json
import os

import pytest
from test_server import engine_home, run_command


def downloads(tmp_path):
    """A home whose voice cache looks like Moonshine's, plus faster-engine files."""
    home = engine_home(tmp_path, voices=(), mlx=("af_heart",))
    tts = home / "moonshine"
    files = {
        "kokoro/model.ort": 3000,
        "kokoro/voices/af_heart.kokorovoice": 500,
        "en_us/piper-voices/en_US-ljspeech-high.ort": 2000,
        "en_us/piper-voices/en_US-ljspeech-high.onnx.json": 10,
        "en_us/piper-voices/en_US-amy-low.ort": 900,
        "en_us/dict.tsv": 100,
        "zipvoice/model.ort": 50,
    }
    for name, size in files.items():
        path = tts / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * size)
    return home, tts


def listing(home):
    reply = run_command("storage", "--json", home=home)
    assert reply.returncode == 0, reply.stderr
    return {item["id"]: item for item in json.loads(reply.stdout)}


def test_storage_groups_downloads_with_sizes(tmp_path):
    home, _ = downloads(tmp_path)
    items = listing(home)
    assert items["kokoro"]["bytes"] == 3500
    assert items["piper:en_US-ljspeech-high"]["bytes"] == 2010
    assert items["piper:en_US-amy-low"]["bytes"] == 900
    assert items["language:en_us"]["bytes"] == 100
    assert items["cloning"]["bytes"] == 50
    assert items["mlx"]["bytes"] > 0
    assert list(items)[0] == "kokoro"  # Largest first.


def test_storage_table_names_the_remove_command(tmp_path):
    home, _ = downloads(tmp_path)
    reply = run_command("storage", home=home)
    assert reply.returncode == 0
    assert "piper:en_US-amy-low" in reply.stdout
    assert "edge-voice-engine storage remove <ID>" in reply.stdout


def test_storage_with_nothing_downloaded(tmp_path):
    home = engine_home(tmp_path, voices=(), mlx=())
    assert listing(home) == {}
    assert "Nothing downloaded yet" in run_command("storage", home=home).stdout


def test_remove_deletes_only_the_named_voice(tmp_path):
    home, tts = downloads(tmp_path)
    reply = run_command("storage", "remove", "piper:en_US-ljspeech-high", home=home)
    assert reply.returncode == 0, reply.stderr
    assert "Removed Piper voice en_US-ljspeech-high" in reply.stdout
    assert not (tts / "en_us/piper-voices/en_US-ljspeech-high.ort").exists()
    assert (tts / "en_us/piper-voices/en_US-amy-low.ort").exists()
    assert set(listing(home)) == {"kokoro", "piper:en_US-amy-low", "language:en_us", "cloning", "mlx"}


def test_remove_faster_engine_voices(tmp_path):
    home, _ = downloads(tmp_path)
    assert run_command("storage", "remove", "mlx", home=home).returncode == 0
    assert not (home / ".edge-voice" / "hf").exists()
    assert "kokoro" in listing(home)


def test_remove_all_and_empty_folders_go(tmp_path):
    home, tts = downloads(tmp_path)
    assert run_command("storage", "remove", "--all", home=home).returncode == 0
    assert listing(home) == {}
    assert tts.exists() and list(tts.iterdir()) == []


def test_remove_needs_ids_or_all_and_refuses_unknown_ids(tmp_path):
    home, tts = downloads(tmp_path)
    assert run_command("storage", "remove", home=home).returncode == 2
    reply = run_command("storage", "remove", "../../etc", home=home)
    assert reply.returncode == 1
    assert "Nothing downloaded with the ID" in reply.stderr
    assert len(listing(home)) == 6


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_remove_deletes_a_link_not_what_it_points_to(tmp_path):
    home, tts = downloads(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("mine")
    (tts / "kokoro" / "linked.ort").symlink_to(outside / "keep.txt")
    (tts / "kokoro" / "linked-folder").symlink_to(outside, target_is_directory=True)
    assert run_command("storage", "remove", "kokoro", home=home).returncode == 0
    assert (outside / "keep.txt").read_text() == "mine"
    assert not (tts / "kokoro" / "linked.ort").is_symlink()


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_remove_refuses_a_voice_folder_that_is_a_link_outside(tmp_path):
    home, tts = downloads(tmp_path)
    outside = tmp_path / "elsewhere"
    (outside / "piper-voices").mkdir(parents=True)
    (outside / "piper-voices" / "en_GB-alba-medium.ort").write_text("not ours")
    (tts / "en_gb").symlink_to(outside, target_is_directory=True)
    # The linked folder isn't walked into, so there's nothing of it to list or delete.
    assert not any(item.startswith("piper:en_GB") for item in listing(home))
    run_command("storage", "remove", "--all", home=home)
    assert (outside / "piper-voices" / "en_GB-alba-medium.ort").read_text() == "not ours"
