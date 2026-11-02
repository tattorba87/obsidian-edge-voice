"""`edge-voice-engine voices …`: the person fetches voices; the engine never does.

    edge-voice-engine voices list [--installed] [--json]
    edge-voice-engine voices get <voice> [<voice> …] [--faster]

`list` shows every voice with pinned SHA-256 hashes (see catalog.py): its name,
accent, engine, whether it's here, and how much `get` would download now.
`get` downloads voices from Moonshine's server (download.moonshine.ai) into its
cache, checking every file against voices.json. With --faster (Apple silicon),
it also fetches each voice and the Kokoro model for the faster engine from
Hugging Face, at the commit server.py pins, into ~/.edge-voice/hf. Nothing else
is downloaded, and only when run.
"""

import argparse
import json
import sys
from pathlib import Path

from edge_voice_engine.catalog import SAMPLES, catalog, label, language_of, megabytes
from edge_voice_engine.server import ENGINE_ID, MLX_REVISION, MLX_WEIGHTS, mlx_refusal, private_hugging_face
from edge_voice_engine.voice_integrity import IntegrityError, cache_file, check_files, manifest, verify


def voice_id(value: str) -> str:
    if not ENGINE_ID.fullmatch(value):
        raise argparse.ArgumentTypeError(f"not a voice name: {value!r}")
    return value


def show(voices: list[dict], as_json: bool) -> int:
    if as_json:
        print(json.dumps(voices, indent=2))
        return 0
    if not voices:
        print("No voices downloaded yet. See: edge-voice-engine voices list")
        return 0
    rows = [("", "Voice", "ID", "Download", "Faster")]
    for voice in voices:
        rows.append(
            (
                "★" if voice["recommended"] else "",
                label(voice),
                voice["id"],
                "installed" if voice["installed"] else megabytes(voice["download"]),
                "yes" if voice["faster"] else "",
            )
        )
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    for row in rows:
        print("  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip())
    print()
    print("★ recommended. Get one with: edge-voice-engine voices get <ID>  (several IDs at once work too)")
    print("Faster: also works with --faster, the faster engine on Apple silicon.")
    print("Hear them first: Kokoro", SAMPLES["Kokoro"], " Piper", SAMPLES["Piper"])
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="edge-voice-engine voices", description="List or download voices.")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="voices you can get, and which are on this computer")
    listing.add_argument("--installed", action="store_true", help="only voices on this computer")
    listing.add_argument("--json", action="store_true", help="for scripts")
    listing.add_argument("--language", type=voice_id, help="only American (en_us) or British (en_gb) voices")
    get = commands.add_parser("get", help="download voices")
    get.add_argument("voices", nargs="+", type=voice_id, metavar="voice")
    get.add_argument("--language", type=voice_id, help="needed only for voices not in the list")
    get.add_argument(
        "--unverified", action="store_true", help="allow an unlisted voice without a pinned SHA-256 (prints a warning)"
    )
    get.add_argument("--faster", action="store_true", help="also get it for the faster engine (Apple silicon)")
    args = parser.parse_args(argv)

    from moonshine_voice.download import tts_asset_cache_path

    if args.command == "list":
        voices = catalog(Path(tts_asset_cache_path()))
        if args.language:
            voices = [voice for voice in voices if voice["language"] == args.language]
        if args.installed:
            voices = [voice for voice in voices if voice["installed"]]
        return show(voices, args.json)

    failed = [voice for voice in args.voices if get_voice(voice, args) != 0]
    if len(args.voices) > 1:
        print(
            f"Got {len(args.voices) - len(failed)} of {len(args.voices)} voices.",
            file=sys.stderr if failed else sys.stdout,
        )
    return 1 if failed else 0


def get_voice(voice: str, args: argparse.Namespace) -> int:
    """Downloads one voice and checks every file it needs; 0 when it's ready."""
    from moonshine_voice import list_tts_voices
    from moonshine_voice.download import download_tts_assets, list_tts_dependency_keys, tts_asset_cache_path

    language = args.language or language_of(voice) or "en_us"
    voices = list_tts_voices(language, root_path=tts_asset_cache_path())
    if voice not in voices["present"] + voices["downloadable"]:
        print(f"There's no voice {voice} for {language}. See: edge-voice-engine voices list", file=sys.stderr)
        return 1
    try:
        data = manifest()
        language = language.lower().replace("-", "_")
        language = {"en": "en_us", "en_uk": "en_gb"}.get(language, language)
        key = language + "/" + voice
        known = data["moonshine"]["voices"].get(key)
        if known is None and not args.unverified:
            raise IntegrityError(
                f"No pinned SHA-256 manifest for {voice} ({language}); "
                "use --unverified only if you accept unverified model files."
            )
        used_unverified = known is None
        if known is None:
            print(f"WARNING: {voice} is unverified; some model files have no pinned SHA-256.", file=sys.stderr)
        dependencies = sorted(set(list_tts_dependency_keys(language, voice=voice)))
        if known is not None and set(dependencies) != set(known):
            raise IntegrityError(
                "Voice dependencies differ from the pinned manifest; update the engine before downloading."
            )
        root = Path(tts_asset_cache_path())
        # Catch tampering before the upstream downloader can silently repair it.
        check_files(root, dependencies, data["moonshine"]["files"], existing_only=True)
        if args.faster:
            refusal = mlx_refusal(language, voice)
            if refusal:
                raise IntegrityError(f"Not for the faster engine: {refusal}.")
            faster = data["faster"]
            if (faster["repository"], faster["revision"]) != (MLX_WEIGHTS, MLX_REVISION):
                raise IntegrityError("Faster engine revision differs from the pinned voice manifest")
            files = faster["voices"].get(voice)
            if files is None and not args.unverified:
                raise IntegrityError(
                    f"No pinned faster-engine voice {voice}; use --unverified only if you accept unverified files."
                )
        print(f"Preparing {voice} from Moonshine (download.moonshine.ai)…")
        download_tts_assets(language, voice=voice, show_progress=True)
        check_files(root, dependencies, data["moonshine"]["files"])
        if args.faster:
            # Fetch bytes without constructing MlxVoice or parsing model weights.
            private_hugging_face(False)
            from huggingface_hub import hf_hub_download, try_to_load_from_cache

            hf_root = Path.home() / ".edge-voice" / "hf"
            if files is None:
                used_unverified = True
                files = faster["base_files"] + ["voices/" + voice.removeprefix("kokoro_") + ".safetensors"]
                print(f"WARNING: faster voice {voice} is unverified.", file=sys.stderr)
            for name in files:
                cache_file(hf_root, name)
                record = faster["files"].get(name)
                cached = try_to_load_from_cache(MLX_WEIGHTS, name, revision=MLX_REVISION)
                if isinstance(cached, str) and record:
                    verify(Path(cached), record, hf_root)
                # The revision is a full commit SHA, checked against the manifest above.
                path = Path(hf_hub_download(MLX_WEIGHTS, name, revision=MLX_REVISION))  # nosec B615
                if record:
                    verify(path, record, hf_root)
        if used_unverified:
            print(f"Done. {voice} is ready; unverified files were explicitly allowed.")
        else:
            print(f"Done. {voice} is ready; all required files passed SHA-256 verification.")
        return 0
    except (IntegrityError, OSError, ValueError, KeyError, ImportError) as error:
        print(f"Voice setup failed: {error}", file=sys.stderr)
        return 1
