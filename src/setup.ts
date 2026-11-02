import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from "fs";
import { homedir, release } from "os";
import { dirname, join } from "path";
import { requestUrl } from "obsidian";
import { childEnvironment } from "./environment";
import lockDarwinArm64Mlx from "../locks/darwin-arm64-mlx.txt";
import lockDarwinArm64 from "../locks/darwin-arm64.txt";
import lockDarwinX64 from "../locks/darwin-x64.txt";
import lockLinuxArm64 from "../locks/linux-arm64.txt";
import lockLinuxX64 from "../locks/linux-x64.txt";
import lockWin32X64 from "../locks/win32-x64.txt";
import serverSource from "../engine/src/edge_voice_engine/server.py";

/**
 * Sets up the Python environment the speech sidecar runs in, with nothing
 * needed beforehand: it downloads a pinned uv (Astral's Python installer),
 * checks it against the checksum below, and has uv fetch its own Python and
 * install moonshine-voice. Everything lives in ~/.edge-voice, so
 * deleting that folder removes it all.
 */

const UV_VERSION = "0.13.6";
// From the .sha256 files published with uv 0.13.6.
const UV_BUILDS: Record<string, { asset: string; sha256: string }> = {
	"darwin-arm64": {
		asset: "uv-aarch64-apple-darwin.tar.gz",
		sha256: "60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472",
	},
	"darwin-x64": {
		asset: "uv-x86_64-apple-darwin.tar.gz",
		sha256: "63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02",
	},
	"linux-x64": {
		asset: "uv-x86_64-unknown-linux-gnu.tar.gz",
		sha256: "f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645",
	},
	"linux-arm64": {
		asset: "uv-aarch64-unknown-linux-gnu.tar.gz",
		sha256: "229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d",
	},
	"win32-x64": {
		asset: "uv-x86_64-pc-windows-msvc.zip",
		sha256: "a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f",
	},
	"win32-arm64": {
		asset: "uv-aarch64-pc-windows-msvc.zip",
		sha256: "c2426c0c8e28b53d8c440e47a18d96ad4db51e159866c0e81435b196d7f0081c",
	},
};

const PYTHON_VERSION = "3.12";
// 0.1 is the API the sidecar speaks (TextToSpeech().language().voice().load()).
// scripts/lock-engine.sh locks this version and everything it needs.
export const PACKAGE = "moonshine-voice==0.1.5";

// Every package the engine installs, at exact versions with their hashes
// (scripts/lock-engine.sh). uv installs them with --require-hashes, so a
// changed or substituted package fails to install instead of running.
// Windows on ARM runs the x64 Python, so it uses the x64 lock.
export const LOCKS: Record<string, string> = {
	"darwin-arm64": lockDarwinArm64,
	"darwin-x64": lockDarwinX64,
	"linux-x64": lockLinuxX64,
	"linux-arm64": lockLinuxArm64,
	"win32-x64": lockWin32X64,
	"win32-arm64": lockWin32X64,
};

// moonshine-voice publishes no wheel for Intel Macs, and its Apple Silicon
// wheel needs macOS 15. The engine-wheels workflow builds both from the same
// release for macOS 13.4 (the floor of the ONNX Runtime it bundles) and
// attaches them to this repository's release ENGINE_TAG; their checksums are
// pinned here, from that release's notes.
const ENGINE_TAG = "moonshine-voice-0.1.5";
const ENGINE_RELEASE = `https://github.com/tattorba87/obsidian-edge-voice/releases/download/${ENGINE_TAG}`;
const ENGINE_WHEELS: Record<string, { asset: string; sha256: string }> = {
	"darwin-x64": {
		asset: "moonshine_voice-0.1.5-py3-none-macosx_13_0_x86_64.whl",
		sha256: "a3a5d827cbb31339808ba0cba0f0082bd26550f0a6a2d5577fc8bf65f382ad23",
	},
	"darwin-arm64": {
		asset: "moonshine_voice-0.1.5-py3-none-macosx_13_0_arm64.whl",
		sha256: "5328a49f62ff4670dada9a0bb7f950994a3ba0b2d47898a7049f540d79afbafd",
	},
};

// Windows on ARM has no moonshine-voice build (nor an ONNX Runtime one bundled
// with it), so it runs the x64 Python and package under Windows 11's emulation.
const PYTHON_REQUEST: Record<string, string> = {
	"win32-arm64": `cpython-${PYTHON_VERSION}-windows-x86_64-none`,
};

