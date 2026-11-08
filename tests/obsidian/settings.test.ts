import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errors, PLUGIN, run, setSettings, until } from "./obsidian";

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
		highlightTheme: "purple",
		inBackground: "visible",
		doubleTapEnabled: false,
		doubleTapCustomKey: null,
		dictationEnabled: false,
		dictationDoubleTapEnabled: true,
		dictationKey: "MetaLeft",
		dictationCustomKey: null,
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

	it("gives Obsidian's settings search every row, by name and alias", () => {
		const names = run<string[]>(`
			const out = [];
			const walk = (items) => {
				for (const item of items ?? []) {
					if (item.name) out.push(item.name, ...(item.aliases ?? []));
					walk(item.items);
				}
			};
			walk(window.edgeVoiceTab.getSettingDefinitions());
			return out;
		`);
		for (const name of [
			"Voice",
			"Get another voice",
			"Speed",
			"Highlight colour",
			"Highlight color",
			"Double-tap shortcut",
			"Downloaded voices",
			"Speech engine",
			"Python interpreter",
		])
			expect(names).toContain(name);
	});

	it("saves the choice of what happens in the background", () => {
		const saved = run<string>(`
			const select = ${SETTING("When Obsidian is in the background")}.querySelector("select");
			select.value = "pause";
			select.dispatchEvent(new Event("change"));
			// Obsidian saves a setting definition's control a moment after the change.
			await new Promise((done) => setTimeout(done, 200));
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

	it("lists downloads as the engine reports them, and copies a remove command instead of deleting", async () => {
		const read = () =>
			run<{ names: string[]; buttons: string[] } | null>(`
				const item = ${SETTING("Piper voice en_US-amy-low")};
				if (!item) return null;
				const storage = item.parentElement;
				return {
					names: [...storage.querySelectorAll(".setting-item-name")].map((name) => name.textContent),
					buttons: [...storage.querySelectorAll("button")].map((button) => button.textContent),
				};
			`);
		// The tab asks the engine when drawn; with the answer, Obsidian draws the open
		// settings page again (update()). Drawn off-screen here, so draw it again by hand.
		await until(() => run<boolean>(`return window.edgeVoiceTab.storage.status === "done";`));
		run(`window.edgeVoiceTab.display();`);
		const shown = await until(read);
		expect(shown?.names).toEqual(["Downloaded voices", "Kokoro voices", "Piper voice en_US-amy-low"]);
		expect(shown?.buttons).toContain("Copy command to remove all");
		expect(shown?.buttons).not.toContain("Delete");
		const copied = run<string>(`
			let copied = "";
			const original = navigator.clipboard.writeText;
			navigator.clipboard.writeText = async (text) => { copied = text; };
			const button = [...${SETTING("Piper voice en_US-amy-low")}.querySelectorAll("button")]
				.find((candidate) => candidate.textContent === "Copy remove command");
			button.click();
			await new Promise((done) => setTimeout(done, 100));
			navigator.clipboard.writeText = original;
			return copied;
		`);
		expect(copied).toBe("~/.edge-voice/engine/bin/edge-voice-engine storage remove piper:en_US-amy-low");
		expect(errors()).toEqual([]);
	});

	it("lists voices to get by name and size, and a British voice switches the language", () => {
		const list = run<{ voices: string[]; groups: string[]; options: string[]; links: string[] }>(`
			await new Promise((resolve) => setTimeout(resolve, 500));
			const voices = [...${SETTING("Voice")}.querySelectorAll("option")].map((option) => option.textContent);
			const more = ${SETTING("Get another voice")};
			return {
				voices,
				groups: [...more.querySelectorAll("optgroup")].map((group) => group.label),
				options: [...more.querySelectorAll("optgroup option")].map((option) => option.textContent),
				links: [...more.querySelectorAll("a")].map((link) => link.textContent),
			};
		`);
		expect(list.voices).toContain("Bella · American English · female · Kokoro");
		expect(list.groups).toEqual(["Recommended", "Kokoro · American English"]);
		expect(list.options).toEqual([
			"Emma · British English · female · Kokoro (under 1 MB)",
			"Santa · American English · male · Kokoro (under 1 MB)",
		]);
		expect(list.links).toEqual(["Review voice licenses", "Kokoro voices", "Piper voices"]);

		const picked = run<{ command: string; language: string }>(`
			const more = ${SETTING("Get another voice")};
			const select = more.querySelector("select");
			select.value = "kokoro_bf_emma";
			select.dispatchEvent(new Event("change"));
			const command = more.querySelector("code.edge-voice-command").textContent;
			const plugin = ${PLUGIN};
			const before = { voice: plugin.settings.voice, language: plugin.settings.language };
			// As if Emma had been downloaded: choosing her sets British English.
			const voice = ${SETTING("Voice")}.querySelector("select");
			voice.appendChild(new Option("Emma", "kokoro_bf_emma"));
			voice.value = "kokoro_bf_emma";
			voice.dispatchEvent(new Event("change"));
			const language = plugin.settings.language;
			plugin.settings.voice = before.voice;
			plugin.settings.language = before.language;
			await plugin.saveSettings();
			return { command, language };
		`);
		expect(picked.command).toMatch(/edge-voice-engine voices get kokoro_bf_emma( --faster)?$/);
		expect(picked.language).toBe("en_gb");
		expect(errors()).toEqual([]);
	});

	it("keeps voice download instructions readable after selection in narrow settings and both themes", () => {
		const layouts = run<
			{
				theme: string;
				width: number;
				description: number;
				row: number;
				overflow: number;
				command: string;
				commandVisible: boolean;
			}[]
		>(`
			const tab = window.edgeVoiceTab.containerEl;
			const more = ${SETTING("Get another voice")};
			const select = more.querySelector("select");
			const originalStyle = tab.style.cssText;
			const originalTheme = document.body.className;
			const layouts = [];
			try {
				for (const theme of ["theme-light", "theme-dark"]) {
					document.body.classList.remove("theme-light", "theme-dark");
					document.body.classList.add(theme);
					for (const width of [700, 480, 360]) {
						tab.style.width = width + "px";
						for (const voice of ["", "kokoro_bf_emma"]) {
							select.value = voice;
							select.dispatchEvent(new Event("change"));
							await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
							layouts.push({
								theme, width,
								description: more.querySelector(".setting-item-description").getBoundingClientRect().width,
								row: more.getBoundingClientRect().width,
								// Obsidian keeps an invisible, unconstrained select to measure labels.
								// Check the visible UI rather than that measurement helper.
								overflow: Math.max(0, ...[more.querySelector(".setting-item-description"),
									select, ...more.querySelectorAll("button"), more.querySelector("code")]
									.filter(el => el.getClientRects().length > 0)
									.map(el => Math.max(el.getBoundingClientRect().right - more.getBoundingClientRect().right,
										el === select ? 0 : el.scrollWidth - el.clientWidth))),
								command: more.querySelector("code").textContent,
								commandVisible: more.querySelector("code").getClientRects().length > 0,
							});
						}
					}
				}
			} finally {
				tab.style.cssText = originalStyle;
				document.body.className = originalTheme;
				select.value = "";
				select.dispatchEvent(new Event("change"));
			}
			return layouts;
		`);
		for (const layout of layouts) {
			expect(layout.description, JSON.stringify(layout)).toBeGreaterThanOrEqual(Math.min(300, layout.row * 0.8));
			expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(1);
			expect(layout.commandVisible).toBe(Boolean(layout.command));
		}
	});

	it("never squeezes a row's description beside its buttons, nor leaves an empty gap", async () => {
		// Reported on Storage → Downloaded voices: two wide buttons left the text one word wide.
		await until(() => run<boolean>(`return window.edgeVoiceTab.storage.status === "done";`));
		run(`window.edgeVoiceTab.display();`);
		await until(() => run<boolean>(`return !!${SETTING("Downloaded voices")};`));
		const rows = run<
			{
				name: string;
				theme: string;
				width: number;
				gap: number;
				description: number;
				row: number;
				overflow: number;
			}[]
		>(`
			const tab = window.edgeVoiceTab.containerEl;
			const originalStyle = tab.style.cssText;
			const originalTheme = document.body.className;
			const rows = [];
			try {
				for (const theme of ["theme-light", "theme-dark"]) {
					document.body.classList.remove("theme-light", "theme-dark");
					document.body.classList.add(theme);
					for (const width of [700, 480, 360]) {
						tab.style.width = width + "px";
						await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
						for (const item of tab.querySelectorAll(".setting-item:not(.setting-item-heading)")) {
							const description = item.querySelector(".setting-item-description");
							if (!description || !description.textContent.trim() || !item.getClientRects().length) continue;
							const box = item.getBoundingClientRect();
							const info = item.querySelector(".setting-item-info");
							const name = item.querySelector(".setting-item-name");
							rows.push({
								name: name?.textContent ?? "",
								theme, width,
								// The text area holds the name and description; anything more is an empty gap.
								gap: info.getBoundingClientRect().height - description.getBoundingClientRect().height - (name?.getBoundingClientRect().height ?? 0),
								description: description.getBoundingClientRect().width,
								row: box.width,
								overflow: Math.max(0, ...[...item.querySelectorAll("button, select, input, .setting-item-description")]
									// Obsidian keeps an invisible select (.is-measuring) to size dropdown labels.
									.filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
									.map((el) => el.getBoundingClientRect().right - box.right)),
							});
						}
					}
				}
			} finally {
				tab.style.cssText = originalStyle;
				document.body.className = originalTheme;
			}
			return rows;
		`);
		expect(rows.some((row) => row.name === "Downloaded voices")).toBe(true);
		expect(rows.some((row) => row.name === "Get another voice")).toBe(true);
		for (const row of rows) {
			// 0.2.0 left Get another voice with a tall empty gap above its controls.
			expect(row.gap, JSON.stringify(row)).toBeLessThanOrEqual(40);
			expect(row.description, JSON.stringify(row)).toBeGreaterThanOrEqual(Math.min(240, row.row * 0.7));
			expect(row.overflow, JSON.stringify(row)).toBeLessThanOrEqual(1);
		}
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

describe("Consistent speech shortcut settings", () => {
	it("uses symbolic presets and refuses a dictation preset already used for reading", () => {
		const result = run<{ labels: string[]; key: string }>(`
            Object.assign(${PLUGIN}.settings,{doubleTapEnabled:true,doubleTapKey:"MetaRight",dictationEnabled:true,dictationDoubleTapEnabled:true,dictationKey:"MetaLeft",dictationCustomKey:null});
            window.edgeVoiceTab.display();
            const row=${SETTING("Dictation double-tap key")};
            const menu=row.querySelector("select.edge-voice-key-menu");
            const labels=[...menu.options].map((option)=>option.textContent);
            menu.value="MetaRight"; menu.dispatchEvent(new Event("change"));
            return {labels,key:${PLUGIN}.settings.dictationKey};
        `);
		expect(result.labels).toContain("Left ⌘");
		expect(result.labels).toContain("Custom");
		expect(result.key).toBe("MetaLeft");
	});
	it("uses the same custom capture panel and blocks conflicts in both directions", () => {
		const result = run<{ blocked: boolean; message: string; key: string; reverseBlocked: boolean }>(`
            Object.assign(${PLUGIN}.settings,{doubleTapEnabled:true,doubleTapKey:"F13",dictationEnabled:true,dictationDoubleTapEnabled:true,dictationKey:"MetaLeft",dictationCustomKey:null});
            window.edgeVoiceTab.display();
            const row=${SETTING("Dictation double-tap key")};
            const menu=row.querySelector("select"); menu.value="custom"; menu.dispatchEvent(new Event("change"));
            const capture=row.querySelector(".edge-voice-key-capture");
            const save=[...row.querySelectorAll("button")].find((button)=>button.textContent==="Save");
            capture.focus(); capture.dispatchEvent(new KeyboardEvent("keydown",{code:"F13",bubbles:true}));
            const blocked=save.disabled,message=row.querySelector(".edge-voice-key-message").textContent;
            capture.dispatchEvent(new KeyboardEvent("keydown",{code:"F14",bubbles:true})); save.click(); capture.blur();
            const key=${PLUGIN}.settings.dictationKey;
            const reading=${SETTING("Double-tap shortcut")};
            const readingMenu=reading.querySelector("select"); readingMenu.value="custom"; readingMenu.dispatchEvent(new Event("change"));
            const readingCapture=reading.querySelector(".edge-voice-key-capture");
            readingCapture.focus(); readingCapture.dispatchEvent(new KeyboardEvent("keydown",{code:"F14",bubbles:true}));
            const reverseBlocked=[...reading.querySelectorAll("button")].find((button)=>button.textContent==="Save").disabled;
            readingCapture.blur();
            return {blocked,message,key,reverseBlocked};
        `);
		expect(result.blocked).toBe(true);
		expect(result.message).toContain("already used");
		expect(result.key).toBe("F14");
		expect(result.reverseBlocked).toBe(true);
	});
	it("refuses enabling either shortcut or dictation with a conflicting key", () => {
		const result = run<{ reading: boolean; dictation: boolean }>(`
            Object.assign(${PLUGIN}.settings,{doubleTapEnabled:false,doubleTapKey:"F14",dictationEnabled:true,dictationDoubleTapEnabled:true,dictationKey:"F14"});
            window.edgeVoiceTab.display();
            ${SETTING("Double-tap shortcut")}.querySelector(".checkbox-container").click();
            const reading=${PLUGIN}.settings.doubleTapEnabled;
            Object.assign(${PLUGIN}.settings,{doubleTapEnabled:true,dictationEnabled:false});
            window.edgeVoiceTab.display();
            ${SETTING("Enable dictation")}.querySelector(".checkbox-container").click();
            return {reading,dictation:${PLUGIN}.settings.dictationEnabled};
        `);
		expect(result).toEqual({ reading: false, dictation: false });
	});
});
