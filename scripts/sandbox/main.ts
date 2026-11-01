/**
 * The development sandbox: a second Obsidian with its own profile, HOME and
 * sample vault, running the plugin built from this repository. Your everyday
 * Obsidian, its settings and its vaults are never touched.
 *
 *   bun run sandbox [--fresh] [--python <path>]   build, open, and reload on every change
 *   bun run sandbox:reset                         put the sample notes and PDFs back
 *   bun run sandbox:errors                        errors from the running sandbox
 *
 * It's driven through Obsidian's command line interface (obsidian-cli). Every
 * Obsidian claims the CLI's socket in its HOME when it starts, so the sandbox
 * gets a HOME of its own, which also keeps its engine folder apart; see
 * layout.ts for what it shares with yours.
 */
import { execFileSync } from "child_process";
import esbuild, { BuildResult, Plugin } from "esbuild";
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
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { engineLinks, layout, pluginSettings, profileConfig, refusal, socketPath, socketProblem } from "./layout";
import { writeSamplePdfs } from "./pdfs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PATHS = layout(REPO);
const APP = process.env.OBSIDIAN_APP ?? "/Applications/Obsidian.app";
const CLI = join(APP, "Contents", "MacOS", "obsidian-cli");
const DAILY_PROFILE = join(homedir(), "Library", "Application Support", "obsidian");
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

function fail(message: string): never {
	console.error(`sandbox: ${message}`);
	process.exit(1);
}

function say(message: string): void {
	console.log(`sandbox: ${message}`);
}

/** The vaults your everyday Obsidian knows, which the sandbox must stay clear of. */
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

function checkCanRun(): void {
	if (process.platform !== "darwin") {
		fail("runs on macOS only for now. Elsewhere, link the repository into a test vault (see CONTRIBUTING.md).");
	}
	if (!existsSync(CLI)) fail(`no Obsidian at ${APP}. Install it, or set OBSIDIAN_APP to where it is.`);
	const refused = refusal(PATHS.root, DAILY_PROFILE, dailyVaults());
	if (refused) fail(refused);
	for (const home of [PATHS.home, PATHS.freshHome]) {
		const problem = socketProblem(home);
		if (problem) fail(problem);
	}
}

/** The sandbox Obsidian's process ID, if it's running. */
function runningPid(): number | null {
	try {
		const out = execFileSync("pgrep", ["-f", `MacOS/Obsidian --user-data-dir=${PATHS.profile}`], {
			encoding: "utf8",
		});
		return Number(out.trim().split("\n")[0]) || null;
	} catch {
		return null; // pgrep exits 1 when nothing matches
	}
}

/** The HOME the running sandbox was started with. */
function activeHome(): string {
	return existsSync(PATHS.runningHome) ? readFileSync(PATHS.runningHome, "utf8").trim() : PATHS.home;
}

/** Runs an obsidian-cli command against the sandbox, never your everyday Obsidian. */
function cli(home: string, ...args: string[]): string {
	try {
		return execFileSync(CLI, args, {
			env: { ...process.env, HOME: home },
			encoding: "utf8",
			timeout: 15000,
		}).trim();
	} catch (error) {
		const { stdout, message } = error as { stdout?: string; message: string };
		return (stdout ?? "").trim() || message;
	}
}

async function writeSamples(): Promise<void> {
	cpSync(join(REPO, "sandbox", "notes"), PATHS.vault, { recursive: true });
	mkdirSync(join(PATHS.vault, "PDFs"), { recursive: true });
	await writeSamplePdfs(join(PATHS.vault, "PDFs"));
}

/** The vault, with Edge Voice enabled and loaded from this repository's build. */
async function prepareVault(): Promise<void> {
	const created = !existsSync(PATHS.vault);
	mkdirSync(PATHS.plugin, { recursive: true });
	if (created) await writeSamples();
	const enabled = join(PATHS.vault, ".obsidian", "community-plugins.json");
	if (!existsSync(enabled)) writeFileSync(enabled, JSON.stringify(["edge-voice"]) + "\n");
	// Links to the build, in a real folder, so the plugin's data.json stays in the sandbox.
	for (const file of PLUGIN_FILES) {
		const link = join(PATHS.plugin, file);
		if (!existsSync(link)) symlinkSync(join(REPO, file), link);
	}
}

/** The sandbox's HOME: links to your engine's heavy parts, or with --fresh, an empty one of its own. */
function prepareHome(fresh: boolean): string {
	if (fresh) {
		rmSync(PATHS.freshHome, { recursive: true, force: true });
		mkdirSync(PATHS.freshHome, { recursive: true });
		return PATHS.freshHome;
	}
	mkdirSync(PATHS.home, { recursive: true });
	for (const { path, target } of engineLinks(homedir(), PATHS.home, process.platform, existsSync)) {
		const current = lstatSync(path, { throwIfNoEntry: false });
		if (current?.isSymbolicLink() && readlinkSync(path) === target) continue;
		if (current) {
			say(`leaving ${path} as it is; it isn't the link to ${target}.`);
			continue;
		}
		mkdirSync(dirname(path), { recursive: true });
		symlinkSync(target, path);
	}
	return PATHS.home;
}

