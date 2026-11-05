import { readFileSync, existsSync } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, PLUGIN, readerState, REQUESTS, run, setSettings, until } from "./obsidian";

const status = () => run<string>(`return document.querySelector(".edge-voice-status-text")?.textContent ?? "";`);
const engineRunning = () => run<boolean>(`return ${PLUGIN}.sidecar.running;`);
const loads = () =>
	existsSync(REQUESTS)
		? readFileSync(REQUESTS, "utf8")
				.split("\n")
				.filter(Boolean)
				.filter((line) => (JSON.parse(line) as { op: string }).op === "load").length
		: 0;

/** Reads "A long note" and pauses it, with unloading after `minutes` (shortened here to `ms`). */
async function readThenPause(minutes: number, ms: number): Promise<void> {
	setSettings({ unloadAfter: minutes });
	run(`${PLUGIN}.idle.options.minutes = () => ${minutes === 0 ? 0 : ms / 60000};`);
	openNote("A long note.md", "source");
	command("read-from-here");
	await until(() => readerState() === "playing");
	command("toggle");
	await until(() => readerState() === "paused");
	// Pausing leaves the sentences ahead being prepared (slowly, after other tests);
	// the plugin would then look again 15 seconds later. Start the countdown once it's quiet.
	await until(() => !run<boolean>(`return ${PLUGIN}.sidecar.busy;`), 20000);
	run(`${PLUGIN}.idle.reset();`);
}

afterEach(() => {
	command("stop");
	run(`${PLUGIN}.idle.options.minutes = () => ${PLUGIN}.settings.unloadAfter;`);
	setSettings({ unloadAfter: 0 });
});

describe("Freeing voice memory when idle", () => {
	it("unloads the engine after the set time paused, then reloads it on resume", async () => {
		await readThenPause(5, 400);
		expect(await until(() => status().startsWith("Unloading voice") || undefined, 3000)).toBe(true);
		expect(engineRunning()).toBe(false);
		// Back to the paused status once it's done.
		expect(await until(() => status().startsWith("Paused") || undefined, 4000)).toBe(true);

		const before = loads();
		command("toggle");
		await until(() => readerState() === "playing");
		expect(readerState()).toBe("playing");
		expect(engineRunning()).toBe(true);
		expect(loads()).toBeGreaterThan(before);
		expect(errors()).toEqual([]);
	});

	it("keeps the engine loaded when set to never, the default", async () => {
		await readThenPause(0, 0);
		await pause(1500);
		expect(engineRunning()).toBe(true);
		expect(status().startsWith("Paused")).toBe(true);
	});
});
