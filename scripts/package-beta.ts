/** Build local BRAT assets without editing versions, committing, tagging or publishing. */
import esbuild from "esbuild";
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildOptions } from "../esbuild.config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { version: string };
const version = process.argv[2];
const escaped = manifest.version.replaceAll(".", "\\.");
if (!version || !new RegExp(`^${escaped}-beta\\.[1-9][0-9]*$`).test(version)) {
	throw new Error(`Usage: bun run package:beta ${manifest.version}-beta.1`);
}
const out = resolve(root, ".scratch", "beta", version);
if (existsSync(out))
	throw new Error(`Output already exists: ${out}. Use a new beta number or inspect/remove it first.`);
mkdirSync(out, { recursive: true });
await esbuild.build({ ...buildOptions(true), absWorkingDir: root, outfile: join(out, "main.js") });
writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...manifest, version }, null, "\t") + "\n");
copyFileSync(join(root, "styles.css"), join(out, "styles.css"));
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));
const files = ["main.js", "manifest.json", "styles.css", "LICENSE"];
const checksums = files.map(
	(file) =>
		`${createHash("sha256")
			.update(readFileSync(join(out, file)))
			.digest("hex")}  ${file}`,
);
writeFileSync(join(out, "SHA256SUMS"), checksums.join("\n") + "\n");
writeFileSync(
	join(out, "BETA-NOTES.md"),
	`# Edge Voice ${version}

Opt-in English dictation beta for Obsidian BRAT. Stable Community users remain on 0.1.5.

## Install with BRAT

In Obsidian, install BRAT and use **Add a beta plugin with frozen version based on a release tag**. Enter **tattorba87/obsidian-edge-voice** and select **${version}**. Try it in a separate test vault: it uses the same edge-voice plugin ID and replaces the plugin files in that vault.

## Set up the local engine

BRAT updates the plugin only. Dictation requires **speech engine 0.4.0** and an English Tiny, Small or Medium streaming model. Follow [setup and update instructions](https://github.com/tattorba87/obsidian-edge-voice/blob/${version}/README.md#setup), then **Settings → Edge Voice → English dictation → Get the dictation model**. Run the shown command yourself and enable dictation. Existing TTS voices/settings are retained; dictation starts disabled.

Click the microphone to start/finish, or double-tap Left Command (Left Ctrl elsewhere) to start and tap once to stop. TTS and STT run one at a time.

## Beta limits and checks

English Markdown editing only. MLX accelerates TTS only. Automated checks passed locally: 234 unit tests, 83 Python tests, 52 Obsidian tests, production build and fresh packaged-engine offline TTS → STT → TTS. Additional workflow results are available in Actions. The real-engine demo uses a cleared recording routed as input; physical microphone permission/device behavior and sustained speech on every platform still need tester feedback. Partial text can change; stop and wait for final text before editing or switching notes.

For rollback, select stable 0.1.5 explicitly in BRAT or reinstall stable, then remove beta tracking. Do not assume an automatic downgrade.

[Dictation guide](https://github.com/tattorba87/obsidian-edge-voice/blob/${version}/docs/dictation.md) · [STT demo with audio](https://github.com/tattorba87/obsidian-edge-voice/blob/${version}/docs/media/dictation-dark.mp4) · [License and model notes](https://github.com/tattorba87/obsidian-edge-voice/blob/${version}/docs/licenses.md)
`,
);
process.stdout.write(`Prepared BRAT assets: ${out}\nNothing was committed, tagged or published.\n`);
