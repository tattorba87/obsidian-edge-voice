// @vitest-environment happy-dom
import "./support/obsidian-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerBar, PlayerControls, SPEEDS } from "../src/player-bar";

let bar: PlayerBar;
let minimized: boolean;

function controls(): PlayerControls {
	return {
		toggle: () => undefined,
		previous: () => undefined,
		next: () => undefined,
		stop: () => undefined,
		speed: () => 1,
		setSpeed: () => undefined,
		minimized: () => minimized,
		setMinimized: (value) => (minimized = value),
		volume: () => 1,
		setVolume: () => undefined,
	};
}

const element = () => document.querySelector<HTMLElement>(".edge-voice-bar")!;
const glowing = () => element().classList.contains("edge-voice-synthesizing");

beforeEach(() => {
	minimized = false;
	bar = new PlayerBar(controls());
});

afterEach(() => bar.destroy());

describe("Player bar", () => {
	it("is hidden until reading starts", () => {
		expect(element().hidden).toBe(true);
	});

	it("shows as soon as play is pressed, and glows while the voice loads or synthesizes", () => {
		bar.update("loading");
		expect(element().hidden).toBe(false);
		expect(glowing()).toBe(true);
	});

	it("stops glowing once audio plays, and glows again only while waiting", () => {
		bar.update("loading");
		bar.update("playing", "line 3");
		expect(glowing()).toBe(false);
		expect(element().textContent).toContain("line 3");
		bar.update("loading");
		expect(glowing()).toBe(true);
	});

	it("never uses Obsidian's is-loading class, which draws a progress bar over it", () => {
		bar.update("loading");
		expect(element().classList.contains("is-loading")).toBe(false);
	});

	it("stays while paused, and hides when reading stops", () => {
		bar.update("loading");
		bar.update("paused");
		expect(element().hidden).toBe(false);
		bar.update("idle");
		expect(element().hidden).toBe(true);
	});

	it("stays hidden when turned off in settings", () => {
		bar.setEnabled(false);
		bar.update("playing");
		expect(element().hidden).toBe(true);
	});

	it("offers only 1×, 1.5× and 2×", () => {
		expect(SPEEDS).toEqual([1, 1.5, 2]);
	});
});
