import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		{
			// esbuild bundles server.py and the locks as text (see esbuild.config.mjs); do the same here.
			// "pre" and load(), since Vite would otherwise turn a .txt import into an asset URL.
			name: "bundled-text",
			enforce: "pre",
			load(id) {
				return /\.(py|txt)$/.test(id)
					? `export default ${JSON.stringify(readFileSync(id, "utf8"))};`
					: undefined;
			},
		},
	],
	resolve: {
		alias: { obsidian: fileURLToPath(new URL("./tests/stubs/obsidian.ts", import.meta.url)) },
	},
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
