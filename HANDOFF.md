# Edge Voice — handoff notes (2026-10-30)

Obsidian plugin that reads notes and PDFs aloud with Moonshine TTS on Steven's
Intel Mac (i5-1038NG7, x86_64), highlighting each sentence. See README.md.

## Decisions so far

- **Native Python sidecar, not WASM.**
  - WASM Kokoro ran at RTF 1.32 on this i5, too slow for continuous reading.
  - WASM Piper fails: `PiperTTS: voices_dir is not a directory`. The core's
    Piper loader (`core/moonshine-tts/src/piper-tts.cpp`, `pick_onnx_path` /
    `open_stage`) only reads from disk, never from the in-memory asset map.
  - Obsidian disables `ELECTRON_RUN_AS_NODE`, so the plugin can't run the WASM
    build in Obsidian's own process.
- **PyPI `moonshine-voice` 0.0.59 won't load on Intel.** Its "universal2" wheel
  has an arm64-only libmoonshine.dylib. It is also an older API.
- So the wheel is built from `~/dev/moonshine` (branch `intel-x86_64-build`)
  with `scripts/build-pip.sh`, which supports x86_64 macOS. It outputs to
  `~/dev/moonshine/language-bindings/python/dist/`.

## State

- Done: server.py, src/{sidecar,reader,sentences,pdf,markdown,main}.ts, build
  config, styles, scripts/setup-python.sh, README. `npm run build` passes.
- Not yet run inside Obsidian.
- Native build done: `~/dev/moonshine/language-bindings/python/dist/
moonshine_voice-0.1.5-py3-none-macosx_15_0_x86_64.whl`. Its dylib is x86_64.
- Installed into `~/.edge-voice/venv` (Python 3.12) with
  `scripts/setup-python.sh ~/dev/moonshine`. `import moonshine_voice` works.

- Native speed on this i5, where a real-time factor (RTF) below 1 means faster
  than real time: Kokoro af_heart 0.47, Piper ryan-high 0.37, Piper
  lessac-medium 0.09. Default voice is now `kokoro_af_heart`.
- Sidecar tested end to end through src/sidecar.ts. Fixed server.py so a bad
  `load` keeps the previous voice.
- Linked to `~/Documents/obsidian/KnowledgeBase/.obsidian/plugins/edge-voice`.
  It's excluded from the vault's git via `.git/info/exclude`.

- Round 2 (after first real use: "roughly working, highlight too faint"):
  - PDF highlight is now overlay boxes (`.edge-voice-layer` inside
    `.page`), built from DOM Ranges over the text-layer spans. The sentence and
    the current word get separate colours.
  - Word-by-word timing is estimated (reader.ts `wordStartTimes`): voiced
    stretch after trimming silence, shared out by `wordWeights`.
  - Right-click → "Start text-to-speech here" in notes (`editor-menu`) and in
    PDFs. PDFs have no menu event, so the plugin wraps
    `Menu.prototype.showAtPosition` and falls back to its own menu after 150 ms.
  - Notes: Markdown is blanked with spaces so offsets stay aligned
    (`maskUnspoken`).
  - Cross-platform desktop: per-OS default Python path; scripts/setup-python.ps1
    for Windows. PyPI 0.1.5 has wheels for win_amd64, manylinux x86_64 and
    aarch64, and macOS arm64. There is no Intel Mac wheel.

- Round 3: Steven reported that punctuation and technical tokens were misread
  ("Qwen3-ASR-1.7B", "5.90%", "2–7 GB", "GPU", em dashes). The cause is
  Moonshine's G2P front end, not the voice: it drops "%", sends mixed or
  unknown tokens to its out-of-vocabulary model, and reads "A" alone as "uh".
  Added src/normalize.ts, a rule-based text normalizer applied to segment text
  only; highlight offsets still use the source. Each rule was checked against
  `GraphemeToPhonemizer("en_us").to_ipa`. Letter A is written as "Ae", the
  only spelling that gave /eɪ/. Word weights are now spoken syllables.

