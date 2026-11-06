# Demo media and reuse credits

## STT release assets

| File                                                  | Purpose                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `dictation-dark.mp4`, `dictation-light.mp4`           | Full real-time STT takes, with the source recording as soundtrack; 1200×800                         |
| `dictation-dark.gif`, `dictation-light.gif`           | Silent versions of the **whole** corresponding take, including finalization and the final hold      |
| `dictation-dark.png`, `dictation-light.png`           | Recording in progress: live text, microphone/input glow, Dictating bars and disabled TTS controls   |
| `dictation-finished.png`                              | Completed, uncorrected dark-theme transcript after the microphone stops                             |
| `dictation-settings.png`                              | The real registered plugin settings tab rendered in the isolated sandbox; see capture note below    |
| `dictation-input.wav`                                 | The cleared 10.1-second mono 16 kHz PCM input, including trailing silence                           |
| `dictation-recording.json`                            | Source details, hashes, model, transcript and timing/QA record                                      |
| `banner-tts-stt.png`                                  | Exact copy of the requested purple v4 banner, with chip/crystal and existing TTS/STT copy preserved |
| `listing-reading-note.png`, `listing-reading-pdf.png` | Existing TTS media exported at the directory's 1200×800 size                                        |

The five suggested gallery images are listed in the [Community listing kit](../community-listing/README.md). Screenshots are PNGs below 5 MB. GIFs are for the long description, not the gallery. Videos and images have not been uploaded to the listing or as external attachments.

## STT recording rights

**Work:** Michael Faraday, _The Chemical History of a Candle_, Lecture I (nineteenth-century original English text). **Recording:** read by **Availle**, LibriVox catalog date 2011-04-16.

- [Primary catalog and reader credit](https://librivox.org/the-chemical-history-of-a-candle-by-michael-faraday/).
- [Original MP3](https://archive.org/download/chemical_history_candle_ava_librivox/chemicalhistorycandle_1_faraday.mp3).
- [Archive metadata and public-domain mark](https://archive.org/metadata/chemical_history_candle_ava_librivox) identify this recording with [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/).
- [LibriVox's public-domain policy](https://librivox.org/pages/public-domain/) expressly permits reuse, editing, redistribution and commercial use of its recordings. LibriVox establishes US public-domain status and asks people elsewhere to check local terms; a public-domain mark is not a worldwide warranty or a waiver of unrelated personality/trademark rights. We use a factual, credited science excerpt without implying endorsement.

The distributed excerpt is **01:03.050–01:12.150** of the MP3 (9.1 seconds). Its spoken sentence ends before the trim point, during a natural pause; one further second of silence was appended for recognition finalization. No word is cut. It was converted to mono 16 kHz PCM without a speed change:

```sh
ffmpeg -ss 63.05 -t 9.1 -i chemicalhistorycandle_1_faraday.mp3 \
  -ac 1 -ar 16000 -af apad=pad_dur=1 -c:a pcm_s16le dictation-input.wav
```

Keep this short credit near a reused demo, GIF or screenshot:

> Michael Faraday, _The Chemical History of a Candle_, read by Availle for LibriVox (public domain). Real local Moonshine transcription; recorded audio routed as input, not a live microphone. [Source and credits](https://github.com/tattorba87/obsidian-edge-voice/blob/main/docs/media/README.md).

No Richard Feynman audio is included. [Caltech's terms](https://www.feynmanlectures.caltech.edu/) permit listening online but withhold download rights. We found no source-specific public reuse grant for a suitable Feynman clip. Freely accessible videos are not evidence of reuse permission. See the [license audit](../licenses.md).

## Reproduce the real-engine STT demo

Requires macOS, Obsidian, ffmpeg and a separately installed engine built from this branch with native `moonshine-voice==0.1.5`. Download an English Medium model explicitly using that environment's `edge-voice-engine models get medium`, or use a previously verified copy of the pinned model.

```sh
STT_DEMO_PYTHON=/absolute/path/to/engine/bin/python \
STT_DEMO_MODEL=/absolute/path/to/medium-streaming-en \
bun scripts/demo/record-stt.ts docs/media/dictation-input.wav .scratch/stt-demo
```

The script uses a dedicated `.sandbox-stt-demo/` profile, HOME and vault and launches in the background. It never opens the person's physical microphone or everyday vault. A Web Audio source routes the licensed file into a MediaStream returned by the capture interface; the plugin's real AudioWorklet, PCM queue, local sidecar, native Moonshine recognizer and Markdown editor perform the transcription. Only the input source is substituted. The model is loaded at normal startup, then the audio starts after **Dictating** appears. Sounds are disabled to keep the soundtrack to the source only. Inactivity auto-stop is disabled for a deterministic explicit Stop.

Frames come from Electron's actual application capture with timestamps. The source audio is delayed to its real start time, then muxed with the frames. Playback runs at the original speed: no waits removed, no cuts, no scripted transcript and no corrections. The video includes startup, the entire utterance, stopping, all queued/final text, and at least five seconds to read the finished note. GIFs include the same entire timeline and hold. This is a selected clean example, not an accuracy benchmark or proof of live-microphone/Apple silicon behavior. Initial longer test passages had errors and were discarded rather than edited into a misleading take.

**Settings capture:** Obsidian's native settings window cannot be captured reliably through the background main-window API. The screenshot renders the plugin's actual registered settings tab inside the isolated window, through the same API used in integration tests. Controls, labels, values and their layout are real; the surrounding settings navigation is omitted. The first attempted capture showed the note instead of settings and was rejected during visual QA.

**QA:** both complete takes were checked against the 27 spoken words, ignoring punctuation/case; both have zero substitutions, omissions or insertions. Light-theme punctuation has an extra comma. The screenshot and video frames were visually inspected; final-state frames show the complete sentence with the microphone stopped. Video/GIF durations and audio alignment were verified from timestamps and decoded media. The waveform ends before final text processing and the finished text remains visible. Exact timing/hashes are recorded in `dictation-recording.json`.

## Existing TTS media

`demo.mp4`, `demo.gif` and `reading-a-pdf.png` are the original TTS assets. They include Wei et al., _Chain-of-Thought Prompting Elicits Reasoning in Large Language Models_ (2022), [arXiv 2201.11903](https://arxiv.org/abs/2201.11903), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain authors, title, source and license when reusing frames. The Intel TTS demo removes pauses for synthesis; this timing edit is disclosed in the README. The new listing exports only resize/pad frames and do not alter paper text.

`banner.png` is the older TTS-only banner and is retained for history. The README uses `banner-tts-stt.png`, an exact copy of the maintainer's requested `~/Desktop/edge-voice-social-preview-purple-v4.png`. Its chip, crystal and existing TTS/STT wording are unchanged. An alternative generated speech-emblem banner was set aside in local scratch files when the maintainer chose v4. Obsidian remains a third-party trademark; confirm promotional asset use against its [brand guidelines](https://obsidian.md/brand) before publishing. This project is independent and not endorsed by Obsidian.
