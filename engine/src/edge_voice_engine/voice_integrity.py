"""Download-time integrity only; the offline speech server never imports this module."""

import hashlib
import json
import re
from pathlib import Path, PurePosixPath


class IntegrityError(ValueError):
    pass


def cache_file(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if not relative.parts or relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
        raise IntegrityError(f"Unsafe voice file path: {name}")
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise IntegrityError(f"Voice file escapes its cache: {name}")
    return path


def manifest() -> dict:
    data = json.loads(Path(__file__).with_name("voices.json").read_text())
    if data.get("schema") != 1:
        raise IntegrityError("Unsupported voice integrity manifest")
    for section in ("moonshine", "faster"):
        for name, record in data[section]["files"].items():
            cache_file(Path.cwd(), name)
            if (
                not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])
                or type(record["size"]) is not int
                or record["size"] < 0
            ):
                raise IntegrityError(f"Invalid SHA-256 entry: {name}")
        for names in data[section]["voices"].values():
            if not isinstance(names, list) or not names or any(name not in data[section]["files"] for name in names):
                raise IntegrityError(f"Incomplete voice dependencies in {section}")
        if section == "faster" and any(name not in data[section]["files"] for name in data[section]["base_files"]):
            raise IntegrityError("Incomplete faster-engine base files")
    return data


def verify(path: Path, record: dict, root: Path) -> None:
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise IntegrityError(f"Voice file escapes its cache: {path}")
    if not path.is_file():
        raise IntegrityError(f"Voice file is missing: {path}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if path.stat().st_size != record["size"] or digest.hexdigest() != record["sha256"]:
        # Remove the owned HF blob too, otherwise another snapshot can reuse it.
        resolved.unlink(missing_ok=True)
        if path != resolved:
            path.unlink(missing_ok=True)
        raise IntegrityError(f"SHA-256 verification failed; removed {path}. Run voices get again to retry.")


def check_files(root: Path, names: list[str], records: dict, *, existing_only: bool = False) -> None:
    for name in names:
        path = cache_file(root, name)
        if name in records and (not existing_only or path.exists() or path.is_symlink()):
            verify(path, records[name], root)
