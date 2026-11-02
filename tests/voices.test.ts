import { describe, expect, it } from "vitest";
import { megabytes, parseCatalog, VoiceInfo, voiceGroups, voiceLabel } from "../src/voices";

const voice = (id: string, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
	id,
	language: "en_us",
	name: id,
	accent: "American English",
	gender: "",
	engine: "Kokoro",
	quality: "",
	recommended: false,
	faster: false,
	installed: false,
	size: 0,
	download: 0,
	...extra,
});

describe("the voice catalog", () => {
	it("keeps only well-formed voices with real IDs, and fills in what's missing", () => {
		const parsed = parseCatalog([
			{ id: "kokoro_bf_emma", language: "en_gb", name: "Emma", recommended: true, download: 520000 },
			{ id: "../../etc/passwd", language: "en_us" },
			{ id: "kokoro_af_heart", language: "../x" },
			"kokoro_af_bella",
			null,
			{ id: "piper_en_US-ryan-high", language: "en_us", size: -5, download: "lots", installed: "yes" },
		]);
		expect(parsed.map((item) => item.id)).toEqual(["kokoro_bf_emma", "piper_en_US-ryan-high"]);
		expect(parsed[0]).toMatchObject({ language: "en_gb", name: "Emma", recommended: true, download: 520000 });
		expect(parsed[1]).toMatchObject({ name: "piper_en_US-ryan-high", size: 0, download: 0, installed: false });
		expect(parseCatalog(undefined)).toEqual([]);
	});

	it("names voices for people", () => {
		expect(voiceLabel(voice("kokoro_af_heart", { name: "Heart", gender: "female", engine: "Kokoro" }))).toBe(
			"Heart · American English · female · Kokoro",
		);
		expect(voiceLabel(voice("piper_en_US-ryan-high", { name: "Ryan", engine: "Piper", quality: "high" }))).toBe(
			"Ryan · American English · Piper · high quality",
		);
	});

	it("rounds sizes to megabytes, and small ones to under 1 MB", () => {
		expect(megabytes(84_400_000)).toBe("84 MB");
		expect(megabytes(520_000)).toBe("under 1 MB");
	});

	it("groups the voices to get: recommended first, then by engine and accent, leaving out installed ones", () => {
		const groups = voiceGroups([
			voice("kokoro_af_heart", { recommended: true, installed: true }),
			voice("kokoro_bf_emma", { recommended: true, accent: "British English" }),
			voice("kokoro_af_sky"),
			voice("kokoro_bf_lily", { accent: "British English" }),
			voice("piper_en_US-amy-low", { engine: "Piper" }),
		]);
		expect(groups.map((group) => [group.label, group.voices.map((item) => item.id)])).toEqual([
			["Recommended", ["kokoro_bf_emma"]],
			["Kokoro · American English", ["kokoro_af_sky"]],
			["Kokoro · British English", ["kokoro_bf_lily"]],
			["Piper · American English", ["piper_en_US-amy-low"]],
		]);
	});
});
