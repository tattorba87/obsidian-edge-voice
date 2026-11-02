"""Writes README.md's voice tables from the engine's catalog (engine/voices.json).

    python3 -I scripts/voice-table.py          rewrite the tables
    python3 -I scripts/voice-table.py --check  fail if they're out of date

The tables sit between the `voices:start` and `voices:end` comments.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine" / "src"))

from edge_voice_engine.catalog import SAMPLES, catalog, manifest_data, megabytes  # noqa: E402

README = ROOT / "README.md"
START, END = "<!-- voices:start -->", "<!-- voices:end -->"


def table(voices: list[dict]) -> list[str]:
    rows = [["Voice", "Accent", "Engine", "ID", "Faster engine"]]
    for voice in voices:
        name = voice["name"] + (f" ({voice['gender']})" if voice["gender"] else "")
        engine = voice["engine"] + (f", {voice['quality']} quality" if voice["quality"] else "")
        rows.append([name, voice["accent"], engine, f"`{voice['id']}`", "yes" if voice["faster"] else ""])
    # Aligned the way Prettier writes tables, so `bun run format` leaves them alone.
    widths = [max(3, *(len(row[i]) for row in rows)) for i in range(len(rows[0]))]

    def line(cells: list[str]) -> str:
        return "| " + " | ".join(cell.ljust(width) for cell, width in zip(cells, widths, strict=True)) + " |"

    return [line(rows[0]), line(["-" * width for width in widths]), *map(line, rows[1:])]


def tables() -> str:
    # Sizes as if nothing were downloaded yet.
    voices = catalog(ROOT / "nonexistent")
    kokoro = next(v for v in voices if v["engine"] == "Kokoro")
    files = manifest_data()["moonshine"]["files"]
    own = max(record["size"] for name, record in files.items() if name.startswith("kokoro/voices/"))
    piper = [v["size"] for v in voices if v["engine"] == "Piper"]
    recommended = [v for v in voices if v["recommended"]]
    others = [v for v in voices if not v["recommended"]]
    lines = [
        START,
        "",
        f"Hear them first: [Kokoro voices]({SAMPLES['Kokoro']}), [Piper voices]({SAMPLES['Piper']}).",
        f"The first Kokoro voice is about {megabytes(kokoro['size'])} (it brings Kokoro's model); "
        f"each one after that is {megabytes(own)}. "
        f"Piper voices are {megabytes(min(piper))} to {megabytes(max(piper))} each.",
        "",
        "**Recommended** (Kokoro's best-graded voices, then Piper's high-quality ones):",
        "",
        *table(recommended),
        "",
        f"<details><summary>The other {len(others)} voices</summary>",
        "",
        *table(others),
        "",
        "</details>",
        "",
        END,
    ]
    return "\n".join(lines)


def main() -> int:
    text = README.read_text()
    if START not in text or END not in text:
        sys.exit(f"README.md needs {START} and {END}")
    before, rest = text.split(START, 1)
    after = rest.split(END, 1)[1]
    updated = before + tables() + after
    if "--check" in sys.argv[1:]:
        if updated != text:
            sys.exit("README.md's voice tables are out of date: run python3 -I scripts/voice-table.py")
        return 0
    README.write_text(updated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
