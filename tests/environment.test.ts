import { describe, expect, it } from "vitest";
import { childEnvironment } from "../src/environment";

describe("The environment the engine and uv start with", () => {
	const env = childEnvironment({
		PATH: "/usr/bin",
		HOME: "/home/me",
		HTTPS_PROXY: "http://proxy:8080",
		SSL_CERT_FILE: "/etc/ssl/corp.pem",
		MOONSHINE_VOICE_CACHE: "/cache",
		EDGE_VOICE_FAKE_LOG: "/tmp/log",
		PYTHONPATH: "/evil",
		PYTHONSTARTUP: "/evil/start.py",
		DYLD_INSERT_LIBRARIES: "/evil.dylib",
		LD_PRELOAD: "/evil.so",
		UV_INDEX_URL: "https://evil.example/simple",
		PIP_INDEX_URL: "https://evil.example/simple",
		VIRTUAL_ENV: "/somewhere/else",
		CONDA_PREFIX: "/opt/conda",
	});

	it("drops what changes which code Python or the linker loads, or where uv installs from", () => {
		for (const name of [
			"PYTHONPATH",
			"PYTHONSTARTUP",
			"DYLD_INSERT_LIBRARIES",
			"LD_PRELOAD",
			"UV_INDEX_URL",
			"PIP_INDEX_URL",
			"VIRTUAL_ENV",
			"CONDA_PREFIX",
		]) {
			expect(env).not.toHaveProperty(name);
		}
	});

	it("keeps the rest: paths, proxy and certificates, and the engine's own settings", () => {
		expect(env).toEqual({
			PATH: "/usr/bin",
			HOME: "/home/me",
			HTTPS_PROXY: "http://proxy:8080",
			SSL_CERT_FILE: "/etc/ssl/corp.pem",
			MOONSHINE_VOICE_CACHE: "/cache",
			EDGE_VOICE_FAKE_LOG: "/tmp/log",
		});
	});
});
