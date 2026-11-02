#!/usr/bin/env python3
"""Benchmarks a speech engine the way the plugin uses it, for comparing engines.

Measures one engine per run, since each lives in its own environment:

  python -I scripts/bench_engines.py measure --engine moonshine --out moonshine.json
  python -I scripts/bench_engines.py measure --engine mlx --out mlx.json --wavs wavs/
  python -I scripts/bench_engines.py report moonshine.json mlx.json >> "$GITHUB_STEP_SUMMARY"

"moonshine" is moonshine-voice (ONNX Runtime, CPU), as server.py runs it.
"mlx" is mlx-audio's Kokoro on MLX, which uses the GPU when Metal is
available. Both speak with the same Kokoro voice.

For each engine: how long loading the voice takes, then each sentence's
synthesis time and audio length (median of several runs after a warm-up),
the real-time factor (seconds of audio per second of work), how long a short
opening clause takes (what the reader sends first, so it sets how soon audio
starts), and peak memory. Only the standard library is used, besides the
engine being measured.
"""

import argparse
import json
import platform
import resource
import statistics

# Benchmark uses a fixed sysctl binary and argument arrays.
import subprocess  # nosec B404
import sys
import time
import wave
from pathlib import Path

VOICE = "am_santa"

# Sentences of the kinds the reader meets: prose, numbers, units, technical
# terms, short and long. Written for this benchmark.
SENTENCES = [
    "The morning was quiet, and the river moved slowly past the old mill.",
    "She opened the letter, read it twice, and set it down without a word.",
    "Results improved by 5.9 percent over the baseline in every setting we tried.",
    "The model has 1.7 billion parameters and runs on a single graphics card.",
    "Training took about 36 hours on eight machines.",
    "Why would anyone build a bridge there?",
    "First, gather the inputs; second, normalize them; third, check the totals.",
    "In 2019, the team moved to a larger office near the station.",
    "Memory use stayed between two and seven gigabytes throughout the run.",
    "He laughed.",
    "The committee, after a long and sometimes heated discussion that lasted well into the evening, "
    "agreed to postpone the decision until the next meeting.",
    "Each chapter ends with a short summary and a list of questions for review.",
    "Latency matters more than throughput when someone is waiting to hear the first word.",
    "The function returns a list of tuples, one for each matching record.",
    "Rain is expected on Tuesday, with clearer skies by the weekend.",
    "A careful reader will notice that the second argument contradicts the first.",
    "Turn left at the second light, then continue for about three hundred meters.",
    "The experiment was repeated with a smaller learning rate and a larger batch.",
    "Nobody expected the play to sell out on its opening night.",
    "Finally, the authors thank the reviewers for their helpful comments.",
]

# Opening clauses: what the reader synthesizes first when nothing is ready,
# so their time is how long someone waits after pressing play.
OPENINGS = [
    "The morning was quiet,",
    "In 2019,",
    "First, gather the inputs;",
    "Rain is expected on Tuesday,",
    "Finally,",
]

# Sentences saved as audio, to compare the engines by ear.
SAMPLES = [0, 2, 10]


class Moonshine:
    name = "moonshine"

    def load(self) -> None:
        from moonshine_voice import TextToSpeech

        self.tts = TextToSpeech().language("en_us").voice(f"kokoro_{VOICE}")
        self.tts.load()

    def synthesize(self, text: str) -> tuple[list[float], int]:
        samples, rate = self.tts.synthesize(text, speed=1.0)
        return list(samples), rate

    def info(self) -> dict:
        import importlib.metadata as metadata

        return {"package": f"moonshine-voice {metadata.version('moonshine-voice')}", "device": "cpu"}


class Mlx:
    name = "mlx"
    repo = "mlx-community/Kokoro-82M-bf16"

    def load(self) -> None:
        from mlx_audio.tts.utils import load_model

        self.model = load_model(self.repo)

    def synthesize(self, text: str) -> tuple[list[float], int]:
        import numpy as np

        chunks = [
            np.array(result.audio, dtype=np.float32)
            for result in self.model.generate(text, voice=VOICE, speed=1.0, lang_code="a")
        ]
        return np.concatenate(chunks).tolist(), self.model.sample_rate

    def info(self) -> dict:
        import importlib.metadata as metadata

        import mlx.core as mx

        details = {
            "package": f"mlx-audio {metadata.version('mlx-audio')}, mlx {metadata.version('mlx')}",
            "weights": self.repo,
            "metal": bool(mx.metal.is_available()),
            "device": str(mx.default_device()),
        }
        if details["metal"]:
            try:
                details["metal_device"] = {
                    key: value for key, value in mx.metal.device_info().items() if isinstance(value, (str, int, float))
                }
            except Exception as error:  # device_info is informative only
                details["metal_device"] = f"unavailable: {error}"
        return details


ENGINES = {"moonshine": Moonshine, "mlx": Mlx}


def machine() -> dict:
    def sysctl(key: str) -> str:
        try:
            # Absolute binary; keys are the fixed machine properties below, never user text.
            return subprocess.run(  # nosec B603
                ["/usr/sbin/sysctl", "-n", key],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return "unknown"

    return {
        "chip": sysctl("machdep.cpu.brand_string"),
        "cores": sysctl("hw.ncpu"),
        "memory_gb": round(int(sysctl("hw.memsize") or 0) / 2**30, 1) if sysctl("hw.memsize").isdigit() else None,
        "macos": platform.mac_ver()[0],
        "arch": platform.machine(),
        "python": platform.python_version(),
    }


def timed(engine, text: str) -> tuple[float, list[float], int]:
    start = time.perf_counter()
    samples, rate = engine.synthesize(text)
    return time.perf_counter() - start, samples, rate


def write_wav(path: Path, samples: list[float], rate: int) -> None:
    import array

    pcm = array.array("h", (max(-32768, min(32767, int(sample * 32767))) for sample in samples))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())


