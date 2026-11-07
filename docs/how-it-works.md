# How it works and limits

The plugin starts the speech engine (`python -I -m edge_voice_engine`, from the environment you set up) and asks it for one sentence of audio at a time over stdin/stdout. While serving the plugin, the engine reads voices from disk only and makes no downloads. The separate `edge-voice-engine voices get` and `models get` commands download files only when you run them. Dictation uses a bounded in-memory PCM queue to the same local sidecar and applies real streaming/final transcripts to the selected Markdown range. Only one speech mode runs at a time. The plugin plays the audio with Web Audio and synthesizes a couple of sentences ahead, so there is no gap between them.

- **PDFs**: text comes from pdf.js (Obsidian's `loadPdfJs`), page by page. The sentence and the word being spoken are drawn as boxes over the page, positioned from the viewer's text layer, and the view follows along onto the next page.
- **Notes**: reads from the cursor to the end of the note. It skips frontmatter, code, comments, embeds, tables and URLs. Highlighting works in Source mode, Live Preview (including rendered callouts and math blocks) and Reading view: rendered text is matched word by word and painted with the CSS Custom Highlight API.

## Limits

- Dictation is English only, in Markdown editing views. It produces text and recognizer punctuation, not spoken Markdown commands. Partial text can change, undo can step through partial results, and switching/closing notes can discard a final revision. Stop and wait before editing; see [dictation behavior](dictation.md#working-in-a-note).
- Native Moonshine STT uses its own runtime. MLX acceleration currently applies to Kokoro TTS only. Dictation speed and accuracy depend on the model, microphone, accent and machine.

- Before speaking, text is rewritten the way a person would read it: "5.90%" becomes "5.90 percent", "2–7 GB" becomes "2 to 7 gigabytes", "$4.99" becomes "4 dollars 99 cents", version numbers like "1.2.3" become "1 point 2 point 3", acronyms like GPU are spelled out, model names like "Qwen3-ASR-1.7B" are split into parts, and citation markers like "[12]" are dropped. The rules are in `src/normalize.ts`; names that a rule gets wrong can be added there.
- Word timing is estimated from word length and punctuation within each sentence's audio, so the word highlight can run slightly early or late on unusual words.
- Obsidian mobile can't start the Python sidecar, so phones and tablets aren't supported yet.
- In PDFs, rotated margin text (like arXiv's sidebar stamp), page numbers, header or footer lines that repeat on neighbouring pages, and footnotes with their superscript marks are skipped. Footnotes are recognised as small print at the bottom of a page that starts with a footnote mark; turn this off under Settings → Skip footnotes in PDFs.
- Scanned PDFs without a text layer have nothing to read.