- Round 4: Steven asked to skip the arXiv sidebar stamp and footer page
  numbers. pdf.ts `skippedItems`: rotated items (transform angle > 0.1 rad),
  plus lines in the top/bottom 8% band that are page numbers or repeat
  (digits masked) on page n±1. Skipped items stay in `items`/`starts` for
  span alignment but add only "\n" to the text. Verified with pdfjs-dist on
  "ML/ASR/Papers/Pushing the Limits of On-Device ASR.pdf" in KnowledgeBase.
  Footnotes are still read; a setting to skip them is a possible follow-up.

- Round 5: player bar (src/player-bar.ts) with skip, play/pause, stop, speed
  −/+ and presets. The speed also shows in the status bar (click for presets).
  The sidecar queues requests on the client and can cancel waiting ones
  (AbortSignal), so a speed change takes effect from the next sentence.
- Round 5: highlighting in rendered notes (src/rendered.ts). Reading view uses
  the internal `previewMode.renderer.sections` (lineStart/lineEnd/el), with
  `applyScroll(line)` to render a section. Live Preview checks `.cm-embed-block`
  / `.math-block` widgets, finding each block's source extent with `blockEnd`.
  Words are matched with `alignWords`; painting uses `CSS.highlights`.
  Not done: right-click in Reading view.

- Round 6: the bar appears only once audio first plays, and stays while
  paused. A minimize toggle shrinks it to play/pause + speed in the
  bottom-right corner; the choice is saved as `settings.playerMinimized`.

- Round 7:
  - Notes join hard-wrapped lines before splitting into sentences
    (`joinWrappedLines`). Breaks are kept at blank lines, headings, lists,
    tables, fences and changes in quote depth. Short-sentence merging no
    longer crosses a kept line break.
  - Quick start: when the sentence about to play has no audio ready, the
    reader synthesizes it in growing pieces (`quickStartPieces`: opening of
    4–13 words at a clause break, each piece up to 2× the previous). Under
    load this measured about 2 s to first audio versus about 5 s whole, with
    no gaps. Moonshine's own `stream()` was not used because its speed is
    fixed at load time.
  - Preload: the voice loads at `onLayoutReady` (setting `preloadVoice`),
    then `server.py` runs a warm-up synth. Voice loading is shared through
    `this.voice.ready`.
  - Volume: a GainNode in the reader. The bar shows a volume icon whose slider
    expands on hover or focus; click mutes, the wheel adjusts.
  - Setting `showPlayer` and a "Show or hide player controls" command.
  - Profiling showed the bottleneck is Kokoro inference in ONNX Runtime
    (~96%). Python and transport are under 1%, so Rust would not help.

- Round 8: the volume slider is drawn by the plugin (track/fill/thumb,
  role=slider) because Obsidian themes restyle `<input type=range>`; it pops up
  vertically on hover or focus and is hidden when minimized. Added the
  highlight colour setting: at Steven's request, seven fixed pairs (amber,
  blue, green, pink, purple, red, grey) in src/colors.ts, chosen with swatches,
  not a free colour picker. They are set as RGB channel variables on body,
  with per-theme alpha in styles.css.

