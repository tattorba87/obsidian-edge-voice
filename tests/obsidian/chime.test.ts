import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, readerState, run, setSettings } from "./obsidian";

/** Double-taps `code` as a person would: two short presses close together. */
async function doubleTap(code: string): Promise<void> {
	for (let tap = 0; tap < 2; tap++) {
		run(`window.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)} }));`);
		await pause(40);
		run(`window.dispatchEvent(new KeyboardEvent("keyup", { code: ${JSON.stringify(code)} }));`);
		await pause(60);
	}
}

/** The notes played since the last call, in hertz, rounded. */
function notes(): number[] {
	return run<number[]>(`const notes = window.chimeNotes; window.chimeNotes = []; return notes;`);
}

beforeEach(() => {
	setSettings({ doubleTapEnabled: true, doubleTapKey: "F13", doubleTapChime: true });
	// Records every note any oscillator starts; the chime's are the only ones.
	run(`
		window.chimeNotes = [];
		window.realStart ??= OscillatorNode.prototype.start;
		OscillatorNode.prototype.start = function (...args) {
			window.chimeNotes.push(Math.round(this.frequency.value));
			return window.realStart.apply(this, args);
		};
	`);
});

afterEach(() => {
	run(`OscillatorNode.prototype.start = window.realStart;`);
	command("stop");
	setSettings({ doubleTapEnabled: false });
});

describe("Double-tap shortcut and its chime", () => {
	it("starts reading with a rising chime, and pauses with a falling one", async () => {
		openNote("A long note.md", "source");
		await doubleTap("F13");
		await pause(300);
		expect(["loading", "playing"]).toContain(readerState());
		expect(notes()).toEqual([659, 988]);

		await doubleTap("F13");
		await pause(300);
		expect(readerState()).toBe("paused");
		expect(notes()).toEqual([988, 659]);
		expect(errors()).toEqual([]);
	});

	it("plays no chime when it's turned off, but still works", async () => {
		setSettings({ doubleTapChime: false });
		openNote("A long note.md", "source");
		await doubleTap("F13");
		await pause(300);
		expect(["loading", "playing"]).toContain(readerState());
		expect(notes()).toEqual([]);
	});

	it("ignores a single tap, and a different key in between", async () => {
		openNote("A long note.md", "source");
		run(`
			window.dispatchEvent(new KeyboardEvent("keydown", { code: "F13" }));
			window.dispatchEvent(new KeyboardEvent("keyup", { code: "F13" }));
			window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
			window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
			window.dispatchEvent(new KeyboardEvent("keydown", { code: "F13" }));
			window.dispatchEvent(new KeyboardEvent("keyup", { code: "F13" }));
		`);
		await pause(300);
		expect(readerState()).toBe("idle");
		expect(notes()).toEqual([]);
	});
});
