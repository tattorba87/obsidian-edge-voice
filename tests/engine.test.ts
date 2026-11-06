import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	ENGINE_PROTOCOL,
	engineUpdateAvailable,
	enginePython,
	findEngine,
	mlxSupported,
	engineStorage,
	formatBytes,
	removeCommand,
	requirementsFile,
	Runner,
	setupSteps,
	voiceCommand,
} from "../src/engine";

const mac = { platform: "darwin", arch: "arm64", faster: false };

describe("The engine's setup steps", () => {
	it.each([
		["darwin", "arm64", false, "requirements-darwin-arm64.txt"],
		["darwin", "arm64", true, "requirements-darwin-arm64-mlx.txt"],
		["darwin", "x64", false, "requirements-darwin-x64.txt"],
		["linux", "x64", false, "requirements-linux-x64.txt"],
		["linux", "arm64", false, "requirements-linux-arm64.txt"],
		["win32", "x64", false, "requirements-win32-x64.txt"],
		// Windows on ARM runs the x64 engine under emulation.
		["win32", "arm64", false, "requirements-win32-x64.txt"],
	])("on %s-%s (faster: %s) installs %s", (platform, arch, faster, file) => {
		expect(requirementsFile({ platform, arch, faster })).toBe(file);
	});

	it("has no steps for a computer there's no engine for", () => {
		expect(requirementsFile({ platform: "linux", arch: "ia32", faster: false })).toBeNull();
		expect(setupSteps({ platform: "linux", arch: "ia32", faster: false }, "kokoro_af_bella")).toBeNull();
	});

	it("explains each step and gives Terminal commands on a Mac", () => {
		const steps = setupSteps(mac, "kokoro_af_bella")!;
		expect(steps.map((step) => step.title)).toEqual([
			"Install uv",
			"Create the engine's folder",
			"Install the engine",
			"Download a voice",
		]);
		expect(steps[0].command).toBeUndefined();
		expect(steps[0].link).toBe("https://docs.astral.sh/uv/getting-started/installation/");
		expect(steps[1].command).toBe("uv venv --clear --managed-python ~/.edge-voice/engine --python 3.12");
		expect(steps[2].command).toBe(
			"uv pip install --python ~/.edge-voice/engine --require-hashes --no-build -r " +
				"https://github.com/tattorba87/obsidian-edge-voice/releases/download/engine-0.4.0/requirements-darwin-arm64.txt",
		);
		// The file can be read before anything runs.
		expect(steps[2].link).toBe(steps[2].command!.split(" -r ")[1]);
		expect(steps[3].command).toBe("~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_af_bella");
		expect(steps[3].text).toContain("download.moonshine.ai");
		for (const step of steps) expect(step.text.length).toBeGreaterThan(40);
		// Nothing a careful person would balk at.
		for (const step of steps)
			expect(step.command ?? "").not.toMatch(/sudo|curl|\| *(sh|bash)|iex|Invoke-Expression/);
	});

	it("gets the voice for the faster engine too when it's included", () => {
		const steps = setupSteps({ ...mac, faster: true }, "kokoro_af_bella")!;
		expect(steps[2].command).toMatch(/requirements-darwin-arm64-mlx\.txt$/);
		expect(steps[3].command).toMatch(/voices get kokoro_af_bella --faster$/);
		expect(steps[3].text).toContain("Hugging Face");
		// Piper voices have no faster-engine version.
		expect(setupSteps({ ...mac, faster: true }, "piper_en_US-lessac-medium")![3].command).not.toContain("--faster");
	});

	it("gives PowerShell commands on Windows, with an x64 Python on ARM", () => {
		const steps = setupSteps({ platform: "win32", arch: "x64", faster: false }, "kokoro_af_bella")!;
		expect(steps[1].command).toBe('uv venv --clear --managed-python "$HOME\\.edge-voice\\engine" --python 3.12');
		expect(steps[2].command).toMatch(/^uv pip install --python "\$HOME\\\.edge-voice\\engine" --require-hashes/);
		expect(steps[3].command).toBe(
			'& "$HOME\\.edge-voice\\engine\\Scripts\\edge-voice-engine.exe" voices get kokoro_af_bella',
		);
		const arm = setupSteps({ platform: "win32", arch: "arm64", faster: false }, "kokoro_af_bella")!;
		expect(arm[1].command).toMatch(/--python cpython-3\.12-windows-x86_64-none$/);
	});

	it("names the voice command for each platform", () => {
		expect(voiceCommand("kokoro_am_santa", false, "linux")).toBe(
			"~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_am_santa",
		);
		expect(voiceCommand("kokoro_am_santa", true, "darwin")).toMatch(/ --faster$/);
	});

	it("offers the faster engine only on Apple silicon with macOS 14 or later", () => {
		expect(mlxSupported("darwin", "arm64", "23.0.0")).toBe(true); // macOS 14
		expect(mlxSupported("darwin", "arm64", "25.5.0")).toBe(true);
		expect(mlxSupported("darwin", "arm64", "22.6.0")).toBe(false); // macOS 13
		expect(mlxSupported("darwin", "x64", "25.5.0")).toBe(false);
		expect(mlxSupported("win32", "arm64", "10.0.26100")).toBe(false);
		expect(mlxSupported("linux", "arm64", "6.8.0")).toBe(false);
	});
});

