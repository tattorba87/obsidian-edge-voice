import { describe, expect, it } from "vitest";
import { startsReading, statusFor, toggleAction } from "../src/controls";

describe("Play and pause", () => {
	it("pauses while reading, and while waiting for the voice", () => {
		expect(toggleAction("playing", true, "button")).toBe("pause");
		expect(toggleAction("loading", true, "double-tap")).toBe("pause");
	});

	it("resumes on the page that was paused", () => {
		expect(toggleAction("paused", true, "button")).toBe("resume");
		expect(toggleAction("paused", true, "double-tap")).toBe("resume");
	});

	it("paused on another page: a button starts the page in front of you, a double tap stops", () => {
		expect(toggleAction("paused", false, "button")).toBe("restart");
		expect(toggleAction("paused", false, "double-tap")).toBe("stop");
	});

	it("starts reading when nothing is", () => {
		expect(toggleAction("idle", false, "button")).toBe("start");
	});

	it("chimes up when reading starts or resumes, down when it pauses or stops", () => {
		expect(startsReading(toggleAction("idle", false, "double-tap"))).toBe(true);
		expect(startsReading(toggleAction("paused", true, "double-tap"))).toBe(true);
		expect(startsReading(toggleAction("playing", true, "double-tap"))).toBe(false);
		expect(startsReading(toggleAction("paused", false, "double-tap"))).toBe(false);
	});
});

describe("Status bar", () => {
	it("shows the spinner and Synthesizing while waiting for the voice", () => {
		expect(statusFor("loading", "line 4", "1×")).toEqual(["busy", "Synthesizing · line 4 · 1×"]);
	});

	it("shows the moving bars and Reading while audio plays, resting bars while paused", () => {
		expect(statusFor("playing", "p. 2", "1.5×")).toEqual(["playing", "Reading · p. 2 · 1.5×"]);
		expect(statusFor("paused", undefined, "2×")).toEqual(["paused", "Paused · 2×"]);
	});

	it("hides when nothing is being read", () => {
		expect(statusFor("idle", "line 4", "1×")).toEqual(["hidden", ""]);
	});
});
