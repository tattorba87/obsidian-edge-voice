"""A stand-in for the engine that speaks the same protocol without a speech library.

synth returns as many samples as the text has characters; texts starting with
"slow" take 300 ms; "fail" errors. load answers an MLX request the way the
engine does, and a voice that isn't on disk (kokoro_am_santa, listed as
downloadable) the way the engine does: an error naming the missing voice.

For the tests against real Obsidian (tests/obsidian), three optional
environment variables: EDGE_VOICE_FAKE_LOG appends every request to that
file as a JSON line; EDGE_VOICE_FAKE_SECONDS_PER_CHAR makes audio that long
per character, silent, so a sentence lasts long enough to be looked at; and
EDGE_VOICE_FAKE_DELAY waits that many seconds before each synth.
"""

import base64
import json
import os
import struct
import sys
import time

LOG = os.environ.get("EDGE_VOICE_FAKE_LOG")
SECONDS_PER_CHAR = float(os.environ.get("EDGE_VOICE_FAKE_SECONDS_PER_CHAR", "0"))
DELAY = float(os.environ.get("EDGE_VOICE_FAKE_DELAY", "0"))


def voice(voice_id, language, name, accent, gender, recommended, installed, download):
    return {
        "id": voice_id,
        "language": language,
        "name": name,
        "accent": accent,
        "gender": gender,
        "engine": "Kokoro",
        "quality": "",
        "recommended": recommended,
        "faster": True,
        "installed": installed,
        "size": 84_000_000,
        "download": download,
    }


# Like the engine's catalog: recommended first, sizes for what's still to get.
CATALOG = [
    voice("kokoro_af_bella", "en_us", "Bella", "American English", "female", True, True, 0),
    voice("kokoro_bf_emma", "en_gb", "Emma", "British English", "female", True, False, 520_000),
    voice("kokoro_am_santa", "en_us", "Santa", "American English", "male", False, False, 520_000),
]

print(json.dumps({"event": "ready"}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if LOG:
        with open(LOG, "a") as log:
            log.write(json.dumps(request) + "\n")
    request_id = request.get("id")
    op = request.get("op")
    if op == "load":
        reply = {"id": request_id, "ok": True}
        # Like server.py: MLX takes Kokoro voices, anything else falls back.
        if request.get("engine") == "mlx":
            mlx = request.get("voice", "").startswith("kokoro_")
            reply["engine"] = "mlx" if mlx else "moonshine"
            if not mlx:
                reply["fallback"] = "the faster engine only has Kokoro voices"
        if request.get("voice") == "kokoro_am_santa":
            reply = {
                "id": request_id,
                "error": "The voice kokoro_am_santa isn't downloaded. "
                "Get it with: edge-voice-engine voices get kokoro_am_santa",
                "missing": "kokoro_am_santa",
            }
    elif op == "synth":
        text = request["text"]
        if text.startswith("slow"):
            time.sleep(0.3)
        time.sleep(DELAY)
        if text.startswith("fail"):
            reply = {"id": request_id, "error": "RuntimeError: cannot say that"}
        else:
            count = int(len(text) * SECONDS_PER_CHAR * 24000) if SECONDS_PER_CHAR else len(text)
            level = 0.0 if SECONDS_PER_CHAR else 0.5
            pcm = struct.pack(f"<{count}f", *([level] * count))
            reply = {"id": request_id, "ok": True, "sampleRate": 24000, "audio": base64.b64encode(pcm).decode()}
    elif op == "voices":
        reply = {
            "id": request_id,
            "ok": True,
            "present": ["kokoro_af_bella"],
            "downloadable": ["kokoro_am_santa"],
            "catalog": CATALOG,
        }
    elif op == "paths":
        reply = {"id": request_id, "ok": True, "cache": "/tmp/cache"}
    else:
        reply = {"id": request_id, "error": f"ValueError: unknown op {op!r}"}
    print(json.dumps(reply), flush=True)
