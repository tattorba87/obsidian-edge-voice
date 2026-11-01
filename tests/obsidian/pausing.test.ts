import { afterEach, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, readerState, run, setSettings } from "./obsidian";

/** Starts reading "A long note" in Live Preview and waits until it's under way. */
async function startReading(): Promise<void> {
	openNote("A long note.md", "source");
	command("read-from-here");
	await pause(600);
	expect(["loading", "playing"]).toContain(readerState());
}

const reading = () => ["loading", "playing"].includes(readerState());

/**
 * Tells the plugin the window lost focus, or is hidden, as Obsidian would on
 * switching to another app or minimizing: the same properties and events,
 * raised from inside. Truly hiding the app would mean scripting macOS, which
 * on a developer's Mac would hide their own Obsidian too.
 */
async function leave(hidden: boolean): Promise<void> {
	run(`
		document.hasFocus = () => false;
		Object.defineProperty(document, "visibilityState", { configurable: true, get: () => ${hidden ? '"hidden"' : '"visible"'} });
		window.dispatchEvent(new Event("blur"));
		document.dispatchEvent(new Event("visibilitychange"));
	`);
	// The plugin checks a moment after the event, since focus passes between windows through a blur.
	await pause(400);
}

afterEach(() => {
	run(`delete document.hasFocus; delete document.visibilityState;`);
	command("stop");
	setSettings({ pauseOnPageSwitch: true, inBackground: "visible" });
	run(`
		for (const leaf of app.workspace.getLeavesOfType("markdown").slice(1)) leaf.detach();
	`);
});

describe("Pausing when switching pages", () => {
	it("pauses when another note opens in its place", async () => {
		await startReading();
		run(`await app.workspace.getMostRecentLeaf().openFile(app.vault.getAbstractFileByPath("Welcome.md"));`);
		await pause(300);
		expect(readerState()).toBe("paused");
		expect(errors()).toEqual([]);
	});

	it("pauses when another tab is opened", async () => {
		await startReading();
		run(`await app.workspace.getLeaf("tab").openFile(app.vault.getAbstractFileByPath("Welcome.md"));`);
		await pause(300);
		expect(readerState()).toBe("paused");
	});

	it("keeps reading when a sidebar is opened", async () => {
		await startReading();
		run(`
			const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
			app.workspace.setActiveLeaf(explorer, { focus: true });
		`);
		await pause(300);
		expect(reading()).toBe(true);
	});

	it("keeps reading on another note when that's turned off", async () => {
		setSettings({ pauseOnPageSwitch: false });
		await startReading();
		run(`await app.workspace.getMostRecentLeaf().openFile(app.vault.getAbstractFileByPath("Welcome.md"));`);
		await pause(300);
		expect(reading()).toBe(true);
	});
});

describe("Pausing in the background", () => {
	it("keeps reading while Obsidian is visible, by default", async () => {
		await startReading();
		await leave(false);
		expect(reading()).toBe(true);
	});

	it("pauses once Obsidian is hidden, by default", async () => {
		await startReading();
		await leave(true);
		expect(readerState()).toBe("paused");
		expect(errors()).toEqual([]);
	});

	it("pauses as soon as Obsidian loses focus, when set to Pause", async () => {
		setSettings({ inBackground: "pause" });
		await startReading();
		await leave(false);
		expect(readerState()).toBe("paused");
	});

	it("keeps reading even when hidden, when set to Keep reading", async () => {
		setSettings({ inBackground: "always" });
		await startReading();
		await leave(true);
		expect(reading()).toBe(true);
	});
});
