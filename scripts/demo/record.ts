/**
 * Records the README's demo: a sandbox Obsidian with the real engine reads a
 * note and a PDF aloud, while Obsidian's own window is captured frame by frame
 * and the plugin's audio is recorded from its audio graph. ffmpeg then makes
 * demo.mp4 (with sound) and demo.gif (silent, short, for the top of the README).
 *
 *     bun scripts/demo/record.ts [output folder]
 *     DEMO_PDF=paper.pdf DEMO_PDF_FROM="We explore how" DEMO_PDF_UNTIL="can be striking" bun scripts/demo/record.ts [output folder]
 *
 * DEMO_PDF reads another PDF instead of the sample, starting at the first text
 * containing DEMO_PDF_FROM and stopping once the sentence containing
 * DEMO_PDF_UNTIL has been said in full. Use only a PDF that's free to show
 * (CC BY, say), and credit it wherever the recording or a frame of it is used.
 *
 * Needs the engine set up (~/.edge-voice/engine) with the voice below, Obsidian
 * installed, and ffmpeg. It runs in CI (the Demo workflow), on a runner, so
 * nobody's own Obsidian or screen is involved.
 */
import esbuild from "esbuild";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { Sandbox } from "../sandbox/obsidian";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OUT = resolve(process.argv[2] ?? "demo-out");
const FRAMES = join(OUT, "frames");
const VOICE = "kokoro_af_heart";
const PYTHON = join(homedir(), ".edge-voice", "engine", process.platform === "win32" ? "Scripts" : "bin", "python");
const SIZE = { width: 1280, height: 800 };
// Another PDF to read instead of the sample (a path), and text to start reading at.
const DEMO_PDF = process.env.DEMO_PDF ? resolve(process.env.DEMO_PDF) : "";
const PDF_PATH = DEMO_PDF ? `PDFs/${basename(DEMO_PDF)}` : "PDFs/A short paper.pdf";
const PDF_FROM = process.env.DEMO_PDF_FROM ?? "";
const PDF_UNTIL = process.env.DEMO_PDF_UNTIL ?? "";
const NOTE_NAME = "Why read along";

// No heading: Obsidian already shows the note's name above it. Every sentence
// was checked through normalizeForSpeech and Moonshine's G2P before recording.
const NOTE = `Edge Voice speaks your notes aloud, right here in Obsidian. The sentence you're on is highlighted, and so is each word as it's spoken.

In a world full of distractions, staying focused on a page is hard. When you hear the words and follow them at the same time, your eyes and ears stay on one thing, and **your mind wanders less**.

Studies suggest it helps people with **ADHD or dyslexia** understand more, and the rest of us too.

Everything runs on your own computer. Your notes never leave it, there's no account, and it's free.

It works on PDFs as well, like this research paper.
`;

const sandbox = new Sandbox(REPO, ".sandbox-demo", (message) => process.stderr.write(`demo: ${message}\n`));
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Runs the inside of an async function in Obsidian and returns its result. */
function run<T>(body: string): T {
	const out = sandbox.eval(`(async () => { ${body} })().then((value) => JSON.stringify(value ?? null))`);
	return JSON.parse(out) as T;
}

const PLUGIN = `app.plugins.plugins["edge-voice"]`;

async function until(read: () => boolean, ms: number): Promise<void> {
	for (let waited = 0; waited < ms && !read(); waited += 250) await pause(250);
}

