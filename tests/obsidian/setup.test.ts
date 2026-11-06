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
		expect(shown!.commands).toHaveLength(4);
		expect(shown!.commands[0]).toMatch(/^uv venv --clear --managed-python /);
		expect(shown!.commands[1]).toMatch(
			/--require-hashes --no-build -r https:\/\/github\.com\/.*\/requirements-darwin-/,
		);
		expect(shown!.commands[2]).toContain("edge-voice-engine voices get kokoro_af_bella");
		expect(shown!.commands[3]).toMatch(/edge-voice-engine models get (tiny|small|medium)$/);
		expect(shown!.copies).toBe(4);
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

describe("Dictation setup defaults and navigation", () => {
	it("turns dictation on for new installs only, keeps existing users' settings and avoids stealing a reading key", () => {
		const result = run<{
			fresh: boolean;
			savedOff: boolean;
			upgraded: boolean;
			freshSilence: number;
			oldDefault: number;
			chosen: number;
			custom: number;
			readingKey: string;
			dictationKey: string;
		}>(`
            const plugin=${PLUGIN}, settings=plugin.settings, load=plugin.loadData;
            try {
                plugin.loadData=async()=>null;await plugin.loadSettings();const fresh=plugin.settings.dictationEnabled;
                plugin.loadData=async()=>({dictationEnabled:false});await plugin.loadSettings();const savedOff=plugin.settings.dictationEnabled;
                // Settings saved by 0.1.5, before dictation existed.
                plugin.loadData=async()=>({voice:"kokoro_af_heart",speed:1});await plugin.loadSettings();const upgraded=plugin.settings.dictationEnabled;
                const freshSilence=(plugin.loadData=async()=>null,await plugin.loadSettings(),plugin.settings.dictationSilence);
                // 0.2.0 saved its default of 10 seconds; from 0.2.1 a saved value is the person's choice.
                plugin.loadData=async()=>({dictationSilence:10});await plugin.loadSettings();const oldDefault=plugin.settings.dictationSilence;
                plugin.loadData=async()=>({dictationSilence:10,settingsVersion:2});await plugin.loadSettings();const chosen=plugin.settings.dictationSilence;
                plugin.loadData=async()=>({dictationSilence:20});await plugin.loadSettings();const custom=plugin.settings.dictationSilence;
                plugin.loadData=async()=>({doubleTapEnabled:true,doubleTapKey:"MetaLeft"});await plugin.loadSettings();
                return {fresh,savedOff,upgraded,freshSilence,oldDefault,chosen,custom,readingKey:plugin.settings.doubleTapKey,dictationKey:plugin.settings.dictationKey};
            } finally {plugin.loadData=load;plugin.settings=settings;}
        `);
		expect(result.fresh).toBe(true);
		expect(result.savedOff).toBe(false);
		expect(result.upgraded).toBe(false);
		expect([result.freshSilence, result.oldDefault, result.chosen, result.custom]).toEqual([6, 6, 10, 20]);
		expect(result.readingKey).toBe("MetaLeft");
		expect(result.dictationKey).not.toBe(result.readingKey);
	});

	it("opens English dictation settings from the disabled notice", () => {
		const result = run<{ opened: boolean; section: boolean; text: string }>(`
            const plugin=${PLUGIN}, wasEnabled=plugin.settings.dictationEnabled;
            const controller=app.setting, popout=controller.shouldUsePopout;
            const tab=controller.pluginTabs.find(tab=>tab.id==="edge-voice"), style=tab.containerEl.style.cssText;
            try {
                // Keep the real settings modal in the test window rather than create a native popout.
                controller.shouldUsePopout=()=>false;tab.containerEl.style.cssText="";
                plugin.settings.dictationEnabled=false;
                app.commands.executeCommandById("edge-voice:toggle-dictation");
                const button=[...document.querySelectorAll(".notice button")].find(el=>el.textContent==="Open dictation settings");
                if(!button)throw new Error("Missing actionable dictation notice");
                button.click();await new Promise(done=>setTimeout(done,500));
                return {opened:controller.activeTab===tab,section:!!tab.containerEl.querySelector(".edge-voice-dictation-settings"),text:tab.containerEl.textContent};
            } finally {
                controller.close();controller.shouldUsePopout=popout;
                tab.containerEl.style.cssText=style;plugin.settings.dictationEnabled=wasEnabled;
            }
        `);
		expect(result.opened).toBe(true);
		expect(result.section).toBe(true);
		expect(result.text).toContain("Enable dictation");
	});
});
