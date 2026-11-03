"""The engine's JSON-lines protocol and its voices command, against stub libraries.

The engine runs as the package people install (python -m edge_voice_engine),
in a temporary home with its own voice caches. It serves the plugin with
downloads off: the stubs fail any attempt, so these tests also prove that only
`edge-voice-engine voices get`, run by the person, downloads anything.
"""

import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUB = Path(__file__).resolve().parent / "stub"
PACKAGE = ROOT / "engine" / "src"
SERVER = PACKAGE / "edge_voice_engine" / "server.py"
MLX_FILES = Path("mlx-community/Kokoro-82M-bf16") / "a71e4d38b236d968966a2002c4c895dbd12b1c3c"


def engine_home(home=None, voices=("kokoro_af_heart",), mlx=("af_heart",)):
    """A home folder holding these voices, as `voices get` (and `--faster`) leaves them."""
    home = Path(home or tempfile.mkdtemp())
    cache = home / "moonshine"
    cache.mkdir(parents=True, exist_ok=True)
    for voice in voices:
        (cache / f"{voice}.ort").write_text("voice")
    hf = home / ".edge-voice" / "hf" / MLX_FILES
    if mlx:
        (hf / "voices").mkdir(parents=True, exist_ok=True)
        (hf / "model.safetensors").write_text("model")
        for voice in mlx:
            (hf / "voices" / f"{voice}.safetensors").write_text("voice")
    return home


def engine_env(home, **env_extra):
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(STUB), str(PACKAGE)]),
        "HOME": str(home),
        "USERPROFILE": str(home),
        "MOONSHINE_STUB_CACHE": str(home / "moonshine"),
        **env_extra,
    }


class Server:
    def __init__(self, *, script=False, home=None, **env_extra):
        self.home = home or engine_home()
        # The engine serving the plugin must never download: the stubs fail if it tries.
        env = engine_env(self.home, MOONSHINE_STUB_OFFLINE="1", **env_extra)
        command = [str(SERVER)] if script else ["-m", "edge_voice_engine"]
        self.proc = subprocess.Popen(
            [sys.executable, "-u", *command],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        self.next_id = 1

    def read(self):
        line = self.proc.stdout.readline()
        assert line, self.proc.stderr.read()
        return json.loads(line)

    def request(self, **body):
        request_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"id": request_id, **body}) + "\n")
        self.proc.stdin.flush()
        return request_id

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=5)


@pytest.fixture
def server():
    s = Server()
    assert s.read() == {"event": "ready"}
    yield s
    s.close()


def test_load_keeps_native_output_off_the_protocol(server):
    request_id = server.request(op="load", language="en_us", voice="kokoro_af_heart")
    assert server.read() == {"id": request_id, "ok": True}


def test_load_of_a_voice_not_on_disk_says_how_to_get_it(server):
    reply = answer(server, op="load", language="en_us", voice="piper_en_US-lessac-medium")
    assert reply["missing"] == "piper_en_US-lessac-medium"
    assert "edge-voice-engine voices get piper_en_US-lessac-medium" in reply["error"]


def test_synth_returns_float32_audio(server):
    server.request(op="load", language="en_us", voice="kokoro_af_heart")
    while "id" not in server.read():
        pass
    request_id = server.request(op="synth", text="Hello there.", speed=2.0)
    reply = server.read()
    assert reply["id"] == request_id and reply["sampleRate"] == 24000
    assert len(base64.b64decode(reply["audio"])) == 4 * round(len("Hello there.") / 2.0)


def test_synth_before_load_is_an_error(server):
    request_id = server.request(op="synth", text="Too early.")
    assert server.read() == {"id": request_id, "error": "RuntimeError: no voice loaded"}


def test_a_bad_voice_keeps_the_old_one(server):
    server.request(op="load", language="en_us", voice="kokoro_af_heart")
    while "id" not in server.read():
        pass
    request_id = server.request(op="load", language="en_us", voice="no_such_voice")
    assert server.read()["missing"] == "no_such_voice"
    server.request(op="synth", text="Still here.")
    assert server.read()["ok"] is True
    assert request_id