async function main(): Promise<void> {
	if (!existsSync(PYTHON)) throw new Error(`no engine at ${PYTHON}; run the setup steps first`);
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(FRAMES, { recursive: true });

	await sandbox.close();
	rmSync(sandbox.paths.root, { recursive: true, force: true });
	await esbuild.build({ ...buildOptions(true), absWorkingDir: REPO, logLevel: "warning" });
	await sandbox.prepareVault();
	writeFileSync(join(sandbox.paths.vault, `${NOTE_NAME}.md`), NOTE);
	if (DEMO_PDF) copyFileSync(DEMO_PDF, join(sandbox.paths.vault, PDF_PATH));
	sandbox.prepareProfile();
	const home = sandbox.prepareHome(false);
	sandbox.prepareSettings(false, PYTHON);
	const settings = join(sandbox.paths.plugin, "data.json");
	writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(readFileSync(settings, "utf8")),
			voice: VOICE,
			language: "en_us",
			fasterEngine: false,
		}),
	);
	await sandbox.launch(home);
	await sandbox.waitForPlugin("edge-voice");

	try {
		// A fixed window, the demo note in Reading view, and the voice loaded beforehand.
		run(`
			const electron = require("electron");
			const remote = electron.remote ?? require("@electron/remote");
			const win = remote.getCurrentWindow();
			win.setSize(${SIZE.width}, ${SIZE.height});
			win.setPosition(0, 0);
			app.workspace.leftSplit?.collapse();
			app.workspace.rightSplit?.collapse();
			const leaf = app.workspace.getMostRecentLeaf();
			await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(`${NOTE_NAME}.md`)}, mode: "preview" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			await ${PLUGIN}.ensureVoice();
			await new Promise((done) => setTimeout(done, 1000));
		`);

		// Capture: frames of the page, and every sound the plugin plays with the
		// moment it started, so the soundtrack is rebuilt in sync with the frames
		// (a MediaRecorder drops the silences, and the sound drifts ahead).
		run(`
			const fs = require("fs");
			const electron = require("electron");
			const remote = electron.remote ?? require("@electron/remote");
			const contents = remote.getCurrentWebContents();
			fs.mkdirSync(${JSON.stringify(join(OUT, "clips"))}, { recursive: true });
			const demo = (window.edgeVoiceDemo = { stop: false, times: [], clips: [], done: null });
			const start = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function (...args) {
				const n = demo.clips.length;
				const data = this.buffer.getChannelData(0);
				fs.writeFileSync(${JSON.stringify(join(OUT, "clips"))} + "/" + n + ".f32", Buffer.from(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
				this.edgeVoiceClip = { t: performance.now(), rate: this.buffer.sampleRate, samples: data.length, end: null };
				demo.clips.push(this.edgeVoiceClip);
				return start.apply(this, args);
			};
			const stop = AudioBufferSourceNode.prototype.stop;
			AudioBufferSourceNode.prototype.stop = function (...args) {
				if (this.edgeVoiceClip && this.edgeVoiceClip.end === null) this.edgeVoiceClip.end = performance.now();
				return stop.apply(this, args);
			};
			demo.done = (async () => {
				for (let n = 0; !demo.stop; n++) {
					const started = performance.now();
					const image = await contents.capturePage();
					demo.times.push(started);
					fs.writeFileSync(${JSON.stringify(FRAMES)} + "/" + String(n).padStart(5, "0") + ".jpg", image.toJPEG(88));
					const spent = performance.now() - started;
					await new Promise((done) => setTimeout(done, Math.max(0, 100 - spent)));
				}
			})();
		`);
		await pause(1500);

		// The note, from the top, to the end.
		const noteStart = run<number>(`
			app.commands.executeCommandById("edge-voice:toggle");
			return performance.now();
		`);
		await until(() => run<string>(`return ${PLUGIN}.reader.state;`) === "playing", 30000);
		await until(() => run<string>(`return ${PLUGIN}.reader.state;`) === "idle", 90000);
		await pause(1200);

		// A PDF for a few sentences: the sample, from its top, or DEMO_PDF from the
		// first text-layer span containing DEMO_PDF_FROM (selected, then "read from here").
		const pdfStart = run<number>(`
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(PDF_PATH)});
			const leaf = app.workspace.getMostRecentLeaf();
			await leaf.openFile(file);
			await new Promise((done) => setTimeout(done, 3000));
			const from = ${JSON.stringify(PDF_FROM)};
			const span = from
				? [...document.querySelectorAll(".workspace-leaf.mod-active .textLayer span")].find((item) => item.textContent.includes(from))
				: null;
			if (from && !span) throw new Error("no text " + JSON.stringify(from) + " in the PDF's first pages");
			if (span) {
				span.scrollIntoView({ block: "center" });
				await new Promise((done) => setTimeout(done, 800));
				const range = document.createRange();
				range.selectNodeContents(span);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				app.commands.executeCommandById("edge-voice:read-from-here");
				selection.removeAllRanges();
			} else {
				app.commands.executeCommandById("edge-voice:toggle");
			}
			// Stop right after the sentence containing DEMO_PDF_UNTIL ends, before the
			// next one starts: its unhighlight() is called once its audio has finished.
			const until = ${JSON.stringify(PDF_UNTIL)};
			if (until) {
				const reader = ${PLUGIN}.reader;
				const watch = setInterval(() => {
					const segment = reader.current;
					if (!segment || !segment.text.includes(until) || segment.edgeVoiceDemoLast) return;
					segment.edgeVoiceDemoLast = true;
					const unhighlight = segment.unhighlight.bind(segment);
					// Once: stopping unhighlights the current sentence too.
					segment.unhighlight = () => {
						segment.unhighlight = unhighlight;
						unhighlight();
						app.commands.executeCommandById("edge-voice:stop");
					};
					clearInterval(watch);
				}, 50);
			}
			return performance.now();
		`);
		if (PDF_UNTIL) {
			await until(() => run<string>(`return ${PLUGIN}.reader.state;`) === "playing", 30000);
			await until(() => run<string>(`return ${PLUGIN}.reader.state;`) === "idle", 120000);
		} else {
			await pause(14000);
		}
		run(`app.commands.executeCommandById("edge-voice:stop");`);
		await pause(1500);

		const timing = run<{ times: number[]; clips: Clip[] }>(`
			const demo = window.edgeVoiceDemo;
			demo.stop = true;
			await demo.done;
			return { times: demo.times, clips: demo.clips };
		`);
		writeFileSync(join(OUT, "timing.json"), JSON.stringify({ ...timing, noteStart, pdfStart }, null, 2));
		encode(timing.times, timing.clips, [noteStart, pdfStart]);
	} finally {
		sandbox.cli("dev:screenshot", `path=${join(OUT, "last.png")}`);
		await sandbox.close();
	}
}