/** The sandbox's Obsidian profile: the one vault, opened at start, with the CLI on; whatever else Obsidian saved stays. */
function prepareProfile(): void {
	mkdirSync(PATHS.profile, { recursive: true });
	const file = join(PATHS.profile, "obsidian.json");
	const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as object) : {};
	writeFileSync(file, JSON.stringify({ ...saved, ...profileConfig(PATHS.vault, Date.now()) }));
}

/** The plugin's interpreter for this start: --python (remembered), none with --fresh. */
function prepareSettings(fresh: boolean, pythonArg: string | undefined): void {
	if (pythonArg) {
		const python = resolve(pythonArg);
		if (!existsSync(python)) fail(`no Python at ${python}.`);
		writeFileSync(PATHS.python, python);
	}
	const python = !fresh && existsSync(PATHS.python) ? readFileSync(PATHS.python, "utf8").trim() : null;
	const file = join(PATHS.plugin, "data.json");
	const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : null;
	writeFileSync(file, JSON.stringify(pluginSettings(saved, python), null, 2));
}

async function launch(home: string): Promise<void> {
	// A socket left from an earlier run would look like a running sandbox.
	rmSync(socketPath(home), { force: true });
	// --use-mock-keychain: macOS looks for the login keychain under HOME, finds none in the sandbox's,
	// and would offer to reset it to defaults. The sandbox stores nothing secret, so it doesn't need one.
	execFileSync("open", [
		"-n",
		"-a",
		APP,
		"--env",
		`HOME=${home}`,
		"--args",
		`--user-data-dir=${PATHS.profile}`,
		"--use-mock-keychain",
	]);
	writeFileSync(PATHS.runningHome, home);
	for (let waited = 0; ; waited += 500) {
		if (existsSync(socketPath(home)) && cli(home, "plugins:restrict") === "on") {
			say(cli(home, "plugins:restrict", "off"));
			return;
		}
		if (existsSync(socketPath(home)) && cli(home, "plugins:restrict") === "off") return;
		if (waited > 30000) fail("the sandbox Obsidian didn't answer within 30 seconds.");
		await new Promise((done) => setTimeout(done, 500));
	}
}

function reload(): void {
	const home = activeHome();
	say(cli(home, "plugin:reload", "id=edge-voice"));
	const errors = cli(home, "dev:errors");
	if (!errors.startsWith("No errors")) console.log(errors);
}

async function start(fresh: boolean, pythonArg: string | undefined): Promise<void> {
	checkCanRun();
	const pid = runningPid();
	if (pid && (fresh || pythonArg)) fail("close the sandbox Obsidian first, to start it with --fresh or --python.");

	// esbuild's watch mode builds once at the start; later builds reload the plugin.
	let firstBuild!: (result: BuildResult) => void;
	const built = new Promise<BuildResult>((done) => (firstBuild = done));
	let ready = false;
	const reloader: Plugin = {
		name: "sandbox-reload",
		setup(build) {
			build.onEnd((result) => {
				if (!ready) firstBuild(result);
				else if (result.errors.length === 0) reload();
			});
		},
	};
	const context = await esbuild.context({ ...buildOptions(false), absWorkingDir: REPO, plugins: [reloader] });
	await context.watch();
	if ((await built).errors.length > 0) say("the build has errors; fix them and it rebuilds.");

	if (pid) {
		say("the sandbox is already open; reloading the plugin.");
		reload();
	} else {
		await prepareVault();
		prepareProfile();
		const home = prepareHome(fresh);
		prepareSettings(fresh, pythonArg);
		say(fresh ? "opening the sandbox with an engine of its own." : "opening the sandbox.");
		await launch(home);
	}
	ready = true;
	say("watching for changes. Ctrl+C stops watching; the sandbox stays open.");
	process.on("SIGINT", () => void context.dispose().then(() => process.exit(0)));
}

async function reset(): Promise<void> {
	checkCanRun();
	if (!existsSync(PATHS.vault)) fail("there's no sandbox yet; run bun run sandbox.");
	for (const entry of readdirSync(PATHS.vault)) {
		if (entry !== ".obsidian") rmSync(join(PATHS.vault, entry), { recursive: true, force: true });
	}
	await writeSamples();
	say("the sample notes and PDFs are back as they were.");
}

function errors(): void {
	checkCanRun();
	if (!runningPid()) fail("the sandbox isn't open.");
	console.log(cli(activeHome(), "dev:errors"));
}

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--python");
const python = args.includes("--python") ? args[args.indexOf("--python") + 1] : undefined;
if (args.includes("--python") && !python) fail("--python needs a path.");

if (command === "reset") await reset();
else if (command === "errors") errors();
else if (command === undefined) await start(args.includes("--fresh"), python);
else fail(`unknown command "${command}". Use: sandbox [--fresh] [--python <path>], sandbox reset, sandbox errors.`);