describe("Finding the engine", () => {
	/** A file standing in for a Python, and a runner answering for it as `answer` says. */
	function python(answer: Record<string, unknown> | null): { path: string; run: Runner; calls: string[][] } {
		const path = join(mkdtempSync(join(tmpdir(), "edge-voice-engine-")), "python");
		writeFileSync(path, "");
		chmodSync(path, 0o755);
		const calls: string[][] = [];
		const run: Runner = (command, args) => {
			calls.push([command, ...args]);
			if (command === path && answer)
				return Promise.resolve({ code: 0, stdout: `noise\n${JSON.stringify(answer)}\n` });
			return Promise.resolve({ code: 1, stdout: "" });
		};
		return { path, run, calls };
	}

	it("uses the Python set in settings when it has the engine, asking it isolated", async () => {
		const found = python({ version: "0.2.0", protocol: ENGINE_PROTOCOL, faster: true });
		expect(await findEngine(found.path, found.run)).toEqual({
			engine: { python: found.path, version: "0.2.0", protocol: ENGINE_PROTOCOL, faster: true },
		});
		expect(found.calls[0].slice(0, 3)).toEqual([found.path, "-I", "-c"]);
	});

	it("refuses a Python path that isn't a full path", async () => {
		const { problem } = await findEngine("python3");
		expect(problem).toContain("full path");
	});

	it("says when the Python there has no engine", async () => {
		const empty = python(null);
		expect((await findEngine(empty.path, empty.run)).problem).toContain("doesn't have the speech engine installed");
	});

	it("tells an engine too old from one too new", async () => {
		const old = python({ version: "0.1.0", protocol: ENGINE_PROTOCOL - 1 });
		expect((await findEngine(old.path, old.run)).problem).toMatch(/too old.*Update it/);
		const newer = python({ version: "9.0.0", protocol: ENGINE_PROTOCOL + 1 });
		expect((await findEngine(newer.path, newer.run)).problem).toMatch(/newer.*Update Edge Voice/);
	});

	it("finds nothing, and no problem, when nothing is installed", async () => {
		// Starting a program that isn't there fails with ENOENT; the plugin checks no files itself.
		const run: Runner = () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
		expect(await findEngine("/nonexistent/python", run)).toEqual({});
	});

	it("looks in ~/.edge-voice/engine by default", () => {
		expect(enginePython("darwin")).toBe(join(homedir(), ".edge-voice", "engine", "bin", "python"));
		expect(enginePython("win32")).toBe(join(homedir(), ".edge-voice", "engine", "Scripts", "python.exe"));
	});
});

describe("Storage, as the engine reports it", () => {
	const kokoro = { id: "kokoro", label: "Kokoro voices", description: "The Kokoro model.", bytes: 330_000_000 };

	it("asks the engine, isolated, and keeps only well-formed items", async () => {
		const calls: string[][] = [];
		const run: Runner = (command, args) => {
			calls.push([command, ...args]);
			return Promise.resolve({ code: 0, stdout: JSON.stringify([kokoro, { id: 3 }, "nonsense"]) });
		};
		expect(await engineStorage("/engine/python", run)).toEqual([kokoro]);
		expect(calls).toEqual([["/engine/python", "-I", "-m", "edge_voice_engine", "storage", "--json"]]);
	});

	it("says null for an engine without the storage command (before 0.3.0), or bad output", async () => {
		const old: Runner = () => Promise.resolve({ code: 2, stdout: "" });
		expect(await engineStorage("/engine/python", old)).toBeNull();
		const garbled: Runner = () => Promise.resolve({ code: 0, stdout: "{" });
		expect(await engineStorage("/engine/python", garbled)).toBeNull();
	});

	it("writes the remove command for this computer", () => {
		expect(removeCommand(["piper:en_US-amy-low"], "darwin")).toBe(
			"~/.edge-voice/engine/bin/edge-voice-engine storage remove piper:en_US-amy-low",
		);
		expect(removeCommand([], "linux")).toBe("~/.edge-voice/engine/bin/edge-voice-engine storage remove --all");
		expect(removeCommand(["kokoro", "mlx"], "win32")).toBe(
			'& "$HOME\\.edge-voice\\engine\\Scripts\\edge-voice-engine.exe" storage remove kokoro mlx',
		);
	});

	it("formats sizes", () => {
		expect(formatBytes(512)).toBe("1 KB");
		expect(formatBytes(84_000_000)).toBe("84 MB");
		expect(formatBytes(1_250_000_000)).toBe("1.3 GB");
	});
});

describe("Engine update recommendation", () => {
	it("detects bug-fix updates even when protocol compatibility is unchanged", () => {
		expect(engineUpdateAvailable("0.3.0", "0.3.1")).toBe(true);
		expect(engineUpdateAvailable("0.2.9", "0.3.0")).toBe(true);
		expect(engineUpdateAvailable("0.9.0", "0.10.0")).toBe(true);
	});
	it("does not suggest a downgrade, reinstall or guessed version", () => {
		for (const version of ["0.3.0", "0.3.1", "1.0.0", "unknown", "0.3.0-dev"])
			expect(engineUpdateAvailable(version, "0.3.0")).toBe(false);
	});
});
