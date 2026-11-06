import { ENGINE_VERSION } from "../../src/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { command, errors, openNote, PLUGIN, run, setSettings, until } from "./obsidian";

beforeEach(() => {
	openNote("A long note.md", "source");
	setSettings({
		dictationEnabled: true,
		dictationModelPath: "/local/test-medium-streaming-en",
		dictationModel: "medium",
		dictationSilence: 0,
		dictationLowercase: false,
		dictationChime: true,
		dictationDoubleTapEnabled: true,
	});
	// Exercise the real AudioWorklet without requesting the person's microphone.
	run(`
        window.dictationTestContext = null;
        window.dictationOriginalMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async () => {
            if (window.dictationPermissionWait) await new Promise((resolve) => { window.dictationGrant = resolve; });
            const context = new AudioContext();
            const destination = context.createMediaStreamDestination();
            const source = context.createConstantSource();
            source.offset.value = 0; source.connect(destination); source.start();
            window.dictationTestSource = source;
            window.dictationTestContext = context;
            window.dictationTestStream = destination.stream;
            return destination.stream;
        };
        window.dictationTargetLeaf = app.workspace.getMostRecentLeaf();
        window.dictationTargetView = window.dictationTargetLeaf.view;
        const editor = window.dictationTargetView.editor;
        window.dictationOriginalNote = editor.getValue();
        editor.setValue("# Dictation test\\n\\n");
        editor.setCursor({ line: 2, ch: 0 });
    `);
});
afterEach(() => {
	run(`
        ${PLUGIN}.dictation?.cancel();
        navigator.mediaDevices.getUserMedia = window.dictationOriginalMedia;
        if (window.dictationTestContext?.state !== "closed" && window.dictationTestContext) await window.dictationTestContext.close();
        window.dictationPermissionWait = false;
        window.dictationGrant?.(); window.dictationGrant = null;
        const view = window.dictationTargetView;
        for (const leaf of app.workspace.getLeavesOfType("markdown")) if (leaf !== window.dictationTargetLeaf) leaf.detach();
        await window.dictationTargetLeaf.setViewState({type:"markdown",state:{file:"A long note.md",mode:"source"}});
        app.workspace.setActiveLeaf(window.dictationTargetLeaf, {focus:true});
        window.dictationTargetLeaf.view.editor.setValue(window.dictationOriginalNote);
    `);
	setSettings({ dictationEnabled: false, dictationLowercase: false });
});
const content = () => run<string>(`return app.workspace.getMostRecentLeaf().view.editor.getValue();`);
const active = () => run<boolean>(`return ${PLUGIN}.dictation?.active ?? false;`);

