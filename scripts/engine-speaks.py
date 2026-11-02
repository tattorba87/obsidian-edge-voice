"""Has an installed engine say something, as the plugin would ask it to.

    python -I scripts/engine-speaks.py <engine python> <voice> [mlx]

Starts `<engine python> -I -u -m edge_voice_engine`, checks hello, loads the
voice (with the faster engine when "mlx" is given, which must then be the one
that speaks) and synthesizes a sentence. The Engine package workflow runs this
with the network cut off, which proves the engine reads only what's on disk.
"""

import base64
import json
import subprocess
import sys

python, voice = sys.argv[1], sys.argv[2]
engine = sys.argv[3] if len(sys.argv) > 3 else None
proc = subprocess.Popen(
    [python, "-I", "-u", "-m", "edge_voice_engine"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
)


def ask(**body):
    proc.stdin.write(json.dumps(body) + "\n")
    proc.stdin.flush()
    while True:
        reply = json.loads(proc.stdout.readline())
        if reply.get("id") == body["id"]:
            return reply


assert json.loads(proc.stdout.readline()) == {"event": "ready"}
hello = ask(id=1, op="hello")
print("hello:", hello)
assert hello.get("engine") == "edge-voice-engine", hello
load = {"engine": engine} if engine else {}
loaded = ask(id=2, op="load", language="en_us", voice=voice, **load)
print("load:", loaded)
assert loaded.get("ok"), loaded
if engine:
    assert loaded.get("engine") == engine, loaded
spoken = ask(id=3, op="synth", text="Edge Voice is reading this offline.", speed=1.0)
seconds = len(base64.b64decode(spoken["audio"])) / 4 / spoken["sampleRate"]
print(f"synth: {seconds:.2f} s of audio")
assert seconds > 1, spoken
proc.stdin.close()
proc.wait(timeout=30)
