import { describe, expect, it, vi } from "vitest";
import { DictationSession, DictationText, microphoneLevel, Microphone } from "../src/dictation";

const tick = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function harness() {
	let receive!: (samples: Float32Array, rate: number) => void;
	let ended!: () => void;
	let timer!: () => void;
	let now = 0;
	const microphone = { start: vi.fn(), stop: vi.fn() };
	const backend = {
		startDictation: vi.fn<(path: string, model: string) => Promise<void>>(async () => {}),
		dictationAudio: vi.fn<(samples: Float32Array, rate: number) => Promise<string>>(async () => "Hello"),
		stopDictation: vi.fn(async () => "Hello there."),
		stop: vi.fn(),
	};
	const options = {
		backend,
		capture: vi.fn(async (audio: typeof receive, disconnected: typeof ended): Promise<Microphone> => {
			receive = audio;
			ended = disconnected;
			return microphone;
		}),
		apply: vi.fn(),
		state: vi.fn(),
		ready: vi.fn(),
		cancelled: vi.fn(),
		error: vi.fn(),
		chime: vi.fn<(recording: boolean) => Promise<void> | void>(),
		setTimer: vi.fn((run: () => void) => {
			timer = run;
			return 1;
		}),
		clearTimer: vi.fn(),
		now: () => now,
	};
	const session = new DictationSession(options);
	return {
		session,
		backend,
		options,
		microphone,
		audio: (length = 1600, rate = 16000, value = 0) => receive(new Float32Array(length).fill(value), rate),
		ended: () => ended(),
		timeout: (ms: number) => {
			now = ms;
			timer();
		},
	};
}

describe("Dictation text ownership", () => {
	it("revises partial text without duplication and preserves surrounding Markdown", () => {
		const text = new DictationText("# Heading\n\nend", 11, 11, false);
		expect(text.update("# Heading\n\nend", "Hello")).toEqual({ from: 11, to: 11, text: "Hello " });
		expect(text.update("# Heading\n\nHello end", "Hello world.")).toEqual({
			from: 11,
			to: 17,
			text: "Hello world. ",
		});
	});
	it("preserves selections until text arrives and supports lowercase", () => {
		const text = new DictationText("a SELECT b", 2, 8, true);
		expect(text.update("a SELECT b", "")).toBeNull();
		expect(text.update("a SELECT b", "Hello WORLD.")).toEqual({ from: 2, to: 8, text: "hello world." });
	});
	it("refuses to replace a note changed externally, including undo", () => {
		const text = new DictationText("safe", 4, 4, false);
		expect(text.update("safe", "Hello")).toEqual({ from: 4, to: 4, text: " Hello" });
		expect(() => text.update("safe edited Hello", "New text")).toThrow("edited");
		expect(() => text.update("safe", "New text")).toThrow("edited");
	});
});

