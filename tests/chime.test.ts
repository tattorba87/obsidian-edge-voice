import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Audio that records the frequency of every note started. */
class RecordingAudio {
	static notes: number[] = [];
	currentTime = 0;
	readonly destination = {};

	createOscillator() {
		const frequency = { value: 0 };
		return {
			type: "",
			frequency,
			connect: (next: unknown) => next,
			start: () => RecordingAudio.notes.push(Math.round(frequency.value)),
			stop: () => undefined,
		};
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