describe("Dictation in the real Markdown editor", () => {
	it("shows the model command in speech-engine setup even before dictation is enabled", () => {
		setSettings({ dictationEnabled: false, dictationModel: "tiny" });
		const result = run<{ commands: string[]; text: string }>(`
            ${PLUGIN}.openSetup();
            const modal=document.querySelector(".edge-voice-setup");
            if(!modal)throw new Error("Speech setup window did not open");
            try {
                return {commands:[...modal.querySelectorAll("code")].map(el=>el.textContent),text:modal.textContent};
            } finally {
                [...modal.querySelectorAll("button")].find(button=>button.textContent==="Close").click();
            }
        `);
		expect(result.commands.some((command) => command.endsWith("models get tiny"))).toBe(true);
		expect(result.commands.some((command) => command.includes("voices get"))).toBe(true);
		expect(result.text).toContain("The last two steps are optional");
		expect(result.text).toContain("Skip this if you only want reading aloud");
	});
	it("uses the managed model when no custom folder is configured", async () => {
		setSettings({ dictationModelPath: "" });
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("# Dictation test\n\nHello from dictation. ");
	});
	it("streams and finalizes text through AudioWorklet and the sidecar, then permits TTS", async () => {
		run(`document.querySelector(".edge-voice-microphone").click();`);
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		expect(run<string>(`return document.querySelector(".edge-voice-dictation-status").textContent;`)).toBe(
			"Dictating",
		);

		const recordingControls = run<{
			visible: boolean;
			disabled: boolean;
			glow: string;
			bars: number;
			animated: boolean;
		}>(`
            const bar=document.querySelector(".edge-voice-bar");
            const buttons=[...bar.querySelectorAll("button")].filter((button)=>!button.classList.contains("edge-voice-microphone") && button.getAttribute("aria-label")!=="Minimize");
            const bars=[...document.querySelectorAll(".edge-voice-dictation-status .edge-voice-eq-bar")];
            return {
                visible:buttons.every((button)=>getComputedStyle(button).display!=="none"),
                disabled:buttons.every((button)=>button.disabled),
                glow:getComputedStyle(bar.querySelector(".edge-voice-glow")).display,
                bars:bars.length,
                animated:bars.some((bar)=>getComputedStyle(bar).animationName!=="none")
            };
        `);
		expect(recordingControls).toEqual({ visible: true, disabled: true, glow: "block", bars: 3, animated: false });
		run(`window.dictationTestSource.offset.value = 0.08;`);
		expect(await until(() => run<boolean>(`return ${PLUGIN}.bar.inputLevel > 0.1;`))).toBe(true);

		expect(
			await until(() =>
				run<boolean>(
					`return [...document.querySelectorAll(".edge-voice-dictation-status .edge-voice-eq-bar")].every((bar)=>bar.getBoundingClientRect().height>0);`,
				),
			),
		).toBe(true);
		run(`window.dictationTestSource.offset.value=0;`);
		expect(
			await until(() =>
				run<boolean>(
					`return [...document.querySelectorAll(".edge-voice-dictation-status .edge-voice-eq-bar")].every((bar)=>bar.getBoundingClientRect().height===0);`,
				),
			),
		).toBe(true);
		command("toggle");
		expect(run<string>(`return ${PLUGIN}.reader.state;`)).toBe("idle");
		run(`document.querySelector(".edge-voice-microphone").click();`);
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("# Dictation test\n\nHello from dictation. ");
		// The cursor waits one space after the dictated words, ready to go on.
		expect(
			run<number>(
				`const e = app.workspace.getMostRecentLeaf().view.editor; return e.posToOffset(e.getCursor());`,
			),
		).toBe("# Dictation test\n\nHello from dictation. ".length);
		expect(run<string>(`return window.dictationTestStream.getAudioTracks()[0].readyState;`)).toBe("ended");
		command("toggle");
		expect(await until(() => run<string>(`return ${PLUGIN}.reader.state;`) === "playing")).toBe(true);

		expect(run<boolean>(`return document.querySelector(".edge-voice-microphone").disabled;`)).toBe(true);
		command("stop");
		expect(run<boolean>(`return document.querySelector(".edge-voice-microphone").disabled;`)).toBe(false);
		expect(errors()).toEqual([]);
	});
	it("preserves an intervening edit and releases the microphone", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		run(`app.workspace.getMostRecentLeaf().view.editor.setValue("My manual edit");`);
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("My manual edit");
		expect(errors()).toEqual([]);
	});
	it("shows when the text is done: a green ring on the microphone and a countdown in the status bar", async () => {
		setSettings({ dictationSilence: 6 });
		const look = () =>
			run<{ done: boolean; status: string; state: string; label: string }>(`
				const bar = document.querySelector(".edge-voice-bar");
				const status = document.querySelector(".edge-voice-dictation-status");
				return {
					done: bar.classList.contains("edge-voice-dictation-done"),
					status: status?.querySelector(".edge-voice-status-text")?.textContent ?? "",
					state: status?.dataset.state ?? "",
					label: bar.querySelector(".edge-voice-microphone").getAttribute("aria-label"),
				};
			`);
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		const done = await until(() => (look().done ? look() : undefined), 6000);
		expect(done?.status).toMatch(/^Done · stops in [1-6] s$/);
		expect(done?.state).toBe("done");
		expect(done?.label).toMatch(/^Text done/);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(look().done).toBe(false);
		expect(errors()).toEqual([]);
	});

	it("applies lowercase to partial and final text", async () => {
		setSettings({ dictationLowercase: true });
		command("toggle-dictation");
		expect(await until(() => content().includes("hello from dictation"))).toBe(true);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("# Dictation test\n\nhello from dictation. ");
	});
});

