import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Audio that records the frequency of every note started. */
class RecordingAudio {
	static notes: number[] = [];
	static ended: (() => void)[] = [];
	resume() {
		return Promise.resolve();
	}
	currentTime = 0;
	readonly destination = {};

	createOscillator() {
		const frequency = { value: 0 };
		const oscillator = {
			onended: null as (() => void) | null,
			type: "",
			frequency,
			connect: (next: unknown) => next,
			start: () => RecordingAudio.notes.push(Math.round(frequency.value)),
			stop: () => {
				RecordingAudio.ended.push(() => oscillator.onended?.());
			},
		};
		return oscillator;
	}

	createGain() {
		const ramp = () => undefined;
		return {
			gain: { setValueAtTime: ramp, linearRampToValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
			connect: (next: unknown) => next,
		};
	}
}

beforeEach(() => {
	RecordingAudio.notes = [];
	RecordingAudio.ended = [];
	vi.stubGlobal("AudioContext", RecordingAudio);
	// chime.ts keeps one AudioContext; a fresh import makes it with this one.
	vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

describe("Double-tap chime", () => {
	it("rises from E5 to B5 to start or resume, and falls back to pause or stop", async () => {
		const { playChime } = await import("../src/chime");
		playChime("up");
		playChime("down");
		expect(RecordingAudio.notes).toEqual([659, 988, 988, 659]);
	});
});

it("dictation chime completes only after its last note ends", async () => {
	const { playDictationChime } = await import("../src/chime");
	let completed = false;
	const playing = playDictationChime(true).then(() => {
		completed = true;
	});
	await Promise.resolve();
	expect(RecordingAudio.notes).toEqual([330, 440, 554]);
	RecordingAudio.ended[0]();
	await Promise.resolve();
	expect(completed).toBe(false);
	RecordingAudio.ended[2]();
	await playing;
	expect(completed).toBe(true);
});
