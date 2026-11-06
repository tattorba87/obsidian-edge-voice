import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, readerState, run, setSettings } from "./obsidian";

async function singleTap(code: string): Promise<void> {
	run(`window.dispatchEvent(new KeyboardEvent("keydown", {code: ${JSON.stringify(code)}}));`);
	await pause(40);
	run(`window.dispatchEvent(new KeyboardEvent("keyup", {code: ${JSON.stringify(code)}}));`);
}

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
	it("starts with two taps and stops with one, using distinct chimes", async () => {
		openNote("A long note.md", "source");
		await doubleTap("F13");
		await pause(300);
		expect(["loading", "playing"]).toContain(readerState());
		expect(notes()).toEqual([659, 988]);

		await singleTap("F13");
		await pause(100);
		expect(readerState()).toBe("idle");
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

it("does not re-arm a start when the old double-tap stop is used", async () => {
	openNote("A long note.md", "source");
	await doubleTap("F13");
	await pause(300);
	await doubleTap("F13");
	await pause(550);
	expect(readerState()).toBe("idle");
});

it("cancels a pending voice load on one tap and ignores its late completion", async () => {
	openNote("A long note.md", "source");
	run(
		`const plugin=app.plugins.plugins["edge-voice"]; window.realEnsureVoice=plugin.ensureVoice.bind(plugin); plugin.ensureVoice=()=>new Promise((resolve)=>{window.finishVoiceLoad=resolve;});`,
	);
	try {
		command("read-from-here");
		for (let tries = 0; tries < 25; tries++) {
			if (run<boolean>(`return !!window.finishVoiceLoad;`)) break;
			await pause(40);
		}
		expect(run<boolean>(`return app.plugins.plugins["edge-voice"].readingStarting;`)).toBe(true);
		await singleTap("F13");
		expect(readerState()).toBe("idle");
		run(`window.finishVoiceLoad();`);
		await pause(300);
		expect(readerState()).toBe("idle");
		expect(run<boolean>(`return app.plugins.plugins["edge-voice"].readingStarting;`)).toBe(false);
	} finally {
		run(
			`window.finishVoiceLoad?.(); app.plugins.plugins["edge-voice"].ensureVoice=window.realEnsureVoice; delete window.finishVoiceLoad;`,
		);
	}
});
