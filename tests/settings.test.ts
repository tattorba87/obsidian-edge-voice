import { describe, expect, it } from "vitest";
import { clamp, isEngineId, savedSettings } from "../src/settings";

const DEFAULTS = { voice: "kokoro_af_bella", speed: 1, chime: true, customKey: null as string | null };

describe("Saved settings", () => {
	it("keeps values of the right type", () => {
		expect(
			savedSettings({ voice: "piper_en_US-lessac-medium", speed: 1.5, chime: false, customKey: "F13" }, DEFAULTS),
		).toEqual({
			voice: "piper_en_US-lessac-medium",
			speed: 1.5,
			chime: false,
			customKey: "F13",
		});
	});

	it("drops values of the wrong type, numbers that aren't finite, and keys it doesn't know", () => {
		expect(
			savedSettings({ voice: 5, speed: Number.NaN, chime: "yes", customKey: 3, pythonPath: "/x" }, DEFAULTS),
		).toEqual({});
		expect(savedSettings({ speed: Number.POSITIVE_INFINITY }, DEFAULTS)).toEqual({});
	});

	it("keeps null where the default is null", () => {
		expect(savedSettings({ customKey: null }, DEFAULTS)).toEqual({ customKey: null });
	});

	it("ignores saved data that isn't an object at all", () => {
		for (const saved of [null, undefined, "settings", 42, [1, 2]])
			expect(savedSettings(saved, DEFAULTS)).toEqual({});
	});
});

describe("Voice and language IDs", () => {
	it("accepts the engine's IDs, capitals included", () => {
		for (const id of ["kokoro_af_bella", "piper_en_US-lessac-medium", "en_us"]) expect(isEngineId(id)).toBe(true);
	});

	it("refuses anything that could become a path, or isn't a string", () => {
		for (const id of ["../x", "a/b", "a b", "", "x".repeat(101), 5, null]) expect(isEngineId(id)).toBe(false);
	});
});

describe("clamp", () => {
	it("keeps a number within its range", () => {
		expect([clamp(-1, 0, 1), clamp(0.5, 0, 1), clamp(9, 0, 1)]).toEqual([0, 0.5, 1]);
	});
});
