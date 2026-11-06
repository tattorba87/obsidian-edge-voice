/**
 * The development sandbox: a second Obsidian with its own profile, HOME and
 * sample vault, running the plugin built from this repository. Your everyday
 * Obsidian, its settings and its vaults are never touched.
 *
 *   bun run sandbox [--fresh] [--python <path>]   build, open, and reload on every change
 *   bun run sandbox:reset                         put the sample notes and PDFs back
 *   bun run sandbox:errors                        errors from the running sandbox
 *
 * The work of preparing, starting and driving it is in obsidian.ts, shared
 * with the tests against real Obsidian.
 */
import esbuild, { BuildResult, Plugin } from "esbuild";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { buildOptions } from "../../esbuild.config.mjs";
import { Sandbox, SandboxError } from "./obsidian";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const sandbox = new Sandbox(REPO, ".sandbox", say);

function say(message: string): void {
	console.log(`sandbox: ${message}`);
}

function reload(): void {
	say(sandbox.cli("plugin:reload", "id=edge-voice"));
	const errors = sandbox.cli("dev:errors");
	if (!errors.startsWith("No errors")) console.log(errors);
}

async function start(fresh: boolean, python: string | undefined): Promise<void> {
	sandbox.checkCanRun();
	const pid = sandbox.runningPid();
	if (pid && (fresh || python)) {
		throw new SandboxError("close the sandbox Obsidian first, to start it with --fresh or --python.");
	}

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
		await sandbox.prepareVault();
		sandbox.prepareProfile();
		const home = sandbox.prepareHome(fresh);
		sandbox.prepareSettings(fresh, python);
		say(fresh ? "opening the sandbox with an engine of its own." : "opening the sandbox.");
		await sandbox.launch(home, {}, args.includes("--background"));
	}
	ready = true;
	say("watching for changes. Ctrl+C stops watching; the sandbox stays open.");
	process.on("SIGINT", () => void context.dispose().then(() => process.exit(0)));
}

async function reset(): Promise<void> {
	sandbox.checkCanRun();
	if (!existsSync(sandbox.paths.vault)) throw new SandboxError("there's no sandbox yet; run bun run sandbox.");
	await sandbox.resetSamples();
	say("the sample notes and PDFs are back as they were.");
}

function errors(): void {
	sandbox.checkCanRun();
	if (!sandbox.runningPid()) throw new SandboxError("the sandbox isn't open.");
	console.log(sandbox.cli("dev:errors"));
}

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--python");
const python = args.includes("--python") ? args[args.indexOf("--python") + 1] : undefined;

try {
	if (args.includes("--python") && !python) throw new SandboxError("--python needs a path.");
	if (command === "reset") await reset();
	else if (command === "errors") errors();
	else if (command === undefined) await start(args.includes("--fresh"), python);
	else {
		throw new SandboxError(
			`unknown command "${command}". Use: sandbox [--fresh] [--python <path>], sandbox reset, sandbox errors.`,
		);
	}
} catch (error) {
	if (!(error instanceof SandboxError)) throw error;
	console.error(`sandbox: ${error.message}`);
	process.exit(1);
}
