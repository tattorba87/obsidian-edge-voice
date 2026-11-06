# Notes for coding agents

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code rules, tests, manual checks and releases. Keep shared contributor rules there rather than duplicating them here.

## Before changing code

- Read the relevant source and tests, `README.md`, `manifest.json` and package scripts. Inspect `git status` and the diff; preserve other contributors' work.
- Edge Voice is desktop-only (`isDesktopOnly: true`). It uses Node.js to run a local Python sidecar; do not imply mobile support or remove desktop APIs just to satisfy generic mobile guidance.
- Keep changes focused. Preserve established behavior unless the task asks to change it; explain substantial architectural changes before implementing them.
- Write plans as Markdown (`.md`) files in `plans/`, the agents' working directory for plans. Create the directory if needed, use descriptive filenames, and keep plans current so the programmer can review them. This directory is gitignored; do not commit its contents.

## Architecture

- `src/main.ts` connects Obsidian views, settings and commands. `src/controls.ts` decides what playback actions mean for the active page.
- `src/reader.ts` handles playback and synthesis ahead of playback. Keep engine-specific behavior out of it.
- `src/markdown.ts`, `src/rendered.ts` and `src/pdf.ts` handle note text, rendered highlights and PDF reading. Preserve source positions when transforming text; verify highlighting in real Obsidian when changing these integrations.
- `src/normalize.ts` and `src/sentences.ts` prepare speech text. Pronunciation changes need both automated coverage and listening with the real engine.
- `src/sidecar.ts` owns the JSON-lines connection to the engine (the `edge-voice-engine` package in `engine/`, run as `python -I -u -m edge_voice_engine`). Keep the protocol backward compatible within a minor version and document new requests in the server docstring.
- The plugin installs and downloads nothing. `src/engine.ts` finds the engine the person installed and writes the setup steps shown to them; `engine/` is the engine package, `engine/pins.json` and `locks/` what its releases install. Preserve pinned versions, checksum verification, and setup commands that stay readable and safe-looking.
- Prefer documented Obsidian APIs and plugin lifecycle cleanup. Where rendering integrations rely on Obsidian DOM structure or internals, keep the dependency isolated and verify it with `tests/obsidian/` and manual testing.

## Validation and handoff

- Run `bun run check` before saying work is done. Report failures as they are; do not claim skipped checks passed. It covers type-checking, lint, formatting, Vitest and pytest, but does not build the bundle or launch Obsidian.
- Run `bun run build` when changing shipped code, bundling or dependencies. Run `bun run test:obsidian` when changing integration with Obsidian; it launches a separate macOS test app and requires Obsidian installed locally.
- Validate locally first (`bun run check`, `bun run build`, `bun run test:obsidian` for Obsidian integration, `bun run check:engine` for engine or setup changes); CI runs every platform on pull requests. Record demos and try changes locally, in the sandbox, which stays fully separate from the maintainer's own engine and Obsidian (see CONTRIBUTING's sandbox).
- Follow CONTRIBUTING's manual sandbox checklist for the affected behavior. Automated tests use fake engines; they do not prove pronunciation, audio quality or GPU behavior. Say what was tried by hand and what still needs a person.
- End with a short summary of changes, checks and remaining limitations. Update user documentation and the Unreleased changelog for user-facing behavior changes.

## Privacy and publication

- Preserve local processing of notes and the documented setup/voice downloads. Do not add telemetry, undisclosed network calls or logging of note contents or secrets.
- Consult current [developer policies](https://docs.obsidian.md/community-directory/developer-policies), [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) and [release guidance](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) when preparing a Community directory submission. Disclose anything that could not be verified.
- Community directory policy prohibits installing or updating plugin dependencies. Edge Voice installs and downloads nothing itself; people run the setup commands it shows. Keep it that way: never add in-plugin downloads or installs. The Obsidian team hasn't confirmed this approach; don't claim publication readiness.
- Do not create releases, push tags, submit directory listings, change repository settings, commit or push unless asked. The release instructions describe the process; they do not authorize executing it.
