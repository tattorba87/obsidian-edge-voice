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

from edge_voice_engine.server import ENGINE_ID, MlxVoice, mlx_refusal


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
    get.add_argument("--faster", action="store_true", help="also get it for the faster engine (Apple silicon)")
    args = parser.parse_args(argv)

    from moonshine_voice import list_tts_voices
    from moonshine_voice.download import download_tts_assets, tts_asset_cache_path

    voices = list_tts_voices(args.language, root_path=tts_asset_cache_path())
    if args.command == "list":
        print("On this computer:", ", ".join(voices["present"]) or "none")
        print("Available to get:", ", ".join(voices["downloadable"]) or "none")
        return 0

    if args.voice not in voices["present"] + voices["downloadable"]:
        print(f"There's no voice {args.voice} for {args.language}. See: edge-voice-engine voices list", file=sys.stderr)
        return 1
    if args.voice in voices["present"]:
        print(f"{args.voice} is already downloaded.")
    else:
        print(f"Downloading {args.voice} from Moonshine (download.moonshine.ai)…")
        download_tts_assets(args.language, voice=args.voice, show_progress=True)
    if args.faster:
        refusal = mlx_refusal(args.language, args.voice)
        if refusal:
            print(f"Not for the faster engine: {refusal}.", file=sys.stderr)
            return 1
        print(f"Downloading {args.voice} for the faster engine from Hugging Face…")
        MlxVoice(args.voice, offline=False)
    print(f"Done. {args.voice} is ready; choose it in Edge Voice's settings.")
    return 0
