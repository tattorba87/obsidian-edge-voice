/**
 * Fakes for testing playback without sound or waiting: audio that "plays" on
 * Vitest's fake clock, a voice that logs what it's asked to say, and
 * sentences that log when they're highlighted. Call `useFakePlayback` in a
 * beforeEach, then advance time with `vi.advanceTimersByTimeAsync`.
 */
import { vi } from "vitest";
import type { Segment, SegmentSource } from "../../src/reader";
import type { Sidecar, Synthesis } from "../../src/sidecar";

/** Seconds of audio per character, about Kokoro's pace at 1×. */
const SECONDS_PER_CHARACTER = 0.06;
/** Samples per second of the fake audio: low, since only its length matters. */
const SAMPLE_RATE = 1000;

/** Audio whose sources end when the fake clock reaches their length; suspending holds them. */
class FakeAudioContext {
	state: "running" | "suspended" = "running";
	readonly destination = {};
	private elapsed = 0;
	private since = Date.now();
	private readonly sources = new Set<FakeSource>();

	get currentTime(): number {
		return (this.elapsed + (this.state === "running" ? Date.now() - this.since : 0)) / 1000;
	}

	createGain() {
		return { gain: { value: 1, setTargetAtTime: () => undefined }, connect: () => undefined };
	}

	createBuffer(_channels: number, length: number, rate: number) {
		return { duration: length / rate, copyToChannel: () => undefined };
	}

	createBufferSource(): FakeSource {
		return new FakeSource(this.sources, () => this.state === "running");
	}

	suspend(): Promise<void> {
		if (this.state === "running") {
			this.elapsed += Date.now() - this.since;
			this.state = "suspended";
			for (const source of this.sources) source.hold();
		}
		return Promise.resolve();
	}

	resume(): Promise<void> {
		if (this.state === "suspended") {
			this.since = Date.now();
			this.state = "running";
			for (const source of this.sources) source.continue();
		}
		return Promise.resolve();
	}
}

class FakeSource {
	buffer: { duration: number } | null = null;
	onended: (() => void) | null = null;
	private remaining = 0;
	private startedAt = 0;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly sources: Set<FakeSource>,
		private readonly running: () => boolean,
	) {}

	connect(): void {}

	start(): void {
		this.remaining = (this.buffer?.duration ?? 0) * 1000;
		this.sources.add(this);
		if (this.running()) this.continue();
	}

	stop(): void {
		clearTimeout(this.timer);
		this.sources.delete(this);
	}

	hold(): void {
		clearTimeout(this.timer);
		this.remaining -= Date.now() - this.startedAt;
	}

	continue(): void {
		this.startedAt = Date.now();
		this.timer = setTimeout(() => {
			this.sources.delete(this);
			this.onended?.();
		}, this.remaining);
	}
}

/** Fake timers, audio and animation frames, for one test. */
export function useFakePlayback(): void {
	vi.useFakeTimers();
	vi.stubGlobal("AudioContext", FakeAudioContext);
	vi.stubGlobal("window", {
		requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16),
		cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
	});
}

/** A voice that answers at once with audio as long as the text, and logs every request. */
export class FakeVoice {
	readonly requests: { text: string; speed: number }[] = [];

	synthesize(text: string, speed: number): Promise<Synthesis> {
		this.requests.push({ text, speed });
		const samples = new Float32Array(Math.round((text.length * SECONDS_PER_CHARACTER * SAMPLE_RATE) / speed));
		return Promise.resolve({ samples, sampleRate: SAMPLE_RATE });
	}

	asSidecar(): Sidecar {
		return this as unknown as Sidecar;
	}
}

/** Sentences that log being highlighted as "+n" and unhighlighted as "-n". */
export function sentences(texts: string[], log: string[]): SegmentSource {
	let next = 0;
	const segment = (n: number): Segment => {
		const words = texts[n].split(/\s+/);
		return {
			text: texts[n],
			label: `line ${n}`,
			weights: words.map((word) => word.length),
			pauses: words.map(() => 0),
			spokenText: (from, to) => words.slice(from, to).join(" "),
			highlight: () => void log.push(`+${n}`),
			highlightWord: () => undefined,
			unhighlight: () => void log.push(`-${n}`),
		};
	};
	return {
		next: () => Promise.resolve(next < texts.length ? segment(next++) : null),
		dispose: () => undefined,
	};
}

/** The sentences highlighted now, from a log of "+n" and "-n". */
export function highlighted(log: string[]): number[] {
	const on = new Set<number>();
	for (const entry of log) {
		const n = Number(entry.slice(1));
		if (entry.startsWith("+")) on.add(n);
		else on.delete(n);
	}
	return [...on];
}
