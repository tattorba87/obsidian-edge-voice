import { existsSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { command, errors, openNote, pause, PLUGIN, readerState, run, sandbox } from "./obsidian";

/** The sandbox's HOME/.edge-voice: Edge Voice must never create anything in it. */
const HOME = join(sandbox.paths.freshHome, ".edge-voice");
const nothingInstalled = () => ["engine", "bin", "python", "venv", "hf"].every((part) => !existsSync(join(HOME, part)));

const SETUP_WINDOW = `document.querySelector(".modal .edge-voice-setup")`;

let python = "";

// As for someone who hasn't set up the engine: the plugin's Python doesn't exist.
beforeAll(() => {
	python = run<string>(`return ${PLUGIN}.settings.pythonPath;`);
	run(
		`${PLUGIN}.settings.pythonPath = "/nonexistent/python"; await ${PLUGIN}.saveSettings(); await ${PLUGIN}.checkEngine();`,
	);
});

afterAll(async () => {
	run(`
		document.querySelectorAll(".modal-container").forEach((modal) => modal.remove());
		document.querySelectorAll(".notice").forEach((notice) => notice.remove());
		${PLUGIN}.settings.pythonPath = ${JSON.stringify(python)};
		await ${PLUGIN}.saveSettings();
		await app.plugins.disablePlugin("edge-voice");
		await app.plugins.enablePlugin("edge-voice");
	`);
	await pause(500);
});

describe("Without an engine, Edge Voice shows how to set it up and installs nothing", () => {
	it("says so when enabled, and installs nothing", async () => {
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

	it("shows the setup steps on play, each command with a Copy button, and installs nothing", async () => {
		openNote("A long note.md", "source");
		command("read-from-here");
		await pause(1000);
		const shown = run<{ text: string; commands: string[]; copies: number; buttons: string[] } | null>(`
			const window = ${SETUP_WINDOW};
			return window && {
				text: window.textContent,
				commands: [...window.querySelectorAll(".edge-voice-command")].map((code) => code.textContent),
				copies: [...window.querySelectorAll(".edge-voice-command-box button")].length,
				buttons: [...window.querySelectorAll(".modal-button-container button")].map((button) => button.textContent),
			};
		`);
		expect(shown).not.toBeNull();
		expect(shown!.text).toContain("Obsidian plugins can't install programs");
		expect(shown!.commands).toHaveLength(3);
		expect(shown!.commands[0]).toMatch(/^uv venv --clear --managed-python /);
		expect(shown!.commands[1]).toMatch(
			/--require-hashes --no-build -r https:\/\/github\.com\/.*\/requirements-darwin-/,
		);
		expect(shown!.commands[2]).toContain("edge-voice-engine voices get kokoro_af_bella");
		expect(shown!.copies).toBe(3);
		expect(shown!.buttons).toEqual(["Check again", "Close"]);
		expect(readerState()).toBe("idle");
		// Given time to start anything, had it been going to.
		await pause(2000);
		expect(nothingInstalled()).toBe(true);
	});

	it("checks again on request, and still finds nothing", async () => {
		run(
			`[...${SETUP_WINDOW}.querySelectorAll("button")].find((button) => button.textContent === "Check again").click();`,
		);
		await pause(1000);
		const message = run<string>(`return ${SETUP_WINDOW}.querySelector(".edge-voice-setup-message").textContent;`);
		expect(message).toContain("No engine found yet");
	});

	it("closes, having installed nothing", async () => {
		run(
			`[...${SETUP_WINDOW}.querySelectorAll("button")].find((button) => button.textContent === "Close").click();`,
		);
		await pause(300);
		expect(run<boolean>(`return !!${SETUP_WINDOW};`)).toBe(false);
		expect(nothingInstalled()).toBe(true);
		expect(errors()).toEqual([]);
	});
});
