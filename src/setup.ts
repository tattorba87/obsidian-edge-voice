import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { requestUrl } from "obsidian";
import serverSource from "../server.py";

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
const PACKAGE = "moonshine-voice>=0.1.5,<0.2";

export const SETUP_HOME = join(homedir(), ".edge-voice");
const UV_PATH = join(SETUP_HOME, "bin", process.platform === "win32" ? "uv.exe" : "uv");
export const VENV_DIR = join(SETUP_HOME, "venv");
export const VENV_PYTHON =
	process.platform === "win32" ? join(VENV_DIR, "Scripts", "python.exe") : join(VENV_DIR, "bin", "python");

/**
 * Writes the sidecar script (bundled into main.js, since Obsidian installs a
 * plugin from main.js, manifest.json and styles.css only) to SETUP_HOME, if it
 * isn't there already in this version, and returns its path.
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

export type SetupStep = "uv" | "python" | "package" | "check";

export interface SetupProgress {
	step(step: SetupStep, state: "running" | "done"): void;
	log(line: string): void;
}

/** Whether this platform has a published moonshine-voice package. */
export function platformSupport(): { supported: boolean; reason?: string } {
	const key = `${process.platform}-${process.arch}`;
	if (key === "darwin-x64") {
		return {
			supported: false,
			reason: "The speech engine (Moonshine) doesn't publish a package for Intel Macs yet. Build a wheel from the moonshine repository (scripts/build-pip.sh) and choose it here.",
		};
	}
	if (key === "win32-arm64") {
		return {
			supported: false,
			reason: "The speech engine (Moonshine) doesn't publish a package for Windows on ARM yet.",
		};
	}
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

/**
 * Runs the whole setup. `wheel` installs that file instead of the package from
 * PyPI (for platforms without a published one). Rejects on failure or when
 * `signal` aborts.
 */
export async function setUpEngine(progress: SetupProgress, signal: AbortSignal, wheel?: string): Promise<string> {
	const env = {
		...process.env,
		UV_PYTHON_INSTALL_DIR: join(SETUP_HOME, "python"),
		UV_CACHE_DIR: join(SETUP_HOME, "cache"),
		UV_NO_PROGRESS: "1",
	};

	progress.step("uv", "running");
	await ensureUv(progress, signal);
	progress.step("uv", "done");

	progress.step("python", "running");
	await runChecked(
		UV_PATH,
		["venv", "--python", PYTHON_VERSION, "--allow-existing", VENV_DIR],
		env,
		progress,
		signal,
	);
	progress.step("python", "done");

	progress.step("package", "running");
	await runChecked(
		UV_PATH,
		["pip", "install", "--python", VENV_PYTHON, "--upgrade", wheel ?? PACKAGE],
		env,
		progress,
		signal,
	);
	progress.step("package", "done");

	progress.step("check", "running");
	const version = await installedVersion(VENV_PYTHON);
	if (!version) throw new Error("moonshine-voice was installed but can't be imported; see the log.");
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
	const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${build.asset}`;
	progress.log(`Downloading ${url}`);
	const response = await requestUrl({ url });
	if (signal.aborted) throw new Error("Cancelled");
	const data = Buffer.from(response.arrayBuffer);
	const digest = createHash("sha256").update(data).digest("hex");
	if (digest !== build.sha256) {
		throw new Error(`The uv download failed its checksum (got ${digest}). Nothing was installed.`);
	}
	progress.log("Checksum verified.");

	const workDir = join(SETUP_HOME, "download");
	await fs.rm(workDir, { recursive: true, force: true });
	await fs.mkdir(workDir, { recursive: true });
	const archive = join(workDir, build.asset);
	await fs.writeFile(archive, data);
	// tar ships with macOS, Linux and Windows 10+, and reads zip as well.
	await runChecked("tar", ["-xf", archive, "-C", workDir], process.env, progress, signal);
	const found = await findFile(workDir, process.platform === "win32" ? "uv.exe" : "uv");
	if (!found) throw new Error("The uv download didn't contain uv.");
	await fs.mkdir(dirname(UV_PATH), { recursive: true });
	await fs.copyFile(found, UV_PATH);
	await fs.chmod(UV_PATH, 0o755);
	await fs.rm(workDir, { recursive: true, force: true });
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
	progress.log(`$ ${[command, ...args].join(" ")}`);
	const code = await run(command, args, (line) => progress.log(line), env, signal);
	if (signal.aborted) throw new Error("Cancelled");
	if (code !== 0) throw new Error(`${command.split(/[/\\]/).pop()} exited with code ${code}; see the log.`);
}

/** Runs a command, passing each line it prints to `onLine`. Resolves with its exit code. */
function run(
	command: string,
	args: string[],
	onLine: (line: string) => void,
	env: NodeJS.ProcessEnv = process.env,
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