def test_voices_paths_and_unknown_ops(server):
    server.request(op="voices", language="en_us")
    reply = server.read()
    catalog = reply.pop("catalog")
    assert reply == {
        "id": 1,
        "ok": True,
        "present": ["kokoro_af_heart"],
        "downloadable": ["piper_en_US-lessac-medium"],
    }
    # Every verified voice, recommended first, described for people.
    assert catalog[0]["id"] == "kokoro_af_heart" and catalog[0]["recommended"]
    emma = next(voice for voice in catalog if voice["id"] == "kokoro_bf_emma")
    assert emma | {"size": 0, "download": 0} == {
        "id": "kokoro_bf_emma",
        "language": "en_gb",
        "name": "Emma",
        "accent": "British English",
        "gender": "female",
        "engine": "Kokoro",
        "quality": "",
        "recommended": True,
        "faster": True,
        "installed": False,
        "size": 0,
        "download": 0,
    }
    assert emma["download"] == emma["size"] > 80_000_000
    server.request(op="paths")
    assert server.read()["cache"] == "/tmp/moonshine_voice"
    request_id = server.request(op="dance")
    assert server.read() == {"id": request_id, "error": "ValueError: unknown op 'dance'"}


def test_a_garbled_line_gets_an_error_and_the_server_carries_on(server):
    server.proc.stdin.write("not json\n")
    server.proc.stdin.flush()
    assert server.read()["error"].startswith("JSONDecodeError")
    server.request(op="paths")
    assert server.read()["ok"] is True


def loaded(server, **body):
    request_id = server.request(op="load", **body)
    while True:
        reply = server.read()
        if reply.get("id") == request_id:
            return reply


def synth_samples(server):
    server.request(op="synth", text="Hello there.", speed=1.0)
    audio = base64.b64decode(server.read()["audio"])
    return struct.unpack(f"<{len(audio) // 4}f", audio)


def test_mlx_speaks_kokoro_voices(server):
    reply = loaded(server, language="en_us", voice="kokoro_af_heart", engine="mlx")
    assert reply == {"id": reply["id"], "ok": True, "engine": "mlx"}
    samples = synth_samples(server)
    assert samples and set(samples) == {0.75}


def test_mlx_falls_back_to_moonshine_for_piper_voices():
    server = Server(home=engine_home(voices=["piper_en_US-lessac-medium"]))
    assert server.read() == {"event": "ready"}
    reply = loaded(server, language="en_us", voice="piper_en_US-lessac-medium", engine="mlx")
    assert reply["ok"] is True and reply["engine"] == "moonshine"
    assert "Kokoro" in reply["fallback"]
    assert set(synth_samples(server)) == {0.25}
    server.close()


def test_mlx_without_its_files_falls_back_and_says_how_to_get_them():
    server = Server(home=engine_home(mlx=()))
    assert server.read() == {"event": "ready"}
    reply = loaded(server, language="en_us", voice="kokoro_af_heart", engine="mlx")
    assert reply["engine"] == "moonshine"
    assert "edge-voice-engine voices get kokoro_af_heart --faster" in reply["fallback"]
    server.close()


def test_mlx_falls_back_to_moonshine_when_it_cannot_load():
    server = Server(MLX_STUB_FAIL="1")
    assert server.read() == {"event": "ready"}
    reply = loaded(server, language="en_us", voice="kokoro_af_heart", engine="mlx")
    assert reply["engine"] == "moonshine" and "no Metal GPU" in reply["fallback"]
    assert set(synth_samples(server)) == {0.25}
    server.close()


def test_mlx_downloads_stay_private_whatever_the_environment_says(tmp_path):
    # As if Obsidian had been started with someone's own Hugging Face settings.
    # Wherever the engine is installed, the files go to ~/.edge-voice/hf, which
    # the plugin's storage list shows and can delete.
    server = Server(
        home=engine_home(tmp_path),
        HF_HOME="/elsewhere/hf",
        USER_HF_HOME="/elsewhere/hf",
        EXPECTED_HF_HOME=str(tmp_path / ".edge-voice" / "hf"),
        HF_TOKEN="hf_secret",
    )
    assert server.read() == {"event": "ready"}
    reply = loaded(server, language="en_us", voice="kokoro_af_heart", engine="mlx")
    assert reply["engine"] == "mlx", reply
    server.close()


def test_load_without_an_engine_replies_as_before(server):
    reply = loaded(server, language="en_us", voice="kokoro_af_heart")
    assert reply == {"id": reply["id"], "ok": True}


