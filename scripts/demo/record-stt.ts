/**
 * Record real English dictation in a separate background Obsidian. A licensed
 * WAV is routed into getUserMedia through Web Audio; capture, AudioWorklet,
 * the real Python/native recognizer and editor insertion are unchanged.
 * No real microphone is requested and no transcript is scripted or corrected.
 *
 * Dictation starts the way people start it: a double tap of Left Command
 * (Left Ctrl elsewhere), shown on screen as a keycap. It stops by itself after
 * the default silence, with the done ring and countdown. The start and stop
 * sounds are in the soundtrack, rebuilt from the notes the plugin played.
 *
 *   bun scripts/demo/record-stt.ts first.wav second.wav output-folder
 *
 * Uses the sandbox's own engine and English Medium model (bun run sandbox:engine
 * --model medium), never yours; STT_DEMO_HOME, STT_DEMO_PYTHON and STT_DEMO_MODEL
 * override them. Needs macOS, Obsidian and ffmpeg. See docs/media/README.md for
 * source rights.
 */
import esbuild from "esbuild";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { Sandbox } from "../sandbox/obsidian";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INPUTS = [resolve(process.argv[2] ?? ""), resolve(process.argv[3] ?? "")];
const OUT = resolve(process.argv[4] ?? ".scratch/stt-demo");
const HOME = resolve(process.env.STT_DEMO_HOME ?? join(ROOT, ".sandbox", "home"));
const PYTHON = process.env.STT_DEMO_PYTHON ?? join(HOME, ".edge-voice", "engine", "bin", "python");
const MODEL = process.env.STT_DEMO_MODEL ?? join(HOME, ".edge-voice", "models", "medium-streaming-en");
const KEY = process.platform === "darwin" ? "MetaLeft" : "ControlLeft";
const RATE = 48000;
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

/** Loads the clips and routes them into getUserMedia; logs the plugin's sound notes. */
function prepare(theme: "dark" | "light", dir: string): void {
	mkdirSync(join(dir, "frames"), { recursive: true });
	run(`
        app.vault.setConfig("theme", ${JSON.stringify(theme === "dark" ? "obsidian" : "moonstone")});
        app.updateTheme();
        const editor = app.workspace.getMostRecentLeaf().view.editor;
        editor.setValue(${JSON.stringify(INITIAL)});
        editor.setCursor(editor.offsetToPos(editor.getValue().length));
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const buffers = [];
        for (const path of ${JSON.stringify(INPUTS)}) {
            const raw = require("fs").readFileSync(path);
            buffers.push(await context.decodeAudioData(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
        }
        await context.resume();
        const demo = window.sttDemo = {context,times:[],starts:[],stop:false,notes:[],playing:false};
        demo.play=(n)=>{const source=context.createBufferSource();source.buffer=buffers[n];source.connect(destination);
            demo.playing=true;source.onended=()=>{demo.playing=false;};demo.starts.push(performance.now());source.start();};
        // A fresh stream each time, as a microphone gives: stopping dictation stops its tracks.
        navigator.mediaDevices.getUserMedia=async()=>new MediaStream(destination.stream.getAudioTracks().map((track)=>track.clone()));
        // The plugin's sounds are sine notes; log each one's pitch and start on the page clock.
        if(!window.sttDemoNotes){window.sttDemoNotes=true;
            const start=OscillatorNode.prototype.start;
            OscillatorNode.prototype.start=function(at=0,...rest){
                const ahead=Math.max(0,at-this.context.currentTime)*1000;
                window.sttDemo?.notes.push({t:performance.now()+ahead,frequency:this.frequency.value});
                return start.call(this,at,...rest);
            };
        }
    `);
}

const dictating = () =>
	run<boolean>(`return document.querySelector(".edge-voice-dictation-status")?.dataset.state==="dictating";`);
const active = () => run<boolean>(`return ${PLUGIN}.dictation?.active===true;`);
const playing = () => run<boolean>(`return window.sttDemo.playing;`);
const doneShown = () => run<boolean>(`return !!document.querySelector(".edge-voice-dictation-done");`);

/** Says one clip: Left Command twice, wait for listening, then the clip. */
async function speak(clip: number): Promise<void> {
	keys(2);
	await until(dictating, 60000);
	await pause(300);
	run(`window.sttDemo.play(${clip});`);
	await pause(500);
}