// On Apple silicon with macOS 14 or later (MLX's floor), Kokoro can run on
// the GPU through MLX, about twice as fast as Moonshine on the CPU in the
// engine benchmark (scripts/bench_engines.py). It goes into the same
// environment, after the engine, from its own lock. misaki needs spaCy's
// English model, which is downloaded and checked here, so spaCy never fetches
// it itself.
export const MLX_PACKAGES = ["mlx-audio==0.5.9", "misaki[en]==0.9.4"];
const SPACY_MODEL = {
	url: "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
	asset: "en_core_web_sm-3.8.0-py3-none-any.whl",
	sha256: "1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85",
};

export const SETUP_HOME = join(homedir(), ".edge-voice");
const UV_PATH = join(SETUP_HOME, "bin", process.platform === "win32" ? "uv.exe" : "uv");
export const VENV_DIR = join(SETUP_HOME, "venv");
export const VENV_PYTHON =
	process.platform === "win32" ? join(VENV_DIR, "Scripts", "python.exe") : join(VENV_DIR, "bin", "python");

/**
 * Writes the sidecar script (engine/src/edge_voice_engine/server.py, bundled
 * into main.js, since Obsidian installs a plugin from main.js, manifest.json
 * and styles.css only) to SETUP_HOME, if it isn't there already in this
 * version, and returns its path.
 */
export function installServerScript(): string {
	const path = join(SETUP_HOME, "server.py");
	const current = existsSync(path) ? readFileSync(path, "utf8") : null;
	if (current !== serverSource) {
		mkdirSync(SETUP_HOME, { recursive: true });
		writeFileSync(path, serverSource);
	}
	return path;
}

export type SetupStep = "uv" | "python" | "package" | "check" | "mlx";

export interface SetupProgress {
	step(step: SetupStep, state: "running" | "done"): void;
	log(line: string): void;
}

/** Whether setup can install the engine on this platform. */
export function platformSupport(): { supported: boolean; reason?: string } {
	const key = `${process.platform}-${process.arch}`;
	if (!UV_BUILDS[key]) return { supported: false, reason: `No setup is available for ${key}.` };
	return { supported: true };
}

/** The installed moonshine-voice version, or null if `python` can't import it. */
export async function installedVersion(python: string): Promise<string | null> {
	if (!existsSync(python)) return null;
	const lines: string[] = [];
	const code = await run(
		python,
		["-I", "-c", "import importlib.metadata as m; print(m.version('moonshine-voice'))"],
		(line) => lines.push(line),
	).catch(() => 1);
	return code === 0 ? (lines.find((line) => /^\d/.test(line)) ?? null) : null;
}

/** The Python uv installs on platform `key` ("darwin-x64"), and the engine wheel to download, if PyPI has none. */
export function engineSource(key: string): { python: string; wheel?: { url: string; asset: string; sha256: string } } {
	const build = ENGINE_WHEELS[key];
	return {
		python: PYTHON_REQUEST[key] ?? PYTHON_VERSION,
		wheel: build && { ...build, url: `${ENGINE_RELEASE}/${build.asset}` },
	};
}

/** Whether the faster engine (MLX) can run here: Apple silicon on macOS 14 (Darwin 23) or later. */
export function mlxSupported(
	platform: string = process.platform,
	arch: string = process.arch,
	darwinRelease: string = release(),
): boolean {
	return platform === "darwin" && arch === "arm64" && Number.parseInt(darwinRelease, 10) >= 23;
}

/**
 * Where the faster engine's model lands, at the commit server.py pins
 * (read from server.py, so the two can't drift): the Hugging Face cache layout,
 * under HF_HOME, which server.py sets to ~/.edge-voice/hf.
 */
export function mlxModelDir(): string {
	const repo = /^MLX_WEIGHTS = "([^"]+)"/m.exec(serverSource)?.[1] ?? "";
	const revision = /^MLX_REVISION = "([0-9a-f]+)"/m.exec(serverSource)?.[1] ?? "";
	return join(SETUP_HOME, "hf", "hub", `models--${repo.replace("/", "--")}`, "snapshots", revision);
}

/** Whether `python` has the faster engine, its English model and its voice files. */
export async function mlxInstalled(python: string): Promise<boolean> {
	if (!existsSync(python) || !existsSync(mlxModelDir())) return false;
	const code = await run(
		python,
		["-I", "-c", "import importlib.metadata as m; m.version('mlx-audio'); m.version('en_core_web_sm')"],
		() => undefined,
	).catch(() => 1);
	return code === 0;
}

/**
 * Installs the faster engine into `python`'s environment, then has the real
 * sidecar load `voice` with it once, which downloads the model and voice (a few
 * hundred MB) now rather than on the next press of play, and shows it works.
 * Rejects on failure or when `signal` aborts.
 */
