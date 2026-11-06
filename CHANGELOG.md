# Changelog

All notable changes to Edge Voice are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- English dictation into Markdown notes using local Moonshine Tiny, Small or Medium streaming ASR. Dictation is opt-in; existing TTS preferences and voices are retained. Use the microphone or an independent Left Command/Left Ctrl shortcut, with optional sounds, lowercase output and an inactivity timeout.
- A verified model setup command (`edge-voice-engine models get <size>`), plus list/check/path/remove commands. Managed English ASR files are pinned by revision, size and SHA-256, checked again offline before loading, and retain their MIT notice. Custom trusted MoonshineFlow folders remain supported.
- Matching TTS/STT symbolic and custom shortcut pickers with conflict checks. Double-tap starts either mode; one short tap stops it, including during startup. Player pause/resume is unchanged.
- A local check for a newer recommended Python engine, including compatible bug fixes, with manual update guidance. Dictation needs engine 0.4.0; compatible older engines keep reading aloud. No automatic installs or downloads.
- Dual-mode setup, upgrade, privacy, model/license and troubleshooting documentation; real-engine STT videos/GIFs and light/dark screenshots; copy-ready short/long Community listing descriptions and upload instructions. The live listing and releases are unchanged.

### Fixed

- The player keeps the same controls for reading and dictation, disables the unavailable mode, and uses the TTS processing glow through dictation finalization. The microphone and three Dictating bars follow input volume and fall to zero when quiet.
- Dictation survives permission prompts, snapshots the insertion range when recording begins, protects manual edits and final text in retained editors, and releases capture when stopped/disabled. Loud samples are clamped; a bounded queue reports machines that cannot keep up.
- Explicit model downloads identify the engine to Moonshine's server; its CDN rejects Python's default downloader user agent. Incomplete or invalid files never replace verified local files.

## [0.1.5] - 2026-11-05

### Added

- Settings → Advanced → **Free voice memory when idle**: after 5, 10 or 30 minutes or an hour stopped or paused, the voice engine is unloaded to give its memory back (about 800 MB with a Kokoro voice). The status bar shows "Unloading voice", then "Reloading voice" on the next play, resume or skip (about 2–3 seconds). Off by default.

## [0.1.4] - 2026-11-04

### Fixed

- In Reading view and other rendered text, a sentence whose first word also appears a few words earlier in the paragraph ("…your own computer. Your notes…") was highlighted from the earlier word, and its word highlight ran ahead.
- Hyphenated words are said properly: "text-to-speech", "step-by-step" and "chain-of-thought" were run together.
- "us" was said as the letters "U S".
- "read" is said "red" after "has", "have", "had", "been", "was", "were", "be", "well" and "widely" ("it was read aloud"); elsewhere it stays "reed".

### Changed

- New demo: why reading along helps, and a research paper read aloud.

## [0.1.3] - 2026-11-03

### Changed

- Edge Voice's settings show up in Obsidian's settings search (Obsidian's setting definitions, 1.13+). Storage and Advanced are now sections with headings instead of folded away, so search can reach every row.
- Renamed the engine connection's internal `request` method, which Obsidian's scan counted as network requests. The plugin makes no network requests.

### Fixed

- Settings: the custom double-tap key box stayed visible while the shortcut was off.

## [0.1.2] - 2026-11-03

### Changed

- The plugin reads and deletes no files itself. Settings → Storage lists downloads as the speech engine reports them, and each has a **Copy remove command** button instead of Delete: you run `edge-voice-engine storage remove <ID>`, as with setup. Needs engine 0.3.0; the setup steps install it.
- The speech engine is found by starting it, not by checking for its files.
- Plugin releases no longer carry `SHA256SUMS`; their signed attestations do that job.
- The plugin's description says text-to-speech (TTS), and the README has an "Is it safe?" section.

### Added

- Engine 0.3.0: `edge-voice-engine storage` lists downloads with their sizes, and `storage remove <ID>` (or `--all`) removes them, only inside the engine's own folders.

### Removed

- Settings → Storage no longer lists what the setup from before engine releases left in `~/.edge-voice`.

## [0.1.1] - 2026-11-02

### Fixed

- PDFs: lines set with ligatures ("fi", "fl", as in most typeset papers) are highlighted again; they were skipped. Highlight boxes on one line are joined, without seams where italics start.
- Settings: after the setup steps find the engine, only the engine and voice rows refresh, instead of the whole page.
- With Reduce motion turned on, the player bar's glow and the status bar's animation stay still, without forcing styles.

### Security

- Releases carry GitHub artifact attestations (signed build provenance): check a download with `gh attestation verify main.js --repo tattorba87/obsidian-edge-voice`. The README explains, in a line each, why the plugin starts a program, reads files outside the vault and writes to the clipboard.
- Development tools: moment is pinned to its fixed version. Neither it nor the remaining development-only advisory (minimatch, in ESLint) is in `main.js`.

## [0.1.0] - 2026-11-02

### Added

- Reads notes and PDFs aloud with on-device voices (Moonshine: Kokoro and Piper), highlighting the sentence and the word being spoken.
- Never downloads or installs anything itself. Without its speech engine, it shows the setup steps for your computer: install uv, then three commands, each explained, with a Copy button, and _Check again_. Every package is installed hash-checked from the engine release; voices are fetched with `edge-voice-engine voices get`. macOS (Apple Silicon and Intel, 13.4 or later), Windows (x64 and ARM) and Linux.
- Choosing a voice is easy: _Get another voice_ lists every voice by name, accent and engine, recommended ones first, with the download size and links to hear them; copy its command, run it, then _Check again_. British English voices work too. `edge-voice-engine voices list` shows the same as a table, `voices get` takes several voices at once, and the README lists them all.
- On Apple silicon (macOS 14 or later), a faster engine that runs Kokoro voices on the GPU with MLX, included in the setup steps there and used automatically, with the standard engine as fallback.
- Highlighting in Source mode, Live Preview (including rendered callouts and math) and Reading view, and over PDF pages.
- Right-click _Start text-to-speech here_ in the editor, Reading view and PDFs.
- Reading follows its page: switching pages pauses it, and so does hiding Obsidian behind other apps. Each has its own setting; in the background it can also pause as soon as you switch apps, or keep reading.
- Player bar with skip, speed and volume, which can be minimized or turned off; animated status-bar indicator.
- Double-tap shortcut to start, pause and resume, with a chime that can be turned off, a choice of three keys or one custom key.
- Text normalization for technical writing: units, percentages, prices, ranges, version numbers and addresses, acronyms, model names, ordinals, decades and citations.
- PDFs skip margin stamps, page numbers, running headers and footers, and footnotes.
- Seven highlight colour themes.
- Storage settings to see and delete downloaded voices, and what an earlier setup left behind.
- The speech engine starts isolated: Python and linker settings in your environment (`PYTHONPATH`, `DYLD_*`/`LD_*`) can't change what runs. It never downloads: a voice that isn't on your computer gets a notice with the command that fetches it.
- The speech engine and its connection check what passes between them: voice IDs, text length, speed, audio and reply size; a stuck engine is restarted instead of blocking reading, and settings of the wrong type fall back to their defaults.

[Unreleased]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.5...HEAD
[0.1.5]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.4...0.1.5
[0.1.4]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/tattorba87/obsidian-edge-voice/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/tattorba87/obsidian-edge-voice/releases/tag/0.1.0
