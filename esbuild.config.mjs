import esbuild from "esbuild";
import { builtinModules } from "node:module";

// Node's own modules, also under the node: prefix: Obsidian's Electron provides them.
const builtins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

/** How main.js is built; the sandbox (scripts/sandbox) builds with these too. */
export function buildOptions(production) {
	return {
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
		format: "cjs",
		target: "es2022",
		platform: "node",
		sourcemap: production ? false : "inline",
		treeShaking: true,
		outfile: "main.js",
		logLevel: "info",
	};
}

if (import.meta.main) {
	const production = process.argv[2] === "production";
	const context = await esbuild.context(buildOptions(production));
	if (production) {
		await context.rebuild();
		await context.dispose();
	} else {
		await context.watch();
	}
}
