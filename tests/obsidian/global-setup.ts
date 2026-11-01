/**
 * Opens one sandbox Obsidian for all the tests against real Obsidian, with the
 * plugin built from this repository and a fake engine (fake-python), and
 * closes it afterwards. The sandbox is .sandbox-test, made fresh every run;
 * the development sandbox (.sandbox) and your everyday Obsidian are untouched.
 */
import esbuild from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { buildOptions } from "../../esbuild.config.mjs";
import { REPO, REQUESTS, sandbox } from "./obsidian";

export async function setup(): Promise<() => Promise<void>> {
	sandbox.checkCanRun();
	await sandbox.close();
	rmSync(sandbox.paths.root, { recursive: true, force: true });
	await esbuild.build({ ...buildOptions(true), absWorkingDir: REPO, logLevel: "warning" });

	await sandbox.prepareVault();
	sandbox.prepareProfile();
	const home = sandbox.prepareHome(true);
	sandbox.prepareSettings(false, join(REPO, "tests", "obsidian", "fake-python"));
	// The faster engine only sets itself up with the plugin's own Python, but say so anyway.
	const settings = join(sandbox.paths.plugin, "data.json");
	writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, "utf8")), fasterEngine: false }));

	await sandbox.launch(home, {
		EDGE_VOICE_FAKE_LOG: REQUESTS,
		// About as long as Kokoro takes to say it, so a sentence stays highlighted long enough to look at.
		EDGE_VOICE_FAKE_SECONDS_PER_CHAR: "0.06",
	});
	await sandbox.waitForPlugin("edge-voice");

	return async () => {
		sandbox.cli("dev:screenshot", `path=${join(sandbox.paths.root, "last.png")}`);
		await sandbox.close();
	};
}
