/**
 * A sandbox Obsidian: prepares its profile, HOME and vault, starts it, drives
 * it through Obsidian's command line interface (obsidian-cli) and closes it.
 * Used by the development sandbox (main.ts) and the tests against real
 * Obsidian (tests/obsidian). Never touches your everyday Obsidian; see
 * layout.ts for why each sandbox has its own HOME.
 */
import { execFileSync } from "child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import {
	engineLinks,
	Layout,
	layout,
	pluginSettings,
	profileConfig,
	refusal,
	socketPath,
	socketProblem,
} from "./layout";
import { writeSamplePdfs } from "./pdfs";

const APP = process.env.OBSIDIAN_APP ?? "/Applications/Obsidian.app";
const CLI = join(APP, "Contents", "MacOS", "obsidian-cli");
const DAILY_PROFILE = join(homedir(), "Library", "Application Support", "obsidian");
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

export class SandboxError extends Error {}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export class Sandbox {
	readonly paths: Layout;

	constructor(
		readonly repo: string,
		name = ".sandbox",
		private readonly log: (message: string) => void = () => undefined,
	) {
		this.paths = layout(repo, name);
	}

	/** Throws if a sandbox can't run here, or would overlap your everyday Obsidian. */
	checkCanRun(): void {
		if (process.platform !== "darwin") {
			throw new SandboxError(
				"runs on macOS only for now. Elsewhere, link the repository into a test vault (see CONTRIBUTING.md).",
			);
		}
		if (!existsSync(CLI))
			throw new SandboxError(`no Obsidian at ${APP}. Install it, or set OBSIDIAN_APP to where it is.`);
		const refused = refusal(this.paths.root, DAILY_PROFILE, dailyVaults());
		if (refused) throw new SandboxError(refused);
		for (const home of [this.paths.home, this.paths.freshHome]) {
			const problem = socketProblem(home);
			if (problem) throw new SandboxError(problem);
		}
	}

	/** The sandbox Obsidian's process ID, if it's running. */
	runningPid(): number | null {
		try {
			const out = execFileSync("pgrep", ["-f", `MacOS/Obsidian --user-data-dir=${this.paths.profile}`], {
				encoding: "utf8",
			});
			return Number(out.trim().split("\n")[0]) || null;
		} catch {
			return null; // pgrep exits 1 when nothing matches
		}
	}

	/** The HOME the running sandbox was started with. */
	activeHome(): string {
		const file = this.paths.runningHome;
		return existsSync(file) ? readFileSync(file, "utf8").trim() : this.paths.home;
	}

	/** Runs an obsidian-cli command against this sandbox, never your everyday Obsidian. */
	cli(...args: string[]): string {
		return cliAt(this.activeHome(), ...args);
	}

	/**
	 * Runs JavaScript inside the sandbox and returns its result as text,
	 * promises awaited. Throws when the code throws.
	 */
	eval(code: string): string {
		const out = this.cli("eval", `code=${code}`);
		// Console output from the code comes first, as "[warn] …" lines; the result is the "=> " line.
		const result = out.indexOf("=> ");
		if (result === 0 || (result > 0 && out[result - 1] === "\n")) return out.slice(result + 3);
		if (out.endsWith("(no output)") || out === "") return "";
		throw new SandboxError(out);
	}

	async writeSamples(): Promise<void> {
		cpSync(join(this.repo, "sandbox", "notes"), this.paths.vault, { recursive: true });
		mkdirSync(join(this.paths.vault, "PDFs"), { recursive: true });
		await writeSamplePdfs(join(this.paths.vault, "PDFs"));
	}

	/** Puts the sample notes and PDFs back, keeping the vault's settings. */
	async resetSamples(): Promise<void> {
		for (const entry of readdirSync(this.paths.vault)) {
			if (entry !== ".obsidian") rmSync(join(this.paths.vault, entry), { recursive: true, force: true });
		}
		await this.writeSamples();
	}

	/** The vault, with Edge Voice enabled and loaded from this repository's build. */
	async prepareVault(): Promise<void> {
		const created = !existsSync(this.paths.vault);
		mkdirSync(this.paths.plugin, { recursive: true });
		if (created) await this.writeSamples();
		const enabled = join(this.paths.vault, ".obsidian", "community-plugins.json");
		if (!existsSync(enabled)) writeFileSync(enabled, JSON.stringify(["edge-voice"]) + "\n");
		// Links to the build, in a real folder, so the plugin's data.json stays in the sandbox.
		for (const file of PLUGIN_FILES) {
			const link = join(this.paths.plugin, file);
			if (!existsSync(link)) symlinkSync(join(this.repo, file), link);
		}
	}