/**
 * The whole take, at real speed: start with a double tap, speak, and let the
 * silence stop it (done ring and countdown); start again, speak, and stop with
 * a single tap. One continuous capture, with the clips and chimes as sound.
 */
async function record(): Promise<void> {
	const dir = join(OUT, "dark");
	prepare("dark", dir);
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
	await pause(1200);
	await speak(0);
	await pause(5500);
	screenshot("dictation-dark.png");
	await until(() => !playing(), 60000);
	// No key: the default silence stops it, through the done ring and countdown.
	await until(() => doneShown() || !active(), 30000);
	await pause(1500);
	if (active()) screenshot("dictation-done.png");
	await until(() => !active(), 30000);
	await pause(2000);
	await speak(1);
	await until(() => !playing(), 60000);
	await until(() => doneShown() || !active(), 30000);
	await pause(1200);
	if (!active()) throw new Error("The second part stopped before the single tap");
	keys(1);
	await until(() => !active(), 30000);
	await pause(1500);
	screenshot("dictation-finished.png");
	await pause(3000);
	const timing = run<{
		times: number[];
		starts: number[];
		notes: { t: number; frequency: number }[];
		transcript: string;
		notices: string[];
	}>(`
        const demo=window.sttDemo;demo.stop=true;await demo.capture;await demo.context.close();
        return {times:demo.times,starts:demo.starts,notes:demo.notes,transcript:app.workspace.getMostRecentLeaf().view.editor.getValue(),notices:[...document.querySelectorAll(".notice")].map(el=>el.textContent)};
    `);
	if (
		timing.notes.length < 12 ||
		timing.starts.length !== 2 ||
		timing.transcript.length < INITIAL.length + 60 ||
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
	const [first, second] = timing.starts.map((t) => Math.round(t - timing.times[0]));
	writeFileSync(join(dir, "sounds.wav"), sounds(timing.notes, timing.times[0], timing.times.at(-1)! + 200));
	ffmpeg(
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		join(dir, "frames.txt"),
		"-i",
		INPUTS[0],
		"-i",
		INPUTS[1],
		"-i",
		join(dir, "sounds.wav"),
		"-filter_complex",
		`[1:a]aresample=${RATE},adelay=${first}:all=1[a1];[2:a]aresample=${RATE},adelay=${second}:all=1[a2];` +
			`[a1][a2][3:a]amix=inputs=3:duration=longest:normalize=0[a]`,
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
		join(OUT, "dictation.mp4"),
	);
	ffmpeg(
		"-i",
		join(OUT, "dictation.mp4"),
		"-vf",
		"fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
		join(OUT, "dictation.gif"),
	);
	process.stdout.write(`${timing.times.length} frames: ${timing.transcript.slice(INITIAL.length)}\n`);
}

function screenshot(name: string): void {
	run(
		`require("fs").writeFileSync(${JSON.stringify(join(OUT, name))},(await require("@electron/remote").getCurrentWebContents().capturePage()).toPNG());`,
	);
}

/**
 * Taps of the dictation key, as the plugin sees them, shown on screen as
 * keycaps: twice to start, once to stop.
 */
function keys(count: 1 | 2): void {
	const name = KEY === "MetaLeft" ? "Left ⌘" : "Left Ctrl";
	const label = count === 2 ? `${name} twice · start` : `${name} once · stop`;
	run(`
        const cap=document.body.createDiv({cls:"stt-demo-keys"});
        cap.style.cssText="position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:99999;display:flex;gap:10px;align-items:center;padding:10px 16px;border-radius:14px;background:rgba(20,16,32,.85);color:#fff;font:600 18px/1 var(--font-interface);box-shadow:0 6px 24px rgba(0,0,0,.35);transition:opacity .4s;";
        const key=()=>{const k=cap.createSpan();k.textContent=${JSON.stringify(KEY === "MetaLeft" ? "⌘" : "Ctrl")};k.style.cssText="min-width:44px;padding:9px 12px;border-radius:9px;background:#2a2340;border:1px solid rgba(175,130,255,.7);box-shadow:0 3px 0 rgba(120,60,220,.9);text-align:center;transition:transform .08s,box-shadow .08s,background .08s;";return k;};
        const caps=Array.from({length:${count}},key);
        const text=cap.createSpan();text.textContent=${JSON.stringify(label)};text.style.cssText="font-weight:500;opacity:.9;margin-left:4px;";
        const wait=(ms)=>new Promise(done=>setTimeout(done,ms));
        const send=(type)=>window.dispatchEvent(new KeyboardEvent(type,{code:${JSON.stringify(KEY)},key:${JSON.stringify(KEY === "MetaLeft" ? "Meta" : "Control")},metaKey:type==="keydown"&&${KEY === "MetaLeft"},ctrlKey:type==="keydown"&&${KEY !== "MetaLeft"},bubbles:true,cancelable:true}));
        const press=(k,on)=>{k.style.transform=on?"translateY(3px)":"";k.style.boxShadow=on?"0 0 0 rgba(120,60,220,.9)":"0 3px 0 rgba(120,60,220,.9)";k.style.background=on?"rgb(120,60,220)":"#2a2340";};
        await wait(600);
        for(const [i,k] of caps.entries()){
            if(i)await wait(140);
            press(k,true);send("keydown");await wait(90);send("keyup");
            if(i<caps.length-1)press(k,false);
        }
        await wait(500);press(caps.at(-1),false);await wait(1000);cap.style.opacity="0";await wait(450);cap.remove();
    `);
}

/** The plugin's start and stop notes, as chime.ts plays them, on the video's clock. */
function sounds(notes: { t: number; frequency: number }[], origin: number, end: number): Buffer {
	const mix = new Float32Array(Math.ceil(((end - origin) / 1000) * RATE));
	for (const { t, frequency } of notes) {
		const offset = Math.round(((t - origin) / 1000) * RATE);
		for (let i = 0; i < 0.3 * RATE && offset + i < mix.length; i++) {
			const s = i / RATE;
			const gain =
				s < 0.01 ? (0.12 * s) / 0.01 : s < 0.28 ? 0.12 * Math.pow(0.0001 / 0.12, (s - 0.01) / 0.27) : 0;
			if (offset + i >= 0) mix[offset + i] += gain * Math.sin(2 * Math.PI * frequency * s);
		}
	}
	const data = Buffer.alloc(mix.length * 2);
	mix.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(RATE, 24);
	header.writeUInt32LE(RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

async function main(): Promise<void> {
	if (!existsSync(PYTHON) || !existsSync(MODEL) || !INPUTS.every((input) => existsSync(input)))
		throw new Error(
			"Needs the sandbox's engine and Medium model (bun run sandbox:engine --model medium) and a licensed WAV input",
		);
	if (OUT === ROOT || ROOT.startsWith(OUT + "/") || INPUTS.some((input) => input.startsWith(OUT + "/")))
		throw new Error("Choose an isolated output directory");
	sandbox.checkCanRun();
	await sandbox.close();
	rmSync(sandbox.paths.root, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	await esbuild.build({ ...buildOptions(true), absWorkingDir: ROOT, logLevel: "warning" });
	await sandbox.prepareVault();
	writeFileSync(join(sandbox.paths.vault, `${NOTE}.md`), INITIAL);
	sandbox.prepareProfile();
	sandbox.prepareSettings(false, PYTHON);
	const settings = join(sandbox.paths.plugin, "data.json");
	writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(readFileSync(settings, "utf8")),
			dictationEnabled: true,
			dictationModelPath: MODEL,
			dictationModel: "medium",
			dictationKey: KEY,
			dictationDoubleTapEnabled: true,
			dictationSilence: 6,
			dictationChime: true,
			highlightTheme: "purple",
			preloadVoice: false,
			fasterEngine: false,
			engineUpdateNotified: "0.4.0",
		}),
	);
	await sandbox.launch(HOME, {}, true);
	await sandbox.waitForPlugin("edge-voice");
	try {
		run(`
            const win=require("@electron/remote").getCurrentWindow();win.setContentSize(1200,800);win.webContents.setBackgroundThrottling(false);
            app.workspace.leftSplit?.collapse();app.workspace.rightSplit?.collapse();app.vault.setConfig("spellcheck",false);
            const leaf=app.workspace.getMostRecentLeaf();
            await leaf.setViewState({type:"markdown",state:{file:${JSON.stringify(`${NOTE}.md`)},mode:"source",source:false}});
            app.workspace.setActiveLeaf(leaf,{focus:true});
            ${PLUGIN}.bar.setEnabled(true);
        `);
		await pause(1000);
		await record();
		// Obsidian's native settings opens a separate window that capturePage cannot
		// capture reliably in the background. Render the real registered settings
		// tab in this isolated window, as the integration tests do. No settings or
		// controls are simulated; this presentation detail is disclosed in credits.
		run(`
            ${PLUGIN}.settings.dictationModelPath="";
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
