"""The engine's JSON-lines protocol, run as a subprocess against a stub engine.

The engine runs as the package users install (python -m edge_voice_engine);
one test also runs server.py as a plain script, as today's in-plugin setup does.
"""

import base64
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUB = Path(__file__).resolve().parent / "stub"
PACKAGE = ROOT / "engine" / "src"
SERVER = PACKAGE / "edge_voice_engine" / "server.py"


class Server:
    def __init__(self, *, script=False, **env_extra):
        env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(STUB), str(PACKAGE)]), **env_extra}
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


def test_load_reports_progress_and_keeps_native_output_off_the_protocol(server):
    request_id = server.request(op="load", language="en_us", voice="kokoro_af_heart")
    assert server.read() == {"event": "progress", "fraction": 1.0, "file": "voice.ort"}
    assert server.read() == {"id": request_id, "ok": True}


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
    assert "no voice" in server.read()["error"]
    server.request(op="synth", text="Still here.")
    assert server.read()["ok"] is True
    assert request_id


def test_voices_paths_and_unknown_ops(server):
    server.request(op="voices", language="en_us")
    assert server.read()["present"] == ["kokoro_af_heart"]
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


def test_mlx_falls_back_to_moonshine_for_piper_voices(server):
    reply = loaded(server, language="en_us", voice="piper_en_US-lessac-medium", engine="mlx")
    assert reply["ok"] is True and reply["engine"] == "moonshine"
    assert "Kokoro" in reply["fallback"]
    assert set(synth_samples(server)) == {0.25}


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
        HOME=str(tmp_path),
        USERPROFILE=str(tmp_path),
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


def test_valid_ids_with_capitals_still_load(server):
    # Piper voices carry their locale, e.g. en_US.
    assert answer(server, op="load", language="en_us", voice="piper_en_US-lessac-medium") == {"id": 1, "ok": True}


def test_hello_names_the_engine_and_its_protocol(server):
    reply = answer(server, op="hello")
    assert reply == {"id": reply["id"], "ok": True, "engine": "edge-voice-engine", "version": "0.2.0", "protocol": 1}


def test_runs_as_a_plain_script_too():
    # Today's in-plugin setup copies server.py next to its environment and runs it.
    server = Server(script=True)
    assert server.read() == {"event": "ready"}
    assert answer(server, op="hello")["ok"]
    server.close()


def test_package_version_matches_the_engine():
    import tomllib

    project = tomllib.loads((ROOT / "engine" / "pyproject.toml").read_text())["project"]
    assert f'VERSION = "{project["version"]}"' in SERVER.read_text()


def run_command(*args):
    env = {**os.environ, "PYTHONPATH": str(PACKAGE)}
    return subprocess.run([sys.executable, "-m", "edge_voice_engine", *args], capture_output=True, text=True, env=env)


def test_command_prints_its_python_and_version():
    assert run_command("--python").stdout.strip() == sys.executable
    assert run_command("--version").stdout.strip() == "0.2.0"
    wrong = run_command("--install")
    assert wrong.returncode != 0 and "unknown arguments" in wrong.stderr
