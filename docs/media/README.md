# Demo media and reuse credits

## Dictation (STT) media

| File                                                  | Purpose                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dictation.mp4`                                       | One real-time take, 1200×800, with the two source clips and the plugin's start/stop sounds as soundtrack |
| `dictation.gif`                                       | The same take, silent                                                                                    |
| `dictation-dark.png`                                  | Dictating: live text, the microphone glow and the Dictating bars                                         |
| `dictation-done.png`                                  | Done: the green ring and **Done · stops in 3 s**, counting down to the automatic stop                    |
| `dictation-finished.png`                              | The finished, uncorrected note after the single-tap stop, with the cursor one space after the text       |
| `dictation-settings.png`                              | The plugin's real dictation settings, rendered in the isolated sandbox; see the capture note below       |
| `dictation-input.wav`, `dictation-input-2.wav`        | The two cleared mono 16 kHz PCM clips routed in as the microphone                                        |
| `listing-reading-note.png`, `listing-reading-pdf.png` | Frames of the TTS demo, resized and padded to the directory's 1200×800                                   |
| `banner-tts-stt.png`                                  | The README banner (purple v4)                                                                            |

Everything is dark theme with the Purple highlight colour. The five suggested gallery images are listed in the [Community listing kit](../community-listing/README.md). Screenshots are PNGs below 5 MB; GIFs are for the long description, not the gallery.

**The take.** Left ⌘ is double-tapped to start (shown on screen as keycaps, as a key press can't be filmed), the first sentence is said, and dictation stops by itself after the default 6 seconds of quiet, through the done ring and countdown. Left ⌘ is double-tapped again, the second sentence is said, and a single Left ⌘ tap stops it. The key presses go to the plugin as real keyboard events; the keycaps are an overlay added for the video.

## STT recording rights

**Work:** Michael Faraday, _The Chemical History of a Candle_, Lecture I (nineteenth-century original English text). **Recording:** read by **Availle**, LibriVox catalog date 2011-04-16.

- [Primary catalog and reader credit](https://librivox.org/the-chemical-history-of-a-candle-by-michael-faraday/).
- [Original MP3](https://archive.org/download/chemical_history_candle_ava_librivox/chemicalhistorycandle_1_faraday.mp3).
- [Archive metadata and public-domain mark](https://archive.org/metadata/chemical_history_candle_ava_librivox) identify this recording with [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/).
- [LibriVox's public-domain policy](https://librivox.org/pages/public-domain/) expressly permits reuse, editing, redistribution and commercial use of its recordings. LibriVox establishes US public-domain status and asks people elsewhere to check local terms; a public-domain mark is not a worldwide warranty or a waiver of unrelated personality/trademark rights. We use a factual, credited science excerpt without implying endorsement.

Two excerpts of the MP3 are used, each ending in a natural pause, with no word cut and no speed change:

| File                    | Excerpt                                  | Words                                                                                                                                        |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `dictation-input.wav`   | 01:03.050–01:12.150, plus 1 s of silence | "There is not a law under which any part of this universe is governed which does not come into play and is touched upon in these phenomena." |
| `dictation-input-2.wav` | 03:00.700–03:07.850, plus 1 s of silence | "And in this wood we have one of the most beautiful illustrations of the general nature of a candle that I can possibly give."               |

```sh
ffmpeg -ss 63.05 -t 9.1 -i chemicalhistorycandle_1_faraday.mp3 \
  -ac 1 -ar 16000 -af apad=pad_dur=1 -c:a pcm_s16le dictation-input.wav
ffmpeg -ss 180.7 -to 187.85 -i chemicalhistorycandle_1_faraday.mp3 \
  -ac 1 -ar 16000 -af apad=pad_dur=1 -c:a pcm_s16le dictation-input-2.wav
```

The second sentence was chosen because the model transcribes it word for word. Other candidates were screened by decoding them offline with the same model, which gives the same text as dictation's final pass on stop; one the model mishears ("…the physical phenomena of a candle") was set aside rather than corrected.

Keep this short credit near a reused demo, GIF or screenshot:

> Michael Faraday, _The Chemical History of a Candle_, read by Availle for LibriVox (public domain). Real local Moonshine transcription; recorded audio routed as input, not a live microphone. [Source and credits](https://github.com/tattorba87/obsidian-edge-voice/blob/main/docs/media/README.md).

No Richard Feynman audio is included. [Caltech's terms](https://www.feynmanlectures.caltech.edu/) permit listening online but withhold download rights. We found no source-specific public reuse grant for a suitable Feynman clip. Freely accessible videos are not evidence of reuse permission. See the [license audit](../licenses.md).

## Reproduce the real-engine STT demo

Requires macOS, Obsidian and ffmpeg, and the sandbox's own engine with the English Medium model (`bun run sandbox:engine --model medium`); your own engine is never used.

```sh
bun scripts/demo/record-stt.ts docs/media/dictation-input.wav docs/media/dictation-input-2.wav .scratch/stt-demo
```

The script uses a dedicated `.sandbox-stt-demo/` profile and vault and launches in the background. It never opens the person's physical microphone or everyday vault. A Web Audio source routes the licensed clips into a fresh MediaStream each time the plugin asks for the microphone; the plugin's real AudioWorklet, PCM queue, local sidecar, native Moonshine recognizer and Markdown editor perform the transcription. Only the input source is substituted. The plugin's start/stop sounds are logged as they play and rebuilt into the soundtrack at the same moments.

Frames come from Electron's actual application capture with timestamps, and the clips are placed at the times they started. Playback runs at the original speed: no waits removed, no cuts, no scripted transcript and no corrections. The live text lags the speech on the Intel recording machine; the final text arrives when each part finishes.

**Settings capture:** Obsidian's native settings window cannot be captured reliably through the background main-window API. The screenshot renders the plugin's actual registered settings tab inside the isolated window, through the same API used in integration tests. Controls, labels, values and their layout are real; the surrounding settings navigation is omitted.

**QA:** both sentences were checked against the spoken words, ignoring punctuation and case: zero substitutions, omissions or insertions. Frames at each step (start keys, live text, done ring and countdown, automatic stop, second start, single-tap stop, finished note) were inspected, and the soundtrack was checked for both clips and all four chimes (speech peaks at −8.7 dBFS, chimes at −17 dBFS). This is a selected clean example, not an accuracy benchmark or proof of live-microphone or Apple silicon behavior.

## TTS media

`demo.mp4` and `demo.gif` are the TTS assets, recorded with the sandbox's own engine and the Purple highlight colour. They include Wei et al., _Chain-of-Thought Prompting Elicits Reasoning in Large Language Models_ (2022), [arXiv 2201.11903](https://arxiv.org/abs/2201.11903), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain authors, title, source and license when reusing frames. The Intel TTS demo removes pauses for synthesis; this timing edit is disclosed in the README. The listing exports only resize and pad frames and do not alter the paper's text.

`banner.png` is the older TTS-only banner and is retained for history. The README uses `banner-tts-stt.png`, an exact copy of the maintainer's requested `~/Desktop/edge-voice-social-preview-purple-v4.png`. Its chip, crystal and existing TTS/STT wording are unchanged. An alternative generated speech-emblem banner was set aside in local scratch files when the maintainer chose v4. Obsidian remains a third-party trademark; confirm promotional asset use against its [brand guidelines](https://obsidian.md/brand) before publishing. This project is independent and not endorsed by Obsidian.
