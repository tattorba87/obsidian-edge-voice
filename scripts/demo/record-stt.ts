/**
 * Record real English dictation in a separate background Obsidian. A licensed
 * WAV is routed into getUserMedia through Web Audio; capture, AudioWorklet,
 * the real Python/native recognizer and editor insertion are unchanged.
 * No real microphone is requested and no transcript is scripted or corrected.
 *
 * STT_DEMO_PYTHON=/absolute/python STT_DEMO_MODEL=/absolute/model-folder
 *   bun scripts/demo/record-stt.ts input.wav output-folder
 *
 * Needs macOS, Obsidian and ffmpeg. See docs/media/README.md for source rights.
 */
import esbuild from "esbuild";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { Sandbox } from "../sandbox/obsidian";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INPUT = resolve(process.argv[2] ?? "");
const OUT = resolve(process.argv[3] ?? ".scratch/stt-demo");
const PYTHON = process.env.STT_DEMO_PYTHON ?? "";
const MODEL = process.env.STT_DEMO_MODEL ?? "";
const sandbox = new Sandbox(ROOT, ".sandbox-stt-demo");
const PLUGIN = 'app.plugins.plugins["edge-voice"]';
const NOTE = "The science in a candle";
const INITIAL =
	"> Michael Faraday · The Chemical History of a Candle\n> Read by Availle for LibriVox · public domain\n\n";
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
function run<T>(body: string): T {
	return JSON.parse(sandbox.eval(`(async()=>{${body}})().then(value=>JSON.stringify(value??null))`)) as T;
}
async function until(read: () => boolean, ms: number): Promise<void> {
	const end = Date.now() + ms;
	while (!read()) {
		if (Date.now() > end) throw new Error("Timed out waiting for dictation");
		await pause(400);
	}
}
function ffmpeg(...args: string[]): void {
	execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

async function record(theme: "dark" | "light"): Promise<void> {
	const dir = join(OUT, theme);
	mkdirSync(join(dir, "frames"), { recursive: true });
	run(`
        app.vault.setConfig("theme", ${JSON.stringify(theme === "dark" ? "obsidian" : "moonstone")});
        app.updateTheme();
        const editor = app.workspace.getMostRecentLeaf().view.editor;
        editor.setValue(${JSON.stringify(INITIAL)});
        editor.setCursor(editor.offsetToPos(editor.getValue().length));
        const context = new AudioContext();
        const raw = require("fs").readFileSync(${JSON.stringify(INPUT)});
        const buffer = await context.decodeAudioData(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        const destination = context.createMediaStreamDestination();
        const source = context.createBufferSource(); source.buffer=buffer; source.connect(destination);
        await context.resume();
        window.sttDemo = {context,source,done:false,audioStart:null,times:[],stop:false};
        source.onended=()=>{window.sttDemo.done=true;};
        navigator.mediaDevices.getUserMedia=async()=>destination.stream;
    `);
	// Capture the actual application on its clock; timestamps preserve waits and speed.
	run(`
        const demo=window.sttDemo, fs=require("fs");
        const contents=require("@electron/remote").getCurrentWebContents();
        demo.capture=(async()=>{
            for(let n=0;!demo.stop;n++) {
                const t=performance.now(); const frame=await contents.capturePage();
                demo.times.push(t);
                fs.writeFileSync(${JSON.stringify(join(dir, "frames"))}+"/"+String(n).padStart(5,"0")+".jpg",frame.toJPEG(92));
                await new Promise(done=>setTimeout(done,Math.max(0,100-(performance.now()-t))));
            }
        })();
    `);
	await pause(700);
	run(`document.querySelector(".edge-voice-microphone").click();`);
	await until(
		() =>
			run<boolean>(`return document.querySelector(".edge-voice-dictation-status")?.dataset.state==="dictating";`),
		60000,
	);
	run(`window.sttDemo.audioStart=performance.now();window.sttDemo.source.start();`);
	await pause(6500);
	run(`
        require("fs").writeFileSync(${JSON.stringify(join(OUT, `dictation-${theme}.png`))},(await require("@electron/remote").getCurrentWebContents().capturePage()).toPNG());
    `);
	await until(() => run<boolean>(`return window.sttDemo.done;`), 60000);
	await pause(1000);
	run(`document.querySelector(".edge-voice-microphone").click();`);
	await until(() => run<boolean>(`return !${PLUGIN}.dictation?.active;`), 60000);
	await pause(5000);
	const timing = run<{ times: number[]; audioStart: number; transcript: string; notices: string[] }>(`
        const demo=window.sttDemo;demo.stop=true;await demo.capture;await demo.context.close();
        return {times:demo.times,audioStart:demo.audioStart,transcript:app.workspace.getMostRecentLeaf().view.editor.getValue(),notices:[...document.querySelectorAll(".notice")].map(el=>el.textContent)};
    `);
	if (
		timing.transcript.length < INITIAL.length + 30 ||
		timing.notices.some((text) => /dictation:|could not|cannot keep up/i.test(text))
	) {
		throw new Error(`Dictation failed: ${JSON.stringify(timing)}`);
	}
	writeFileSync(join(dir, "timing.json"), JSON.stringify(timing, null, 2));
	const list = timing.times.map(
		(t, n) =>
			`file 'frames/${String(n).padStart(5, "0")}.jpg'\nduration ${Math.max(0.001, ((timing.times[n + 1] ?? t + 100) - t) / 1000).toFixed(3)}`,
	);
	list.push(`file 'frames/${String(timing.times.length - 1).padStart(5, "0")}.jpg'`);
	writeFileSync(join(dir, "frames.txt"), list.join("\n") + "\n");
	const delay = Math.round(timing.audioStart - timing.times[0]);
	ffmpeg(
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		join(dir, "frames.txt"),
		"-i",
		INPUT,
		"-filter_complex",
		`[1:a]adelay=${delay}:all=1,apad[a]`,
		"-map",
		"0:v",
		"-map",
		"[a]",
		"-vf",
		"fps=30,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"slow",
		"-crf",
		"22",
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-shortest",
		"-movflags",
		"+faststart",
		join(OUT, `dictation-${theme}.mp4`),
	);
	ffmpeg(
		"-i",
		join(OUT, `dictation-${theme}.mp4`),
		"-vf",
		"fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
		join(OUT, `dictation-${theme}.gif`),
	);
	process.stdout.write(`${theme}: ${timing.times.length} frames, ${timing.transcript.slice(INITIAL.length)}\n`);
}

async function main(): Promise<void> {
	if (!PYTHON || !MODEL || !existsSync(INPUT))
		throw new Error("Set STT_DEMO_PYTHON/MODEL and provide a licensed WAV input");
	if (OUT === ROOT || ROOT.startsWith(OUT + "/") || INPUT.startsWith(OUT + "/"))
		throw new Error("Choose an isolated output directory");
	sandbox.checkCanRun();
	await sandbox.close();
	rmSync(sandbox.paths.root, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	await esbuild.build({ ...buildOptions(true), absWorkingDir: ROOT, logLevel: "warning" });
	await sandbox.prepareVault();
	writeFileSync(join(sandbox.paths.vault, `${NOTE}.md`), INITIAL);
	sandbox.prepareProfile();
	const home = sandbox.prepareHome(true);
	sandbox.prepareSettings(false, PYTHON);
	const settings = join(sandbox.paths.plugin, "data.json");
	writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(readFileSync(settings, "utf8")),
			dictationEnabled: true,
			dictationModelPath: MODEL,
			dictationModel: "medium",
			dictationSilence: 0,
			dictationChime: false,
			preloadVoice: false,
			fasterEngine: false,
			engineUpdateNotified: "0.4.0",
		}),
	);
	await sandbox.launch(home, {}, true);
	await sandbox.waitForPlugin("edge-voice");
	try {
		run(`
            const win=require("@electron/remote").getCurrentWindow();win.setContentSize(1200,800);win.webContents.setBackgroundThrottling(false);
            app.workspace.leftSplit?.collapse();app.workspace.rightSplit?.collapse();
            const leaf=app.workspace.getMostRecentLeaf();
            await leaf.setViewState({type:"markdown",state:{file:${JSON.stringify(`${NOTE}.md`)},mode:"source",source:false}});
            app.workspace.setActiveLeaf(leaf,{focus:true});
            ${PLUGIN}.bar.setEnabled(true);
        `);
		await pause(1000);
		await record("dark");
		await record("light");
		// Obsidian's native settings opens a separate window that capturePage cannot
		// capture reliably in the background. Render the real registered settings
		// tab in this isolated window, as the integration tests do. No settings or
		// controls are simulated; this presentation detail is disclosed in credits.
		run(`
            ${PLUGIN}.settings.dictationModelPath="";${PLUGIN}.settings.dictationSilence=10;${PLUGIN}.settings.dictationChime=true;
            const tab=app.setting.pluginTabs.find(tab=>tab.id==="edge-voice");
            tab.containerEl.style.cssText="position:fixed;inset:40px 0 0 44px;z-index:99999;background:var(--background-primary);padding:8px 40px;overflow:auto;";
            document.body.appendChild(tab.containerEl);tab.display();
            await new Promise(done=>setTimeout(done,2500));
            tab.containerEl.style.height="calc(100vh - 40px)";tab.containerEl.style.boxSizing="border-box";
            const heading=[...tab.containerEl.querySelectorAll(".setting-item-heading")].find(el=>el.textContent.includes("English dictation"));
            if(!heading)throw new Error("Dictation settings heading missing");
            heading.scrollIntoView({block:"start",behavior:"instant"});
            await new Promise(done=>setTimeout(done,600));
            require("fs").writeFileSync(${JSON.stringify(join(OUT, "dictation-settings.png"))},(await require("@electron/remote").getCurrentWebContents().capturePage()).toPNG());
            tab.containerEl.remove();
        `);
	} finally {
		await sandbox.close();
	}
}
await main();
