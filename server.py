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

On Apple silicon, "load" can ask for Kokoro on MLX (the GPU, via mlx-audio):

  {"id": 5, "op": "load", "language": "en_us", "voice": "kokoro_am_santa", "engine": "mlx"}
  -> {"id": 5, "ok": true, "engine": "mlx"}

When MLX can't take the voice (Piper voices, other languages) or fails to
load, the voice loads with moonshine-voice instead and the reply says why:
  -> {"id": 5, "ok": true, "engine": "moonshine", "fallback": "..."}
A "load" without "engine" uses moonshine-voice and replies as above.
"""

import array
import base64
import json
import os
import sys
from pathlib import Path

# Kokoro for MLX on Hugging Face (the model and its voices, as .safetensors),
# pinned to one commit so what users download can't change under them.
MLX_WEIGHTS = "mlx-community/Kokoro-82M-bf16"
MLX_REVISION = "a71e4d38b236d968966a2002c4c895dbd12b1c3c"


def private_hugging_face() -> None:
    """Keeps Hugging Face downloads in ~/.edge-voice, anonymous and without telemetry.

    Set before huggingface_hub is imported, since it reads these then. HF_HOME
    is forced, not defaulted: one set for other tools would put the files where
    deleting ~/.edge-voice doesn't reach. Tokens are dropped, so nothing ties the
    downloads to anyone's account.
    """
    os.environ["HF_HOME"] = str(Path(__file__).resolve().parent / "hf")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ.pop("HF_TOKEN", None)
    os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)


class MlxVoice:
    """Kokoro on MLX, behind the same synthesize/close calls as moonshine-voice."""

    def __init__(self, voice: str):
        private_hugging_face()
        from huggingface_hub import hf_hub_download
        from mlx_audio.tts.utils import load_model

        # The voice file at the pinned commit, given to mlx-audio by path.
        name = voice.removeprefix("kokoro_")
        self.voice = hf_hub_download(MLX_WEIGHTS, f"voices/{name}.safetensors", revision=MLX_REVISION)
        self.model = load_model(MLX_WEIGHTS, revision=MLX_REVISION)

    def synthesize(self, text, speed=None):
        samples = []
        for result in self.model.generate(text, voice=self.voice, speed=speed or 1.0, lang_code="a"):
            samples.extend(result.audio.tolist())
        return samples, self.model.sample_rate

    def close(self):
        pass


def mlx_refusal(language: str, voice: str):
    """Why MLX can't speak this voice, or None if it can."""
    if language != "en_us":
        return "the faster engine only speaks English"
    if not voice.startswith("kokoro_"):
        return "the faster engine only has Kokoro voices"
    return None


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
                language = request.get("language") or "en_us"
                voice = request.get("voice") or ""
                engine = request.get("engine")
                candidate = None
                fallback = None
                if engine == "mlx":
                    fallback = mlx_refusal(language, voice)
                    if fallback is None:
                        try:
                            candidate = MlxVoice(voice)
                            candidate.synthesize("Ready.")
                        except Exception as error:  # Any MLX trouble: Moonshine speaks instead.
                            candidate = None
                            fallback = f"the faster engine failed to load ({type(error).__name__}: {error})"
                if candidate is None:
                    # Open the new voice first, so a bad choice keeps the old one.
                    candidate = TextToSpeech().language(language)
                    if voice:
                        candidate.voice(voice)
                    candidate.on_progress(on_progress)
                    candidate.load()
                    # ONNX Runtime's first run is slow; pay for it here, not on
                    # the first sentence someone is waiting to hear.
                    candidate.synthesize("Ready.")
                if tts is not None:
                    tts.close()
                tts = candidate
                reply = {"id": request_id, "ok": True}
                if engine is not None:
                    reply["engine"] = "moonshine" if fallback else engine
                    if fallback:
                        reply["fallback"] = fallback
                send(reply)
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
