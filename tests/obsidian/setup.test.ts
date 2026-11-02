import { existsSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, PLUGIN, readerState, run, sandbox } from "./obsidian";

/** The engine folder the plugin would install into: the sandbox's HOME/.edge-voice. */
const ENGINE = join(sandbox.paths.freshHome, ".edge-voice");
const nothingInstalled = () => ["bin", "python", "venv"].every((part) => !existsSync(join(ENGINE, part)));

const SETUP_WINDOW = `document.querySelector(".modal .edge-voice-setup")`;

let python = "";

// As for someone who hasn't set up the engine: the plugin's Python doesn't exist.
beforeAll(() => {
	python = run<string>(`return ${PLUGIN}.settings.pythonPath;`);
	run(
		`${PLUGIN}.settings.pythonPath = "/nonexistent/python"; await ${PLUGIN}.saveSettings(); ${PLUGIN}.restartSidecar();`,
	);
});

afterAll(async () => {
	run(`
		document.querySelectorAll(".modal-container").forEach((modal) => modal.remove());
		${PLUGIN}.settings.pythonPath = ${JSON.stringify(python)};
		await ${PLUGIN}.saveSettings();
		await app.plugins.disablePlugin("edge-voice");
		await app.plugins.enablePlugin("edge-voice");
	`);
	await pause(500);
});

describe("Setting up the engine only when asked", () => {
	it("offers setup when enabled without an engine, and installs nothing", async () => {
		run(`
			document.querySelectorAll(".notice").forEach((notice) => notice.remove());
			await app.plugins.disablePlugin("edge-voice");
			await app.plugins.enablePlugin("edge-voice");
		`);
		await pause(1500);
		const notices = run<string[]>(
			`return [...document.querySelectorAll(".notice")].map((notice) => notice.textContent);`,
		);
		expect(notices.some((text) => text.includes("needs its speech engine"))).toBe(true);
		expect(nothingInstalled()).toBe(true);
	});

	it("opens the setup window on play, saying what will be downloaded, and installs nothing", async () => {
		openNote("A long note.md", "source");
		command("read-from-here");
		await pause(1000);
		const shown = run<{ text: string; buttons: string[] } | null>(`
			const window = ${SETUP_WINDOW};
			return window && {
				text: window.textContent,
				buttons: [...window.querySelectorAll(".modal-button-container button")].map((button) => button.textContent),
			};
		`);
		expect(shown).not.toBeNull();
		expect(shown!.text).toContain("What will be downloaded");
		expect(shown!.text).toContain("Where it goes");
		expect(shown!.buttons).toEqual(["Install", "Not now"]);
		expect(readerState()).toBe("idle");
		// Given time to start, had it been going to.
		await pause(2000);
		expect(nothingInstalled()).toBe(true);
	});

	it("closes on Not now, still having installed nothing", async () => {
		run(`
			[...${SETUP_WINDOW}.querySelectorAll("button")].find((button) => button.textContent === "Not now").click();
		`);
		await pause(300);
		expect(run<boolean>(`return !!${SETUP_WINDOW};`)).toBe(false);
		expect(nothingInstalled()).toBe(true);
		expect(errors()).toEqual([]);
	});
});
