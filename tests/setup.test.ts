import { afterEach, describe, expect, it } from "vitest";
import { engineSource, platformSupport } from "../src/setup";

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
	});

	it("runs the x64 engine on Windows on ARM", () => {
		expect(engineSource("win32-arm64")).toEqual({ python: "cpython-3.12-windows-x86_64-none", wheel: undefined });
	});

	it("installs from PyPI where it has a package", () => {
		for (const key of ["win32-x64", "linux-x64", "linux-arm64"]) {
			expect(engineSource(key)).toEqual({ python: "3.12", wheel: undefined });
		}
	});
});
