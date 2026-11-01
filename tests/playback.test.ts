import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Reader, ReaderState } from "../src/reader";
import { FakeVoice, highlighted, sentences, useFakePlayback } from "./support/playback";

// Short sentences without commas, so each is asked for whole (no quick-start opening clause).
const TEXTS = ["The first sentence is here.", "Then a second one.", "A third follows.", "And the last."];

let voice: FakeVoice;
let states: ReaderState[];
let log: string[];
let speed: number;

function reader(): Reader {
	return new Reader(voice.asSidecar(), {
		speed: () => speed,
		volume: () => 1,
		prefetch: () => 2,
		onState: (state) => {
			if (states.at(-1) !== state) states.push(state);
		},
		onError: (error) => {
			throw error;
		},
	});
}

beforeEach(() => {
	useFakePlayback();
	voice = new FakeVoice();
	states = [];
	log = [];
	speed = 1;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Reading aloud", () => {
	it("waits for the voice, then plays, and stops at the end", async () => {
		const r = reader();
		r.start(sentences(TEXTS, log));
		await vi.advanceTimersByTimeAsync(60000);
		expect(states).toEqual(["idle", "loading", "playing", "idle"]);
		expect(voice.requests.map((request) => request.text)).toEqual(TEXTS);
		expect(highlighted(log)).toEqual([]);
	});

	it("highlights each sentence while it plays, one at a time", async () => {
		const r = reader();
		r.start(sentences(TEXTS, log));
		await vi.advanceTimersByTimeAsync(100);
		expect(highlighted(log)).toEqual([0]);
		await vi.advanceTimersByTimeAsync(TEXTS[0].length * 60);
		expect(highlighted(log)).toEqual([1]);
		r.stop();
	});

	it("uses a new speed from the next sentence", async () => {
		const r = reader();
		r.start(sentences(TEXTS, log));
		await vi.advanceTimersByTimeAsync(100);
		// As setSpeed in main.ts does: the new speed, and audio prepared at the old one dropped.
		speed = 1.5;
		r.invalidateAudio();
		await vi.advanceTimersByTimeAsync(60000);
		const spoken = (text: string) => voice.requests.filter((request) => request.text === text);
		expect(spoken(TEXTS[0]).map((request) => request.speed)).toEqual([1]);
		for (const text of TEXTS.slice(1)) expect(spoken(text).at(-1)?.speed).toBe(1.5);
	});

	it("leaves only the last sentence highlighted after quick skips", async () => {
		const r = reader();
		r.start(sentences(TEXTS, log));
		await vi.advanceTimersByTimeAsync(100);
		r.skip(1);
		r.skip(1);
		r.skip(1);
		await vi.advanceTimersByTimeAsync(100);
		expect(highlighted(log)).toEqual([3]);
		r.stop();
	});

	it("holds while paused, and carries on from the same sentence", async () => {
		const r = reader();
		r.start(sentences(TEXTS, log));
		await vi.advanceTimersByTimeAsync(100);
		r.pause();
		await vi.advanceTimersByTimeAsync(10000);
		expect(states.at(-1)).toBe("paused");
		expect(highlighted(log)).toEqual([0]);
		r.resume();
		await vi.advanceTimersByTimeAsync(TEXTS[0].length * 60);
		expect(highlighted(log)).toEqual([1]);
		r.stop();
	});
});
