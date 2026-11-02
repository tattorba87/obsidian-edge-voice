# Changelog

All notable changes to Edge Voice are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Reads notes and PDFs aloud with on-device voices (Moonshine: Kokoro and Piper), highlighting the sentence and the word being spoken.
- Sets up its speech engine and the default voice when you ask, from a window listing what will be downloaded and where it goes, with nothing to install beforehand, on macOS (Apple Silicon and Intel, 13.4 or later), Windows (x64 and ARM) and Linux.
- On Apple silicon (macOS 14 or later), a faster engine that runs voices on the GPU with MLX, installed with the engine when you set it up (or when you turn it on) and used automatically, with the standard engine as fallback.
- Highlighting in Source mode, Live Preview (including rendered callouts and math) and Reading view, and over PDF pages.
- Right-click _Start text-to-speech here_ in the editor, Reading view and PDFs.
- Reading follows its page: switching pages pauses it, and so does hiding Obsidian behind other apps. Each has its own setting; in the background it can also pause as soon as you switch apps, or keep reading.
- Player bar with skip, speed and volume, which can be minimized or turned off; animated status-bar indicator.
- Double-tap shortcut to start, pause and resume, with a chime that can be turned off, a choice of three keys or one custom key.
- Text normalization for technical writing: units, percentages, ranges, acronyms, model names, ordinals, decades and citations.
- PDFs skip margin stamps, page numbers, running headers and footers, and footnotes.
- Seven highlight colour themes.
- Storage settings to see and delete downloaded voices and the engine.
- The speech engine and its installer start isolated: Python, linker and installer settings in your environment (`PYTHONPATH`, `DYLD_*`/`LD_*`, uv configuration) can't change what runs or where packages come from.
- The speech engine and its connection check what passes between them: voice IDs, text length, speed, audio and reply size; a stuck engine is restarted instead of blocking reading, and settings of the wrong type fall back to their defaults.