interface Clip {
	/** performance.now() when it started playing. */
	t: number;
	rate: number;
	samples: number;
	/** When it was cut off, if it was. */
	end: number | null;
}

/**
 * Waits for synthesis to cut from the recording: before a part's first sound
 * and between sounds within a part. On a slow computer the next sentence may
 * not be ready in time; on Apple silicon it is, and the demo shows that.
 */
function waits(clips: Clip[], parts: number[]): [number, number][] {
	const cuts: [number, number][] = [];
	const ends = (clip: Clip) => clip.end ?? clip.t + (clip.samples / clip.rate) * 1000;
	parts.forEach((part, p) => {
		const next = parts[p + 1] ?? Infinity;
		const mine = clips.filter((clip) => clip.t >= part && clip.t < next).sort((a, b) => a.t - b.t);
		if (mine.length === 0) return;
		if (mine[0].t - part > 900) cuts.push([part + 600, mine[0].t - 200]);
		for (let i = 1; i < mine.length; i++) {
			const gap = mine[i].t - ends(mine[i - 1]);
			if (gap > 350) cuts.push([ends(mine[i - 1]) + 150, mine[i].t - 150]);
		}
	});
	return cuts;
}

/** demo.mp4 from the frames and the sounds, with the waits cut; demo.gif from the note's part. */
function encode(allTimes: number[], clips: Clip[], parts: number[]): void {
	if (allTimes.length < 10) throw new Error(`only ${allTimes.length} frames were captured`);
	const cuts = waits(clips, parts);
	const origin = allTimes[0];
	// Time on the recording's clock -> seconds into the video, with the waits taken out.
	const at = (time: number): number => {
		let shift = 0;
		for (const [from, to] of cuts) {
			if (time >= to) shift += to - from;
			else if (time > from) shift += time - from;
		}
		return (time - origin - shift) / 1000;
	};
	const kept = allTimes
		.map((time, n) => ({ n, time }))
		.filter(({ time }) => !cuts.some(([a, b]) => time > a && time < b));
	const list = kept.map(({ n, time }, k) => {
		const next = kept[k + 1] ? at(kept[k + 1].time) : at(time) + 0.1;
		return `file 'frames/${String(n).padStart(5, "0")}.jpg'\nduration ${Math.max(0.001, next - at(time)).toFixed(3)}`;
	});
	// The concat demuxer wants the last file again, without a duration.
	list.push(`file 'frames/${String(kept[kept.length - 1].n).padStart(5, "0")}.jpg'`);
	writeFileSync(join(OUT, "frames.txt"), list.join("\n") + "\n");

	// The soundtrack: every sound at the moment it played, cut off where it was.
	const rate = clips[0]?.rate ?? 24000;
	const total = Math.ceil((at(allTimes[allTimes.length - 1]) + 0.2) * rate);
	const mix = new Float32Array(total);
	clips.forEach((clip, n) => {
		if (clip.rate !== rate) throw new Error(`sounds at ${clip.rate} and ${rate} Hz`);
		const raw = readFileSync(join(OUT, "clips", `${n}.f32`));
		const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
		const played =
			clip.end === null
				? samples.length
				: Math.min(samples.length, Math.round(((clip.end - clip.t) / 1000) * rate));
		const offset = Math.round(at(clip.t) * rate);
		for (let i = 0; i < played && offset + i < total; i++) mix[offset + i] += samples[i];
	});
	writeFileSync(join(OUT, "audio.wav"), wav(mix, rate));
	writeFileSync(join(OUT, "cuts.json"), JSON.stringify(cuts.map(([a, b]) => [at(a), (b - a) / 1000])));

	const ffmpeg = (...args: string[]) =>
		execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: OUT });
	ffmpeg(
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		"frames.txt",
		"-i",
		"audio.wav",
		"-map",
		"0:v",
		"-map",
		"1:a",
		"-c:a",
		"aac",
		"-b:a",
		"128k",
		"-vf",
		"fps=30,scale=1280:-2:flags=lanczos,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"slow",
		"-crf",
		"24",
		"-movflags",
		"+faststart",
		"demo.mp4",
	);

	// The GIF: from just before reading starts, the first sentences of the note.
	const from = Math.max(0, at(parts[0]) - 0.5);
	for (const [width, fps] of [
		[960, 12],
		[800, 10],
		[720, 8],
	]) {
		ffmpeg(
			"-ss",
			from.toFixed(2),
			"-t",
			"14",
			"-i",
			"demo.mp4",
			"-vf",
			`fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
			"demo.gif",
		);
		if (statSync(join(OUT, "demo.gif")).size < 9_500_000) break;
	}
	const cutSeconds = cuts.reduce((sum, [a, b]) => sum + b - a, 0) / 1000;
	process.stdout.write(`cut ${cuts.length} waits for synthesis (${cutSeconds.toFixed(1)} s)\n`);
	for (const file of ["demo.mp4", "demo.gif"])
		process.stdout.write(`${file}: ${(statSync(join(OUT, file)).size / 1e6).toFixed(1)} MB\n`);
}

/** 16-bit mono WAV. */
function wav(samples: Float32Array, rate: number): Buffer {
	const data = Buffer.alloc(samples.length * 2);
	samples.forEach((sample, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2));
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

await main();
