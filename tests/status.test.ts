// @vitest-environment happy-dom
import "./support/obsidian-dom";
import { afterEach, describe, expect, it } from "vitest";
import { StatusIndicator } from "../src/status";

afterEach(() => document.body.replaceChildren());
describe("Dictation status meter", () => {
	it("shows three input-driven bars and resets them to zero during silence", () => {
		const el = document.body.createDiv();
		const status = new StatusIndicator(el);
		status.show("dictating", "Dictating");
		expect(el.querySelectorAll(".edge-voice-eq-bar")).toHaveLength(3);
		expect(el.textContent).toBe("Dictating");
		expect(el.style.getPropertyValue("--edge-voice-input-level")).toBe("0");
		status.setInputLevel(0.8);
		expect(Number(el.style.getPropertyValue("--edge-voice-input-level"))).toBeGreaterThan(0.5);
		status.setInputLevel(0.01);
		expect(el.style.getPropertyValue("--edge-voice-input-level")).toBe("0");
		status.show("hidden");
		status.setInputLevel(1);
		expect(el.style.getPropertyValue("--edge-voice-input-level")).toBe("0");
	});
	it("does not change TTS's indicator state or accept invalid levels", () => {
		const el = document.body.createDiv();
		const status = new StatusIndicator(el);
		status.show("playing", "Reading");
		status.setInputLevel(1);
		expect(el.dataset.state).toBe("playing");
		expect(el.style.getPropertyValue("--edge-voice-input-level")).toBe("0");
		status.show("dictating", "Dictating");
		status.setInputLevel(Number.NaN);
		expect(el.style.getPropertyValue("--edge-voice-input-level")).toBe("0");
	});
});
