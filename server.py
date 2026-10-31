#!/usr/bin/env python3
"""Text-to-speech sidecar for the Edge Voice Obsidian plugin.

The plugin starts this script and talks to it in JSON lines. One request per
line on stdin, one reply per request on stdout, in order:

  {"id": 1, "op": "load", "language": "en_us", "voice": "kokoro_af_heart"}
  -> {"id": 1, "ok": true}

  {"id": 2, "op": "synth", "text": "Hello there.", "speed": 1.0}
  -> {"id": 2, "ok": true, "sampleRate": 24000, "audio": "<base64 float32 LE>"}

  {"id": 3, "op": "voices", "language": "en_us"}
  -> {"id": 3, "ok": true, "present": [...], "downloadable": [...]}

  {"id": 4, "op": "paths"}
  -> {"id": 4, "ok": true, "cache": "/path/to/moonshine_voice/cache"}

A failed request gets {"id": n, "error": "..."}. While a voice downloads, the
server also emits {"event": "progress", "fraction": 0.4, "file": "..."}.
"""

import array
import base64
import json
import os
import sys


def main() -> None:
    # The native library logs to fd 1, which would corrupt the protocol, so
    # replies go to a private copy of stdout and fd 1 is pointed at stderr.
    protocol = os.fdopen(os.dup(1), "w", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    from moonshine_voice import TextToSpeech, list_tts_voices

    def send(message: dict) -> None:
        protocol.write(json.dumps(message) + "\n")
        protocol.flush()

    def on_progress(fraction: float, file: str) -> None:
        send({"event": "progress", "fraction": fraction, "file": str(file)})

    tts = None
    send({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            op = request.get("op")
            if op == "load":
                # Open the new voice first, so a bad choice keeps the old one.
                candidate = TextToSpeech().language(request.get("language") or "en_us")
                if request.get("voice"):
                    candidate.voice(request["voice"])
                candidate.on_progress(on_progress)
                candidate.load()
                # ONNX Runtime's first run is slow; pay for it here, not on
                # the first sentence someone is waiting to hear.
                candidate.synthesize("Ready.")
                if tts is not None:
                    tts.close()
                tts = candidate
                send({"id": request_id, "ok": True})
            elif op == "synth":
                if tts is None:
                    raise RuntimeError("no voice loaded")
                samples, sample_rate = tts.synthesize(request["text"], speed=request.get("speed"))
                if hasattr(samples, "astype"):
                    pcm = samples.astype("<f4").tobytes()
                else:
                    pcm = array.array("f", samples).tobytes()
                send(
                    {
                        "id": request_id,
                        "ok": True,
                        "sampleRate": sample_rate,
                        "audio": base64.b64encode(pcm).decode("ascii"),
                    }
                )
            elif op == "paths":
                from moonshine_voice.download_file import get_cache_dir

                send({"id": request_id, "ok": True, "cache": str(get_cache_dir())})
            elif op == "voices":
                voices = list_tts_voices(request.get("language") or "en_us")
                send({"id": request_id, "ok": True, **voices})
            else:
                raise ValueError(f"unknown op {op!r}")
        except Exception as error:  # Reported to the plugin, which keeps going.
            send({"id": request_id, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
