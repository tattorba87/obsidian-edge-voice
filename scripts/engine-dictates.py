"""Real, offline TTS-to-STT smoke test against a packaged engine and managed Tiny model.

    python -I scripts/engine-dictates.py <installed engine python> <installed TTS voice>

Run `edge-voice-engine models get tiny` explicitly before invoking this script.
The model is verified offline by the normal loader. No audio is saved.
"""

import base64
import json
import subprocess  # nosec B404 -- explicit installed interpreter and fixed module argv
import sys


def main():
    python, voice = sys.argv[1:3]
    proc = subprocess.Popen(  # nosec B603 -- caller supplies the installed engine interpreter
        [python, "-I", "-u", "-m", "edge_voice_engine"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
    )

    def ask(**body):
        proc.stdin.write(json.dumps({"id": 1, **body}) + "\n")
        proc.stdin.flush()
        while line := proc.stdout.readline():
            reply = json.loads(line)
            if reply.get("id") == 1:
                if not reply.get("ok"):
                    raise RuntimeError(reply)
                return reply
        raise RuntimeError("Engine closed before answering")

    try:
        hello = ask(op="hello")
        if "dictation-streaming-v1" not in hello.get("capabilities", []):
            raise RuntimeError("Packaged engine lacks dictation capability")
        ask(op="load", voice=voice, language="en_us")
        spoken = ask(op="synth", text="Today I am writing a note. My words stay on this computer.", speed=1.0)
        raw = base64.b64decode(spoken["audio"])
        rate = spoken["sampleRate"]
        ask(op="asr_start", model="tiny", modelPath="")
        for offset in range(0, len(raw), rate * 4):
            ask(op="asr_audio", audio=base64.b64encode(raw[offset : offset + rate * 4]).decode(), sampleRate=rate)
        final = ask(op="asr_stop")["text"]
        print(f"Offline packaged Tiny recognition: {final}")
        if not all(word in final.lower() for word in ("writing", "note", "computer")):
            raise RuntimeError("Recognizer did not recover the smoke sentence")
        ask(op="load", voice=voice, language="en_us")
        ask(op="synth", text="Reading still works after dictation.", speed=1.0)
        print("TTS → STT → TTS passed with managed model verification.")
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


if __name__ == "__main__":
    main()
