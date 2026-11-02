import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, Sidecar } from "../src/sidecar";

const FAKE_SERVER = fileURLToPath(new URL("./fixtures/fake_server.py", import.meta.url));
const BAD_SERVER = fileURLToPath(new URL("./fixtures/bad_server.py", import.meta.url));
const PYTHON = process.platform === "win32" ? "python" : "python3";

let sidecar: Sidecar | undefined;
afterEach(() => sidecar?.stop());

describe("Sidecar", () => {
	it("loads, reports progress and synthesizes", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		const progress: number[] = [];
		sidecar.onProgress = (fraction) => progress.push(fraction);
		await sidecar.load("en_us", "any");
		expect(progress).toEqual([0.5]);
		const audio = await sidecar.synthesize("hello", 1);
		expect(audio.sampleRate).toBe(24000);
		expect(Array.from(audio.samples)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
		expect(await sidecar.cacheDir()).toBe("/tmp/cache");
	});

	it("asks for the faster engine and reports a fallback", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		expect(await sidecar.load("en_us", "kokoro_am_santa")).toEqual({ engine: "moonshine", fallback: undefined });
		expect(await sidecar.load("en_us", "kokoro_am_santa", "mlx")).toEqual({ engine: "mlx", fallback: undefined });
		expect(await sidecar.load("en_us", "piper_en_US-lessac-medium", "mlx")).toEqual({
			engine: "moonshine",
			fallback: "the faster engine only has Kokoro voices",
		});
	});

	it("answers requests in order", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		const lengths = await Promise.all(["slow one", "b", "cc"].map((text) => sidecar!.synthesize(text, 1)));
		expect(lengths.map((audio) => audio.samples.length)).toEqual([8, 1, 2]);
	});

	it("cancels a request still waiting its turn", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		const cancel = new AbortController();
		const first = sidecar.synthesize("slow first", 1);
		const second = sidecar.synthesize("second", 1, cancel.signal);
		const third = sidecar.synthesize("third", 1);
		await new Promise((resolve) => setTimeout(resolve, 50));
		cancel.abort();
		await expect(second).rejects.toBeInstanceOf(CancelledError);
		expect((await first).samples.length).toBe(10);
		expect((await third).samples.length).toBe(5);
	});

	it("passes engine errors through and keeps going", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		await expect(sidecar.synthesize("fail please", 1)).rejects.toThrow("cannot say that");
		expect((await sidecar.synthesize("ok", 1)).samples.length).toBe(2);
	});

	it("rejects when the interpreter can't start", async () => {
		sidecar = new Sidecar("/nonexistent/python", FAKE_SERVER);
		await expect(sidecar.synthesize("hi", 1)).rejects.toThrow(/Could not start/);
		expect(sidecar.running).toBe(false);
	});

	it("starts the engine isolated: no module next to the script or on PYTHONPATH is loaded", async () => {
		const dir = mkdtempSync(join(tmpdir(), "edge-voice-isolation-"));
		const planted = mkdtempSync(join(tmpdir(), "edge-voice-pythonpath-"));
		try {
			// Modules named like ones the server imports, which leave a marker if Python ever loads them.
			const plant = (folder: string, module: string) =>
				writeFileSync(
					join(folder, `${module}.py`),
					`open(${JSON.stringify(join(folder, `${module}-loaded`))}, "w").close()\n`,
				);
			copyFileSync(FAKE_SERVER, join(dir, "server.py"));
			plant(dir, "base64");
			plant(planted, "struct");
			vi.stubEnv("PYTHONPATH", planted);
			sidecar = new Sidecar(PYTHON, join(dir, "server.py"));
			expect((await sidecar.synthesize("ok", 1)).samples.length).toBe(2);
			expect(existsSync(join(dir, "base64-loaded"))).toBe(false);
			expect(existsSync(join(planted, "struct-loaded"))).toBe(false);
		} finally {
			vi.unstubAllEnvs();
			// Windows won't remove a folder a running process has as its working directory.
			sidecar?.stop();
			for (const folder of [dir, planted])
				rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
		}
	});
});

describe("Sidecar limits", () => {
	const limits = { startMs: 1500, answerMs: 1500, maxLine: 10_000 };

	/** A sidecar running the misbehaving engine in `mode` (see fixtures/bad_server.py). */
	function bad(mode: string): Sidecar {
		vi.stubEnv("EDGE_VOICE_BAD", mode);
		sidecar = new Sidecar(PYTHON, BAD_SERVER, limits);
		return sidecar;
	}

	afterEach(() => vi.unstubAllEnvs());

	it("gives up on an engine that never says it's ready", async () => {
		await expect(bad("silent").synthesize("hi", 1)).rejects.toThrow(/didn't start within 1.5 s/);
		expect(sidecar!.running).toBe(false);
	});

	it("restarts an engine that stops answering, failing what was waiting, not blocking it forever", async () => {
		const engine = bad("hang");
		const first = engine.synthesize("one", 1);
		const queued = engine.synthesize("two", 1);
		await expect(first).rejects.toThrow(/didn't answer within 1.5 s/);
		await expect(queued).rejects.toThrow(/didn't answer/);
		expect(engine.running).toBe(false);
	});

	it("gives loading a voice all the time it needs, since it may be downloading", async () => {
		const engine = bad("hang");
		let settled = false;
		void engine.load("en_us", "kokoro_af_bella").then(
			() => (settled = true),
			() => (settled = true),
		);
		await new Promise((done) => setTimeout(done, limits.answerMs * 2));
		expect(settled).toBe(false);
		expect(engine.running).toBe(true);
	});

	it("ends an engine whose reply never ends, instead of growing without bound", async () => {
		await expect(bad("huge").synthesize("hi", 1)).rejects.toThrow(/too large/);
	});

	it("refuses audio with an impossible sample rate, or that isn't whole samples", async () => {
		const engine = bad("bad-audio");
		await expect(engine.synthesize("rate", 1)).rejects.toThrow(/impossible sample rate/);
		await expect(engine.synthesize("half", 1)).rejects.toThrow(/whole samples/);
	});

	it("keeps only real voice IDs from the engine's list", async () => {
		expect(await bad("bad-voices").voices("en_us")).toEqual({
			present: ["kokoro_af_bella"],
			downloadable: ["piper_en_US-lessac-medium"],
		});
	});

	it("never sends the engine a voice ID that isn't one", async () => {
		sidecar = new Sidecar(PYTHON, FAKE_SERVER);
		await expect(sidecar.load("en_us", "../../etc/passwd")).rejects.toThrow(/Not a voice/);
		expect(sidecar.running).toBe(false);
	});
});
