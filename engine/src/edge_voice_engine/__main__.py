"""Starts the engine: `python -I -u -m edge_voice_engine`, or the `edge-voice-engine` command.

--python   prints the interpreter running the engine, so the plugin can
           launch that interpreter isolated (-I) instead of this command.
--version  prints the engine version.
"""

import sys


def main() -> None:
    if sys.argv[1:] == ["--python"]:
        print(sys.executable)
    elif sys.argv[1:] == ["--version"]:
        from edge_voice_engine.server import VERSION

        print(VERSION)
    elif sys.argv[1:2] == ["voices"]:
        from edge_voice_engine.voices import main as voices

        sys.exit(voices(sys.argv[2:]))
    elif sys.argv[1:]:
        sys.exit(f"edge-voice-engine: unknown arguments {' '.join(sys.argv[1:])} (try voices, --python or --version)")
    else:
        from edge_voice_engine.server import main as serve

        serve()


if __name__ == "__main__":
    main()