describe("Dictation session", () => {
	it("drains queued audio before finalizing and releases microphone immediately on stop", async () => {
		const h = harness();
		const answer = deferred<string>();
		h.backend.dictationAudio.mockReturnValueOnce(answer.promise);
		await h.session.start("/model", "medium", 10);
		h.audio();
		h.audio(800);
		const stopped = h.session.finish();
		expect(h.microphone.stop).toHaveBeenCalledOnce();
		expect(h.backend.stopDictation).not.toHaveBeenCalled();
		answer.resolve("Hello");
		await stopped;
		expect(h.backend.dictationAudio).toHaveBeenCalledTimes(2);
		expect(h.options.apply).toHaveBeenLastCalledWith("Hello there.");
		expect(h.session.active).toBe(false);
	});
	it("discards late recognition replies after cancellation", async () => {
		const h = harness();
		const reply = deferred<string>();
		h.backend.dictationAudio.mockReturnValueOnce(reply.promise);
		await h.session.start("/model", "medium", 0);
		h.audio();
		h.session.cancel();
		reply.resolve("Late words");
		await tick();
		expect(h.options.apply).not.toHaveBeenCalled();
		expect(h.microphone.stop).toHaveBeenCalledOnce();
	});
	it("closes a microphone permission result that arrives after startup was cancelled", async () => {
		const h = harness();
		const mic = deferred<Microphone>();
		h.options.capture.mockReturnValueOnce(mic.promise);
		const started = h.session.start("/model", "medium", 0);
		await tick();
		await h.session.finish();
		mic.resolve(h.microphone);
		await started;
		expect(h.microphone.stop).toHaveBeenCalledOnce();
		expect(h.session.active).toBe(false);
	});
	it("cancels loading before requesting microphone permission", async () => {
		const h = harness();
		const loaded = deferred<void>();
		h.backend.startDictation.mockReturnValueOnce(loaded.promise);
		const started = h.session.start("/model", "medium", 0);
		await h.session.finish();
		loaded.resolve();
		await started;
		expect(h.options.capture).not.toHaveBeenCalled();
	});
	it("stops on denied permission, decoder failure, disconnect and editor ownership errors", async () => {
		for (const failure of ["permission", "decoder", "disconnect", "editor"]) {
			const h = harness();
			if (failure === "permission") h.options.capture.mockRejectedValueOnce(new Error("Permission denied"));
			if (failure === "decoder") h.backend.dictationAudio.mockRejectedValueOnce(new Error("Decode failed"));
			if (failure === "editor")
				h.options.apply.mockImplementation(() => {
					throw new Error("Note edited");
				});
			await h.session.start("/model", "medium", 0);
			if (failure === "disconnect") h.ended();
			else if (failure !== "permission") h.audio();
			await tick();
			expect(h.session.active).toBe(false);
			expect(h.options.error).toHaveBeenCalledOnce();
			expect(h.backend.stop).toHaveBeenCalled();
		}
	});
	it("caps buffered audio instead of silently dropping words", async () => {
		const h = harness();
		const reply = deferred<string>();
		h.backend.dictationAudio.mockReturnValueOnce(reply.promise);
		await h.session.start("/model", "tiny", 0);
		h.audio();
		h.audio(320001);
		expect(h.session.active).toBe(false);
		expect(h.options.error).toHaveBeenCalledWith(expect.stringContaining("keep up"));
		reply.resolve("");
		await tick();
	});
	it("auto-stops after transcript inactivity, and disables the timer at zero", async () => {
		const h = harness();
		await h.session.start("/model", "medium", 2);
		h.timeout(1000);
		expect(h.session.active).toBe(true);
		h.audio();
		await tick();
		h.timeout(2500);
		expect(h.session.active).toBe(true);
		h.timeout(3100);
		await tick();
		expect(h.session.active).toBe(false);
		const off = harness();
		await off.session.start("/model", "tiny", 0);
		expect(off.options.setTimer).not.toHaveBeenCalled();
		off.session.cancel();
	});
});

describe("Microphone level", () => {
	it("follows RMS volume, independent of signal sign, with bounded output", () => {
		expect(microphoneLevel(new Float32Array())).toBe(0);
		expect(microphoneLevel(new Float32Array(32))).toBe(0);
		expect(microphoneLevel(new Float32Array([0.05, -0.05]))).toBeCloseTo(0.4);
		expect(microphoneLevel(new Float32Array([1, -1]))).toBe(1);
	});
});

