/**
 * Where the sandbox keeps everything, and the decisions about it that don't
 * touch the disk, so they can be tested. See main.ts for what uses them.
 */
import { isAbsolute, join, relative } from "path";

/** The sandbox vault's ID in its Obsidian profile. Fixed, because restricted mode is remembered per vault ID. */
export const VAULT_ID = "ed9e5a1dbe0a5b0c";

/** macOS keeps socket paths to 104 bytes, the terminating zero included. */
const MAX_SOCKET_PATH = 103;

export interface Layout {
	root: string;
	/** Obsidian's profile (--user-data-dir): its vault list, settings and storage. */
	profile: string;
	/** HOME for a sandbox sharing the daily engine. */
	home: string;
	/** HOME for `--fresh`: an engine of its own, installed from scratch. */
	freshHome: string;
	vault: string;
	plugin: string;
	/** Which HOME the running sandbox was started with, so the CLI can find it. */
	runningHome: string;
	/** The --python remembered from an earlier start. */
	python: string;
}

export function layout(repo: string): Layout {
	const root = join(repo, ".sandbox");
	const vault = join(root, "vault");
	return {
		root,
		profile: join(root, "profile"),
		home: join(root, "home"),
		freshHome: join(root, "home-fresh"),
		vault,
		plugin: join(vault, ".obsidian", "plugins", "edge-voice"),
		runningHome: join(root, "running-home"),
		python: join(root, "python"),
	};
}

/** Where Obsidian's command line interface listens, for an Obsidian started with `home` as HOME. */
export function socketPath(home: string): string {
	return join(home, ".obsidian-cli.sock");
}

/** Why the sandbox can't use `home`, or null if it can. */
export function socketProblem(home: string): string | null {
	const socket = socketPath(home);
	if (Buffer.byteLength(socket) <= MAX_SOCKET_PATH) return null;
	return (
		`The sandbox's path is too long for Obsidian's command line socket (${Buffer.byteLength(socket)} bytes, ` +
		`macOS allows ${MAX_SOCKET_PATH}): ${socket}. Move the repository to a shorter path.`
	);
}

export interface Link {
	/** The link, inside the sandbox home. */
	path: string;
	/** What it points at, in the real home. */
	target: string;
}

/**
 * The parts of the daily engine a shared sandbox links to, so nothing is
 * installed or downloaded twice: the engine folder's Python, packages, uv and
 * its cache, the MLX voices (hf), and Moonshine's voice cache, which follows
 * HOME. Only what exists is linked. server.py is left out on purpose: the
 * sandbox writes its own, so a development version never replaces the one the
 * daily plugin runs.
 */
export function engineLinks(
	realHome: string,
	sandboxHome: string,
	platform: NodeJS.Platform,
	exists: (path: string) => boolean,
): Link[] {
	const parts = ["bin", "python", "venv", "cache", "hf"].map((name) => join(".edge-voice", name));
	// Where platformdirs puts Moonshine's cache, under HOME. The sandbox runs on macOS only for now (see main.ts).
	if (platform === "darwin") parts.push(join("Library", "Caches", "moonshine_voice"));
	else if (platform === "linux") parts.push(join(".cache", "moonshine_voice"));
	return parts
		.map((part) => ({ path: join(sandboxHome, part), target: join(realHome, part) }))
		.filter((link) => exists(link.target));
}

/** The sandbox profile's obsidian.json: the one vault, opened at start, and the command line interface on. */
export function profileConfig(vault: string, now: number): object {
	return { vaults: { [VAULT_ID]: { path: vault, ts: now, open: true } }, cli: true };
}

/**
 * The plugin's settings for this start: `python` as its interpreter, or none,
 * so the plugin uses (or installs) the engine in its home. Everything else is
 * left as the sandbox last saved it.
 */
export function pluginSettings(saved: Record<string, unknown> | null, python: string | null): Record<string, unknown> {
	const settings: Record<string, unknown> = { ...saved };
	if (python) settings.pythonPath = python;
	else delete settings.pythonPath;
	return settings;
}

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Why the sandbox must not use `root`, or null if it may: never inside the
 * daily Obsidian's profile or any of its vaults, and never around them.
 */
export function refusal(root: string, dailyProfile: string, dailyVaults: string[]): string | null {
	for (const place of [dailyProfile, ...dailyVaults]) {
		if (isInside(root, place) || isInside(place, root)) {
			return `Refusing to use ${root}: it overlaps ${place}, which belongs to your everyday Obsidian.`;
		}
	}
	return null;
}