def answer(server, **body):
    request_id = server.request(**body)
    while True:
        reply = server.read()
        if reply.get("id") == request_id:
            return reply


@pytest.mark.parametrize(
    "voice",
    ["../../etc/passwd", "kokoro_af_heart/../x", "a b", "x" * 101, 12],
)
def test_load_refuses_a_voice_id_that_isnt_one(server, voice):
    # The faster engine builds a file name from it; a path in it must never get that far.
    reply = answer(server, op="load", language="en_us", voice=voice)
    assert "invalid voice" in reply["error"]


def test_load_refuses_a_language_id_that_isnt_one(server):
    assert "invalid language" in answer(server, op="load", language="en_us/..", voice="kokoro_af_heart")["error"]


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"text": "x" * 20001}, "at most 20000"),
        ({"text": None}, "at most 20000"),
        ({"text": "Hi.", "speed": float("nan")}, "invalid speed"),
        ({"text": "Hi.", "speed": "fast"}, "invalid speed"),
        ({"text": "Hi.", "speed": 10}, "outside 0.25 to 4"),
    ],
)
def test_synth_refuses_text_and_speeds_it_shouldnt_take(server, body, message):
    answer(server, op="load", language="en_us", voice="kokoro_af_heart")
    assert message in answer(server, op="synth", **body)["error"]


def test_valid_ids_with_capitals_still_load():
    # Piper voices carry their locale, e.g. en_US.
    server = Server(home=engine_home(voices=["piper_en_US-lessac-medium"]))
    assert server.read() == {"event": "ready"}
    assert answer(server, op="load", language="en_us", voice="piper_en_US-lessac-medium") == {"id": 1, "ok": True}
    server.close()


def test_hello_names_the_engine_and_its_protocol(server):
    reply = answer(server, op="hello")
    assert reply == {"id": reply["id"], "ok": True, "engine": "edge-voice-engine", "version": "0.3.0", "protocol": 1}


def test_runs_as_a_plain_script_too():
    # For running a checkout's server.py by hand.
    server = Server(script=True)
    assert server.read() == {"event": "ready"}
    assert answer(server, op="hello")["ok"]
    server.close()


def test_package_version_matches_the_engine():
    import tomllib

    project = tomllib.loads((ROOT / "engine" / "pyproject.toml").read_text())["project"]
    assert f'VERSION = "{project["version"]}"' in SERVER.read_text()


