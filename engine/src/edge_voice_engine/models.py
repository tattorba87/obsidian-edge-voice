"""Explicit, human-run English ASR model setup. The server only uses offline helpers."""

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path


def catalog():
    data = json.loads(Path(__file__).with_name("models.json").read_text())
    if data.get("schema") != 1 or data.get("language") != "en" or set(data["models"]) != {"tiny", "small", "medium"}:
        raise ValueError("Unsupported English model manifest")
    for model, entry in data["models"].items():
        if entry["base_url"] != f"https://download.moonshine.ai/model/{model}-streaming-en/quantized_26_08_21":
            raise ValueError("Unexpected model download host or revision")
        if set(entry["files"]) != {
            "adapter.ort",
            "cross_kv.ort",
            "decoder_kv.ort",
            "encoder.ort",
            "frontend.model.ort",
            "frontend.weights.ort",
            "streaming_config.json",
            "tokenizer.bin",
        }:
            raise ValueError("Incomplete English model manifest")
        for record in entry["files"].values():
            if (
                not re.fullmatch(r"[0-9a-f]{64}", record["sha256"])
                or type(record["size"]) is not int
                or record["size"] <= 0
            ):
                raise ValueError("Invalid model SHA-256 record")
    return data["models"]


def model_root():
    return Path.home() / ".edge-voice" / "models"


def model_path(model):
    if model not in ("tiny", "small", "medium"):
        raise ValueError("Choose tiny, small or medium")
    root = model_root()
    path = root / f"{model}-streaming-en"
    if root.is_symlink() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("The managed model folder must not be a symbolic link; use a custom model path instead")
    return path


def matches(path, record):
    if not path.is_file() or path.is_symlink() or path.stat().st_size != record["size"]:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == record["sha256"]


def checked_model(model):
    """Verify every managed file before passing it to the native parser; never download."""
    path = model_path(model)
    for name, record in catalog()[model]["files"].items():
        if not matches(path / name, record):
            raise ValueError(f"English {model} model is missing or damaged. Run edge-voice-engine models get {model}.")
    return path


def download(model):
    entry = catalog()[model]
    path = model_path(model)
    path.mkdir(parents=True, exist_ok=True)
    for name, record in entry["files"].items():
        target = path / name
        if target.is_symlink():
            raise ValueError(f"Refusing linked model file: {target}")
        if matches(target, record):
            continue
        print(f"Downloading {model}/{name} from download.moonshine.ai…", flush=True)
        # The manifest restricts URLs to HTTPS on Moonshine's host, with fixed filenames.
        url = entry["base_url"] + "/" + name
        request = urllib.request.Request(url, headers={"User-Agent": "edge-voice-engine"})
        temporary = None
        try:
            with urllib.request.urlopen(request, timeout=60) as response:  # nosec B310 -- validated HTTPS manifest above
                if response.geturl() != url:
                    raise ValueError("Unexpected model download redirect")
                with tempfile.NamedTemporaryFile(dir=path, prefix=".download-", delete=False) as stream:
                    temporary = Path(stream.name)
                    remaining = record["size"]
                    while remaining:
                        block = response.read(min(1024 * 1024, remaining))
                        if not block:
                            raise ValueError(f"Incomplete model file: {name}")
                        stream.write(block)
                        remaining -= len(block)
                    if response.read(1):
                        raise ValueError(f"Oversized model file: {name}")
            if not matches(temporary, record):
                raise ValueError(f"SHA-256 verification failed: {name}")
            temporary.replace(target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    checked_model(model)
    # Retain upstream's MIT notice alongside weights for anyone copying the folder.
    with tempfile.NamedTemporaryFile(dir=path, prefix=".license-", delete=False) as stream:
        notice = Path(stream.name)
        stream.write(Path(__file__).with_name("MODEL-LICENSE.txt").read_bytes())
    try:
        notice.replace(path / "LICENSE.txt")
    finally:
        notice.unlink(missing_ok=True)
    print(f"Ready: {path} (all files passed SHA-256 verification).")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="English streaming speech recognition models (MIT). Downloads are explicit."
    )
    parser.add_argument("action", choices=("list", "get", "check", "path", "remove"), nargs="?", default="list")
    parser.add_argument("model", choices=("tiny", "small", "medium"), nargs="?")
    args = parser.parse_args(argv)
    try:
        if args.action == "list":
            for model, entry in catalog().items():
                size = sum(record["size"] for record in entry["files"].values()) / 1_000_000
                print(f"{model:6} English streaming, MIT, {size:.1f} MB — {model_path(model)}")
        elif not args.model:
            parser.error("choose a model: tiny, small or medium")
        elif args.action == "get":
            download(args.model)
        elif args.action == "check":
            print(f"Verified: {checked_model(args.model)}")
        elif args.action == "path":
            print(model_path(args.model))
        else:
            path = model_path(args.model)
            if path.exists():
                shutil.rmtree(path)
            print(f"Removed {path}")
        return 0
    except (OSError, ValueError) as error:
        print(f"Model setup failed: {error}", file=sys.stderr)
        return 1
