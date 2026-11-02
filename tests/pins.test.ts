import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * What an engine release installs: engine/pins.json, the engine package's
 * pyproject.toml and the locks must agree (scripts/lock-engine.sh writes the
 * locks from pins.json; bump a version there, then run it).
 */
const ROOT = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const pins = JSON.parse(read("engine", "pins.json")) as {
	moonshine: { package: string; macWheels: Record<string, { asset: string; sha256: string }> };
	mlx: { packages: string[]; spacyModel: { url: string; sha256: string } };
};
const LOCKS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];

describe("Engine pins and locks", () => {
	it("has a lock with every package hashed for each platform", () => {
		for (const key of LOCKS) {
			const lock = read("locks", `${key}.txt`);
			expect(lock, key).toContain(`${pins.moonshine.package} \\`);
			const packages = lock.split(/\r?\n/).filter((line) => /^[a-z0-9]/.test(line));
			expect(packages.length, key).toBeGreaterThan(5);
			for (const line of packages) expect(line, `${key}: ${line}`).toMatch(/==\S+ \\$/);
			expect(lock.split("--hash=sha256:").length - 1, key).toBeGreaterThanOrEqual(packages.length);
		}
	});

	it("locks this repository's Mac wheels by the checksums pinned for them", () => {
		for (const [key, wheel] of Object.entries(pins.moonshine.macWheels)) {
			expect(wheel.asset).toMatch(/^moonshine_voice-.*macosx_13_0_(x86_64|arm64)\.whl$/);
			expect(read("locks", `${key}.txt`)).toContain(wheel.sha256);
		}
	});

	it("locks the faster engine's packages and spaCy's model as pinned", () => {
		const lock = read("locks", "darwin-arm64-mlx.txt");
		for (const spec of pins.mlx.packages) expect(lock).toContain(`${spec.replace("[en]", "")} \\`);
		expect(lock).toContain(pins.mlx.spacyModel.sha256);
	});

	it("gives the engine package the same pins", () => {
		const project = read("engine", "pyproject.toml");
		const list = (name: string) =>
			[...(project.match(new RegExp(`^${name} = \\[(.*)\\]$`, "m"))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
				(match) => match[1],
			);
		expect(list("dependencies")).toEqual([pins.moonshine.package]);
		expect(list("mlx")).toEqual(pins.mlx.packages);
	});

	it("points the plugin at the engine version being released", () => {
		const version = /^version = "(.*)"$/m.exec(read("engine", "pyproject.toml"))?.[1];
		expect(read("src", "engine.ts")).toContain(`export const ENGINE_VERSION = "${version}";`);
		expect(read("engine", "src", "edge_voice_engine", "server.py")).toMatch(/^PROTOCOL = 1$/m);
		expect(read("src", "engine.ts")).toContain("export const ENGINE_PROTOCOL = 1;");
	});
});