export async function installMlx(
	python: string,
	voice: string,
	progress: SetupProgress,
	signal: AbortSignal,
): Promise<void> {
	await ensureUv(progress, signal);
	progress.step("mlx", "running");
	const model = join(SETUP_HOME, "download", SPACY_MODEL.asset);
	await download(SPACY_MODEL.url, SPACY_MODEL.sha256, model, progress, signal);
	await runChecked(
		UV_PATH,
		[
			"pip",
			"install",
			"--python",
			python,
			"--require-hashes",
			"--find-links",
			dirname(model),
			"-r",
			await writeLock("darwin-arm64-mlx", lockDarwinArm64Mlx),
		],
		uvEnv(),
		progress,
		signal,
	);
	await fs.rm(dirname(model), { recursive: true, force: true });
	// Installs fine anywhere; whether the GPU is there shows only when it loads.
	await runChecked(
		python,
		[
			"-I",
			"-c",
			"import mlx.core as mx, mlx_audio.tts.utils, misaki.en; assert mx.metal.is_available(), 'no Metal GPU'",
		],
		childEnvironment(),
		progress,
		signal,
	);
	progress.log(`Loading ${voice} with the faster engine (downloads its files the first time).`);
	const reply = await sidecarRequest(
		python,
		installServerScript(),
		{ id: 1, op: "load", language: "en_us", voice, engine: "mlx" },
		progress,
		signal,
	);
	if (reply.engine !== "mlx") {
		const why =
			typeof reply.fallback === "string"
				? reply.fallback
				: typeof reply.error === "string"
					? reply.error
					: "it didn't load";
		throw new Error(`The faster engine doesn't work here: ${why}`);
	}
	progress.step("mlx", "done");
}

/** Starts a sidecar, sends it one request, and resolves with the reply to it. */
function sidecarRequest(
	python: string,
	script: string,
	request: { id: number } & Record<string, unknown>,
	progress: SetupProgress,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const child = spawn(python, ["-I", script], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: dirname(script),
			env: childEnvironment(),
		});
		const onAbort = () => child.kill();
		signal.addEventListener("abort", onAbort, { once: true });
		let buffer = "";
		let settled = false;
		const finish = (result: Record<string, unknown> | Error) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			child.stdin.end();
			if (result instanceof Error) reject(result);
			else resolve(result);
		};
		child.stdout.on("data", (data: Buffer) => {
			buffer += data.toString("utf8");
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line) continue;
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue;
				}
				if (message.event === "ready") child.stdin.write(JSON.stringify(request) + "\n");
				else if (message.id === request.id) finish(message);
			}
		});
		child.stderr.on("data", (data: Buffer) => {
			for (const line of data.toString("utf8").split(/\r?\n/)) if (line.trim()) progress.log(line);
		});
		child.on("error", (error) => finish(error));
		child.on("close", (code) =>
			finish(new Error(signal.aborted ? "Cancelled" : `The sidecar exited (${code}) before answering.`)),
		);
	});
}

/** Writes a lock where uv can read it, and returns its path. */
async function writeLock(name: string, lock: string): Promise<string> {
	const path = join(SETUP_HOME, "locks", `${name}.txt`);
	await fs.mkdir(dirname(path), { recursive: true });
	await fs.writeFile(path, lock);
	return path;
}

function uvEnv(): NodeJS.ProcessEnv {
	return {
		...childEnvironment(),
		UV_PYTHON_INSTALL_DIR: join(SETUP_HOME, "python"),
		UV_CACHE_DIR: join(SETUP_HOME, "cache"),
		UV_NO_PROGRESS: "1",
	};
}

/** Runs the whole setup. Rejects on failure or when `signal` aborts. */
export async function setUpEngine(progress: SetupProgress, signal: AbortSignal): Promise<string> {
	const key = `${process.platform}-${process.arch}`;
	const source = engineSource(key);
	const env = uvEnv();

	progress.step("uv", "running");
	await ensureUv(progress, signal);
	progress.step("uv", "done");

	progress.step("python", "running");
	await runChecked(UV_PATH, ["venv", "--python", source.python, "--allow-existing", VENV_DIR], env, progress, signal);
	progress.step("python", "done");

	progress.step("package", "running");
	const lock = LOCKS[key];
	if (!lock) throw new Error(`No setup is available for ${key}.`);
	const install = ["pip", "install", "--python", VENV_PYTHON, "--require-hashes", "-r", await writeLock(key, lock)];
	if (source.wheel) {
		if (!source.wheel.sha256) throw new Error(`The speech engine for ${key} hasn't been published yet.`);
		const wheel = join(SETUP_HOME, "download", source.wheel.asset);
		await download(source.wheel.url, source.wheel.sha256, wheel, progress, signal);
		// The lock names this wheel by its hash; reinstall even at the same
		// version, so the checked file is what runs.
		await runChecked(
			UV_PATH,
			[...install, "--find-links", dirname(wheel), "--reinstall-package", "moonshine-voice"],
			env,
			progress,
			signal,
		);
		await fs.rm(dirname(wheel), { recursive: true, force: true });
	} else {
		await runChecked(UV_PATH, install, env, progress, signal);
	}
	progress.step("package", "done");

	progress.step("check", "running");
	const version = await installedVersion(VENV_PYTHON);
	if (!version) throw new Error("moonshine-voice was installed but can't be imported; see the log.");
	// A package built for another processor installs fine and fails only here.
	await runChecked(
		VENV_PYTHON,
		["-I", "-c", "from moonshine_voice.moonshine_api import _MoonshineLib; _MoonshineLib()"],
		childEnvironment(),
		progress,
		signal,
	);
	progress.log(`moonshine-voice ${version} is ready.`);
	progress.step("check", "done");
	return version;
}

