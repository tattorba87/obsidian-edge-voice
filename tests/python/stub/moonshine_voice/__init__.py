"""A stand-in for moonshine_voice, so the engine can be tested without the real one.

Like the real native library, it prints to stdout (fd 1) while loading; the
server must keep that out of its protocol. Voices live as files in a cache
folder (MOONSHINE_STUB_CACHE), and loading one that isn't there fails, as the
real library does when told not to download. Loading without
models_from(..., download=False) fails too: the engine must never download.
"""

import os
from pathlib import Path

CATALOG = {"en_us": ["kokoro_af_heart", "piper_en_US-lessac-medium"]}


def cache() -> Path:
    return Path(os.environ["MOONSHINE_STUB_CACHE"])


def list_tts_voices(language, root_path=None):
    known = CATALOG.get(language, [])
    present = [voice for voice in known if (Path(root_path or cache()) / f"{voice}.ort").exists()]
    return {"present": present, "downloadable": [voice for voice in known if voice not in present]}


class TextToSpeech:
    def __init__(self):
        self._language = "en_us"
        self._voice = None
        self._root = None
        self._download = True
        self.closed = False

    def language(self, code):
        self._language = code
        return self

    def voice(self, voice_id):
        self._voice = voice_id
        return self

    def models_from(self, directory, *, download=False):
        self._root = Path(directory)
        self._download = download
        return self

    def load(self):
        if self._download:
            raise RuntimeError("the engine tried to download (no models_from(..., download=False))")
        if self._voice and not (self._root / f"{self._voice}.ort").exists():
            raise RuntimeError(f"voice {self._voice!r} not on disk")
        os.write(1, b"native library noise on stdout\n")
        return self

    def synthesize(self, text, speed=None):
        samples = [0.25] * max(1, round(len(text) / (speed or 1.0)))
        return samples, 24000

    def close(self):
        self.closed = True
