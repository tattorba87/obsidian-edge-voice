/**
 * Records the README's demo: a sandbox Obsidian with the real engine reads a
 * note and a PDF aloud, while Obsidian's own window is captured frame by frame
 * and the plugin's audio is recorded from its audio graph. ffmpeg then makes
 * demo.mp4 (with sound) and demo.gif (silent, short, for the top of the README).
 *
 *     bun scripts/demo/record.ts [output folder]
 *
 * Needs the engine set up (~/.edge-voice/engine) with the voice below, Obsidian
 * installed, and ffmpeg. It runs in CI (the Demo workflow), on a runner, so
 * nobody's own Obsidian or screen is involved.
 */
import esbuild from "esbuild";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { Sandbox } from "../sandbox/obsidian";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OUT = resolve(process.argv[2] ?? "demo-out");
const FRAMES = join(OUT, "frames");
const VOICE = "kokoro_af_heart";
const PYTHON = join(homedir(), ".edge-voice", "engine", process.platform === "win32" ? "Scripts" : "bin", "python");
const SIZE = { width: 1280, height: 800 };

const NOTE = `# Reading along

Edge Voice reads your notes aloud, right here in Obsidian. The sentence being read is highlighted, and so is each word as it's spoken.

Everything runs on your own computer. Your notes never leave it, there's no account, and it's free.

It reads PDFs too. Pause, skip a sentence, or change the speed from the player bar at the bottom.
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
	writeFileSync(join(sandbox.paths.vault, "Reading along.md"), NOTE);
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
			await leaf.setViewState({ type: "markdown", state: { file: "Reading along.md", mode: "preview" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			await ${PLUGIN}.ensureVoice();
			await new Promise((done) => setTimeout(done, 1000));
		`);

		// Capture: frames of the page, and everything the plugin sends to the speakers.
		run(`
			const fs = require("fs");
			const electron = require("electron");
			const remote = electron.remote ?? require("@electron/remote");
			const contents = remote.getCurrentWebContents();
			const demo = (window.edgeVoiceDemo = { stop: false, times: [], audioStart: null, chunks: [], done: null });
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (target, ...rest) {
				const result = connect.call(this, target, ...rest);
				if (target instanceof AudioDestinationNode) {
					const context = target.context;
					if (!context.edgeVoiceTap) {
						context.edgeVoiceTap = context.createMediaStreamDestination();
						const recorder = new MediaRecorder(context.edgeVoiceTap.stream, { mimeType: "audio/webm;codecs=opus" });
						recorder.ondataavailable = (event) => demo.chunks.push(event.data);
						recorder.start(250);
						demo.recorder = recorder;
						demo.audioStart = performance.now();
					}
					connect.call(this, context.edgeVoiceTap);
				}
				return result;
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

		// A PDF, from its first sentence, for a few sentences.
		run(`
			const file = app.vault.getAbstractFileByPath("PDFs/A short paper.pdf");
			const leaf = app.workspace.getMostRecentLeaf();
			await leaf.openFile(file);
			await new Promise((done) => setTimeout(done, 2000));
			app.commands.executeCommandById("edge-voice:toggle");
		`);
		await pause(14000);
		run(`app.commands.executeCommandById("edge-voice:stop");`);
		await pause(1000);

		const timing = run<{ times: number[]; audioStart: number | null }>(`
			const demo = window.edgeVoiceDemo;
			demo.stop = true;
			await demo.done;
			if (demo.recorder) {
				const stopped = new Promise((done) => (demo.recorder.onstop = done));
				demo.recorder.stop();
				await stopped;
				const audio = new Blob(demo.chunks, { type: "audio/webm" });
				require("fs").writeFileSync(${JSON.stringify(join(OUT, "audio.webm"))}, Buffer.from(await audio.arrayBuffer()));
			}
			return { times: demo.times, audioStart: demo.audioStart };
		`);
		writeFileSync(join(OUT, "timing.json"), JSON.stringify({ ...timing, noteStart }, null, 2));
		encode(timing.times, timing.audioStart, noteStart);
	} finally {
		sandbox.cli("dev:screenshot", `path=${join(OUT, "last.png")}`);
		await sandbox.close();
	}
}

/** demo.mp4 at the frames' real timing with the audio laid over it; demo.gif from the note's part. */
function encode(times: number[], audioStart: number | null, noteStart: number): void {
	if (times.length < 10) throw new Error(`only ${times.length} frames were captured`);
	const list = times.map((time, n) => {
		const next = times[n + 1] ?? time + 100;
		return `file 'frames/${String(n).padStart(5, "0")}.jpg'\nduration ${((next - time) / 1000).toFixed(3)}`;
	});
	// The concat demuxer wants the last file again, without a duration.
	list.push(`file 'frames/${String(times.length - 1).padStart(5, "0")}.jpg'`);
	writeFileSync(join(OUT, "frames.txt"), list.join("\n") + "\n");

	const audio = join(OUT, "audio.webm");
	const withAudio = audioStart !== null && existsSync(audio) && statSync(audio).size > 1000;
	const ffmpeg = (...args: string[]) =>
		execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: OUT });
	ffmpeg(
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		"frames.txt",
		...(withAudio
			? [
					"-itsoffset",
					((audioStart - times[0]) / 1000).toFixed(3),
					"-i",
					"audio.webm",
					"-map",
					"0:v",
					"-map",
					"1:a",
					"-c:a",
					"aac",
					"-b:a",
					"128k",
				]
			: []),
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
	const from = Math.max(0, (noteStart - times[0]) / 1000 - 0.5);
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
	for (const file of ["demo.mp4", "demo.gif"])
		process.stdout.write(
			`${file}: ${(statSync(join(OUT, file)).size / 1e6).toFixed(1)} MB${file === "demo.mp4" && !withAudio ? " (no audio was captured)" : ""}\n`,
		);
}

await main();
