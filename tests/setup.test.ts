import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { engineSource, LOCKS, MLX_PACKAGES, mlxModelDir, mlxSupported, PACKAGE, platformSupport } from "../src/setup";

const { platform, arch } = process;

function pretend(os: string, cpu: string): void {
	Object.defineProperty(process, "platform", { value: os });
	Object.defineProperty(process, "arch", { value: cpu });
}

afterEach(() => pretend(platform, arch));

describe("setup", () => {
	it.each([
		["darwin", "arm64"],
		["darwin", "x64"],
		["win32", "x64"],
		["win32", "arm64"],
		["linux", "x64"],
		["linux", "arm64"],
	])("sets up on %s-%s", (os, cpu) => {
		pretend(os, cpu);
		expect(platformSupport()).toEqual({ supported: true });
	});

	it("says which platforms it can't set up", () => {
		pretend("linux", "ia32");
		const support = platformSupport();
		expect(support.supported).toBe(false);
		expect(support.reason).toContain("linux-ia32");
	});

	it("installs this repository's wheels on both kinds of Mac", () => {
		expect(engineSource("darwin-x64").wheel?.url).toMatch(
			/\/releases\/download\/moonshine-voice-[^/]+\/.*_x86_64\.whl$/,
		);
		expect(engineSource("darwin-arm64").wheel?.url).toMatch(/_arm64\.whl$/);
		for (const key of ["darwin-x64", "darwin-arm64"]) {
			expect(engineSource(key).wheel?.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it("runs the x64 engine on Windows on ARM", () => {
		expect(engineSource("win32-arm64")).toEqual({ python: "cpython-3.12-windows-x86_64-none", wheel: undefined });
	});

	it("installs from PyPI where it has a package", () => {
		for (const key of ["win32-x64", "linux-x64", "linux-arm64"]) {
			expect(engineSource(key)).toEqual({ python: "3.12", wheel: undefined });
		}
	});

	it("offers the faster engine only on Apple silicon with macOS 14 or later", () => {
		expect(mlxSupported("darwin", "arm64", "23.0.0")).toBe(true); // macOS 14
		expect(mlxSupported("darwin", "arm64", "25.5.0")).toBe(true);
		expect(mlxSupported("darwin", "arm64", "22.6.0")).toBe(false); // macOS 13
		expect(mlxSupported("darwin", "x64", "25.5.0")).toBe(false);
		expect(mlxSupported("win32", "arm64", "10.0.26100")).toBe(false);
		expect(mlxSupported("linux", "arm64", "6.8.0")).toBe(false);
	});

	it("looks for the faster engine's model at the commit server.py pins", () => {
		const server = readFileSync(join(__dirname, "..", "server.py"), "utf8");
		const revision = /^MLX_REVISION = "([0-9a-f]{40})"/m.exec(server)?.[1];
		expect(revision).toBeDefined();
		expect(mlxModelDir()).toBe(
			join(
				homedir(),
				".edge-voice",
				"hf",
				"hub",
				"models--mlx-community--Kokoro-82M-bf16",
				"snapshots",
				revision!,
			),
		);
	});

	it("has a lock with every package hashed for each platform it sets up", () => {
		for (const key of ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"]) {
			const lock = LOCKS[key];
			// The version setup asks for is the one locked: bump one, run scripts/lock-engine.sh.
			expect(lock, key).toContain(`${PACKAGE} \\`);
			const packages = lock.split("\n").filter((line) => /^[a-z0-9]/.test(line));
			expect(packages.length, key).toBeGreaterThan(5);
			for (const line of packages) expect(line, `${key}: ${line}`).toMatch(/==\S+ \\$/);
			expect(lock.split("--hash=sha256:").length - 1, key).toBeGreaterThanOrEqual(packages.length);
		}
	});

	it("locks the faster engine's packages at the versions setup names", () => {
		const lock = readFileSync(join(__dirname, "..", "locks", "darwin-arm64-mlx.txt"), "utf8");
		for (const spec of MLX_PACKAGES) expect(lock).toContain(`${spec.replace("[en]", "")} \\`);
	});
});
