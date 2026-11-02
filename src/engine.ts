import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir, release } from "os";
import { isAbsolute, join } from "path";
import { clearTimeout, setTimeout } from "timers";
import { childEnvironment } from "./environment";

/**
 * The speech engine the person installs themselves: where Edge Voice looks for
 * it, how it checks it, and the setup steps it shows. Edge Voice never
 * installs or downloads anything; it runs what's there, and when something is
 * missing it shows the commands to run, each with what it does and where its
 * downloads come from.
 */

/** The engine release these steps install, and the protocol this plugin speaks. */
export const ENGINE_VERSION = "0.2.0";
export const ENGINE_PROTOCOL = 1;
const RELEASE = `https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-${ENGINE_VERSION}`;
export const UV_INSTALL = "https://docs.astral.sh/uv/getting-started/installation/";

export const EDGE_VOICE_HOME = join(homedir(), ".edge-voice");
export const ENGINE_DIR = join(EDGE_VOICE_HOME, "engine");
/** What the setup before engine releases left in EDGE_VOICE_HOME; no longer used. */
export const OLD_SETUP = ["venv", "bin", "python", "download", "server.py"];
export const DEFAULT_VOICE = "kokoro_af_bella";

/** The Python inside the engine's folder. */
export function enginePython(platform: string = process.platform, dir: string = ENGINE_DIR): string {
	return platform === "win32" ? join(dir, "Scripts", "python.exe") : join(dir, "bin", "python");
}

/** Whether the faster engine (MLX) can run here: Apple silicon on macOS 14 (Darwin 23) or later. */
export function mlxSupported(
	platform: string = process.platform,
	arch: string = process.arch,
	darwinRelease: string = release(),
): boolean {
	return platform === "darwin" && arch === "arm64" && Number.parseInt(darwinRelease, 10) >= 23;
}

export interface Platform {
	platform: string;
	arch: string;
	/** On Apple silicon with macOS 14 or later, whether the steps include the faster engine. */
	faster: boolean;
}

/** The release's requirements file for this platform, or null if there's no engine for it. */
export function requirementsFile({ platform, arch, faster }: Platform): string | null {
	const key = `${platform}-${arch}`;
	if (key === "darwin-arm64") return faster ? "requirements-darwin-arm64-mlx.txt" : "requirements-darwin-arm64.txt";
	// Windows on ARM runs the x64 engine under emulation: moonshine-voice has no ARM build there.
	if (key === "win32-arm64") return "requirements-win32-x64.txt";
	if (["darwin-x64", "linux-x64", "linux-arm64", "win32-x64"].includes(key)) return `requirements-${key}.txt`;
	return null;
}

export interface Step {
	title: string;
	/** What it does, in plain words. */
	text: string;
	/** The command to copy, if the step has one. */
	command?: string;
	/** A page to open, if the step has one. */
	link?: string;
}

/** The command that downloads `voice` (and, with `faster`, its faster-engine files). */
export function voiceCommand(voice: string, faster: boolean, platform: string = process.platform): string {
	const tool =
		platform === "win32"
			? '& "$HOME\\.edge-voice\\engine\\Scripts\\edge-voice-engine.exe"'
			: "~/.edge-voice/engine/bin/edge-voice-engine";
	return `${tool} voices get ${voice}${faster ? " --faster" : ""}`;
}

/** The setup steps for this computer, or null if there's no engine for it. */
export function setupSteps(where: Platform, voice: string): Step[] | null {
	const file = requirementsFile(where);
	if (!file) return null;
	const windows = where.platform === "win32";
	const folder = windows ? '"$HOME\\.edge-voice\\engine"' : "~/.edge-voice/engine";
	const shell = windows ? "PowerShell" : "Terminal";
	// On Windows on ARM, an x64 Python, to match the engine.
	const python = where.platform === "win32" && where.arch === "arm64" ? "cpython-3.12-windows-x86_64-none" : "3.12";
	const faster = where.faster && voice.startsWith("kokoro_");
	return [
		{
			title: "Install uv",
			text:
				"uv is a widely used tool for installing Python programs, made by Astral. Install it by following " +
				`Astral's own instructions. Skip this if "uv --version" already works in ${shell}.`,
			link: UV_INSTALL,
		},
		{
			title: "Create the engine's folder",
			text:
				`Run this in ${shell}. It creates ${windows ? "the folder .edge-voice\\engine in your home folder" : "the folder ~/.edge-voice/engine"} ` +
				"with its own copy of Python 3.12, from uv. If the folder is already there, it's replaced.",
			command: `uv venv --clear --managed-python ${folder} --python ${python}`,
		},
		{
			title: "Install the engine",
			text:
				"This installs exactly the packages listed in the file at the end of the command; you can open it in a " +
				"browser and read it first. Each package is checked against the fingerprint written next to it, and if " +
				"anything differs, nothing is installed. Nothing is compiled on your computer, and nothing needs " +
				`administrator rights.${where.faster ? " This includes the faster engine for Apple silicon." : ""}`,
			command: `uv pip install --python ${folder} --require-hashes --no-build -r ${RELEASE}/${file}`,
			link: `${RELEASE}/${file}`,
		},
		{
			title: "Download a voice",
			text:
				`This downloads the voice ${voice} from Moonshine's server (download.moonshine.ai)` +
				(faster ? ", and its files for the faster engine from Hugging Face" : "") +
				". You can get more voices later; Edge Voice's settings show the command for each.",
			command: voiceCommand(voice, faster, where.platform),
		},
	];
}

