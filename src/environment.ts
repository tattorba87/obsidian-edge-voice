/**
 * The environment for the programs the plugin starts (the engine's Python,
 * uv): Obsidian's, without the variables that change which code Python or the
 * dynamic linker loads, or where uv installs from and with what settings. A
 * stray PYTHONPATH, DYLD_INSERT_LIBRARIES or UV_INDEX_URL would otherwise
 * quietly change what runs. Proxy and certificate settings stay, so
 * downloads still work behind a proxy.
 */
const DROPPED = [/^PYTHON/, /^DYLD_/, /^LD_/, /^UV_/, /^PIP_/, /^VIRTUAL_ENV$/, /^CONDA_PREFIX$/];

export function childEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(base)) {
		if (!DROPPED.some((pattern) => pattern.test(name))) env[name] = value;
	}
	return env;
}
