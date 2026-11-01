import builtins from "builtin-modules";
import esbuild from "esbuild";

/** How main.js is built; the sandbox (scripts/sandbox) builds with these too. */
export function buildOptions(production) {
	return {
		entryPoints: ["src/main.ts"],
		// server.py and the engine's locks ship inside main.js; Obsidian installs only main.js, manifest.json and styles.css.
		loader: { ".py": "text", ".txt": "text" },
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
