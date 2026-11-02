"""Has an installed engine say something, as the plugin would ask it to.

    python -I scripts/engine-speaks.py <engine python> <voice> [mlx]

Starts `<engine python> -I -u -m edge_voice_engine`, checks hello, loads the
voice (with the faster engine when "mlx" is given, which must then be the one
that speaks) and synthesizes a sentence. The Engine package workflow runs this
with the network cut off, which proves the engine reads only what's on disk.
"""

import base64
import json

# Explicit local interpreter, isolated mode and fixed module argv.
import subprocess  # nosec B404
import sys

python, voice = sys.argv[1], sys.argv[2]
engine = sys.argv[3] if len(sys.argv) > 3 else None
# CI supplies the installed interpreter; module and arguments are fixed.
proc = subprocess.Popen(  # nosec B603
    [python, "-I", "-u", "-m", "edge_voice_engine"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
)


def ask(**body):
    proc.stdin.write(json.dumps(body) + "\n")
    proc.stdin.flush()
    while True:
        reply = json.loads(proc.stdout.readline())
        if reply.get("id") == body["id"]:
            return reply


def require(condition, detail):
    if not condition:
        raise RuntimeError(f"Engine smoke check failed: {detail}")


require(json.loads(proc.stdout.readline()) == {"event": "ready"}, "ready event")
hello = ask(id=1, op="hello")
print("hello:", hello)
require(hello.get("engine") == "edge-voice-engine", hello)
load = {"engine": engine} if engine else {}
loaded = ask(id=2, op="load", language="en_us", voice=voice, **load)
print("load:", loaded)
require(loaded.get("ok"), loaded)
if engine:
    require(loaded.get("engine") == engine, loaded)
spoken = ask(id=3, op="synth", text="Edge Voice is reading this offline.", speed=1.0)
seconds = len(base64.b64decode(spoken["audio"])) / 4 / spoken["sampleRate"]
print(f"synth: {seconds:.2f} s of audio")
require(seconds > 1, spoken)
proc.stdin.close()
proc.wait(timeout=30)
