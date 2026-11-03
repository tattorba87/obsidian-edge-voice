#!/usr/bin/env python3
"""Text-to-speech sidecar for the Edge Voice Obsidian plugin.

The plugin starts this (as `python -I -u -m edge_voice_engine` when the engine
is installed as a package, or as a script) and talks to it in JSON lines. One
request per line on stdin, one reply per request on stdout, in order:

  {"id": 0, "op": "hello"}
  -> {"id": 0, "ok": true, "engine": "edge-voice-engine", "version": "0.2.0", "protocol": 1}

"protocol" changes only when a change would break a plugin that speaks the
previous one; additions within a protocol keep older plugins working.

  {"id": 1, "op": "load", "language": "en_us", "voice": "kokoro_af_heart"}
  -> {"id": 1, "ok": true}

  {"id": 2, "op": "synth", "text": "Hello there.", "speed": 1.0}
  -> {"id": 2, "ok": true, "sampleRate": 24000, "audio": "<base64 float32 LE>"}

  {"id": 3, "op": "voices", "language": "en_us"}
  -> {"id": 3, "ok": true, "present": [...], "downloadable": [...], "catalog": [...]}

  {"id": 4, "op": "paths"}
  -> {"id": 4, "ok": true, "cache": "/path/to/moonshine_voice/cache"}

A failed request gets {"id": n, "error": "..."}. The engine never downloads:
voices are fetched beforehand by the person, with `edge-voice-engine voices get
<voice>` (see voices.py). Loading a voice that isn't on disk fails with
{"id": n, "error": "...", "missing": "<voice>"}, so the plugin can show that
command. "voices" lists what's on disk ("present") and what the command can
fetch ("downloadable") for that language, and "catalog": every voice with
pinned hashes in any language, each {"id", "language", "name", "accent",
"gender", "engine", "quality", "recommended", "faster", "installed", "size",
"download"} (sizes in bytes; "download" is what `voices get` would fetch now),
recommended first. See catalog.py.

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
import math
import os
import re
import sys
from pathlib import Path

# Released with the engine package (engine/pyproject.toml has the same version).
VERSION = "0.3.0"
PROTOCOL = 1

# Kokoro for MLX on Hugging Face (the model and its voices, as .safetensors),
# pinned to one commit so what users download can't change under them.
MLX_WEIGHTS = "mlx-community/Kokoro-82M-bf16"
MLX_REVISION = "a71e4d38b236d968966a2002c4c895dbd12b1c3c"


def private_hugging_face(offline: bool = True) -> None:
    """Keeps Hugging Face files in ~/.edge-voice, anonymous, without telemetry, and offline.

    Set before huggingface_hub is imported, since it reads these then. HF_HOME
    is forced, not defaulted: one set for other tools would put the files where
    deleting ~/.edge-voice doesn't reach. Tokens are dropped, so nothing ties
    downloads to anyone's account. Offline unless the person is fetching a
    voice themselves (`voices get --faster`): the engine the plugin runs only
    reads what's already there.
    """
    os.environ["HF_HOME"] = str(Path.home() / ".edge-voice" / "hf")
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # Boolean opt-out of implicit authentication, not a password or token.
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"  # nosec B105
    os.environ.pop("HF_TOKEN", None)
    os.environ.pop("HUGGING_FACE_HUB_TOKEN", None)


class MlxVoice:
    """Kokoro on MLX, behind the same synthesize/close calls as moonshine-voice."""

    def __init__(self, voice: str, offline: bool = True):
        private_hugging_face(offline)
        from huggingface_hub import hf_hub_download
        from mlx_audio.tts.utils import load_model

        # The voice file at the pinned commit, given to mlx-audio by path.
        name = voice.removeprefix("kokoro_")
        # CI checks MLX_REVISION is a full commit SHA; Bandit cannot follow the constant.
        self.voice = hf_hub_download(  # nosec B615
            MLX_WEIGHTS, f"voices/{name}.safetensors", revision=MLX_REVISION
        )
        self.model = load_model(MLX_WEIGHTS, revision=MLX_REVISION)

    def synthesize(self, text, speed=None):
        samples = []
        for result in self.model.generate(text, voice=self.voice, speed=speed or 1.0, lang_code="a"):
            samples.extend(result.audio.tolist())
        return samples, self.model.sample_rate

    def close(self):
        pass


class MissingVoice(Exception):
    """The voice isn't on disk; the person fetches it with `edge-voice-engine voices get`."""

    def __init__(self, voice: str, faster: bool = False):
        self.voice = voice
        command = f"edge-voice-engine voices get {voice}" + (" --faster" if faster else "")
        super().__init__(f"The voice {voice} isn't downloaded. Get it with: {command}")


