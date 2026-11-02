"""A stand-in for server.py that misbehaves in one way, chosen by EDGE_VOICE_BAD:

silent      never says it's ready
hang        ready, then never answers
huge        answers a synth with one line that never ends
bad-audio   answers a synth with an impossible sample rate, or half a sample
bad-voices  lists voice IDs that aren't IDs
"""

import json
import os
import sys
import time

mode = os.environ.get("EDGE_VOICE_BAD", "")
if mode == "silent":
    time.sleep(60)
    sys.exit()
print(json.dumps({"event": "ready"}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    reply = {"id": request["id"], "ok": True}
    if mode == "hang":
        time.sleep(60)
    elif mode == "huge":
        sys.stdout.write("x" * 100_000)
        sys.stdout.flush()
        time.sleep(60)
    elif mode == "bad-audio":
        reply.update(sampleRate=-1 if request.get("text") == "rate" else 24000, audio="AAAA")
    elif mode == "bad-voices":
        reply.update(present=["kokoro_af_bella", "../../etc/passwd", 5], downloadable=["piper_en_US-lessac-medium"])
    print(json.dumps(reply), flush=True)
