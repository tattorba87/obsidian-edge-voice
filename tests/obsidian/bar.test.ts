import { afterEach, describe, expect, it } from "vitest";
import { command, errors, openNote, run } from "./obsidian";

afterEach(() => command("stop"));

interface Sample {
	shown: boolean;
	glowing: boolean;
	/** The bar's ::before: Obsidian's .is-loading rule draws a progress bar there. */
	before: string;
	ring: string;
	status: string;
}

describe("Player bar in Obsidian", () => {
	it("glows while waiting for the voice, stops once audio plays, and shows nothing of Obsidian's over it", () => {
		openNote("A long note.md", "source");
		// Sampled inside Obsidian every 20 ms for 2 seconds: the press, the wait, then playing.
		const samples = run<Sample[]>(`
			app.commands.executeCommandById("edge-voice:read-from-here");
			const samples = [];
			for (let i = 0; i < 100; i++) {
				const bar = document.querySelector(".edge-voice-bar");
				const ring = bar?.querySelector(".edge-voice-glow-ring");
				samples.push({
					shown: !!bar && !bar.hidden,
					glowing: !!bar?.classList.contains("edge-voice-synthesizing"),
					before: bar ? getComputedStyle(bar, "::before").content : "",
					ring: ring ? getComputedStyle(ring).backgroundImage : "",
					status: document.querySelector(".edge-voice-status-text")?.textContent ?? "",
				});
				await new Promise((done) => setTimeout(done, 20));
			}
			return samples;
		`);
		const glowAt = samples.findIndex((sample) => sample.glowing);
		const playingAt = samples.findIndex((sample, i) => i > glowAt && !sample.glowing);
		expect(glowAt).toBeGreaterThanOrEqual(0);
		expect(samples[glowAt].shown).toBe(true);
		// The glow starts on the press; the status line follows as soon as the reader is waiting.
		expect(samples.some((sample) => sample.glowing && sample.status.startsWith("Synthesizing"))).toBe(true);
		// The glow is a real gradient in the highlight colour, not dropped as invalid.
		expect(samples[glowAt].ring).toMatch(/^conic-gradient/);
		expect(playingAt).toBeGreaterThan(glowAt);
		expect(samples[playingAt].status).toMatch(/^Reading/);
		// And it stays off while audio plays: prepared audio doesn't bring the glow back.
		expect(samples.slice(playingAt).some((sample) => sample.glowing)).toBe(false);
		expect(samples.every((sample) => sample.before === "none" || sample.before === "normal")).toBe(true);
		expect(errors()).toEqual([]);
	});
});
