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
		files: ["src/**/*.ts"],
		rules: {
			// Obsidian's Setting and other components have a then() method, so a promise callback that
			// returns one (\`.catch((e) => setting.setDesc(...))\`) makes the promise call it, and it calls
			// back, forever: Obsidian freezes. Write the callback with braces.
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression[callee.property.name=/^(then|catch|finally)$/] > ArrowFunctionExpression[body.type='CallExpression'][body.callee.property.name=/^(set|add)[A-Z]/]",
					message:
						"This callback returns an Obsidian component, whose then() method a promise would call forever. Use braces.",
				},
			],
		},
	},
	{
		rules: {
			// Proper nouns the plugin's UI text names.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: [
						"Obsidian",
						"Python",
						"Kokoro",
						"Piper",
						"Moonshine",
						"Mac",
						"Edge Voice",
						"English",
						"Markdown",
					],
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
	{
		// The tests' stand-in for Obsidian's createEl has to make elements the plain way.
		files: ["tests/support/obsidian-dom.ts"],
		rules: { "obsidianmd/prefer-create-el": "off" },
	},
	globalIgnores([
		"main.js",
		"node_modules/",
		".scratch/",
		".sandbox/",
		".sandbox-test/",
		".sandbox-demo/",
		".sandbox-stt-demo/",
		"coverage/",
		"scripts/",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"versions.json",
	]),
);
