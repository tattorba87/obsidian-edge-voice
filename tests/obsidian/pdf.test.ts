import { afterEach, describe, expect, it } from "vitest";
import { command, errors, openFile, run, spoken, until } from "./obsidian";

afterEach(() => command("stop"));

describe("Reading PDFs in Obsidian", () => {
	it("highlights the sentence with boxes on the page, and never reads the header, stamp or page numbers", async () => {
		openFile("PDFs/A short paper.pdf");
		spoken(true);
		command("read-from-here");
		const boxes = await until(() =>
			run<number>(`return document.querySelectorAll(".edge-voice-layer > div").length;`),
		);
		expect(boxes).toBeGreaterThan(0);
		// Skip through the first page, so every sentence on it is asked for.
		for (let i = 0; i < 8; i++) {
			command("next");
			await new Promise((done) => setTimeout(done, 150));
		}
		const texts = spoken();
		expect(texts.join(" ")).toContain("Reading along with audio");
		for (const text of texts) {
			expect(text).not.toContain("A Short Paper");
			expect(text).not.toContain("sandbox:0001");
			expect(text.trim()).not.toMatch(/^\d+$/);
		}
		expect(errors()).toEqual([]);
	});

	it("highlights every line of a sentence set with ligatures (fi), one box per line", async () => {
		openFile("PDFs/Ligatures.pdf");
		command("read-from-here");
		const lines = await until(() => {
			const boxes = run<{ top: number }[]>(`
				return [...document.querySelectorAll(".edge-voice-layer > .edge-voice-sentence")]
					.map((box) => ({ top: Math.round(box.getBoundingClientRect().top) }));
			`);
			return boxes.length >= 3 ? boxes : undefined;
		}, 15000);
		// Three lines, three boxes: the middle line ("signiﬁcantly") used to get none.
		expect(lines?.length).toBe(3);
		expect(new Set(lines?.map((box) => box.top)).size).toBe(3);
		expect(errors()).toEqual([]);
	});
});
