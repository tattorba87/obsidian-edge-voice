import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteItem, formatBytes, scanMlxVoices, scanVoices, StorageItem } from "../src/storage";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A Moonshine cache with the given files, each `bytes` long. */
function cache(files: Record<string, number>): string {
	dir = mkdtempSync(join(tmpdir(), "edge-voice-"));
	for (const [path, bytes] of Object.entries(files)) {
		const full = join(dir, "download.moonshine.ai", "tts", path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, Buffer.alloc(bytes));
	}
	return dir;
}

describe("storage", () => {
	it("groups downloads the way a person thinks of them, largest first", async () => {
		const root = cache({
			"kokoro/decoder.model.ort": 300,
			"kokoro/voices/af_heart.bin": 10,
			"en_us/piper-voices/en_US-lessac-medium.generator.model.ort": 100,
			"en_us/piper-voices/en_US-lessac-medium.onnx.json": 5,
			"en_us/piper-voices/en_US-ryan-high.upstream.weights.ort": 200,
			"en_us/oov/model.ort": 50,
			"zipvoice/vocoder.ort": 900,
			"clone_asr/encoder.ort": 100,
		});
		const items = await scanVoices(root);
		expect(items.map((item) => [item.label, item.bytes])).toEqual([
			["Voice cloning models", 1000],
			["Kokoro voices", 310],
			["Piper voice en_US-ryan-high", 200],
			["Piper voice en_US-lessac-medium", 105],
			["Pronunciation data (en_us)", 50],
		]);
	});

	it("deletes exactly one item's files", async () => {
		const root = cache({ "kokoro/a.ort": 1, "en_us/piper-voices/en_US-amy-low.onnx.json": 1 });
		const [kokoro] = (await scanVoices(root)).filter((item) => item.id === "kokoro");
		await deleteItem(kokoro);
		expect((await scanVoices(root)).map((item) => item.id)).toEqual(["piper:en_US-amy-low"]);
	});

	it("reports the faster engine's voices as one item, or nothing when there are none", async () => {
		dir = mkdtempSync(join(tmpdir(), "edge-voice-"));
		expect(await scanMlxVoices(join(dir, "missing"))).toBeNull();
		writeFileSync(join(dir, "kokoro.safetensors"), Buffer.alloc(2048));
		expect((await scanMlxVoices(dir))?.bytes).toBe(2048);
	});

	it("formats sizes", () => {
		expect(formatBytes(512)).toBe("1 KB");
		expect(formatBytes(84_000_000)).toBe("84 MB");
		expect(formatBytes(1_250_000_000)).toBe("1.3 GB");
	});
});

describe("deleting downloads", () => {
	// Symbolic links need extra rights on Windows; the boundary itself is tested everywhere.
	const links = it.skipIf(process.platform === "win32");

	/** A root folder with a voice file in it, and a precious file outside it. */
	function layout() {
		dir = mkdtempSync(join(tmpdir(), "edge-voice-delete-"));
		const root = join(dir, "root");
		const outside = join(dir, "outside");
		mkdirSync(join(root, "kokoro"), { recursive: true });
		mkdirSync(outside);
		writeFileSync(join(root, "kokoro", "voice.bin"), "voice");
		writeFileSync(join(outside, "precious.txt"), "keep me");
		return { root, outside };
	}

	const item = (root: string, paths: string[]): StorageItem => ({
		id: "test",
		label: "Test",
		description: "",
		paths,
		root,
		bytes: 0,
	});

	it("refuses a path outside its root, and deletes nothing there", async () => {
		const { root, outside } = layout();
		await expect(deleteItem(item(root, [join(root, "..", "outside", "precious.txt")]))).rejects.toThrow(
			/isn't inside/,
		);
		expect(existsSync(join(outside, "precious.txt"))).toBe(true);
	});

	links("refuses a path whose folder is a link to somewhere else", async () => {
		const { root, outside } = layout();
		symlinkSync(outside, join(root, "escape"));
		await expect(deleteItem(item(root, [join(root, "escape", "precious.txt")]))).rejects.toThrow(/isn't inside/);
		expect(existsSync(join(outside, "precious.txt"))).toBe(true);
	});

	links("removes a link inside the root as a link, leaving what it points to", async () => {
		const { root, outside } = layout();
		symlinkSync(outside, join(root, "kokoro", "linked"));
		await deleteItem(item(root, [join(root, "kokoro", "linked")]));
		expect(existsSync(join(root, "kokoro", "linked"))).toBe(false);
		expect(existsSync(join(outside, "precious.txt"))).toBe(true);
	});

	links("deletes the faster engine's voices where they really are when their folder is a link", async () => {
		const { root } = layout();
		const linked = join(dir, "hf");
		symlinkSync(root, linked);
		await deleteItem(item(linked, [linked]));
		expect(existsSync(join(root, "kokoro", "voice.bin"))).toBe(false);
	});
});