	/**
	 * The sandbox's HOME, its own and separate from yours: its engine, voices and
	 * models live there (see `bun run sandbox:engine`), never in your ~/.edge-voice.
	 * When fresh, an empty one, as for a new user. Only `shareYourEngine` (the TTS demo
	 * recorder) links to your engine's heavy parts instead of installing its own.
	 */
	prepareHome(fresh: boolean, shareYourEngine = false): string {
		const { home, freshHome } = this.paths;
		if (fresh) {
			rmSync(freshHome, { recursive: true, force: true });
			mkdirSync(freshHome, { recursive: true });
			return freshHome;
		}
		mkdirSync(home, { recursive: true });
		if (!shareYourEngine) return home;
		for (const { path, target } of engineLinks(homedir(), home, process.platform, existsSync)) {
			const current = lstatSync(path, { throwIfNoEntry: false });
			if (current?.isSymbolicLink() && readlinkSync(path) === target) continue;
			if (current) {
				this.log(`leaving ${path} as it is; it isn't the link to ${target}.`);
				continue;
			}
			mkdirSync(dirname(path), { recursive: true });
			symlinkSync(target, path);
		}
		return home;
	}

	/** The sandbox's Obsidian profile: the one vault, opened at start, with the CLI on; whatever else Obsidian saved stays. */
	prepareProfile(): void {
		mkdirSync(this.paths.profile, { recursive: true });
		const file = join(this.paths.profile, "obsidian.json");
		const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as object) : {};
		writeFileSync(file, JSON.stringify({ ...saved, ...profileConfig(this.paths.vault, Date.now()) }));
	}

	/**
	 * The plugin's interpreter for this start: `python` if given, for this start only;
	 * otherwise none, so the plugin uses the engine in the sandbox's own HOME. Nothing is
	 * remembered, so the sandbox never drifts back onto an engine outside it.
	 */
	prepareSettings(fresh: boolean, python: string | undefined): void {
		let chosen: string | null = null;
		if (python && !fresh) {
			chosen = resolve(python);
			if (!existsSync(chosen)) throw new SandboxError(`no Python at ${chosen}.`);
		}
		// An older sandbox remembered its last --python here; forget it.
		rmSync(this.paths.python, { force: true });
		const file = join(this.paths.plugin, "data.json");
		const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : null;
		writeFileSync(file, JSON.stringify(pluginSettings(saved, chosen), null, 2));
	}

	/** Starts the sandbox Obsidian with `home` as HOME (plus `env`), and waits until community plugins are on. */
	async launch(home: string, env: Record<string, string> = {}, background = false): Promise<void> {
		// A socket left from an earlier run would look like a running sandbox.
		rmSync(socketPath(home), { force: true });
		const envArgs = Object.entries({ ...env, HOME: home }).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
		// --use-mock-keychain: macOS looks for the login keychain under HOME, finds none in the sandbox's,
		// and would offer to reset it to defaults. The sandbox stores nothing secret, so it doesn't need one.
		execFileSync("open", [
			...(background ? ["-g"] : []),
			"-n",
			"-a",
			APP,
			...envArgs,
			"--args",
			`--user-data-dir=${this.paths.profile}`,
			"--use-mock-keychain",
		]);
		writeFileSync(this.paths.runningHome, home);
		// The CLI answers before Obsidian has registered its plugin commands, so keep asking.
		for (let waited = 0; waited <= 60000; waited += 500) {
			const restricted = existsSync(socketPath(home)) ? cliAt(home, "plugins:restrict") : "";
			if (restricted === "on") {
				this.log(cliAt(home, "plugins:restrict", "off"));
				return;
			}
			if (restricted === "off") return;
			await wait(500);
		}
		throw new SandboxError("the sandbox Obsidian didn't answer within a minute.");
	}

	/**
	 * Waits until plugin `id` is loaded and Obsidian has settled. Turning
	 * restricted mode off reloads the window, and while it reloads the CLI's
	 * commands are gone, so a marker set in the window must survive a moment
	 * between two checks.
	 */
	async waitForPlugin(id: string, timeout = 60000): Promise<void> {
		const probe = `(() => {
			const steady = window.sandboxMark === true;
			window.sandboxMark = true;
			return steady && !!app.plugins.plugins[${JSON.stringify(id)}];
		})()`;
		for (let waited = 0; waited <= timeout; waited += 500) {
			try {
				if (this.eval(probe) === "true") return;
			} catch {
				// The window is still loading.
			}
			await wait(500);
		}
		throw new SandboxError(`${id} didn't load in the sandbox within ${timeout / 1000} seconds.`);
	}

	/** Closes the sandbox Obsidian, if it's running, and waits until it has gone. */
	async close(): Promise<void> {
		const pid = this.runningPid();
		if (!pid) return;
		process.kill(pid);
		for (let waited = 0; this.runningPid() && waited < 10000; waited += 250) await wait(250);
	}
}

function cliAt(home: string, ...args: string[]): string {
	try {
		return execFileSync(CLI, args, {
			env: { ...process.env, HOME: home },
			encoding: "utf8",
			timeout: 30000,
			// The CLI can ignore SIGTERM while waiting for a socket reply.
			killSignal: "SIGKILL",
		}).trim();
	} catch (error) {
		const { stdout, message } = error as { stdout?: string; message: string };
		return (stdout ?? "").trim() || message;
	}
}

/** The vaults your everyday Obsidian knows, which a sandbox must stay clear of. */
function dailyVaults(): string[] {
	try {
		const config = JSON.parse(readFileSync(join(DAILY_PROFILE, "obsidian.json"), "utf8")) as {
			vaults?: Record<string, { path: string }>;
		};
		return Object.values(config.vaults ?? {}).map((vault) => vault.path);
	} catch {
		return [];
	}
}
