import { describe, expect, it } from "vitest";
import { pausesInBackground } from "../src/background";

const window = (focused: boolean, hidden: boolean) => ({ focused, hidden });

describe("pausesInBackground", () => {
	it("pauses once no window has focus, when set to pause", () => {
		expect(pausesInBackground("pause", [window(false, false)])).toBe(true);
		expect(pausesInBackground("pause", [window(false, false), window(true, false)])).toBe(false);
	});

	it("keeps reading while any window is on screen, when set to visible", () => {
		expect(pausesInBackground("visible", [window(false, false)])).toBe(false);
		expect(pausesInBackground("visible", [window(false, true), window(false, false)])).toBe(false);
		expect(pausesInBackground("visible", [window(false, true), window(false, true)])).toBe(true);
	});

	it("never pauses when set to always", () => {
		expect(pausesInBackground("always", [window(false, true)])).toBe(false);
	});
});
