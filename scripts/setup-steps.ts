/**
 * Prints the setup steps Edge Voice shows on a platform, as JSON: the exact
 * commands, so CI can run what people are told to run (see the Engine package
 * workflow). With a base URL, the release's address is replaced by it, for a
 * release served locally.
 *
 *   bun scripts/setup-steps.ts <platform> <arch> <faster: true|false> <voice> [base url]
 */
import { ENGINE_VERSION, setupSteps } from "../src/engine";

const [platform, arch, faster, voice, base, dictationModel] = process.argv.slice(2);
const steps = setupSteps({ platform, arch, faster: faster === "true" }, voice, dictationModel);
if (!steps) throw new Error(`No setup steps for ${platform}-${arch}`);
const release = `https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-${ENGINE_VERSION}`;
const commands = steps.flatMap((step) =>
	step.command ? [base ? step.command.replace(release, base) : step.command] : [],
);
console.log(JSON.stringify(commands, null, 2));