- Round 9 (public-release essentials):
  - One-click setup (src/setup.ts, src/setup-modal.ts): downloads uv 0.13.6
    (SHA-256 pinned per platform), then `uv venv --python 3.12` and
    `uv pip install "moonshine-voice>=0.1.5,<0.2"`, all under
    ~/.edge-voice (UV_PYTHON_INSTALL_DIR and UV_CACHE_DIR are set there).
    Intel Mac and Windows ARM have no PyPI wheel, so the window offers
    "Install from a wheel file…". Setup is offered from a startup notice, from
    play when the engine is missing, and from Settings → Voice engine. Tested
    end to end with HOME pointed at a temp folder: 11 s on this Mac with the
    local wheel.
  - Right-click in Reading view: one capture-phase contextmenu handler for
    PDFs and Reading view (`sourceAtPointer`), with
    `MarkdownSource.offsetInReadingView` mapping a DOM position to a source
    offset through the section's words (`alignWords`). Not yet tried in
    Obsidian.
  - Footnotes (pdf.ts `footnoteItems`): a small-print block (< 93% of the body
    size, weighted by text) at the bottom (lower 45%) whose top line starts
    with a footnote mark (digit, * ∗ † ‡ § ¶ or superscript digits), not a
    caption; plus small superscript marks. Setting `skipFootnotes`, default
    on. Verified on the On-Device ASR paper (p3) and Attention Is All You Need
    (p1); no false positives on Conformer or the RAG survey (p1–4).
  - The GPU/home-server option is parked; the plan is in
    ~/.claude/plans/don-t-start-this-radiant-flamingo.md.

- Round 10: renamed to **Edge Voice**, at Steven's request so the plugin
  isn't tied to Moonshine (id `edge-voice`, home `~/.edge-voice`, CSS
  `edge-voice-*`, repo `obsidian-edge-voice`, folder ~/dev/obsidian-edge-voice,
  vault link `.obsidian/plugins/edge-voice`). Moonshine is named only as the
  current engine. Added a double-tap shortcut (src/double-tap.ts): a lone tap is
  under 350 ms, the second within 450 ms, and any other key resets it. It
  calls the same toggle as the ribbon. Settings `doubleTapEnabled` (default
  off) and `doubleTapKey`, with a key dropdown and "Record key".

- Round 11:
  - Page-aware playback (main.ts): `target` is the view and file being read.
    `registerAutoPause` pauses on `active-leaf-change` (sidebars excluded), on
    `file-open` changing the target's file, and on every Obsidian window
    losing focus (setting `keepReadingInBackground`).
    `toggle("button" | "double-tap")`: when paused on another page, a button
    starts reading that page and a double tap stops. Starting reads from the
    selection, else the top of what's visible (`MarkdownSource.startOffset`,
    `PdfSource.startFor`).
  - Storage (src/storage.ts): `scanVoices` groups Moonshine's cache (path from
    the sidecar's new `paths` request) into Kokoro, each Piper voice, voice
    cloning (~670 MB, unused) and pronunciation data. `scanEngine` covers
    ~/.edge-voice. Delete stops reading and the sidecar first.
  - Status bar (src/status.ts): a spinner for busy, a progress bar for
    downloads, equalizer bars that move while playing and rest while paused.
    The play button gets a spinning ring while a sentence is prepared.
  - server.py is bundled into main.js (esbuild text loader) and written to
    ~/.edge-voice/server.py, since Obsidian installs only main.js,
    manifest.json and styles.css.
- Project tooling: Prettier (tabs, 120 columns), ESLint 9 with
  eslint-plugin-obsidianmd recommended (the community review's rules; two
  accepted `display` deprecation warnings because minAppVersion is 1.5), ruff,
  Vitest (66 tests; PDFs generated with pdf-lib), pytest (server.py against a
  stub engine), lefthook hooks, CONTRIBUTING.md/AGENTS.md rules, CHANGELOG,
  version-bump script, CI (Ubuntu full check, plus tests on Windows and macOS)
  and a release workflow that drafts a GitHub release on version tags.
  Repo: github.com/tattorba87/obsidian-edge-voice (private for now).

## Next steps

1. Steven tests in Obsidian: page-aware playback and the double tap,
   right-click in Reading view, footnotes, storage deletion, setup from
   scratch, and the loading animations.
2. Before going public: make the repo public, publish a release, and submit
   to the community directory (obsidianmd/obsidian-releases).
3. Parked: GPU/home-server engine (OpenAI-compatible speech servers such as
   Kokoro-FastAPI and Ollama); the plan is in
   ~/.claude/plans/don-t-start-this-radiant-flamingo.md.
4. Optional: fix the moonshine wheel platform tag upstream, so Intel Macs get
   a PyPI wheel.
