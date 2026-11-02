"""`edge-voice-engine voices …`: the person fetches voices; the engine never does.

    edge-voice-engine voices list [--language en_us]
    edge-voice-engine voices get <voice> [--faster] [--language en_us]

`get` downloads one voice from Moonshine's server (download.moonshine.ai) into
its cache. With --faster (Apple silicon), it also fetches that voice and the
Kokoro model for the faster engine from Hugging Face, at the commit server.py
pins, into ~/.edge-voice/hf. Nothing else is downloaded, and only when run.
"""

import argparse
import sys
from pathlib import Path

from edge_voice_engine.server import ENGINE_ID, MLX_REVISION, MLX_WEIGHTS, mlx_refusal, private_hugging_face
from edge_voice_engine.voice_integrity import IntegrityError, cache_file, check_files, manifest, verify


def voice_id(value: str) -> str:
    if not ENGINE_ID.fullmatch(value):
        raise argparse.ArgumentTypeError(f"not a voice name: {value!r}")
    return value


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="edge-voice-engine voices", description="List or download voices.")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="voices on this computer, and ones you can get")
    listing.add_argument("--language", type=voice_id, default="en_us")
    get = commands.add_parser("get", help="download a voice")
    get.add_argument("voice", type=voice_id)
    get.add_argument("--language", type=voice_id, default="en_us")
    get.add_argument(
        "--unverified", action="store_true", help="allow an unlisted voice without a pinned SHA-256 (prints a warning)"
    )
    get.add_argument("--faster", action="store_true", help="also get it for the faster engine (Apple silicon)")
    args = parser.parse_args(argv)

    from moonshine_voice import list_tts_voices
    from moonshine_voice.download import download_tts_assets, list_tts_dependency_keys, tts_asset_cache_path

    voices = list_tts_voices(args.language, root_path=tts_asset_cache_path())
    if args.command == "list":
        print("On this computer:", ", ".join(voices["present"]) or "none")
        print("Available to get:", ", ".join(voices["downloadable"]) or "none")
        return 0

    if args.voice not in voices["present"] + voices["downloadable"]:
        print(f"There's no voice {args.voice} for {args.language}. See: edge-voice-engine voices list", file=sys.stderr)
        return 1
    try:
        data = manifest()
        language = args.language.lower().replace("-", "_")
        language = {"en": "en_us", "en_uk": "en_gb"}.get(language, language)
        key = language + "/" + args.voice
        known = data["moonshine"]["voices"].get(key)
        if known is None and not args.unverified:
            raise IntegrityError(
                f"No pinned SHA-256 manifest for {args.voice} ({args.language}); "
                "use --unverified only if you accept unverified model files."
            )
        used_unverified = known is None
        if known is None:
            print(f"WARNING: {args.voice} is unverified; some model files have no pinned SHA-256.", file=sys.stderr)
        dependencies = sorted(set(list_tts_dependency_keys(args.language, voice=args.voice)))
        if known is not None and set(dependencies) != set(known):
            raise IntegrityError(
                "Voice dependencies differ from the pinned manifest; update the engine before downloading."
            )
        root = Path(tts_asset_cache_path())
        # Catch tampering before the upstream downloader can silently repair it.
        check_files(root, dependencies, data["moonshine"]["files"], existing_only=True)
        if args.faster:
            refusal = mlx_refusal(args.language, args.voice)
            if refusal:
                raise IntegrityError(f"Not for the faster engine: {refusal}.")
            faster = data["faster"]
            if (faster["repository"], faster["revision"]) != (MLX_WEIGHTS, MLX_REVISION):
                raise IntegrityError("Faster engine revision differs from the pinned voice manifest")
            files = faster["voices"].get(args.voice)
            if files is None and not args.unverified:
                raise IntegrityError(
                    f"No pinned faster-engine voice {args.voice}; use --unverified only if you accept unverified files."
                )
        print(f"Preparing {args.voice} from Moonshine (download.moonshine.ai)…")
        download_tts_assets(args.language, voice=args.voice, show_progress=True)
        check_files(root, dependencies, data["moonshine"]["files"])
        if args.faster:
            # Fetch bytes without constructing MlxVoice or parsing model weights.
            private_hugging_face(False)
            from huggingface_hub import hf_hub_download, try_to_load_from_cache

            hf_root = Path.home() / ".edge-voice" / "hf"
            if files is None:
                used_unverified = True
                files = faster["base_files"] + ["voices/" + args.voice.removeprefix("kokoro_") + ".safetensors"]
                print(f"WARNING: faster voice {args.voice} is unverified.", file=sys.stderr)
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
            print(f"Done. {args.voice} is ready; unverified files were explicitly allowed.")
        else:
            print(f"Done. {args.voice} is ready; all required files passed SHA-256 verification.")
        return 0
    except (IntegrityError, OSError, ValueError, KeyError, ImportError) as error:
        print(f"Voice setup failed: {error}", file=sys.stderr)
        return 1
