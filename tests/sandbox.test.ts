import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	engineLinks,
	isInside,
	layout,
	pluginSettings,
	profileConfig,
	refusal,
	socketPath,
	socketProblem,
	VAULT_ID,
} from "../scripts/sandbox/layout";

describe("sandbox layout", () => {
	const paths = layout("/repo");

	it("keeps everything in .sandbox, with the plugin inside the vault", () => {
		expect(paths.root).toBe(join("/repo", ".sandbox"));
		expect(paths.plugin.startsWith(paths.vault)).toBe(true);
		expect(paths.plugin.endsWith(join("plugins", "edge-voice"))).toBe(true);
		expect(paths.home).not.toBe(paths.freshHome);
	});

	it("puts the CLI socket in the sandbox's own HOME, and refuses a path macOS can't use", () => {
		expect(socketPath(paths.home)).toBe(join(paths.home, ".obsidian-cli.sock"));
		expect(socketProblem(paths.home)).toBeNull();
		expect(socketProblem("/" + "a".repeat(100))).toMatch(/too long/);
	});

	it("links only the engine parts that exist, and never server.py", () => {
		const real = (...parts: string[]) => join("/home/me", ...parts);
		const existing = new Set([
			real(".edge-voice", "venv"),
			real(".edge-voice", "python"),
			real(".edge-voice", "server.py"),
			real("Library", "Caches", "moonshine_voice"),
		]);
		const links = engineLinks("/home/me", "/sbx", "darwin", (path) => existing.has(path));
		expect(links).toEqual([
			{ path: join("/sbx", ".edge-voice", "python"), target: real(".edge-voice", "python") },
			{ path: join("/sbx", ".edge-voice", "venv"), target: real(".edge-voice", "venv") },
			{
				path: join("/sbx", "Library", "Caches", "moonshine_voice"),
				target: real("Library", "Caches", "moonshine_voice"),
			},
		]);
	});

	it("registers the one vault, opened at start, with the command line interface on", () => {
		expect(profileConfig("/repo/.sandbox/vault", 5)).toEqual({
			vaults: { [VAULT_ID]: { path: "/repo/.sandbox/vault", ts: 5, open: true } },
			cli: true,
		});
		expect(VAULT_ID).toMatch(/^[0-9a-f]{16}$/);
	});

	it("sets the plugin's Python, or removes it so the plugin uses its own engine, keeping other settings", () => {
		expect(pluginSettings({ voice: "kokoro_am_santa" }, "/py")).toEqual({
			voice: "kokoro_am_santa",
			pythonPath: "/py",
		});
		expect(pluginSettings({ voice: "kokoro_am_santa", pythonPath: "/py" }, null)).toEqual({
			voice: "kokoro_am_santa",
		});
		expect(pluginSettings(null, null)).toEqual({});
	});

	it("refuses to overlap your everyday Obsidian's profile or vaults, either way round", () => {
		const profile = "/home/me/Library/Application Support/obsidian";
		expect(refusal("/repo/.sandbox", profile, ["/home/me/Notes"])).toBeNull();
		expect(refusal("/home/me/Notes/dev/.sandbox", profile, ["/home/me/Notes"])).toMatch(/everyday Obsidian/);
		expect(refusal("/home/me", profile, [])).toMatch(/everyday Obsidian/);
		expect(isInside("/a/bc", "/a/b")).toBe(false);
	});
});
