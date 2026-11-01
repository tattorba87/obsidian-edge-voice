"""A stand-in for server.py that speaks the same protocol without an engine.

synth returns as many samples as the text has characters; texts starting with
"slow" take 300 ms; "fail" errors; load reports progress first, and answers
an MLX request the way server.py does.

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

print(json.dumps({"event": "ready"}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if LOG:
        with open(LOG, "a") as log:
            log.write(json.dumps(request) + "\n")
    request_id = request.get("id")
    op = request.get("op")
    if op == "load":
        print(json.dumps({"event": "progress", "fraction": 0.5, "file": "voice"}), flush=True)
        reply = {"id": request_id, "ok": True}
        # Like server.py: MLX takes Kokoro voices, anything else falls back.
        if request.get("engine") == "mlx":
            mlx = request.get("voice", "").startswith("kokoro_")
            reply["engine"] = "mlx" if mlx else "moonshine"
            if not mlx:
                reply["fallback"] = "the faster engine only has Kokoro voices"
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
        reply = {"id": request_id, "ok": True, "present": ["kokoro_af_bella"], "downloadable": ["kokoro_am_santa"]}
    elif op == "paths":
        reply = {"id": request_id, "ok": True, "cache": "/tmp/cache"}
    else:
        reply = {"id": request_id, "error": f"ValueError: unknown op {op!r}"}
    print(json.dumps(reply), flush=True)
