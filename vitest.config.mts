import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		{
			// esbuild bundles server.py as text (see esbuild.config.mjs); do the same here.
			name: "python-as-text",
			transform(code, id) {
				return id.endsWith(".py") ? `export default ${JSON.stringify(code)};` : undefined;
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