describe("Dictation review regressions", () => {
	it("ignores permission-prompt and loading blur, but finalizes blur while recording", async () => {
		const h = harness();
		const loaded = deferred<void>();
		const mic = deferred<Microphone>();
		h.backend.startDictation.mockReturnValueOnce(loaded.promise);
		h.options.capture.mockReturnValueOnce(mic.promise);
		const started = h.session.start("/model", "medium", 0);
		h.session.blur();
		expect(h.session.active).toBe(true);
		loaded.resolve();
		await tick();
		h.session.blur();
		expect(h.session.active).toBe(true);
		mic.resolve(h.microphone);
		await started;
		h.session.blur();
		await tick();
		expect(h.options.apply).toHaveBeenLastCalledWith("Hello there.");
		expect(h.session.active).toBe(false);
	});
	it("reports an explicit stop during startup", async () => {
		const h = harness();
		const loaded = deferred<void>();
		h.backend.startDictation.mockReturnValueOnce(loaded.promise);
		const started = h.session.start("/model", "medium", 0);
		await h.session.finish();
		expect(h.options.cancelled).toHaveBeenCalledOnce();
		loaded.resolve();
		await started;
	});
	it("takes the editor snapshot only when permission and the start chime have finished", async () => {
		const h = harness();
		const sound = deferred<void>();
		h.options.chime.mockReturnValueOnce(sound.promise);
		const started = h.session.start("/model", "medium", 0);
		await tick();
		h.audio();
		expect(h.backend.dictationAudio).not.toHaveBeenCalled();
		expect(h.options.ready).not.toHaveBeenCalled();
		expect(h.microphone.start).not.toHaveBeenCalled();
		sound.resolve();
		await started;
		expect(h.options.ready).toHaveBeenCalledOnce();
		expect(h.microphone.start).toHaveBeenCalledOnce();
		h.audio();
		await tick();
		expect(h.backend.dictationAudio).toHaveBeenCalledOnce();
		h.session.cancel();
	});
	it("releases the microphone when cancelled during the chime and ignores late readiness", async () => {
		const h = harness();
		const sound = deferred<void>();
		h.options.chime.mockReturnValueOnce(sound.promise);
		const started = h.session.start("/model", "medium", 0);
		await tick();
		await h.session.finish();
		expect(h.microphone.stop).toHaveBeenCalledOnce();
		sound.resolve();
		await started;
		expect(h.options.ready).not.toHaveBeenCalled();
	});
	it.each([16000, 44100, 48000, 96000])(
		"buffers a slow recognition pass and drains bounded ordered chunks at %i Hz",
		async (rate) => {
			const h = harness();
			const answer = deferred<string>();
			h.backend.dictationAudio.mockReturnValueOnce(answer.promise);
			await h.session.start("/model", "medium", 0);
			h.audio(rate / 10, rate);
			for (let second = 0; second < 12; second++) h.audio(rate, rate);
			expect(h.session.active).toBe(true);
			const stopped = h.session.finish();
			answer.resolve("Hello");
			await stopped;
			const calls = h.backend.dictationAudio.mock.calls;
			expect(calls.every(([samples, sampleRate]) => samples.length <= rate * 2 && sampleRate === rate)).toBe(
				true,
			);
			expect(calls.reduce((sum, [samples]) => sum + samples.length, 0)).toBe(rate * 12.1);
			expect(h.options.error).not.toHaveBeenCalled();
		},
	);
});

it("preserves sample order when draining a buffer spanning multiple requests", async () => {
	const h = harness();
	const reply = deferred<string>();
	h.backend.dictationAudio.mockReturnValueOnce(reply.promise);
	await h.session.start("/model", "medium", 0);
	h.audio(1600, 16000, 0.1);
	// Different amplitudes expose reordering while splitting and combining capture frames.
	h.audio(50000, 16000, 0.2);
	h.audio(30000, 16000, 0.3);
	const stopped = h.session.finish();
	reply.resolve("Hello");
	await stopped;
	expect(h.backend.dictationAudio.mock.calls.map(([audio]) => audio.length)).toEqual([1600, 32000, 32000, 16000]);
	const chunks = h.backend.dictationAudio.mock.calls.map(([audio]) => audio);
	const value = (number: number) => new Float32Array([number])[0];
	expect(chunks[1].every((sample) => sample === value(0.2))).toBe(true);
	expect(chunks[2].subarray(0, 18000).every((sample) => sample === value(0.2))).toBe(true);
	expect(chunks[2].subarray(18000).every((sample) => sample === value(0.3))).toBe(true);
	expect(chunks[3].every((sample) => sample === value(0.3))).toBe(true);
});
