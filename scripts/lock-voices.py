"""Pin all English Kokoro/Piper files and the faster engine's immutable HF files.

Run in an environment installed from the platform lock (moonshine-voice supplies
its catalogue): python scripts/lock-voices.py --cache .scratch/voice-lock-cache
Only this maintenance command needs network. Models stay in ignored scratch;
only the two identical small SHA-256 manifests are committed.
"""

import argparse
import ast
import concurrent.futures
import hashlib
import importlib.metadata
import json
import re
import time
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]


def safe_path(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError(f"Unsafe asset path: {name}")
    target = root / path
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Asset path escapes cache: {name}")
    return target


def request(url, **kwargs):
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=90, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"sha256": digest.hexdigest(), "size": path.stat().st_size}


def download(cache, name, url, refresh):
    destination = safe_path(cache, name)
    if refresh or not destination.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_name(destination.name + ".part")
        try:
            with request(url, stream=True) as response, partial.open("wb") as stream:
                for chunk in response.iter_content(1024 * 1024):
                    stream.write(chunk)
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)
    return file_hash(destination)


def constants():
    tree = ast.parse((ROOT / "engine/src/edge_voice_engine/server.py").read_text())
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {"MLX_WEIGHTS", "MLX_REVISION"}:
                    result[target.id] = ast.literal_eval(node.value)
    if not re.fullmatch(r"[0-9a-f]{40}", result["MLX_REVISION"]):
        raise ValueError("The HF revision must be an immutable full commit SHA")
    return result["MLX_WEIGHTS"], result["MLX_REVISION"]


def generate(args):
    from moonshine_voice.download import get_tts_voice_catalog, list_tts_dependency_manifest

    expected = json.loads((ROOT / "engine/pins.json").read_text())["moonshine"]["package"]
    if expected != "moonshine-voice==" + importlib.metadata.version("moonshine-voice"):
        raise ValueError("Install the platform lock before generating voice hashes")
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    catalogue = get_tts_voice_catalog(languages="en_us,en_gb", root_path=cache / "empty-catalogue")
    voices, assets = {}, {}
    for language, entries in catalogue.items():
        for entry in entries:
            if not entry.id.startswith(("kokoro_", "piper_")):
                continue
            files = [f for g in list_tts_dependency_manifest(language, voice=entry.id)["groups"] for f in g["files"]]
            voices[language.replace("-", "_") + "/" + entry.id] = sorted({file["name"] for file in files})
            for file in files:
                if not file["url"].startswith("https://download.moonshine.ai/tts/"):
                    raise ValueError("Unexpected Moonshine asset host")
                safe_path(cache / "moonshine", file["name"])
                assets[file["name"]] = file
    print(f"Hashing {len(assets)} unique files for {len(voices)} English voice/language entries", flush=True)

    def one(item):
        name, file = item
        return name, download(cache / "moonshine", name, file["url"], args.refresh)

    hashes = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for count, (name, digest) in enumerate(pool.map(one, sorted(assets.items())), 1):
            hashes[name] = digest
            if count % 20 == 0:
                print(f"Hashed {count}/{len(assets)} files", flush=True)
    repository, revision = constants()
    metadata = request(f"https://huggingface.co/api/models/{repository}/revision/{revision}?blobs=true").json()
    if metadata["sha"] != revision:
        raise ValueError("Hugging Face returned another revision")
    hf_files = {file["rfilename"]: file for file in metadata["siblings"]}
    base = sorted(
        name for name in hf_files if not name.startswith("voices/") and name.endswith((".json", ".safetensors"))
    )
    faster_voices = {}
    for voice in sorted({key.split("/", 1)[1] for key in voices if "/kokoro_" in key}):
        name = "voices/" + voice.removeprefix("kokoro_") + ".safetensors"
        if name not in hf_files:
            raise ValueError(f"Pinned HF revision lacks English voice: {voice}")
        faster_voices[voice] = base + [name]
    faster_files = {}
    for name in sorted(set(base).union(*(set(files) for files in faster_voices.values()))):
        safe_path(cache / "hf", name)
        info = hf_files[name]
        if info.get("lfs"):
            # Git LFS's SHA-256 is content-addressed at the reviewed immutable commit.
            digest = info["lfs"]["sha256"]
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("Invalid HF LFS SHA-256")
            faster_files[name] = {"sha256": digest, "size": info["size"]}
        else:
            url = f"https://huggingface.co/{repository}/resolve/{revision}/{quote(name, safe='/')}"
            faster_files[name] = download(cache / "hf", name, url, args.refresh)
    result = {
        "schema": 1,
        "moonshine": {"package": expected, "voices": voices, "files": hashes},
        "faster": {
            "repository": repository,
            "revision": revision,
            "base_files": base,
            "voices": faster_voices,
            "files": faster_files,
        },
    }
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    for path in [ROOT / "engine/voices.json", ROOT / "engine/src/edge_voice_engine/voices.json"]:
        path.write_text(text)
    moonshine_bytes = sum(file["size"] for file in hashes.values())
    faster_bytes = sum(file["size"] for file in faster_files.values())
    print(f"Pinned {moonshine_bytes} Moonshine bytes and {faster_bytes} faster-engine bytes", flush=True)
    print(f"Manifests: {len(text)} bytes each", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".scratch/voice-lock-cache")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=4)
    parser.add_argument("--refresh", action="store_true", help="redownload instead of reusing the maintenance cache")
    generate(parser.parse_args())
