import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { obsidian: fileURLToPath(new URL("./tests/stubs/obsidian.ts", import.meta.url)) },
	},
	test: {
		include: ["tests/**/*.test.ts"],
		// Those run real Obsidian, with their own config (vitest.obsidian.config.mts).
		exclude: ["tests/obsidian/**", "**/node_modules/**"],
		environment: "node",
	},
});
