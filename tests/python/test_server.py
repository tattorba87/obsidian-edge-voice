"""server.py's JSON-lines protocol, run as a subprocess against a stub engine."""

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUB = Path(__file__).resolve().parent / "stub"


class Server:
    def __init__(self):
        env = {**os.environ, "PYTHONPATH": str(STUB)}
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(ROOT / "server.py")],
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
