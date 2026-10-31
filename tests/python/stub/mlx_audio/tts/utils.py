"""load_model for the stand-in: MLX_STUB_FAIL makes loading fail, as a Mac without Metal would."""

import os


class Audio:
    def __init__(self, samples):
        self.samples = samples

    def tolist(self):
        return list(self.samples)


class Result:
    def __init__(self, audio):
        self.audio = audio


class Model:
    sample_rate = 24000

    def generate(self, text, voice=None, speed=1.0, lang_code="a"):
        # mlx-audio names Kokoro voices without the "kokoro_" prefix.
        if voice is None or voice.startswith("kokoro_"):
            raise ValueError(f"unknown voice {voice!r}")
        # Two chunks, as mlx-audio yields for longer text; 0.75 tells it apart from Moonshine's 0.25.
        half = max(1, round(len(text) / speed / 2))
        yield Result(Audio([0.75] * half))
        yield Result(Audio([0.75] * half))


def load_model(path):
    if os.environ.get("MLX_STUB_FAIL"):
        raise RuntimeError("no Metal GPU")
    return Model()
