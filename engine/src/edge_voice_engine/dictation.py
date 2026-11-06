"""English streaming dictation from local model files; never resolves or downloads models."""

import array
import base64
import math
import sys
from pathlib import Path

ARCHITECTURES = {"tiny": 2, "small": 4, "medium": 5}


class Dictation:
    def __init__(self, model_path, model):
        if model not in ARCHITECTURES:
            raise ValueError("choose an English streaming model: tiny, small or medium")
        if model_path == "":
            from edge_voice_engine.models import checked_model

            model_path = str(checked_model(model))
        if not isinstance(model_path, str) or not Path(model_path).is_absolute():
            raise ValueError("choose an absolute path to local English model files")
        root = Path(model_path)
        required = (
            "tokenizer.bin",
            "encoder.ort",
            "decoder_kv.ort",
            "cross_kv.ort",
            "adapter.ort",
            "streaming_config.json",
        )
        if any(not (root / name).is_file() for name in required):
            raise ValueError("English streaming model files are missing from the selected folder")
        if not (root / "frontend.ort").is_file() and not all(
            (root / name).is_file() for name in ("frontend.model.ort", "frontend.weights.ort")
        ):
            raise ValueError("English streaming frontend files are missing from the selected folder")
        from moonshine_voice import ModelArch, Transcriber

        self.lines = {}
        self.error = None
        self.transcriber = Transcriber(model_path=str(root), model_arch=ModelArch(ARCHITECTURES[model]))
        self.stream = None
        try:
            self.stream = self.transcriber.create_stream(update_interval=0.35)
            self.stream.add_listener(self.event)
            self.stream.start()
        except Exception:
            self.close()
            raise

    def event(self, event):
        if getattr(event, "error", None) is not None:
            self.error = "The speech recognizer failed while decoding audio."
        elif event.line is not None:
            # Python dicts preserve first-seen order; partial lines revise their own slot.
            self.lines[event.line.line_id] = event.line.text.strip()

    def snapshot(self):
        if self.error:
            raise RuntimeError(self.error)
        return " ".join(text for text in self.lines.values() if text)

    def audio(self, encoded, rate):
        if type(rate) is not int or not 8000 <= rate <= 192000:
            raise ValueError("invalid microphone sample rate")
        if not isinstance(encoded, str) or len(encoded) > 2_100_000:
            raise ValueError("audio must be at most two seconds of float32 mono PCM")
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) % 4 or len(raw) > rate * 4 * 2:
            raise ValueError("invalid audio chunk length")
        samples = array.array("f")
        samples.frombytes(raw)
        if sys.byteorder != "little":
            samples.byteswap()
        if any(not math.isfinite(x) for x in samples):
            raise ValueError("invalid audio samples")
        self.stream.add_audio([max(-1.0, min(1.0, x)) for x in samples], sample_rate=rate)
        return self.snapshot()

    def finish(self):
        try:
            self.stream.stop()
            return self.snapshot()
        finally:
            self.close()

    def close(self):
        if self.stream is not None:
            self.stream.close()
            self.stream = None
        self.transcriber.close()
