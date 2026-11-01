import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errors, PLUGIN, run, setSettings } from "./obsidian";

/** Code that finds a setting on Edge Voice's settings screen by its name. */
const SETTING = (name: string) =>
	`([...window.edgeVoiceTab.containerEl.querySelectorAll(".setting-item")]` +
	`.find((item) => item.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(name)}))`;

// Edge Voice's own settings tab, drawn off-screen in the main window. Opening Obsidian's
// settings from code (app.setting.open) leaves an empty window and stops Obsidian answering.
beforeAll(() => {
	run(`
		const tab = app.setting.pluginTabs.find((candidate) => candidate.id === "edge-voice");
		if (!tab) throw new Error("Edge Voice's settings tab isn't registered");
		tab.containerEl.style.cssText = "position: fixed; left: -10000px; top: 0; width: 700px;";
		document.body.appendChild(tab.containerEl);
		tab.display();
		window.edgeVoiceTab = tab;
	`);
});

afterAll(() => {
	run(`window.edgeVoiceTab.containerEl.remove(); delete window.edgeVoiceTab;`);
	setSettings({
		highlightTheme: "amber",
		inBackground: "visible",
		doubleTapEnabled: false,
		doubleTapCustomKey: null,
	});
});

describe("Edge Voice settings in Obsidian", () => {
	it("applies a highlight colour as soon as it's picked", () => {
		const result = run<{ theme: string; accent: string }>(`
			${SETTING("Highlight colour")}.querySelector('.edge-voice-swatch[aria-label="Blue"]').click();
			return {
				theme: ${PLUGIN}.settings.highlightTheme,
				accent: document.body.style.getPropertyValue("--edge-voice-accent").trim(),
			};
		`);
		expect(result).toEqual({ theme: "blue", accent: "20, 100, 230" });
	});

	it("saves the choice of what happens in the background", () => {
		const saved = run<string>(`
			const select = ${SETTING("When Obsidian is in the background")}.querySelector("select");
			select.value = "pause";
			select.dispatchEvent(new Event("change"));
			return ${PLUGIN}.settings.inBackground;
		`);
		expect(saved).toBe("pause");
	});

	it("records a custom double-tap key: refuses a letter, saves F13", () => {
		const steps = run<{ refused: string; saveAfterLetter: boolean; saveAfterF13: boolean; key: string }>(`
			const item = ${SETTING("Double-tap shortcut")};
			item.querySelector(".checkbox-container").click();
			const menu = item.querySelector("select.edge-voice-key-menu");
			menu.value = "custom";
			menu.dispatchEvent(new Event("change"));
			const capture = item.querySelector(".edge-voice-key-capture");
			const save = [...item.querySelectorAll("button")].find((button) => button.textContent === "Save");
			const press = (code) => capture.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
			capture.focus();
			press("KeyA");
			const refused = item.querySelector(".edge-voice-key-message").textContent;
			const saveAfterLetter = !save.disabled;
			press("F13");
			const saveAfterF13 = !save.disabled;
			save.click();
			return { refused, saveAfterLetter, saveAfterF13, key: ${PLUGIN}.settings.doubleTapKey };
		`);
		expect(steps.refused).toMatch(/types or moves the cursor/);
		expect(steps.saveAfterLetter).toBe(false);
		expect(steps.saveAfterF13).toBe(true);
		expect(steps.key).toBe("F13");
		expect(errors()).toEqual([]);
	});

	it("says why when the voice list can't be had, without freezing Obsidian", () => {
		// As for someone whose engine isn't set up yet. This used to hang Obsidian at 100% CPU:
		// the failure path returned a Setting, whose then() method a promise keeps calling.
		const description = run<string>(`
			const tab = window.edgeVoiceTab;
			const real = tab.plugin.sidecar.voices;
			tab.plugin.sidecar.voices = () => Promise.reject(new Error("the engine isn't set up"));
			tab.display();
			await new Promise((done) => setTimeout(done, 500));
			tab.plugin.sidecar.voices = real;
			return ${SETTING("Voice")}.querySelector(".setting-item-description").textContent;
		`);
		expect(description).toBe("Could not list voices: the engine isn't set up");
		expect(run<number>(`return 1 + 1;`)).toBe(2);
	});
});
