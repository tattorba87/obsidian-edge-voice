import { afterEach, describe, expect, it } from "vitest";
import { command, errors, HIGHLIGHTED, openNote, run, spoken, until, words } from "./obsidian";

afterEach(() => command("stop"));

/** Starts reading `path` in `mode` and returns the first highlighted text. */
async function startReading(mode: "source" | "preview"): Promise<string> {
	openNote("A long note.md", mode);
	spoken(true);
	command("read-from-here");
	return (await until(() => run<string>(HIGHLIGHTED))) ?? "";
}

describe("Reading notes in Obsidian", () => {
	it("loads without errors", () => {
		expect(run<boolean>(`return !!app.plugins.plugins["edge-voice"];`)).toBe(true);
		expect(errors()).toEqual([]);
	});

	it("highlights the sentence being read in Reading view", async () => {
		const highlighted = await startReading("preview");
		expect(highlighted).not.toBe("");
		// The highlight is on the sentence the voice was asked to say.
		expect(words(highlighted).slice(0, 4)).toEqual(words(spoken()[0] ?? "").slice(0, 4));
		expect(errors()).toEqual([]);
	});

	it("highlights the sentence being read in Live Preview", async () => {
		const highlighted = await startReading("source");
		expect(highlighted).not.toBe("");
		expect(words(highlighted).slice(0, 4)).toEqual(words(spoken()[0] ?? "").slice(0, 4));
		expect(errors()).toEqual([]);
	});

	it("keeps the highlight when switching to Live Preview and back mid-sentence", async () => {
		const before = await startReading("preview");
		for (const mode of ["source", "preview"]) {
			run(`
				const view = app.workspace.getMostRecentLeaf().view;
				await view.setState({ ...view.getState(), mode: ${JSON.stringify(mode)} }, { history: false });
			`);
			const after = (await until(() => run<string>(HIGHLIGHTED), 3000)) ?? "";
			expect(words(after).slice(0, 4)).toEqual(words(before).slice(0, 4));
		}
		expect(errors()).toEqual([]);
	});

	it("moves the highlight at once on a skip, before the voice is ready", async () => {
		const first = await startReading("source");
		command("next");
		// Well inside the fake voice's 0.3 s of synthesis.
		const next = await until(() => {
			const now = run<string>(HIGHLIGHTED);
			return now && words(now).join(" ") !== words(first).join(" ") ? now : "";
		}, 250);
		expect(next).toBeTruthy();
		expect(errors()).toEqual([]);
	});
});
