/**
 * Checks for what's read back from the plugin's saved settings (data.json),
 * which could be edited by hand, synced from another device, or left by an
 * older version. A value is kept only if it has the type its default has;
 * anything else falls back to the default instead of reaching the engine.
 */

/** A voice or language ID: they become file and model names in the engine. */
const ENGINE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isEngineId(value: unknown): value is string {
	return typeof value === "string" && ENGINE_ID.test(value);
}

/**
 * The saved settings that match their defaults' types: strings, finite
 * numbers, booleans, and null where the default is null (or a string there).
 */
export function savedSettings<T extends object>(saved: unknown, defaults: T): Partial<T> {
	if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return {};
	const kept: Partial<T> = {};
	for (const key of Object.keys(defaults) as (keyof T & string)[]) {
		const value = (saved as Record<string, unknown>)[key];
		const fallback = defaults[key];
		const fits =
			fallback === null
				? value === null || typeof value === "string"
				: typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value));
		if (fits) kept[key] = value as T[keyof T & string];
	}
	return kept;
}

/** `value` within [min, max]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