def fixture_voice_manifest():
    def digest(content):
        return {"sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}

    voices = ["kokoro_af_heart", "piper_en_US-lessac-medium"]
    return {
        "schema": 1,
        "moonshine": {
            "files": {"shared.dict": digest(b"dictionary"), **{f"{voice}.ort": digest(b"voice") for voice in voices}},
            "voices": {"en_us/" + voice: ["shared.dict", f"{voice}.ort"] for voice in voices},
        },
        "faster": {
            "repository": "mlx-community/Kokoro-82M-bf16",
            "revision": "a71e4d38b236d968966a2002c4c895dbd12b1c3c",
            "base_files": ["model.safetensors"],
            "files": {"model.safetensors": digest(b"downloaded"), "voices/af_heart.safetensors": digest(b"downloaded")},
            "voices": {"kokoro_af_heart": ["model.safetensors", "voices/af_heart.safetensors"]},
        },
    }


def run_command(*args, home=None, voice_manifest=None, **extra):
    home = home or engine_home()
    # Only the test's temporary package has fixture hashes. Production has no env/file override.
    package = home / "test-package" / "edge_voice_engine"
    shutil.copytree(
        PACKAGE / "edge_voice_engine", package, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__")
    )
    (package / "voices.json").write_text(
        json.dumps(voice_manifest if voice_manifest is not None else fixture_voice_manifest())
    )
    env = engine_env(home, **extra)
    env["PYTHONPATH"] = os.pathsep.join([str(STUB), str(package.parent)])
    return subprocess.run(
        [sys.executable, "-m", "edge_voice_engine", *args],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )


def test_command_prints_its_python_and_version():
    assert run_command("--python").stdout.strip() == sys.executable
    assert run_command("--version").stdout.strip() == "0.3.0"
    wrong = run_command("--install")
    assert wrong.returncode != 0 and "unknown arguments" in wrong.stderr


def test_voices_get_downloads_a_voice_the_engine_can_then_load(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    result = run_command("voices", "get", "kokoro_af_heart", home=home)
    assert result.returncode == 0, result.stderr
    assert "download.moonshine.ai" in result.stdout and "ready" in result.stdout
    server = Server(home=home)
    assert server.read() == {"event": "ready"}
    assert answer(server, op="load", language="en_us", voice="kokoro_af_heart")["ok"]
    server.close()


def test_voices_get_faster_also_fetches_the_mlx_files(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    assert run_command("voices", "get", "kokoro_af_heart", "--faster", home=home).returncode == 0
    assert (home / ".edge-voice" / "hf" / MLX_FILES / "voices" / "af_heart.safetensors").exists()
    server = Server(home=home)
    assert server.read() == {"event": "ready"}
    assert loaded(server, language="en_us", voice="kokoro_af_heart", engine="mlx")["engine"] == "mlx"
    server.close()


def test_voices_get_refuses_unknown_voices_and_piper_for_the_faster_engine(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    unknown = run_command("voices", "get", "kokoro_nobody", home=home)
    assert unknown.returncode == 1 and "voices list" in unknown.stderr
    piper = run_command("voices", "get", "piper_en_US-lessac-medium", "--faster", home=home)
    assert piper.returncode == 1 and "Kokoro" in piper.stderr
    assert "not a voice name" in run_command("voices", "get", "../x", home=home).stderr


def catalog_manifest():
    """The fixture manifest plus a British voice, sharing Kokoro's model file."""
    data = fixture_voice_manifest()
    data["moonshine"]["files"]["kokoro.model"] = {"sha256": "0" * 64, "size": 80_000_000}
    for key in ["en_us/kokoro_af_heart", "en_gb/kokoro_bf_emma"]:
        data["moonshine"]["voices"][key] = ["kokoro.model", key.split("/")[1] + ".ort"]
    data["moonshine"]["files"]["kokoro_bf_emma.ort"] = data["moonshine"]["files"]["kokoro_af_heart.ort"]
    return data


def test_voices_list_shows_names_sizes_and_what_is_here(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    # A UTF-8 console, as on macOS and Linux; Windows' legacy one is tested below.
    result = run_command("voices", "list", home=home, voice_manifest=catalog_manifest(), PYTHONIOENCODING="utf-8")
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert lines[1].startswith("★") and "Heart · American English · female · Kokoro" in lines[1]
    assert "kokoro_af_heart" in lines[1] and "80 MB" in lines[1] and "yes" in lines[1]
    assert any("Lessac · American English · female · Piper · medium quality" in line for line in lines)
    assert "voices get <ID>" in result.stdout

    # Once Kokoro's model is here, the next Kokoro voice is small.
    (home / "moonshine" / "kokoro.model").write_text("model")
    (home / "moonshine" / "kokoro_af_heart.ort").write_text("voice")
    voices = json.loads(run_command("voices", "list", "--json", home=home, voice_manifest=catalog_manifest()).stdout)
    by_id = {voice["id"]: voice for voice in voices}
    assert by_id["kokoro_af_heart"]["installed"] and by_id["kokoro_af_heart"]["download"] == 0
    assert by_id["kokoro_bf_emma"]["download"] == 5 and by_id["kokoro_bf_emma"]["language"] == "en_gb"
    installed = run_command("voices", "list", "--installed", home=home, voice_manifest=catalog_manifest())
    assert "kokoro_af_heart" in installed.stdout and "kokoro_bf_emma" not in installed.stdout


def test_voices_get_takes_several_voices(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    result = run_command("voices", "get", "kokoro_af_heart", "piper_en_US-lessac-medium", home=home)
    assert result.returncode == 0, result.stderr
    assert "Got 2 of 2 voices." in result.stdout
    assert (home / "moonshine" / "piper_en_US-lessac-medium.ort").exists()
    partly = run_command("voices", "get", "kokoro_af_heart", "kokoro_nobody", home=home)
    assert partly.returncode == 1 and "Got 1 of 2 voices." in partly.stderr


def test_voice_manifest_is_packaged_identically():
    reviewed = ROOT / "engine/voices.json"
    assert reviewed.read_bytes() == (PACKAGE / "edge_voice_engine/voices.json").read_bytes()
    data = json.loads(reviewed.read_text())
    assert "en_us/kokoro_af_bella" in data["moonshine"]["voices"]
    assert "en_us/piper_en_US-lessac-medium" in data["moonshine"]["voices"]


def test_bad_download_is_deleted_and_never_reported_ready(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    reply = run_command("voices", "get", "kokoro_af_heart", home=home, MOONSHINE_STUB_TAMPER="1")
    assert reply.returncode == 1 and "SHA-256 verification failed" in reply.stderr
    assert not (home / "moonshine/kokoro_af_heart.ort").exists()
    assert "ready" not in reply.stdout


def test_cached_voice_and_shared_language_tampering_is_detected(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    assert run_command("voices", "get", "kokoro_af_heart", home=home).returncode == 0
    for filename in ["kokoro_af_heart.ort", "shared.dict"]:
        path = home / "moonshine" / filename
        path.write_bytes(b"tampered")
        reply = run_command("voices", "get", "kokoro_af_heart", home=home)
        assert reply.returncode == 1 and "SHA-256 verification failed" in reply.stderr
        assert not path.exists()
        assert run_command("voices", "get", "kokoro_af_heart", home=home).returncode == 0


def test_unlisted_voice_needs_explicit_unverified_flag(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    data = fixture_voice_manifest()
    del data["moonshine"]["voices"]["en_us/piper_en_US-lessac-medium"]
    reply = run_command("voices", "get", "piper_en_US-lessac-medium", home=home, voice_manifest=data)
    assert reply.returncode == 1 and "--unverified" in reply.stderr
    assert not (home / "moonshine/piper_en_US-lessac-medium.ort").exists()
    reply = run_command("voices", "get", "piper_en_US-lessac-medium", "--unverified", home=home, voice_manifest=data)
    assert reply.returncode == 0 and "WARNING" in reply.stderr


def test_unverified_does_not_bypass_hash_for_a_known_voice(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    reply = run_command("voices", "get", "kokoro_af_heart", "--unverified", home=home, MOONSHINE_STUB_TAMPER="1")
    assert reply.returncode == 1 and "SHA-256" in reply.stderr


def test_bad_faster_download_is_deleted_before_model_parsing(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    reply = run_command("voices", "get", "kokoro_af_heart", "--faster", home=home, HF_STUB_TAMPER="model.safetensors")
    assert reply.returncode == 1 and "SHA-256 verification failed" in reply.stderr
    assert not (home / ".edge-voice/hf" / MLX_FILES / "model.safetensors").exists()


def test_manifest_path_escape_and_incomplete_record_are_refused(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    for change in ["escape", "missing"]:
        data = fixture_voice_manifest()
        if change == "escape":
            data["moonshine"]["files"]["../outside"] = data["moonshine"]["files"]["shared.dict"]
        else:
            del data["moonshine"]["files"]["shared.dict"]
        reply = run_command("voices", "get", "kokoro_af_heart", home=home, voice_manifest=data)
        assert reply.returncode == 1
        assert not (home / "moonshine/kokoro_af_heart.ort").exists()


def test_readme_voice_tables_match_the_catalog():
    result = subprocess.run(
        [sys.executable, "-I", str(ROOT / "scripts" / "voice-table.py"), "--check"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


def test_voices_list_works_on_a_legacy_windows_console(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    result = run_command("voices", "list", home=home, voice_manifest=catalog_manifest(), PYTHONIOENCODING="cp1252")
    assert result.returncode == 0, result.stderr
    assert "* " in result.stdout and "Heart - American English - female - Kokoro" in result.stdout


def test_voices_list_stops_quietly_when_the_reader_does(tmp_path):
    home = engine_home(tmp_path, voices=[], mlx=())
    package = home / "test-package"
    run_command("voices", "list", home=home)  # Lays out the package with the fixture manifest.
    env = engine_env(home)
    env["PYTHONPATH"] = os.pathsep.join([str(STUB), str(package)])
    for _ in range(20):
        lister = subprocess.Popen(
            [sys.executable, "-m", "edge_voice_engine", "voices", "list"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        lister.stdout.close()  # Like `| head` exiting before the table is written.
        _, errors = lister.communicate()
        assert lister.returncode == 0, errors
        assert b"Traceback" not in errors and b"BrokenPipe" not in errors
