import { beforeAll, describe, expect, it, vi } from "vitest";
import { Reader, Segment, SegmentSource } from "../src/reader";
import { Sidecar } from "../src/sidecar";

beforeAll(() => {
	// The reader uses window's timers so pop-out windows work; tests run in node.
	vi.stubGlobal("window", { cancelAnimationFrame: () => undefined });
});

/** Segments that record when they're highlighted, as "+n" and "-n". */
function source(count: number, log: string[]): SegmentSource {
	let next = 0;
	const segment = (n: number): Segment => ({
		text: `Sentence ${n}.`,
		label: `line ${n}`,
		weights: [1, 1],
		pauses: [0, 0],
		spokenText: () => `Sentence ${n}.`,
		highlight: () => void log.push(`+${n}`),
		highlightWord: () => undefined,
		unhighlight: () => void log.push(`-${n}`),
	});
	return {
		next: () => Promise.resolve(next < count ? segment(next++) : null),
		dispose: () => undefined,
	};
}

/** An engine whose synthesis never finishes, as if every sentence were still being prepared. */
const slowEngine = { synthesize: () => new Promise<never>(() => undefined) } as unknown as Sidecar;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function reader(): Reader {
	return new Reader(slowEngine, {
		speed: () => 1,
		volume: () => 1,
		prefetch: () => 2,
		onState: () => undefined,
		onError: (error) => {
			throw error;
		},
	});
}

describe("Reader", () => {
	it("highlights the first sentence before its audio is ready", async () => {
		const log: string[] = [];
		const r = reader();
		r.start(source(5, log));
		await settle();
		expect(log).toEqual(["+0"]);
		r.stop();
	});

	it("moves the highlight at once when skipping, without waiting for audio", async () => {
		const log: string[] = [];
		const r = reader();
		r.start(source(5, log));
		await settle();
		r.skip(2);
		await settle();
		expect(log).toEqual(["+0", "-0", "+2"]);
		r.skip(-1);
		await settle();
		expect(log).toEqual(["+0", "-0", "+2", "-2", "+1"]);
		r.stop();
		expect(log.at(-1)).toBe("-1");
	});
});
