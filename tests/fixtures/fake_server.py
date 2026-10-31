"""A stand-in for server.py that speaks the same protocol without an engine.

synth returns as many samples as the text has characters; texts starting with
"slow" take 300 ms; "fail" errors; load reports progress first.
"""

import base64
import json
import struct
import sys
import time

print(json.dumps({"event": "ready"}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    request_id = request.get("id")
    op = request.get("op")
    if op == "load":
        print(json.dumps({"event": "progress", "fraction": 0.5, "file": "voice"}), flush=True)
        reply = {"id": request_id, "ok": True}
    elif op == "synth":
        text = request["text"]
        if text.startswith("slow"):
            time.sleep(0.3)
        if text.startswith("fail"):
            reply = {"id": request_id, "error": "RuntimeError: cannot say that"}
        else:
            pcm = struct.pack(f"<{len(text)}f", *([0.5] * len(text)))
            reply = {"id": request_id, "ok": True, "sampleRate": 24000, "audio": base64.b64encode(pcm).decode()}
    elif op == "paths":
        reply = {"id": request_id, "ok": True, "cache": "/tmp/cache"}
    else:
        reply = {"id": request_id, "error": f"ValueError: unknown op {op!r}"}
    print(json.dumps(reply), flush=True)