def measure(name: str, repeats: int, wavs: Path | None) -> dict:
    engine = ENGINES[name]()
    start = time.perf_counter()
    engine.load()
    load_seconds = time.perf_counter() - start
    # The first run pays for compiling and caching; the plugin pays it while loading too.
    warmup_seconds, _, _ = timed(engine, "Ready.")

    sentences = []
    for index, text in enumerate(SENTENCES):
        times = []
        for _ in range(repeats):
            seconds, samples, rate = timed(engine, text)
            times.append(seconds)
        audio_seconds = len(samples) / rate
        work = statistics.median(times)
        sentences.append(
            {"text": text, "seconds": work, "audio_seconds": audio_seconds, "rtf": audio_seconds / work if work else 0}
        )
        if wavs is not None and index in SAMPLES:
            wavs.mkdir(parents=True, exist_ok=True)
            write_wav(wavs / f"{name}-{index}.wav", samples, rate)

    openings = [statistics.median(timed(engine, text)[0] for _ in range(repeats)) for text in OPENINGS]
    total_audio = sum(sentence["audio_seconds"] for sentence in sentences)
    total_work = sum(sentence["seconds"] for sentence in sentences)
    return {
        "engine": name,
        "machine": machine(),
        "info": engine.info(),
        "repeats": repeats,
        "load_seconds": load_seconds,
        "warmup_seconds": warmup_seconds,
        "rtf": total_audio / total_work if total_work else 0,
        "first_clause_seconds": statistics.median(openings),
        # ru_maxrss is in bytes on macOS.
        "peak_memory_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20,
        "sentences": sentences,
    }


def report(paths: list[Path]) -> str:
    runs = [json.loads(path.read_text()) for path in paths]
    lines = ["## Speech engine benchmark", ""]
    first = runs[0]["machine"]
    lines.append(
        f"Machine: {first['chip']}, {first['cores']} cores, {first['memory_gb']} GB, "
        f"macOS {first['macos']} ({first['arch']}), Python {first['python']}."
    )
    mlx = [run for run in runs if run["engine"] == "mlx"]
    if mlx:
        info = mlx[0]["info"]
        if info.get("metal"):
            lines.append(f"\nMLX ran with **Metal available** on `{info.get('device')}`.")
        else:
            lines.append(
                "\n> **Metal is not available on this machine, so MLX ran on the CPU.** "
                "Its speed here is CPU against CPU and says nothing about a real Mac's GPU."
            )
    lines += [
        "",
        "| Engine | Run | Load (s) | Real-time factor | First clause (s) | Peak memory (MB) |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    counts: dict[str, int] = {}
    for run in runs:
        counts[run["engine"]] = counts.get(run["engine"], 0) + 1
        lines.append(
            f"| {run['engine']} | {counts[run['engine']]} | {run['load_seconds']:.1f} | {run['rtf']:.1f}× "
            f"| {run['first_clause_seconds']:.2f} | {run['peak_memory_mb']:.0f} |"
        )
    by_engine: dict[str, list[dict]] = {}
    for run in runs:
        by_engine.setdefault(run["engine"], []).append(run)
    if "moonshine" in by_engine and "mlx" in by_engine:
        rtf = statistics.median(run["rtf"] for run in by_engine["mlx"]) / statistics.median(
            run["rtf"] for run in by_engine["moonshine"]
        )
        first_clause = statistics.median(
            run["first_clause_seconds"] for run in by_engine["moonshine"]
        ) / statistics.median(run["first_clause_seconds"] for run in by_engine["mlx"])
        lines += [
            "",
            f"MLX against Moonshine, medians over runs: **{rtf:.2f}×** the real-time factor, "
            f"first clause **{first_clause:.2f}×** as fast. (Above 1 means MLX is faster.)",
        ]
    lines += ["", "Real-time factor is seconds of audio made per second of work; higher is faster.", ""]
    for name, engine_runs in by_engine.items():
        details = ", ".join(f"{key}: {value}" for key, value in engine_runs[0]["info"].items())
        lines.append(f"- {name}: {details}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("measure", help="measure one engine")
    run.add_argument("--engine", choices=sorted(ENGINES), required=True)
    run.add_argument("--out", type=Path, required=True)
    run.add_argument("--repeats", type=int, default=5)
    run.add_argument("--wavs", type=Path, help="save a few sentences as WAV here")
    summary = commands.add_parser("report", help="a Markdown table from measure results")
    summary.add_argument("results", type=Path, nargs="+")
    args = parser.parse_args()

    if args.command == "measure":
        result = measure(args.engine, args.repeats, args.wavs)
        args.out.write_text(json.dumps(result, indent=2))
        print(
            f"{args.engine}: real-time factor {result['rtf']:.1f}×, first clause {result['first_clause_seconds']:.2f} s"
        )
    else:
        sys.stdout.write(report(args.results))


if __name__ == "__main__":
    main()
