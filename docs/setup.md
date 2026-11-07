# Setup and updates

Edge Voice doesn't install or download anything itself. Its speech engine is a small Python program you set up once, with the commands below; Edge Voice shows the same commands for your computer, each with a Copy button, when it can't find the engine.

1. **Install the plugin** from [Obsidian's Community plugins](https://community.obsidian.md/plugins/edge-voice) and enable it.
2. **Install [uv](https://docs.astral.sh/uv/getting-started/installation/)**, Astral's widely used Python installer, if you don't have it.
3. **Install the shared engine** with the commands for your computer below, in Terminal (PowerShell on Windows).
4. **Choose the features you want:** run `voices get` for TTS reading aloud, `models get` for STT dictation, or both. These are separate optional downloads.
5. **Back in Obsidian**, open Settings, choose Edge Voice under Community plugins in the left bar, open **Advanced** and click **Check again**. For STT, turn on **English dictation → Enable dictation**, select the model you downloaded and leave **Custom model folder** empty.

**macOS (Apple silicon, macOS 14 or later)**, with the faster engine:

```sh
brew install uv
uv venv --clear --managed-python ~/.edge-voice/engine --python 3.12
uv pip install --python ~/.edge-voice/engine --require-hashes --no-build -r https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.4.0/requirements-darwin-arm64-mlx.txt
# Optional TTS: read aloud
~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_af_bella --faster
# Optional STT: English dictation
~/.edge-voice/engine/bin/edge-voice-engine models get medium
```

**macOS (Intel, or Apple silicon on macOS 13.4 or later)**: replace `darwin-arm64-mlx` with `darwin-x64` (Intel) or `darwin-arm64`, and leave out `--faster`:

```sh
brew install uv
uv venv --clear --managed-python ~/.edge-voice/engine --python 3.12
uv pip install --python ~/.edge-voice/engine --require-hashes --no-build -r https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.4.0/requirements-darwin-x64.txt
# Optional TTS: read aloud
~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_af_bella
# Optional STT: English dictation
~/.edge-voice/engine/bin/edge-voice-engine models get medium
```

**Windows** (PowerShell; on Windows on ARM, use `--python cpython-3.12-windows-x86_64-none` in the second line):

```powershell
winget install --id=astral-sh.uv -e
uv venv --clear --managed-python "$HOME\.edge-voice\engine" --python 3.12
uv pip install --python "$HOME\.edge-voice\engine" --require-hashes --no-build -r https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.4.0/requirements-win32-x64.txt
# Optional TTS: read aloud
& "$HOME\.edge-voice\engine\Scripts\edge-voice-engine.exe" voices get kokoro_af_bella
# Optional STT: English dictation
& "$HOME\.edge-voice\engine\Scripts\edge-voice-engine.exe" models get medium
```

Open a new PowerShell window after installing uv, so it's found.

**Linux** (x64; on ARM64, use `linux-arm64`). uv's [installer](https://docs.astral.sh/uv/getting-started/installation/) is `curl -LsSf https://astral.sh/uv/install.sh | sh`, or use your package manager:

```sh
uv venv --clear --managed-python ~/.edge-voice/engine --python 3.12
uv pip install --python ~/.edge-voice/engine --require-hashes --no-build -r https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.4.0/requirements-linux-x64.txt
# Optional TTS: read aloud
~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_af_bella
# Optional STT: English dictation
~/.edge-voice/engine/bin/edge-voice-engine models get medium
```

**Reading only:** skip `models get`. **Dictation only:** skip `voices get`; the standard engine is sufficient, and MLX/faster voice packages are optional for TTS. **Both:** run both download commands. The plugin runs neither command itself.

The examples download English **Medium** (269 MB), which prioritizes word accuracy. For speed and lower resource use, replace `medium` with **`small`** (142 MB) or **`tiny`** (45 MB), accepting more recognition errors, especially with Tiny. Select the same model in **English dictation** settings. [Full dictation guide](dictation.md).

What these do:

- `uv venv` makes the engine's own folder, `~/.edge-voice/engine`, with its own Python 3.12, so nothing else on your computer changes.
- `uv pip install` installs the engine from this repository's engine release. The file at the end lists every package at an exact version with its fingerprint (SHA-256); open it to read it first if you like. If anything downloaded differs from its fingerprint, nothing is installed. Nothing is compiled, and nothing needs administrator rights.
- `voices get` downloads a TTS voice (see [Voices](voices.md)), checking every file against its fingerprint.
- `models get medium` downloads the English streaming STT model, verifies each file against its size and SHA-256 fingerprint, and stores it in `~/.edge-voice/models/`. It is separate from TTS voices.

**Check again verifies the engine installation**, not downloaded models or microphone permissions. Once dictation is enabled, click the mic and grant access when prompted. Existing installations need engine **0.4.0** for STT; updating the plugin doesn't update Python. See [engine updates](#updating-the-plugin-and-speech-engine).

Everything goes into `~/.edge-voice` (about 100 MB for the engine, a few hundred MB more with the faster engine) and Moonshine's voice folder (see [Files outside your vault](privacy.md#files-outside-your-vault)). Nothing runs at login. To remove it all, delete those folders.

On Apple silicon Macs with macOS 14 or later there's a faster engine: Kokoro on the GPU with [MLX](https://github.com/ml-explore/mlx), through [mlx-audio](https://pypi.org/project/mlx-audio/). On GitHub's Apple silicon runners it synthesized about 2.2 times as fast as the standard engine and started speaking about 1.6 times sooner (`scripts/bench_engines.py`). The Apple silicon commands above include it: they install `requirements-darwin-arm64-mlx.txt` (a few hundred MB more: mlx-audio and what it needs, and spaCy's English model), and `voices get` adds `--faster`, which also fetches the Kokoro voice files from [Hugging Face](https://huggingface.co/mlx-community/Kokoro-82M-bf16) at a pinned commit. The standard engine speaks if the faster one can't. Turn it off under Settings → Edge Voice → Advanced → Faster voice engine. Advanced, at the bottom of the settings, also shows the engine Edge Voice found, a Python path to use another installation (a full path), and how many sentences to prepare ahead.

**Memory.** While Obsidian is open, the voice engine stays loaded so reading starts at once; it uses no processor time while idle, but holds several hundred MB of memory (about 800 MB with a Kokoro voice). Settings → Edge Voice → Advanced → **Free voice memory when idle** unloads it after 5, 10 or 30 minutes or an hour stopped or paused (default: never). The status bar shows "Unloading voice", and the next play, resume or skip shows "Reloading voice" for about 2–3 seconds with a Kokoro voice, 1–2 with a Piper voice.

| Platform                       | Needs               | Engine package                                                              | Tested                          |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| macOS, Apple Silicon and Intel | macOS 13.4 or later | Built by this repository from the moonshine release (PyPI has no Intel one) | macOS 15 and 26, in CI          |
| Windows x64                    | Windows 10 or later | PyPI                                                                        | In CI                           |
| Windows on ARM                 | Windows 11          | PyPI's x64 package, run with Windows' built-in x64 emulation                | Not yet                         |
| Linux x64 and ARM64            | glibc 2.34 or later | PyPI                                                                        | Ubuntu, in CI; Flatpak/Snap not |

The macOS packages come from this repository's `moonshine-voice-*` release, built by `.github/workflows/engine-wheels.yml`. Engine releases (`engine-*`) are built by `.github/workflows/engine-release.yml`; nothing is published to PyPI.

## Updating the plugin and speech engine

The plugin and Python speech engine are updated separately. Update **Edge Voice** through Obsidian's **Community plugins → Check for updates**, then reload it. That updates the plugin; it does not install or update Python packages or voices.

**When is a manual engine update needed?** Check **Settings → Edge Voice → Advanced → Speech engine**. It shows the installed engine version and Python path. Edge Voice compares that version with the engine release recommended by the plugin and offers setup steps once per recommended engine version when it is older, including for engine bug fixes that keep the same protocol. This is a local comparison: the plugin does not check GitHub or PyPI. A plugin update brings the new recommendation; no online version check runs.

A compatible older engine can still read aloud. An incompatible engine gets setup guidance; an engine newer than the plugin understands asks you to update the plugin. New optional features can require an engine capability as well: English dictation checks for that separately and preserves a saved choice to turn dictation off. Plugin-only fixes do not require a Python reinstall. Engine release notes identify changes that do.

**To update the normal engine:**

1. Read the plugin and engine release notes, and note any custom Python path under Advanced. The standard commands below target `~/.edge-voice/engine`; adapt them if you installed elsewhere.
2. Stop reading and quit Obsidian so the engine is not in use. From [Setup](#setup-and-updates) above, rerun the commands to create the environment and install the engine for your platform. `uv venv --clear` replaces only that engine environment; the installation uses exact package versions and SHA-256 checksums from the named engine release. Use the commands from the updated plugin or this page, rather than an unrestricted package upgrade.
3. Downloaded voices live outside that Python environment and normally do not need downloading again. Rerun the voice command only if a voice is missing, its files changed, or you are enabling the faster engine. A normal Python bug-fix update does not change your notes, plugin settings or voice selection.
4. Reopen Obsidian. Under **Advanced**, click **Check again**, confirm the engine version, and try reading a short note. If you use a custom Python environment, select its full Python path there.

You can check the installed engine version directly:

```sh
# macOS / Linux
~/.edge-voice/engine/bin/python -I -m edge_voice_engine --version
```

```powershell
# Windows PowerShell
& "$HOME\.edge-voice\engine\Scripts\python.exe" -I -m edge_voice_engine --version
```

**Updating from the TTS-only release:** your voice, speed, shortcuts and downloaded voices are kept, and dictation stays off until you turn it on. To use it, update the engine to 0.4.0, get a model under English dictation, then enable the feature. TTS still works with compatible engine 0.3.0, but that engine cannot dictate. ASR models also live outside the Python environment and survive a normal engine update. A changed model manifest can require rerunning its download command; a missing or damaged file is reported before loading it.
