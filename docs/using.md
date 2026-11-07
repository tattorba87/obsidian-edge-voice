# Using Edge Voice

| Command                                   | What it does                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| _Right-click → Start text-to-speech here_ | In a PDF or a note (editor or Reading view): starts at the word you clicked, or at the start of your selection |
| Read aloud / pause                        | Also the ribbon button and the player bar's play button (see below)                                            |
| Read from current position                | Starts again from the selection, or from the top of what's in view                                             |
| Next / Previous sentence                  | Skip around while reading                                                                                      |
| Read faster / Read slower                 | Between 1×, 1.5× and 2×                                                                                        |
| Stop reading                              | Stops and clears the highlight                                                                                 |
| Start / stop English dictation            | Starts capture in the current Markdown editor, or finishes it                                                  |
| Stop dictation                            | Releases the microphone and writes the final text                                                              |
| Show or hide player controls              | Toggles the floating player bar                                                                                |

Reading starts from the selected text if there is any, otherwise from the top of what's in view.

## Reading follows the page

Reading belongs to the page it started on.

- Switch to another page and it **pauses**; turn off _Pause when switching pages_ to let it carry on. Opening the sidebars doesn't count as switching.
- Switch to another app and it **keeps reading while Obsidian is visible**: it pauses only once every Obsidian window is minimized, hidden or covered. _When Obsidian is in the background_ can make it pause as soon as you switch apps, or always keep reading.
- **Play** on the page that was paused resumes it. On any other page it starts reading that page.
- **Stop** ends reading.

**Double-tap shortcut** (off by default): under Settings → Double-tap shortcut, turn it on and pick Right Command (Right Ctrl outside a Mac), Right Option (Alt) or Right Shift, or choose _Custom…_ and press the key you want: the box shows it before you save, and only a single modifier or function key is accepted. Optional reading shortcut sounds rise to start and fall to stop. Double-tap to start; tap the shortcut key once to stop, including while the voice loads. Use the player to pause and resume. It works while Obsidian is the active app; a plugin can't listen for keys system-wide.

## Player bar and status bar

When reading starts, or dictation is enabled, a player bar floats above the status bar: previous / play-pause / next / stop, the speed with − and + buttons (1×, 1.5× or 2×; click the speed to pick one), and a speaker icon with a vertical volume slider that pops up on hover (click the icon to mute, or scroll over it). A new speed is heard from the next sentence; volume changes at once. While a sentence is being synthesized, a glow runs around the bar's edge. The ⌄ button shrinks the bar to a small pill in the corner, and _Show player controls_ in settings turns it off.

Dictation adds a microphone button without rearranging the controls. Its own input glow follows microphone volume; the full processing glow continues through startup, recording and finalization.

The status bar shows what's happening: a spinner while a voice loads or a sentence is prepared, moving bars while reading, and resting bars while paused, with the page position and speed. Click it for the speed presets. Dictation shows **Dictating** with three input-driven bars, and a spinner while starting or finishing.

## Look and storage

Pick the highlight colour under Settings → Highlight colour: amber, blue, green, pink, purple, red or grey. Each sets a soft tint for the sentence and a deeper shade for the spoken word; a preview shows the result.

Settings → Storage (near the bottom) lists the downloaded voices with their sizes, as the engine reports them, to keep them from piling up. Edge Voice doesn't delete files itself: each voice has a **Copy remove command** button, and you run the command (`edge-voice-engine storage remove <ID>`), as with setup. You can also run `edge-voice-engine storage` yourself to see the list. Get a removed voice again with its command (see [Voices](voices.md)). ASR models are listed and removed with `edge-voice-engine models list` / `models remove <size>` instead; see [dictation storage](dictation.md#storage-and-verification). The engine itself isn't listed there; to remove everything, delete `~/.edge-voice`.

Bind the commands you use to hotkeys under Settings → Hotkeys.
