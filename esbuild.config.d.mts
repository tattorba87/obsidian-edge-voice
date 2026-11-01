import type { BuildOptions } from "esbuild";

/** How main.js is built (esbuild.config.mjs). */
export function buildOptions(production: boolean): BuildOptions;
