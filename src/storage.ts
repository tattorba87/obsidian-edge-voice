import { existsSync, promises as fs } from "fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "path";

/** Something on disk the person can delete: a voice or a model family. */
export interface StorageItem {
	id: string;
	label: string;
	description: string;
	paths: string[];
	/** The folder it was found in; deleting never reaches outside it. */
	root: string;
	bytes: number;
}

// Moonshine's cache mirrors its CDN: <cache>/download.moonshine.ai/tts/...
const TTS_DIR = join("download.moonshine.ai", "tts");

/** Sizes of everything under `dir`, file by file, relative to it. */
async function filesUnder(dir: string): Promise<Map<string, number>> {
	const sizes = new Map<string, number>();
	if (!existsSync(dir)) return sizes;
	const walk = async (current: string) => {
		for (const entry of await fs.readdir(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) sizes.set(relative(dir, path), (await fs.stat(path)).size);
		}
	};
	await walk(dir);
	return sizes;
}

/** The name a Piper voice's files share: en_US-lessac-medium.generator.model.ort → en_US-lessac-medium. */
function piperStem(file: string): string {
	return file.replace(/(\.(upstream|generator))?(\.(model|weights))?\.(ort|onnx\.json|onnx)$/, "");
}

/**
 * What the speech engine has downloaded, grouped the way a person thinks of it:
 * each Piper voice, the Kokoro voices, the voice-cloning models, and each
 * language's pronunciation data. Largest first.
 */
export async function scanVoices(cacheDir: string): Promise<StorageItem[]> {
	const root = join(cacheDir, TTS_DIR);
	const groups = new Map<string, StorageItem>();
	const add = (id: string, label: string, description: string, path: string, bytes: number) => {
		const item = groups.get(id) ?? { id, label, description, paths: [], root, bytes: 0 };
		item.paths.push(path);
		item.bytes += bytes;
		groups.set(id, item);
	};
	for (const [file, bytes] of await filesUnder(root)) {
		const parts = file.split(sep);
		const path = join(root, file);
		if (parts[0] === "kokoro") {
			add("kokoro", "Kokoro voices", "The Kokoro model and its voices.", path, bytes);
		} else if (parts[0] === "zipvoice" || parts[0] === "clone_asr") {
			add(
				"cloning",
				"Voice cloning models",
				"ZipVoice and the speech recognizer it uses. Edge Voice doesn't need these.",
				path,
				bytes,
			);
		} else if (parts[1] === "piper-voices") {
			const stem = piperStem(parts[2] ?? file);
			add(`piper:${stem}`, `Piper voice ${stem}`, `A Piper voice for ${parts[0]}.`, path, bytes);
		} else {
			add(
				`language:${parts[0]}`,
				`Pronunciation data (${parts[0]})`,
				"Shared by every voice in this language.",
				path,
				bytes,
			);
		}
	}
	return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

/**
 * The faster engine's voice files on Apple silicon (the Kokoro model and its
 * voices, from Hugging Face), as one item, or null when there are none.
 */
export async function scanMlxVoices(hfDir: string): Promise<StorageItem | null> {
	const files = await filesUnder(hfDir);
	if (files.size === 0) return null;
	let bytes = 0;
	for (const size of files.values()) bytes += size;
	return {
		id: "mlx",
		label: "Faster engine voices",
		description:
			"The Kokoro model and voices the faster engine uses on Apple silicon. They download again when next used.",
		paths: [hfDir],
		root: hfDir,
		bytes,
	};
}

/**
 * Deletes the item's files. Each must be inside the item's root (or the root
 * itself) once links in the folders above it are resolved, so a wrong path or
 * a folder replaced by a link can't make it delete anything else. A link
 * inside the root is removed as a link; what it points to stays.
 */
export async function deleteItem(item: StorageItem): Promise<void> {
	const root = await fs.realpath(item.root).catch(() => null);
	if (!root) return; // Nothing there to delete.
	for (const path of item.paths) {
		// The root itself (the faster engine's voices) is deleted where it really is.
		const real = path === item.root ? root : await realLocation(path);
		if (!real) continue;
		if (!isWithin(real, root)) throw new Error(`Refusing to delete ${path}: it isn't inside ${item.root}.`);
		await fs.rm(real, { recursive: true, force: true });
	}
}

/** Where `path` really is: its folder with links resolved, and its own name (a link stays a link). */
async function realLocation(path: string): Promise<string | null> {
	const parent = await fs.realpath(dirname(path)).catch(() => null);
	return parent && join(parent, basename(path));
}

/** Whether `path` is `root` or inside it. */
function isWithin(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function formatBytes(bytes: number): string {
	if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
	if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
	return `${(bytes / 1e9).toFixed(1)} GB`;
}
