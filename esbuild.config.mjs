import builtins from "builtin-modules";
import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
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
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
