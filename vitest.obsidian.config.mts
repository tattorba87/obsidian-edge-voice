import { defineConfig } from "vitest/config";

// The tests against real Obsidian (tests/obsidian): one sandbox Obsidian, opened
// once by the global setup and shared, so the files run one after another.
export default defineConfig({
	test: {
		include: ["tests/obsidian/**/*.test.ts"],
		environment: "node",
		globalSetup: ["tests/obsidian/global-setup.ts"],
		fileParallelism: false,
		testTimeout: 60000,
		// Obsidian on a shared CI Mac occasionally stops answering for a while; one more try
		// tells that from a real failure, which fails twice.
		retry: 1,
		hookTimeout: 180000,
	},
});
