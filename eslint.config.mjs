import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// The same rules Obsidian's community-plugin review runs (eslint-plugin-obsidianmd
// recommended: ESLint core, type-checked typescript-eslint, Obsidian's own rules).
export default tseslint.config(
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.mjs", "esbuild.config.mjs", "manifest.json"] },
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			// Proper nouns the plugin's UI text names.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: ["Obsidian", "Python", "Kokoro", "Piper", "Moonshine", "Mac", "Edge Voice"],
					acronyms: ["MB", "PDF"],
					ignoreWords: ["PDFs"],
				},
			],
			// The plugin supports Obsidian 1.5+, older than the declarative
			// settings API (1.13) these rules point to.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		// Tests run in Node, not in Obsidian windows.
		files: ["tests/**"],
		rules: { "obsidianmd/prefer-window-timers": "off" },
	},
	globalIgnores([
		"main.js",
		"node_modules/",
		".scratch/",
		"coverage/",
		"scripts/",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"versions.json",
	]),
);