export interface Engine {
	python: string;
	version: string;
	protocol: number;
	/** Whether the faster engine's packages are installed (the `[mlx]` requirements). */
	faster: boolean;
}

export interface EngineSearch {
	engine?: Engine;
	/** Why an engine that was found can't be used, in words for the person. */
	problem?: string;
}

// Asks the engine about itself without loading the speech library, so it's quick.
const PROBE = [
	"import importlib.util as u, json",
	"from edge_voice_engine.server import PROTOCOL, VERSION",
	"print(json.dumps({'version': VERSION, 'protocol': PROTOCOL, " +
		"'faster': all(u.find_spec(m) is not None for m in ('mlx_audio', 'en_core_web_sm'))}))",
].join("\n");

/**
 * Finds the engine: the Python set in settings if there is one (it must be a
 * full path), otherwise the one in ENGINE_DIR, otherwise the
 * `edge-voice-engine` command on PATH. Installs nothing.
 */
export async function findEngine(configured: string, run: Runner = runPython): Promise<EngineSearch> {
	const custom = configured.trim();
	if (custom && !isAbsolute(custom)) {
		return { problem: `The Python path in settings must be a full path, like ${enginePython()}.` };
	}
	const candidates = custom ? [custom] : [enginePython()];
	if (!custom) {
		const fromPath = await commandPython(run);
		if (fromPath) candidates.push(fromPath);
	}
	let problem: string | undefined;
	for (const python of candidates) {
		if (!existsSync(python)) continue;
		const found = await probe(python, run);
		if (!found) {
			problem ??= `${python} doesn't have the speech engine installed.`;
		} else if (found.protocol !== ENGINE_PROTOCOL) {
			problem ??=
				found.protocol < ENGINE_PROTOCOL
					? `The speech engine (${found.version}) is too old for this version of Edge Voice. Update it with the steps below.`
					: `The speech engine (${found.version}) is newer than this version of Edge Voice understands. Update Edge Voice.`;
		} else {
			return { engine: found };
		}
	}
	return problem ? { problem } : {};
}

/** Which of the old setup's folders are still in EDGE_VOICE_HOME. */
export function oldSetupLeftovers(exists: (path: string) => boolean = existsSync): string[] {
	return OLD_SETUP.map((name) => join(EDGE_VOICE_HOME, name)).filter(exists);
}

export type Runner = (command: string, args: string[]) => Promise<{ code: number; stdout: string }>;

async function probe(python: string, run: Runner): Promise<Engine | null> {
	const { code, stdout } = await run(python, ["-I", "-c", PROBE]).catch(() => ({ code: 1, stdout: "" }));
	if (code !== 0) return null;
	try {
		const info = JSON.parse(stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
		if (typeof info.version !== "string" || typeof info.protocol !== "number") return null;
		return { python, version: info.version, protocol: info.protocol, faster: info.faster === true };
	} catch {
		return null;
	}
}

/** The interpreter of an `edge-voice-engine` command on PATH, if there is one. */
async function commandPython(run: Runner): Promise<string | null> {
	const command = process.platform === "win32" ? "edge-voice-engine.exe" : "edge-voice-engine";
	const { code, stdout } = await run(command, ["--python"]).catch(() => ({ code: 1, stdout: "" }));
	const python = stdout.trim().split("\n").pop() ?? "";
	return code === 0 && isAbsolute(python) ? python : null;
}

/** Runs a command with a clean environment and a time limit, and collects its output. */
function runPython(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env: childEnvironment(),
			cwd: homedir(),
			stdio: ["ignore", "pipe", "ignore"],
		});
		let stdout = "";
		const timer = setTimeout(() => child.kill(), 30_000);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (data: string) => (stdout += data.slice(0, 10_000)));
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout });
		});
	});
}
