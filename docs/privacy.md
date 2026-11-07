# Privacy, files and verifying downloads

Edge Voice reads your notes and PDFs on your computer, and the plugin itself never connects to the internet: no telemetry, no account, nothing sent anywhere. Reading and dictation work offline once their files are installed.

What the plugin does on your computer, and why (Obsidian's review lists these):

- **Starts the speech engine** as a separate program (Node's `child_process`): the Python in `~/.edge-voice/engine` (or the one you set under Advanced), with fixed arguments, no shell, and Python's isolated mode. To find an engine installed elsewhere, it may also run `edge-voice-engine --python` if that command is on your PATH. It runs nothing else.
- **Reads notes/PDFs and writes dictated text through Obsidian.** The sizes in Settings → Storage come from the engine, and removing voices is a command you run.
- **Uses the microphone only when you start dictation.** Audio goes to the local speech engine in memory; recordings and transcript logs are not saved. Dictated text is inserted into the note you choose.
- **Writes to the clipboard** only when you press a Copy button for a setup, voice or model command. It never reads the clipboard.

Only the commands you run yourself download anything, and only when you run them:

| What                                  | From                                                                                                    | Why                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| uv                                    | [Astral](https://docs.astral.sh/uv/), through your package manager or its installer                     | Sets up Python programs without touching the rest of your system           |
| Python 3.12                           | uv's Python builds ([python-build-standalone](https://github.com/astral-sh/python-build-standalone))    | The engine's own Python                                                    |
| The engine and its packages           | This repository's engine release on GitHub, and PyPI                                                    | Every file is checked against the SHA-256 in the requirements file         |
| Voices (`voices get`)                 | Moonshine's server, `download.moonshine.ai`                                                             | The voice files; each is checked against its SHA-256                       |
| English ASR models (`models get`)     | Moonshine's server, `download.moonshine.ai`, at a pinned English streaming revision                     | SHA-256 checked before installation and again before managed model loading |
| Faster engine voices (`--faster`)     | [Hugging Face](https://huggingface.co/mlx-community/Kokoro-82M-bf16), at a pinned commit; telemetry off | Kokoro for MLX on Apple silicon; checked against SHA-256                   |
| spaCy's English model (faster engine) | Explosion's GitHub release, named in the requirements file with its SHA-256                             | English pronunciation for the faster engine                                |

## Files outside your vault

Edge Voice keeps its engine and voices outside your vault, because they're shared by all your vaults and too big to sync:

- `~/.edge-voice` (`%USERPROFILE%\.edge-voice` on Windows): the engine (about 100 MB, a few hundred MB more with the faster engine) the faster engine's voices, and English ASR models under `models/` (45–269 MB each).
- Moonshine's voice folder: `~/Library/Caches/moonshine_voice` on macOS, `~/.cache/moonshine_voice` on Linux, a folder under `%LOCALAPPDATA%\moonshine_voice` on Windows.

Settings → Storage shows TTS voice sizes and their removal commands. Use `models list`, `models check <size>` and `models remove <size>` for ASR models. Custom ASR folders remain yours to manage. Obsidian has no uninstall step for plugins, so to remove everything after uninstalling Edge Voice, delete those two folders. Inside your vault, Edge Voice reads the notes and PDFs you ask it to read, inserts dictated text into the Markdown note you choose, and stores its settings in its plugin folder.

## Verifying downloads

Plugin releases from 0.1.1 on carry GitHub's signed build provenance (an artifact attestation), which shows a file was built by this repository's release workflow from a given commit. With the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify main.js --repo tattorba87/obsidian-edge-voice
```

The community directory also rebuilds `main.js` from the source and checks it matches the release byte for byte. Engine releases list the SHA-256 of their files in `SHA256SUMS`, and the setup commands check every package against its hash.
