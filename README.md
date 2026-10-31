# Edge Voice

An Obsidian plugin that reads notes and PDFs aloud with speech models running on your own computer, highlighting each sentence and word as it is spoken. Nothing leaves your machine once a voice has downloaded.

The speech engine today is [Moonshine](https://github.com/moonshine-ai/moonshine) (Kokoro and Piper voices, on the CPU). The plugin talks to it through a small engine interface, so other engines can be added.

## How it works

The plugin starts `server.py` in a private Python environment that has `moonshine_voice` installed, and asks it for one sentence of audio at a time over stdin/stdout. It plays the audio with Web Audio and synthesizes a couple of sentences ahead, so there is no gap between them.

- **PDFs**: text comes from pdf.js (Obsidian's `loadPdfJs`), page by page. The sentence and the word being spoken are drawn as boxes over the page, positioned from the viewer's text layer, and the view follows along onto the next page.
- **Notes**: reads from the cursor to the end of the note. It skips frontmatter, code, comments, embeds, tables and URLs. Highlighting works in Source mode, Live Preview (including rendered callouts and math blocks) and Reading view: rendered text is matched word by word and painted with the CSS Custom Highlight API.

## Setup

Works in Obsidian desktop on macOS, Windows and Linux.

Install and enable the plugin. That's all: it sets up its speech engine in the background, with progress in the status bar, then downloads the default voice (Kokoro) and tells you when it's ready to read. Press play before then and reading starts as soon as it is. If setup fails, a notice offers the log and a way to try again.

Setup downloads about 100 MB into `~/.edge-voice`, once: [uv](https://docs.astral.sh/uv/) (a pinned release, checked against its published SHA-256), a private Python 3.12 that uv installs, and the [moonshine-voice](https://pypi.org/project/moonshine-voice/) package. The voice adds a few hundred MB. Nothing else is installed, nothing runs at login, and your notes never leave your computer. Delete `~/.edge-voice` to remove it all.

| Platform                       | Needs               | Engine package                                                              |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| macOS, Apple Silicon and Intel | macOS 13.4 or later | Built by this repository from the moonshine release (PyPI has no Intel one) |
| Windows x64                    | Windows 10 or later | PyPI                                                                        |
| Windows on ARM                 | Windows 11          | PyPI's x64 package, run with Windows' built-in x64 emulation                |
| Linux x64 and ARM64            | glibc 2.34 or later | PyPI                                                                        |

The macOS packages come from this repository's `moonshine-voice-*` release, built by `.github/workflows/engine-wheels.yml`, and setup checks each against a pinned SHA-256 like uv.

### Development

See [CONTRIBUTING.md](CONTRIBUTING.md): setup, the checks (`bun run check`), the rules, and how releases are made. `scripts/setup-python.sh` and `scripts/setup-python.ps1` set up the speech engine from a terminal.

## Use

| Command                                   | What it does                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| _Right-click → Start text-to-speech here_ | In a PDF or a note (editor or Reading view): starts at the word you clicked, or at the start of your selection |
| Read aloud / pause                        | Also the ribbon button and the player bar's play button (see below)                                            |
| Read from current position                | Starts again from the selection, or from the top of what's in view                                             |
| Next / Previous sentence                  | Skip around while reading                                                                                      |
| Read faster / Read slower                 | 0.1× steps, from 0.5× to 2.5×                                                                                  |
| Stop reading                              | Stops and clears the highlight                                                                                 |
| Show or hide player controls              | Toggles the floating player bar                                                                                |

Reading starts from the selected text if there is any, otherwise from the top of what's in view.

### Reading follows the page

Reading belongs to the page it started on.

- Switch to another page, or to another app, and it **pauses**. Turn on _Keep reading after switching pages or leaving Obsidian_ to let it carry on. Opening the sidebars doesn't count as switching.
- **Play** on the page that was paused resumes it. On any other page it starts reading that page.
- **Stop** ends reading.

**Double-tap shortcut** (off by default): under Settings → Double-tap shortcut, turn it on and pick a key (Right Command on a Mac and Right Ctrl elsewhere by default), or record any key. Double-tap to start; double-tap again to pause, and again to resume. Paused on a different page, a double tap stops instead, and the next one starts on the page you're on. It works while Obsidian is the active app; a plugin can't listen for keys system-wide.

### Player bar and status bar

When reading starts, a player bar floats above the status bar: previous / play-pause / next / stop, the speed with − and + buttons (click the speed for presets from 0.75× to 2.5×), and a speaker icon with a vertical volume slider that pops up on hover (click the icon to mute, or scroll over it). A new speed is heard from the next sentence; volume changes at once. While a sentence is being synthesized, a glow runs around the bar's edge. The ⌄ button shrinks the bar to a small pill in the corner, and _Show player controls_ in settings turns it off.

The status bar shows what's happening: a spinner while a voice loads or a sentence is prepared (with a progress bar while a voice downloads), moving bars while reading, and resting bars while paused, with the page position and speed. Click it for the speed presets.

### Look and storage

Pick the highlight colour under Settings → Highlight colour: amber, blue, green, pink, purple, red or grey. Each sets a soft tint for the sentence and a deeper shade for the spoken word; a preview shows the result.

Settings → Storage lists everything downloaded, each voice and the speech engine itself, with its size and a button to delete it. A deleted voice downloads again the next time it's used.

Bind the commands you use to hotkeys under Settings → Hotkeys.

## Voices

Kokoro voices (`kokoro_*`, the default is `kokoro_af_heart`) sound the most natural and synthesize about twice as fast as they play, even on a 2020 Intel i5. Piper voices (`piper_*`) are faster still, so reading starts sooner. Pick one under Settings → Edge Voice → Voice; the list marks downloaded voices with ✓.

## Limits

- Before speaking, text is rewritten the way a person would read it: "5.90%" becomes "5.90 percent", "2–7 GB" becomes "2 to 7 gigabytes", acronyms like GPU are spelled out, model names like "Qwen3-ASR-1.7B" are split into parts, and citation markers like "[12]" are dropped. The rules are in `src/normalize.ts`; names that a rule gets wrong can be added there.
- Word timing is estimated from word length and punctuation within each sentence's audio, so the word highlight can run slightly early or late on unusual words.
- Obsidian mobile can't start the Python sidecar, so phones and tablets aren't supported yet.
- In PDFs, rotated margin text (like arXiv's sidebar stamp), page numbers, header or footer lines that repeat on neighbouring pages, and footnotes with their superscript marks are skipped. Footnotes are recognised as small print at the bottom of a page that starts with a footnote mark; turn this off under Settings → Skip footnotes in PDFs.
- Scanned PDFs without a text layer have nothing to read.
