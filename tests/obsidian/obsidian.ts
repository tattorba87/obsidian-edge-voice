/**
 * What the tests against real Obsidian use to drive the sandbox the global
 * setup opened: run code inside Obsidian, read what the fake engine was asked
 * to say, and check for errors.
 */
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { Sandbox } from "../../scripts/sandbox/obsidian";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));
export const sandbox = new Sandbox(REPO, ".sandbox-test", (message) =>
	process.stderr.write(`obsidian tests: ${message}\n`),
);
/** Where the fake engine logs every request (EDGE_VOICE_FAKE_LOG). */
export const REQUESTS = join(sandbox.paths.root, "requests.log");

/**
 * Runs `body`, the inside of an async function, in Obsidian (`app` is
 * Obsidian's), and returns its result. Values go through JSON, so return
 * plain data.
 */
export function run<T>(body: string): T {
	const out = sandbox.eval(`(async () => { ${body} })().then((value) => JSON.stringify(value ?? null))`);
	return JSON.parse(out) as T;
}

/** Errors Obsidian captured since the last call, or an empty list; clears them. */
export function errors(): string[] {
	const out = sandbox.cli("dev:errors");
	sandbox.cli("dev:errors", "clear");
	return out.startsWith("No errors") ? [] : [out];
}

/** The texts the fake engine was asked to synthesize, oldest first; `clear` starts the log afresh. */
export function spoken(clear = false): string[] {
	if (!existsSync(REQUESTS)) return [];
	const texts = readFileSync(REQUESTS, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { op: string; text?: string })
		.filter((request) => request.op === "synth")
		.map((request) => request.text ?? "");
	if (clear) rmSync(REQUESTS, { force: true });
	return texts;
}

/** Stops any reading and opens `path` in `mode` ("source" for editing, "preview" for Reading view). */
export function openNote(path: string, mode: "source" | "preview"): void {
	run(`
		app.commands.executeCommandById("edge-voice:stop");
		const leaf = app.workspace.getMostRecentLeaf();
		await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(path)}, mode: ${JSON.stringify(mode)} } });
		await new Promise((done) => setTimeout(done, 300));
	`);
}

/** Stops any reading and opens `path` (a PDF, say) in its usual view, waiting `settle` ms for it to render. */
export function openFile(path: string, settle = 1500): void {
	run(`
		app.commands.executeCommandById("edge-voice:stop");
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
		await app.workspace.getMostRecentLeaf().openFile(file);
		await new Promise((done) => setTimeout(done, ${settle}));
	`);
}

/** Runs a command of the plugin's, e.g. "read-from-here" or "next". */
export function command(id: string): void {
	run(`app.commands.executeCommandById(${JSON.stringify(`edge-voice:${id}`)});`);
}

/** The text under the sentence highlight in the open note: CodeMirror marks in the editor, CSS highlights in Reading view. */
export const HIGHLIGHTED = `
	const marks = [...document.querySelectorAll(".workspace-leaf.mod-active .cm-content .edge-voice-sentence")];
	const highlight = CSS.highlights.get("edge-voice-sentence");
	const rendered = highlight ? [...highlight].map((range) => range.toString()).join(" ") : "";
	return marks.map((mark) => mark.textContent).join("") || rendered;
`;

/** The words of `text`, lower-cased, for comparing rendered text with what the voice was asked to say. */
export const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** Polls `read` until it returns something, for up to `ms`. */
export async function until<T>(read: () => T, ms = 10000): Promise<T | undefined> {
	for (let waited = 0; waited < ms; waited += 200) {
		const value = read();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 200));
	}
	return undefined;
}
