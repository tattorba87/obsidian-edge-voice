/**
 * Installs the sandbox's own speech engine, separate from yours: the setup
 * steps Edge Voice shows people, run with HOME set to the sandbox's, so
 * `~/.edge-voice` means `.sandbox/home/.edge-voice`. Your own engine, voices,
 * models and everyday Obsidian are never used or changed.
 *
 *   bun run sandbox:engine [--model tiny|small|medium] [--copy]
 *
 * --model also gets an English dictation model. --copy clones the voice and
 * model files you already have (a read-only copy; instant on APFS) instead of
 * downloading them again; the engine checks their SHA-256 either way.
 */
import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_VOICE, setupSteps } from "../../src/engine";
import { Sandbox } from "./obsidian";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
if (model && !["tiny", "small", "medium"].includes(model)) throw new Error("--model is tiny, small or medium");
const copy = args.includes("--copy");

const sandbox = new Sandbox(REPO, ".sandbox", (message) => process.stderr.write(`sandbox: ${message}\n`));
const home = sandbox.prepareHome(false);
const env = { ...process.env, HOME: home };
const say = (message: string) => process.stderr.write(`sandbox: ${message}\n`);

if (copy) {
	// Read-only copies of what you already downloaded; nothing of yours is moved or linked.
	const caches =
		process.platform === "darwin"
			? join("Library", "Caches", "moonshine_voice")
			: join(".cache", "moonshine_voice");
	const pairs = [[join(homedir(), caches), join(home, caches)]];
	if (model) {
		const folder = join(".edge-voice", "models", `${model}-streaming-en`);
		pairs.push([join(homedir(), folder), join(home, folder)]);
	}
	for (const [from, to] of pairs) {
		if (!existsSync(from) || existsSync(to)) continue;
		say(`copying ${from} into the sandbox.`);
		mkdirSync(join(to, ".."), { recursive: true });
		cpSync(from, to, { recursive: true, verbatimSymlinks: true });
	}
}

const steps = setupSteps({ platform: process.platform, arch: process.arch, faster: false }, DEFAULT_VOICE, model);
if (!steps) throw new Error(`No setup steps for ${process.platform}-${process.arch}`);
for (const step of steps) {
	if (!step.command) continue;
	say(`running: ${step.command}`);
	execFileSync(
		process.platform === "win32" ? "powershell" : "bash",
		process.platform === "win32" ? ["-Command", step.command] : ["-c", step.command],
		{ env, stdio: "inherit" },
	);
}
say(`the sandbox's own engine is ready in ${join(home, ".edge-voice")}. Start it with bun run sandbox.`);
