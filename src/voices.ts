import { isEngineId } from "./settings";

/** One voice the engine can get, as its catalog describes it (see the engine's catalog.py). */
export interface VoiceInfo {
	id: string;
	language: string;
	name: string;
	accent: string;
	gender: string;
	engine: string;
	quality: string;
	recommended: boolean;
	faster: boolean;
	installed: boolean;
	/** Bytes the voice takes in all, and what getting it would download now. */
	size: number;
	download: number;
}

/** Where to hear the voices before getting one: their own pages, opened in the browser. */
export const VOICE_SAMPLES = {
	Kokoro: "https://huggingface.co/spaces/hexgrad/Kokoro-TTS",
	Piper: "https://rhasspy.github.io/piper-samples/",
};

const text = (value: unknown): string => (typeof value === "string" ? value.slice(0, 80) : "");
const bytes = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/** The engine's catalog, keeping only well-formed entries with real voice and language IDs. */
export function parseCatalog(value: unknown): VoiceInfo[] {
	if (!Array.isArray(value)) return [];
	const voices: VoiceInfo[] = [];
	for (const item of value.slice(0, 1000)) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as Record<string, unknown>;
		if (!isEngineId(entry.id) || !isEngineId(entry.language)) continue;
		voices.push({
			id: entry.id,
			language: entry.language,
			name: text(entry.name) || entry.id,
			accent: text(entry.accent),
			gender: text(entry.gender),
			engine: text(entry.engine),
			quality: text(entry.quality),
			recommended: entry.recommended === true,
			faster: entry.faster === true,
			installed: entry.installed === true,
			size: bytes(entry.size),
			download: bytes(entry.download),
		});
	}
	return voices;
}

/** "Heart · American English · female · Kokoro". */
export function voiceLabel(voice: VoiceInfo): string {
	return [voice.name, voice.accent, voice.gender, voice.engine, voice.quality && `${voice.quality} quality`]
		.filter(Boolean)
		.join(" · ");
}

export function megabytes(size: number): string {
	return size < 1_000_000 ? "under 1 MB" : `${Math.round(size / 1_000_000)} MB`;
}

/** Voices not on this computer yet, grouped for a list: recommended first, then by engine and accent. */
export function voiceGroups(catalog: VoiceInfo[]): { label: string; voices: VoiceInfo[] }[] {
	const groups = new Map<string, VoiceInfo[]>();
	for (const voice of catalog) {
		if (voice.installed) continue;
		const label = voice.recommended ? "Recommended" : [voice.engine, voice.accent].filter(Boolean).join(" · ");
		groups.set(label, [...(groups.get(label) ?? []), voice]);
	}
	return [...groups].map(([label, voices]) => ({ label, voices }));
}