async function ensureUv(progress: SetupProgress, signal: AbortSignal): Promise<void> {
	const lines: string[] = [];
	if (existsSync(UV_PATH) && (await run(UV_PATH, ["--version"], (line) => lines.push(line)).catch(() => 1)) === 0) {
		if (lines.some((line) => line.includes(UV_VERSION))) {
			progress.log(`Using ${lines[0]}.`);
			return;
		}
	}
	const build = UV_BUILDS[`${process.platform}-${process.arch}`];
	if (!build) throw new Error(`No uv build for ${process.platform}-${process.arch}.`);
	const workDir = join(SETUP_HOME, "download");
	const archive = join(workDir, build.asset);
	await download(
		`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${build.asset}`,
		build.sha256,
		archive,
		progress,
		signal,
	);
	// tar ships with macOS, Linux and Windows 10+, and reads zip as well.
	await runChecked("tar", ["-xf", archive, "-C", workDir], childEnvironment(), progress, signal);
	const found = await findFile(workDir, process.platform === "win32" ? "uv.exe" : "uv");
	if (!found) throw new Error("The uv download didn't contain uv.");
	await fs.mkdir(dirname(UV_PATH), { recursive: true });
	await fs.copyFile(found, UV_PATH);
	await fs.chmod(UV_PATH, 0o755);
	await fs.rm(workDir, { recursive: true, force: true });
}

/** Downloads `url` to `path` (in a fresh folder) if its SHA-256 is `sha256`. */
async function download(
	url: string,
	sha256: string,
	path: string,
	progress: SetupProgress,
	signal: AbortSignal,
): Promise<void> {
	progress.log(`Downloading ${url}`);
	const response = await requestUrl({ url });
	if (signal.aborted) throw new Error("Cancelled");
	const data = Buffer.from(response.arrayBuffer);
	const digest = createHash("sha256").update(data).digest("hex");
	if (digest !== sha256) {
		const name = url.split("/").pop();
		throw new Error(`The download of ${name} failed its checksum (got ${digest}). Nothing was installed.`);
	}
	progress.log("Checksum verified.");
	await fs.rm(dirname(path), { recursive: true, force: true });
	await fs.mkdir(dirname(path), { recursive: true });
	await fs.writeFile(path, data);
}

async function findFile(dir: string, name: string): Promise<string | null> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isFile() && entry.name === name) return path;
		if (entry.isDirectory()) {
			const found = await findFile(path, name);
			if (found) return found;
		}
	}
	return null;
}

async function runChecked(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	progress: SetupProgress,
	signal: AbortSignal,
): Promise<void> {
	// uv reads uv.toml and pyproject.toml settings from the working directory up, and the
	// user's; --no-config keeps those from changing where packages come from.
	const full = command === UV_PATH ? ["--no-config", ...args] : args;
	progress.log(`$ ${[command, ...full].join(" ")}`);
	const code = await run(command, full, (line) => progress.log(line), env, signal);
	if (signal.aborted) throw new Error("Cancelled");
	if (code !== 0) throw new Error(`${command.split(/[/\\]/).pop()} exited with code ${code}; see the log.`);
}

/** Runs a command, passing each line it prints to `onLine`. Resolves with its exit code. */
function run(
	command: string,
	args: string[],
	onLine: (line: string) => void,
	env: NodeJS.ProcessEnv = childEnvironment(),
	signal?: AbortSignal,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
		const onAbort = () => child.kill();
		signal?.addEventListener("abort", onAbort, { once: true });
		let partial = "";
		const take = (data: Buffer) => {
			partial += data.toString("utf8");
			const lines = partial.split(/\r?\n/);
			partial = lines.pop() ?? "";
			for (const line of lines) if (line.trim()) onLine(line);
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			if (partial.trim()) onLine(partial);
			resolve(code ?? 1);
		});
	});
}
