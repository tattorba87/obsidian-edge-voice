// @vitest-environment happy-dom
import "./support/obsidian-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Dictation microphone", () => {
	it("offers a start button while idle only when dictation is enabled", () => {
		bar.setDictationEnabled(true);
		bar.setDictationState("idle");
		expect(element().hidden).toBe(false);
		expect(element().querySelector(".edge-voice-microphone")?.getAttribute("aria-label")).toBe("Start dictation");
		expect(element().classList.contains("edge-voice-dictation-only")).toBe(false);
		bar.setDictationEnabled(false);
		expect(element().hidden).toBe(true);
	});
	it("the microphone starts and stops through the dictation control", () => {
		bar.destroy();
		const dictate = vi.fn();
		bar = new PlayerBar({ ...controls(), dictate });
		bar.setDictationEnabled(true);
		const microphone = element().querySelector<HTMLButtonElement>(".edge-voice-microphone")!;
		microphone.click();
		expect(dictate).toHaveBeenCalledOnce();
		bar.setDictationState("recording");
		expect(microphone.getAttribute("aria-pressed")).toBe("true");
		expect(microphone.getAttribute("aria-label")).toBe("Stop dictation");
		microphone.click();
		expect(dictate).toHaveBeenCalledTimes(2);
	});
	it("keeps the recording indicator visible even with playback controls disabled", () => {
		bar.setEnabled(false);
		bar.setDictationState("recording");
		expect(element().hidden).toBe(false);
		expect(element().classList.contains("edge-voice-recording")).toBe(true);
		expect(element().querySelector(".edge-voice-microphone")?.getAttribute("aria-label")).toBe("Stop dictation");
		bar.setDictationState("stopping");
		expect(element().querySelector<HTMLButtonElement>(".edge-voice-microphone")!.disabled).toBe(true);
		bar.setDictationState("idle");
		expect(element().hidden).toBe(true);
		expect(element().style.getPropertyValue("--edge-voice-mic-level")).toBe("0");
	});
	it("modulates and resets the glow from input level", () => {
		vi.useFakeTimers();
		try {
			bar.setDictationState("recording");
			bar.setMicrophoneLevel(0.8);
			vi.advanceTimersByTime(120);
			expect(Number(element().style.getPropertyValue("--edge-voice-mic-level"))).toBeGreaterThan(0.5);
			bar.setDictationState("idle");
			expect(element().style.getPropertyValue("--edge-voice-mic-level")).toBe("0");
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("Microphone animation scheduling", () => {
	it("stops scheduling frames once the level settles and resumes only on change", () => {
		vi.useFakeTimers();
		try {
			bar.setDictationState("recording");
			bar.setMicrophoneLevel(0.6);
			vi.advanceTimersByTime(2000);
			expect(vi.getTimerCount()).toBe(0);
			bar.setMicrophoneLevel(0.6);
			expect(vi.getTimerCount()).toBe(0);
			bar.setMicrophoneLevel(0.2);
			expect(vi.getTimerCount()).toBe(1);
			vi.advanceTimersByTime(2000);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	it("does not animate with reduced motion, and reacts to preference changes", () => {
		vi.useFakeTimers();
		bar.destroy();
		const motion = new EventTarget() as EventTarget & { matches: boolean };
		motion.matches = true;
		const original = window.matchMedia.bind(window);
		window.matchMedia = () => motion as MediaQueryList;
		try {
			bar = new PlayerBar(controls());
			bar.setDictationState("recording");
			bar.setMicrophoneLevel(0.7);
			expect(vi.getTimerCount()).toBe(0);
			motion.matches = false;
			motion.dispatchEvent(new Event("change"));
			expect(vi.getTimerCount()).toBe(1);
			motion.matches = true;
			motion.dispatchEvent(new Event("change"));
			expect(vi.getTimerCount()).toBe(0);
			bar.destroy();
			motion.matches = false;
			motion.dispatchEvent(new Event("change"));
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			window.matchMedia = original;
			vi.useRealTimers();
		}
	});
});

describe("Stable controls across reading and dictation", () => {
	it("keeps every playback control present and disables them throughout dictation", () => {
		bar.setDictationEnabled(true);
		const buttons = Array.from(element().querySelectorAll<HTMLButtonElement>("button"));
		for (const state of ["starting", "recording", "stopping"] as const) {
			bar.setDictationState(state);
			expect(Array.from(element().querySelectorAll("button"))).toEqual(buttons);
			for (const button of buttons) {
				const label = button.getAttribute("aria-label");
				if (label !== "Stop dictation" && label !== "Minimize") expect(button.disabled).toBe(true);
			}
			expect(element().querySelector<HTMLElement>(".edge-voice-volume")!.inert).toBe(true);
			expect(element().classList.contains("edge-voice-dictation-only")).toBe(false);
		}
		bar.setDictationState("idle");
		expect(buttons.every((button) => !button.disabled)).toBe(true);
	});
	it.each(["loading", "playing", "paused"] as const)("disables the mic during TTS %s until stopped", (state) => {
		bar.setDictationEnabled(true);
		bar.update(state);
		const mic = element().querySelector<HTMLButtonElement>(".edge-voice-microphone")!;
		expect(mic.disabled).toBe(true);
		bar.update("idle");
		expect(mic.disabled).toBe(false);
	});
	it("keeps the processing glow through dictation and resets it when both modes stop", () => {
		bar.update("loading");
		expect(glowing()).toBe(true);
		bar.setDictationState("recording");
		expect(glowing()).toBe(true);
		bar.update("idle");
		expect(glowing()).toBe(true);
		expect(element().classList.contains("edge-voice-recording")).toBe(true);
		bar.setDictationState("stopping");
		expect(glowing()).toBe(true);
		bar.setDictationState("idle");
		expect(glowing()).toBe(false);
	});
	it("blocks clicks and custom volume input while dictating", () => {
		bar.destroy();
		const reading = vi.fn(),
			volume = vi.fn();
		bar = new PlayerBar({ ...controls(), toggle: reading, setVolume: volume });
		bar.setDictationEnabled(true);
		bar.update("idle");
		bar.setDictationState("recording");
		element().querySelector<HTMLButtonElement>('[aria-label="Resume"]')!.click();
		element()
			.querySelector(".edge-voice-volume-track")!
			.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
		element()
			.querySelector(".edge-voice-volume")!
			.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
		expect(reading).not.toHaveBeenCalled();
		expect(volume).not.toHaveBeenCalled();
	});
});
