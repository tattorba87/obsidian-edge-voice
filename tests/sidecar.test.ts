import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, Sidecar } from "../src/sidecar";

const FAKE_SERVER = fileURLToPath(new URL("./fixtures/fake_server.py", import.meta.url));
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
			rmSync(dir, { recursive: true, force: true });
			rmSync(planted, { recursive: true, force: true });
		}
	});
});
