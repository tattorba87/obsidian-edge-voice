# Test the upcoming dictation release safely

This checkout prepares plugin 0.2.0 and engine 0.4.0; neither is published by this work. User instructions are in [English dictation](dictation.md). Use a disposable vault and a separate Python environment while testing the branch. Never overlay your everyday engine just to try development code.

## Isolated engine and Obsidian

1. Run `bun install` in this worktree.
2. Create a test environment. Install the **released 0.3.0 requirements** to obtain the unchanged, hash-pinned dependencies, using a different environment path. For Intel macOS:

   ```sh
   uv venv /private/tmp/edge-voice-dictation-engine --python 3.12
   uv pip install --python /private/tmp/edge-voice-dictation-engine --require-hashes --no-build -r https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.3.0/requirements-darwin-x64.txt
   ```

   Choose the requirements filename for your platform from the README. Version 0.4.0 uses the same dependency pins; it adds the dictation protocol and model command.

3. Build this branch's engine wheel using the pinned build backend and overlay only that wheel, without resolving dependencies:

   ```sh
   uv build --wheel engine --force-pep517 --build-constraints engine/build-constraints.txt --require-hashes -o .scratch/engine-dist
   uv pip install --python /private/tmp/edge-voice-dictation-engine --no-deps --reinstall .scratch/engine-dist/edge_voice_engine-0.4.0-py3-none-any.whl
   ```

   This developer overlay is separate from the end-user release installation. The complete release package is built by `scripts/build-engine-release.sh` and verified by `bun run check:engine`.

4. Start the isolated sandbox in the background:

   ```sh
   bun run sandbox --background --python /private/tmp/edge-voice-dictation-engine/bin/python
   ```

   Its profile, HOME and vault are separate from your everyday Obsidian. macOS chooses the Space; background launch avoids bringing it to the foreground.

5. In **English dictation**, choose Medium and enable dictation. For a sandbox, either run its model command with the sandbox's HOME (do not copy a real-home installation accidentally), or set **Custom model folder (advanced)** to a trusted existing English streaming folder such as MoonshineFlow's. Set the matching model size. A custom folder is read only and is not authenticated by the plugin.
6. Open a Markdown editor and click the mic, or double-tap Left ⌘ (Left Ctrl outside Mac). One tap stops and finalizes. See the [manual checklist](../CONTRIBUTING.md#dictation-release-and-media-checks) before considering a release.

Existing plugin settings merge with defaults. Dictation is enabled for new settings; a saved off choice is retained. No STT model or microphone permission is required for TTS. Protocol 1 remains compatible with released engine 0.3.0 for reading; dictation checks `dictation-streaming-v1` before opening capture. Updated engines retain the older TTS operations.

The maintained release checklist and current validation limits are in [release-readiness.md](release-readiness.md). The ignored `plans/english-dictation.md` and `plans/stt-release-readiness.md` track the implementation, Claude review fixes and changes of course for local reviewers.
