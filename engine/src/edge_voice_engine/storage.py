"""`edge-voice-engine storage …`: what the engine has downloaded, and removing it.

    edge-voice-engine storage [--json]
    edge-voice-engine storage remove <id> [<id> …]
    edge-voice-engine storage remove --all

Lists the downloads grouped the way a person thinks of them: the Kokoro voices,
each Piper voice, the voice-cloning models, each language's pronunciation data,
and the faster engine's voices (~/.edge-voice/hf), with their sizes. `remove`
deletes the groups named by their IDs. It only ever deletes inside the voice
cache and ~/.edge-voice/hf, found again when it runs (never from paths given to
it): a link is removed as a link, and anything that resolves outside those
folders is refused. Edge Voice's settings show these commands; the plugin
itself reads and deletes no files.
"""

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

from edge_voice_engine.catalog import megabytes


@dataclass
class Item:
    id: str
    label: str
    description: str
    root: Path
    paths: list[Path] = field(default_factory=list)
    bytes: int = 0

    def public(self) -> dict:
        return {"id": self.id, "label": self.label, "description": self.description, "bytes": self.bytes}


def hugging_face_dir() -> Path:
    return Path.home() / ".edge-voice" / "hf"


def files_under(folder: Path) -> list[tuple[Path, int]]:
    """Every file under `folder` with its size, without following links out of it."""
    found = []
    if not folder.is_dir() or folder.is_symlink():
        return found
    for current, _dirs, files in os.walk(folder):
        for name in files:
            path = Path(current) / name
            found.append((path, path.lstat().st_size))
    return found


def piper_stem(name: str) -> str:
    """The name a Piper voice's files share: en_US-lessac-medium.generator.model.ort → en_US-lessac-medium."""
    return re.sub(r"(\.(upstream|generator))?(\.(model|weights))?\.(ort|onnx\.json|onnx)$", "", name)


def scan(tts_root: Path, hf: Path) -> list[Item]:
    """The downloads, largest first."""
    groups: dict[str, Item] = {}

    def add(item_id: str, label: str, description: str, root: Path, path: Path, size: int) -> None:
        item = groups.setdefault(item_id, Item(item_id, label, description, root))
        item.paths.append(path)
        item.bytes += size

    for path, size in files_under(tts_root):
        parts = path.relative_to(tts_root).parts
        if parts[0] == "kokoro":
            add("kokoro", "Kokoro voices", "The Kokoro model and its voices.", tts_root, path, size)
        elif parts[0] in ("zipvoice", "clone_asr"):
            add(
                "cloning",
                "Voice cloning models",
                "ZipVoice and the speech recognizer it uses. Edge Voice doesn't need these.",
                tts_root,
                path,
                size,
            )
        elif len(parts) > 2 and parts[1] == "piper-voices":
            stem = piper_stem(parts[2])
            add(f"piper:{stem}", f"Piper voice {stem}", f"A Piper voice for {parts[0]}.", tts_root, path, size)
        else:
            add(
                f"language:{parts[0]}",
                f"Pronunciation data ({parts[0]})",
                "Shared by every voice in this language.",
                tts_root,
                path,
                size,
            )
    hf_files = files_under(hf)
    if hf_files:
        groups["mlx"] = Item(
            "mlx",
            "Faster engine voices",
            "The Kokoro model and voices the faster engine uses on Apple silicon. "
            "Get them again with a voice's command and --faster.",
            hf,
            [hf],
            sum(size for _, size in hf_files),
        )
    return sorted(groups.values(), key=lambda item: -item.bytes)


def within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def remove(item: Item) -> None:
    """Deletes the item's files. Each must be inside its root once links in the folders above it are resolved."""
    if not item.root.exists():
        return
    root = item.root.resolve()
    for path in item.paths:
        real = root if path == item.root else path.parent.resolve() / path.name
        if not within(real, root):
            raise ValueError(f"refusing to delete {path}: it isn't inside {item.root}")
        if real.is_symlink() or real.is_file():
            real.unlink(missing_ok=True)
        elif real.is_dir():
            shutil.rmtree(real)
    if item.root != item.paths[0]:
        prune_empty(root)


def prune_empty(root: Path) -> None:
    """Removes folders left empty under `root`, keeping `root` itself."""
    for current, _dirs, _files in os.walk(root, topdown=False):
        folder = Path(current)
        if folder != root and not folder.is_symlink() and not any(folder.iterdir()):
            folder.rmdir()


def show(items: list[Item]) -> None:
    if not items:
        print("Nothing downloaded yet. Get a voice with: edge-voice-engine voices get <ID>")
        return
    rows = [("Size", "ID", "What")] + [(megabytes(item.bytes), item.id, item.label) for item in items]
    widths = [max(len(row[i]) for row in rows) for i in range(3)]
    for row in rows:
        print("  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip())
    print()
    print(f"{megabytes(sum(item.bytes for item in items))} in all.")
    print("Remove with: edge-voice-engine storage remove <ID>  (or --all)")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="edge-voice-engine storage", description="Show what's downloaded, or remove it."
    )
    parser.add_argument("--json", action="store_true", help="for scripts")
    commands = parser.add_subparsers(dest="command")
    removing = commands.add_parser("remove", help="delete downloaded voices")
    removing.add_argument("ids", nargs="*", metavar="id", help="IDs from `edge-voice-engine storage`")
    removing.add_argument("--all", action="store_true", help="everything listed")
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    from moonshine_voice.download import tts_asset_cache_path

    items = scan(Path(tts_asset_cache_path()), hugging_face_dir())
    if args.command != "remove":
        if args.json:
            print(json.dumps([item.public() for item in items], indent=2))
        else:
            show(items)
        return 0

    if args.all == bool(args.ids):
        parser.error("name what to remove (IDs from `edge-voice-engine storage`), or use --all")
    by_id = {item.id: item for item in items}
    unknown = [item_id for item_id in args.ids if item_id not in by_id]
    if unknown:
        print(f"Nothing downloaded with the ID {', '.join(unknown)}. See: edge-voice-engine storage", file=sys.stderr)
        return 1
    chosen = items if args.all else [by_id[item_id] for item_id in args.ids]
    for item in chosen:
        remove(item)
        print(f"Removed {item.label} ({megabytes(item.bytes)}).")
    return 0