def moonshine_voice(language: str, voice: str):
    """Opens a moonshine-voice voice from disk only; MissingVoice if it isn't there."""
    from moonshine_voice import TextToSpeech, list_tts_voices
    from moonshine_voice.download import tts_asset_cache_path

    root = tts_asset_cache_path()
    if voice and voice not in list_tts_voices(language, root_path=root)["present"]:
        raise MissingVoice(voice)
    tts = TextToSpeech().language(language)
    if voice:
        tts.voice(voice)
    return tts.models_from(root, download=False).load()


def mlx_missing(error: Exception) -> bool:
    """Whether MLX failed only because its files aren't downloaded (Hugging Face is offline here)."""
    seen = [error, error.__cause__, error.__context__]
    names = {type(e).__name__ for e in seen if e is not None}
    return bool(names & {"LocalEntryNotFoundError", "OfflineModeIsEnabled", "FileNotFoundError"})


def mlx_refusal(language: str, voice: str):
    """Why MLX can't speak this voice, or None if it can."""
    if language != "en_us":
        return "the faster engine only speaks English"
    if not voice.startswith("kokoro_"):
        return "the faster engine only has Kokoro voices"
    return None


# What the plugin may send: voice and language IDs (they become file and model names), text
# for one sentence or clause, and a playback speed. Anything else is refused, not passed on.
ENGINE_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")
MAX_TEXT = 20000


def engine_id(value, name: str, default: str = "") -> str:
    """`value` as a voice or language ID, or `default` when it's missing."""
    if value is None or value == "":
        return default
    if not isinstance(value, str) or not ENGINE_ID.fullmatch(value):
        raise ValueError(f"invalid {name} {value!r}")
    return value


def synth_text(value) -> str:
    if not isinstance(value, str) or len(value) > MAX_TEXT:
        raise ValueError(f"text must be a string of at most {MAX_TEXT} characters")
    return value


def synth_speed(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"invalid speed {value!r}")
    if not 0.25 <= value <= 4:
        raise ValueError(f"speed {value} is outside 0.25 to 4")
    return value


def main() -> None:
    # The native library logs to fd 1, which would corrupt the protocol, so
    # replies go to a private copy of stdout and fd 1 is pointed at stderr.
    protocol = os.fdopen(os.dup(1), "w", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    from moonshine_voice import list_tts_voices
    from moonshine_voice.download import tts_asset_cache_path

    try:
        from edge_voice_engine.catalog import catalog
    except ImportError:  # Run as a lone script: no catalog, the plugin copes.
        catalog = None

    def send(message: dict) -> None:
        protocol.write(json.dumps(message) + "\n")
        protocol.flush()

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
                language = engine_id(request.get("language"), "language", "en_us")
                voice = engine_id(request.get("voice"), "voice")
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
                            fallback = (
                                str(MissingVoice(voice, faster=True))
                                if mlx_missing(error)
                                else f"the faster engine failed to load ({type(error).__name__}: {error})"
                            )
                if candidate is None:
                    # Open the new voice first, so a bad choice keeps the old one.
                    candidate = moonshine_voice(language, voice)
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
                text = synth_text(request.get("text"))
                samples, sample_rate = tts.synthesize(text, speed=synth_speed(request.get("speed")))
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
            elif op == "hello":
                send(
                    {
                        "id": request_id,
                        "ok": True,
                        "engine": "edge-voice-engine",
                        "version": VERSION,
                        "protocol": PROTOCOL,
                    }
                )
            elif op == "paths":
                from moonshine_voice.download_file import get_cache_dir

                send({"id": request_id, "ok": True, "cache": str(get_cache_dir())})
            elif op == "voices":
                language = engine_id(request.get("language"), "language", "en_us")
                voices = list_tts_voices(language, root_path=tts_asset_cache_path())
                if catalog:
                    voices["catalog"] = catalog(Path(tts_asset_cache_path()))
                send({"id": request_id, "ok": True, **voices})
            else:
                raise ValueError(f"unknown op {op!r}")
        except MissingVoice as error:
            send({"id": request_id, "error": str(error), "missing": error.voice})
        except Exception as error:  # Reported to the plugin, which keeps going.
            send({"id": request_id, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