describe("Dictation review regressions in Obsidian", () => {
	it("keeps startup alive through permission blur and snapshots typing when recording begins", async () => {
		run(`window.dictationPermissionWait = true;`);
		command("toggle-dictation");
		expect(await until(() => run<boolean>(`return !!window.dictationGrant;`))).toBe(true);
		run(`
            window.dispatchEvent(new Event("blur"));
            const editor = window.dictationTargetView.editor;
            editor.setValue("Typed during startup. ");
            editor.setCursor(editor.offsetToPos(editor.getValue().length));
            window.dictationGrant();
        `);
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("Typed during startup. Hello from dictation. ");
		expect(errors()).toEqual([]);
	});
	it("keeps dictating through sidebar focus and preserves the final words", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		run(`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("file-explorer")[0], {focus:true});`);
		expect(active()).toBe(true);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(run<string>(`return window.dictationTargetView.editor.getValue();`)).toBe(
			"# Dictation test\n\nHello from dictation. ",
		);
		expect(errors()).toEqual([]);
	});
	it("finalizes the original open note when a different tab becomes active", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		run(`
            window.dictationOtherFile = app.vault.getFileByPath("Welcome.md");
            window.dictationOtherText = await app.vault.read(window.dictationOtherFile);
            await app.workspace.getLeaf("tab").openFile(window.dictationOtherFile);
        `);
		expect(await until(() => !active())).toBe(true);
		expect(run<string>(`return window.dictationTargetView.editor.getValue();`)).toBe(
			"# Dictation test\n\nHello from dictation. ",
		);
		expect(
			run<boolean>(`return (await app.vault.read(window.dictationOtherFile)) === window.dictationOtherText;`),
		).toBe(true);
		expect(errors()).toEqual([]);
	});
	it("does not write a late result into a replacement file in the same pane", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		run(`
            window.dictationOtherFile = app.vault.getFileByPath("Welcome.md");
            window.dictationOtherText = await app.vault.read(window.dictationOtherFile);
            await window.dictationTargetLeaf.openFile(window.dictationOtherFile);
        `);
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe(run<string>(`return window.dictationOtherText;`));
		expect(errors()).toEqual([]);
	});
	it("stops safely when leaving editing mode", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		run(
			`await window.dictationTargetView.setState({...window.dictationTargetView.getState(),mode:"preview"},{history:false});`,
		);
		expect(await until(() => !active())).toBe(true);
		expect(run<string>(`return window.dictationTestStream.getAudioTracks()[0].readyState;`)).toBe("ended");
		expect(errors()).toEqual([]);
	});
	it("releases capture immediately when disabled in settings, then finalizes", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		setSettings({ dictationEnabled: false });
		expect(run<string>(`return window.dictationTestStream.getAudioTracks()[0].readyState;`)).toBe("ended");
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe("# Dictation test\n\nHello from dictation. ");
	});
	it("preserves an undo made during dictation instead of re-inserting the partial transcript", async () => {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		const undone = run<string>(
			`const editor=window.dictationTargetView.editor; editor.undo(); return editor.getValue();`,
		);
		expect(await until(() => !active())).toBe(true);
		expect(content()).toBe(undone);
		expect(errors()).toEqual([]);
	});
	it("keeps dictation settings after the regular voice and advanced settings", () => {
		const headings = run<(string | null)[]>(
			`return app.setting.pluginTabs.find((tab)=>tab.id==="edge-voice").getSettingDefinitions().map((group)=>group.heading??null);`,
		);
		expect(headings.at(-1)).toBe("English dictation");
		expect(headings.indexOf("Advanced")).toBeLessThan(headings.length - 1);
	});
	it("notifies about a compatible engine update only once per recommended version", () => {
		const result = run<{ notices: number; remembered: string }>(`
            const plugin=${PLUGIN};
            const check=plugin.checkEngine.bind(plugin), offer=plugin.offerSetup.bind(plugin);
            const preload=plugin.settings.preloadVoice, remembered=plugin.settings.engineUpdateNotified;
            let notices=0;
            try {
                plugin.settings.preloadVoice=false; plugin.settings.engineUpdateNotified="";
                plugin.checkEngine=async()=>({engine:{python:"/test/python",version:"0.2.0",protocol:1,faster:false}});
                plugin.offerSetup=()=>{notices++;};
                await plugin.prepareEngine(); await plugin.prepareEngine();
                return {notices,remembered:plugin.settings.engineUpdateNotified};
            } finally {
                plugin.checkEngine=check; plugin.offerSetup=offer;
                plugin.settings.preloadVoice=preload; plugin.settings.engineUpdateNotified=remembered;
                await plugin.saveSettings();
            }
        `);
		expect(result).toEqual({ notices: 1, remembered: ENGINE_VERSION });
	});
});

it("can disable dictation sounds independently of TTS", async () => {
	setSettings({ dictationChime: false, doubleTapChime: true });
	run(`
        window.dictationSoundStarts=0;
        window.dictationRealOscillatorStart=OscillatorNode.prototype.start;
        OscillatorNode.prototype.start=function(...args){window.dictationSoundStarts++;return window.dictationRealOscillatorStart.apply(this,args);};
    `);
	try {
		command("toggle-dictation");
		expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
		command("stop-dictation");
		expect(await until(() => !active())).toBe(true);
		expect(run<number>(`return window.dictationSoundStarts;`)).toBe(0);
		expect(run<boolean>(`return ${PLUGIN}.settings.doubleTapChime;`)).toBe(true);
	} finally {
		run(`OscillatorNode.prototype.start=window.dictationRealOscillatorStart;`);
	}
});

it("double-taps to start dictation and single-taps to stop with final text", async () => {
	setSettings({
		dictationKey: "F14",
		dictationCustomKey: "F14",
		dictationDoubleTapEnabled: true,
		doubleTapEnabled: false,
	});
	const tap = `window.dispatchEvent(new KeyboardEvent("keydown",{code:"F14"})); window.dispatchEvent(new KeyboardEvent("keyup",{code:"F14"}));`;
	run(tap);
	expect(active()).toBe(false);
	run(tap);
	expect(await until(() => content().includes("Hello from dictation"))).toBe(true);
	run(tap);
	expect(await until(() => !active())).toBe(true);
	expect(content()).toBe("# Dictation test\n\nHello from dictation. ");
	expect(run<string>(`return window.dictationTestStream.getAudioTracks()[0].readyState;`)).toBe("ended");
});
