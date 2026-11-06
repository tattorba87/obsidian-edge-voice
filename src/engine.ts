import { spawn } from "child_process";
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
export const ENGINE_VERSION = "0.4.0";
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

/** A newer bundled recommendation, independent of protocol compatibility. No network lookup. */
export function engineUpdateAvailable(installed: string, recommended: string = ENGINE_VERSION): boolean {
	const parse = (value: string) => (/^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : null);
	const current = parse(installed);
	const target = parse(recommended);
	if (!current || !target) return false;
	for (let i = 0; i < 3; i++) {
		if (current[i] !== target[i]) return current[i] < target[i];
	}
	return false;
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
	return `${engineTool(platform)} voices get ${voice}${faster ? " --faster" : ""}`;
}

/** A manual, SHA-256 verified English ASR download; never executed by the plugin. */
export function modelCommand(model: string, platform: string = process.platform): string {
	if (!["tiny", "small", "medium"].includes(model)) throw new Error("Unknown English streaming model");
	return `${engineTool(platform)} models get ${model}`;
}

/** The engine's command, as the person types it in Terminal or PowerShell. */
function engineTool(platform: string): string {
	return platform === "win32"
		? '& "$HOME\\.edge-voice\\engine\\Scripts\\edge-voice-engine.exe"'
		: "~/.edge-voice/engine/bin/edge-voice-engine";
}

/** The setup steps for this computer, or null if there's no engine for it. */
export function setupSteps(where: Platform, voice: string, dictationModel?: string): Step[] | null {
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
			title: "Download a reading voice (optional)",
			text:
				`This downloads the voice ${voice} from Moonshine's server (download.moonshine.ai)` +
				(faster ? ", and its files for the faster engine from Hugging Face" : "") +
				". Skip this if you only want dictation. You can get more voices later in Edge Voice settings.",
			command: voiceCommand(voice, faster, where.platform),
		},
		...(dictationModel
			? [
					{
						title: "Download a dictation model (optional)",
						text:
							`For English speech-to-text, this downloads the ${dictationModel} streaming model from Moonshine (download.moonshine.ai), with SHA-256 verification. ` +
							"Skip this if you only want reading aloud. Medium (269 MB) prioritizes word accuracy; Small (142 MB) and Tiny (45 MB) prioritize speed and lower resource use, with more recognition errors expected. " +
							"Choose another model in Settings → Edge Voice → English dictation, then use its download command. After downloading, enable dictation and leave Custom model folder empty.",
						command: modelCommand(dictationModel, where.platform),
					},
				]
			: []),
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
		const found = await probe(python, run);
		if (found === "missing") continue;
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

export type Runner = (command: string, args: string[]) => Promise<{ code: number; stdout: string }>;

/** The engine at `python`; null if that Python has none, "missing" if there's no such program. */
async function probe(python: string, run: Runner): Promise<Engine | null | "missing"> {
	let result: { code: number; stdout: string };
	try {
		result = await run(python, ["-I", "-c", PROBE]);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : null;
	}
	const { code, stdout } = result;
	if (code !== 0) return null;
	try {
		const info = JSON.parse(stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
		if (typeof info.version !== "string" || typeof info.protocol !== "number") return null;
		return { python, version: info.version, protocol: info.protocol, faster: info.faster === true };
	} catch {
		return null;
	}
}

/** Something the engine has downloaded, as `edge-voice-engine storage --json` lists it. */
export interface StorageItem {
	id: string;
	label: string;
	description: string;
	bytes: number;
}

/**
 * What the engine has downloaded, largest first, or null when this engine is
 * too old to say (before 0.3.0). The engine reads its own folders; the plugin
 * reads no files.
 */
export async function engineStorage(python: string, run: Runner = runPython): Promise<StorageItem[] | null> {
	const { code, stdout } = await run(python, ["-I", "-m", "edge_voice_engine", "storage", "--json"]).catch(() => ({
		code: 1,
		stdout: "",
	}));
	if (code !== 0) return null;
	try {
		const items = JSON.parse(stdout) as unknown;
		if (!Array.isArray(items)) return null;
		return items.filter(
			(item): item is StorageItem =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as StorageItem).id === "string" &&
				typeof (item as StorageItem).label === "string" &&
				typeof (item as StorageItem).description === "string" &&
				typeof (item as StorageItem).bytes === "number",
		);
	} catch {
		return null;
	}
}

/** The command that removes downloads: the given IDs, or everything when there are none. */
export function removeCommand(ids: string[], platform: string = process.platform): string {
	return `${engineTool(platform)} storage remove ${ids.length > 0 ? ids.join(" ") : "--all"}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
	if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
	return `${(bytes / 1e9).toFixed(1)} GB`;
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
