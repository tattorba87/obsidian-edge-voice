import { afterEach, describe, expect, it } from "vitest";
import { errors, openNote, run, spoken } from "./obsidian";

/** The words of `text`, lower-cased, for comparing rendered text with what the voice was asked to say. */
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** Polls `read` inside Obsidian until it returns something, for up to `ms`. */
async function until(read: () => string, ms = 10000): Promise<string> {
	for (let waited = 0; waited < ms; waited += 200) {
		const value = read();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 200));
	}
	return "";
}

afterEach(() => {
	run(`app.commands.executeCommandById("edge-voice:stop");`);
});

describe("Edge Voice in Obsidian", () => {
	it("loads without errors", () => {
		expect(run<boolean>(`return !!app.plugins.plugins["edge-voice"];`)).toBe(true);
		expect(errors()).toEqual([]);
	});

	it("highlights the sentence being read in Reading view", async () => {
		openNote("A long note.md", "preview");
		spoken(true);
		run(`app.commands.executeCommandById("edge-voice:read-from-here");`);
		// Rendered text is highlighted with the CSS Custom Highlight API, so read the ranges back.
		const highlighted = await until(() =>
			run<string>(`
				const highlight = CSS.highlights.get("edge-voice-sentence");
				return highlight ? [...highlight].map((range) => range.toString()).join(" ") : "";
			`),
		);
		expect(highlighted).not.toBe("");
		// The highlight is on the sentence the voice was asked to say.
		expect(words(highlighted).slice(0, 4)).toEqual(words(spoken()[0] ?? "").slice(0, 4));
		expect(errors()).toEqual([]);
	});

	it("highlights the sentence being read in Live Preview", async () => {
		openNote("A long note.md", "source");
		spoken(true);
		run(`app.commands.executeCommandById("edge-voice:read-from-here");`);
		// Editor text is highlighted with CodeMirror marks.
		const highlighted = await until(() =>
			run<string>(`
				const marks = [...document.querySelectorAll(".workspace-leaf.mod-active .cm-content .edge-voice-sentence")];
				return marks.map((mark) => mark.textContent).join("");
			`),
		);
		expect(highlighted).not.toBe("");
		expect(words(highlighted).slice(0, 4)).toEqual(words(spoken()[0] ?? "").slice(0, 4));
		expect(errors()).toEqual([]);
	});
});
