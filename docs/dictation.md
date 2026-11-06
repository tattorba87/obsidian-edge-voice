# English dictation

Write Markdown with your voice using Moonshine's local streaming speech recognition. Dictation and reading aloud run one at a time. Dictation is on for new installs. If you're updating from 0.1.x it stays off until you turn it on under **Settings → Edge Voice → English dictation**, so nothing new appears in your player or shortcuts. A saved choice to turn it off is preserved. Recording starts only when you click the microphone or use its shortcut; no microphone permission is requested at startup.

## Set up

1. Install the speech engine using the [README setup steps](../README.md#setup). Dictation needs **engine 0.4.0 or later**; an older compatible engine can still read aloud. You can skip the voice download if you only want dictation.
2. Open **Settings → Edge Voice → English dictation**. The **Set up the speech engine** window includes an optional model command too. Choose a model, then **Get the dictation model → Show command**. Run that command yourself in Terminal or PowerShell. The plugin never downloads anything.
3. Turn on **Enable dictation**. Open a Markdown note in Source mode or Live Preview and put the cursor where you want the words.
4. Click the microphone in the player bar. Grant Obsidian microphone access when your operating system asks. Wait for **Dictating** before speaking. Click the microphone again to finish and insert the final words.

For the default Medium model:

```sh
# macOS / Linux
~/.edge-voice/engine/bin/edge-voice-engine models get medium
```

```powershell
# Windows PowerShell
& "$HOME\.edge-voice\engine\Scripts\edge-voice-engine.exe" models get medium
```

These commands download from `download.moonshine.ai` at a pinned model revision. Each file's byte count and SHA-256 must match the manifest bundled with the engine before it replaces a local file. Interrupted or invalid downloads never replace a working file. Running the command again reuses verified files. Managed models are verified again, offline, before the native recognizer loads them. The model folder includes the upstream MIT notice.

The commands above target the standard installation. If **Advanced → Python path** points to a custom environment, run that environment's `edge-voice-engine` executable instead.

## Choose a model

| English model    | Parameters  | Download | When to try it                                                                   |
| ---------------- | ----------- | -------- | -------------------------------------------------------------------------------- |
| Medium Streaming | 245 million | 269.1 MB | Prioritizes word accuracy; default, also the family used by MoonshineFlow        |
| Small Streaming  | 123 million | 142.3 MB | Prioritizes speed and lower resource use over word accuracy                      |
| Tiny Streaming   | 34 million  | 45.2 MB  | Prioritizes speed and the smallest footprint; expect the most recognition errors |

All three are **MIT licensed**, explicitly including their weights, according to [Moonshine's versioned license](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/LICENSE). Sizes are the pinned quantized ORT files, not runtime memory. Parameter counts come from [Moonshine's model documentation](https://moonshine-voice.readthedocs.io/en/latest/models/available-models/). These are model choices, not plugin accuracy benchmarks. Changing the dropdown does not download its model; run its command first.

The original non-streaming Tiny/Base models are different and are not supported by this loader. No English Base Streaming checkpoint is offered. Other languages are not supported.

**Apple silicon:** recognition uses Moonshine's native streaming runtime. **Faster voice engine** enables MLX for Kokoro TTS only; it does not change STT. An MLX STT adapter has not been implemented or validated. [MLX-Audio's Moonshine adapter](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/stt/models/moonshine/README.md) documents the original Tiny/Base family rather than these streaming models.

If you previously turned dictation off, its notice has an **Open dictation settings** button; clicking the notice or button opens the English dictation section directly. Updating from 0.1.x, or with dictation turned off, leaves it off until you enable it there.

## Controls and preferences

- **Microphone:** click once to start; click again to finish. The player keeps the same controls. TTS controls are disabled during dictation, and the microphone is disabled while reading is loading, playing or paused. Stop reading first to switch to dictation.
- **Shortcut:** double-tap **Left ⌘** on Mac, **Left Ctrl** elsewhere, to start; one short tap of the same key finishes, including during startup. The reading shortcut uses the right key by default and is independently enabled. Both settings show the same symbolic key picker and a custom modifier/function-key option. Conflicting shortcuts cannot be enabled. Shortcuts work only with Obsidian focused.
- **Feedback:** the player has the same processing glow as TTS through startup, recording and finalization. The microphone glow and three status-bar bars follow input volume and return to zero when quiet. **Dictating** means capture is active; **Finishing dictation…** means capture has stopped and queued audio/final text is still being processed. Text can continue changing during this final step.
- **Dictation sounds:** optional start/stop sounds, separate from the reading shortcut sounds. Dictation starts capture after its start sound finishes.
- **Lowercase dictation:** lowercases recognizer output. Otherwise capitalization and punctuation are preserved. It does not add Markdown formatting, spoken commands or an LLM rewrite.
- **Stop after silence:** default 10 seconds, maximum 300; set 0 to turn it off. This measures time since the **transcript last changed**, as in MoonshineFlow, rather than acoustic silence. Slow recognition or unrecognized speech can therefore stop early. Casing and timeout settings apply next session.

## Working in a note

Dictation inserts at the cursor or replaces the selection once the recognizer returns nonempty text. It snapshots the cursor and selection when recording actually begins, so typing while the model loads is allowed. Live words may be revised as you speak; read the finished text and correct recognition mistakes.

Stop before typing or using undo. If the document changes, dictation stops on its next transcript update rather than overwrite your edit. Undo follows normal Obsidian history and can step through several partial transcripts; a recording is not grouped into one undo operation.

Switching notes or leaving editing mode finishes dictation. A final revision may still reach the original note if that editor remains open, unchanged and in editing mode. Replacing the note in the same pane, closing it or leaving editing mode can discard a final revision to protect the replacement editor. Sidebar focus alone does not stop it. Window blur finishes an ongoing recording, but is ignored during startup so the system permission prompt can open. Turning the feature off finalizes an ongoing recording. Unloading the plugin or restarting the engine cancels pending results and releases capture.

Audio is held only in memory, sent to the local Python engine, then discarded. The plugin saves neither recordings nor transcript logs. The resulting note is saved through Obsidian as usual. If recognition cannot keep up, it stops with a message instead of silently discarding words: the queue holds at most 20 seconds plus the current request, with no request exceeding two seconds. The engine is unloaded after dictation; the next TTS session loads its voice again.

## Storage and verification

Models are in `~/.edge-voice/models/<size>-streaming-en` (`%USERPROFILE%\.edge-voice\models` on Windows), outside the Python environment and your vault. Updating Python packages keeps them. List choices, verify a model, show its path or remove it explicitly:

```sh
~/.edge-voice/engine/bin/edge-voice-engine models list
~/.edge-voice/engine/bin/edge-voice-engine models check medium
~/.edge-voice/engine/bin/edge-voice-engine models path medium
~/.edge-voice/engine/bin/edge-voice-engine models remove medium
```

On Windows use the executable shown in the setup command. Stop dictation before removing a model. The **Storage** settings and `storage` command manage TTS voices; ASR models use `models` instead. Remove the entire `.edge-voice` folder only when you want to remove the engine and all its managed models too.

**Custom model folder (advanced)** can reuse an existing trusted English streaming folder, for example MoonshineFlow's. Use an absolute path; the selected size must match. Both the original `frontend.ort` layout and the newer split `frontend.model.ort`/`frontend.weights.ort` layout are accepted with tokenizer, encoder, decoder, adapter, cross-KV and streaming config. Custom files are not authenticated by this plugin. Do not load untrusted model files. Model commands never delete your custom folder.

## Troubleshooting

| Symptom                           | What to check                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Engine supports reading only      | Update the engine manually using **Advanced → Speech engine**, then check again. Plugin updates do not update Python.                |
| Missing or damaged model          | Run `models get <size>` using the same environment the plugin uses; leave Custom model folder empty for managed models.              |
| Microphone denied or disconnected | Enable microphone access for Obsidian in system privacy settings and check your system's input device. Reconnect it and start again. |
| No words or poor accuracy         | Confirm English speech, input device and volume. Try Medium, speak clearly, and increase/disable the inactivity timeout.             |
| Recording stops before you finish | Check timeout, focus changes and manual edits. A queue-limit message means the model is too slow; try Small/Tiny.                    |
| Shortcut does nothing             | Enable that mode's shortcut; pick distinct keys, focus Obsidian, release other modifiers, and close custom-key capture.              |
| Mic is grey                       | Stop reading, including paused playback, before starting dictation.                                                                  |
| Words keep changing after Stop    | Capture has ended; wait for finalization before editing or switching the note.                                                       |

For a safe test environment see [development setup](experimental-dictation.md); for existing users see [updating the plugin and engine](../README.md#updating-the-plugin-and-speech-engine).
