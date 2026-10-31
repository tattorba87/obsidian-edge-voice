"""A stand-in for moonshine_voice, so server.py can be tested without the engine.

Like the real native library, it prints to stdout (fd 1) while loading; the
server must keep that out of its protocol.
"""

import os

VOICES = {"en_us": ["kokoro_af_heart", "piper_en_US-lessac-medium"]}


def list_tts_voices(language):
    return {"present": VOICES.get(language, [])[:1], "downloadable": VOICES.get(language, [])[1:]}


class TextToSpeech:
    def __init__(self):
        self._language = "en_us"
        self._voice = None
        self.loaded = False
        self.closed = False

    def language(self, code):
        self._language = code
        return self

    def voice(self, voice_id):
        self._voice = voice_id
        return self

    def on_progress(self, handler):
        self._progress = handler
        return self

    def load(self):
        if self._voice and self._voice not in VOICES.get(self._language, []):
            raise ValueError(f"no voice {self._voice!r}")
        os.write(1, b"native library noise on stdout\n")
        self._progress(1.0, "voice.ort")
        self.loaded = True
        return self

    def synthesize(self, text, speed=None):
        samples = [0.25] * max(1, round(len(text) / (speed or 1.0)))
        return samples, 24000

    def close(self):
        self.closed = True
