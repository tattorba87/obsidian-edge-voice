/** What reading does while you use another app. */
export type InBackground = "pause" | "visible" | "always";

/**
 * Whether reading should pause, given each open Obsidian window: "pause" once
 * none has focus, "visible" once none is on screen (minimized, hidden or
 * covered), "always" never.
 */
export function pausesInBackground(mode: InBackground, windows: { focused: boolean; hidden: boolean }[]): boolean {
	if (mode === "pause") return !windows.some((win) => win.focused);
	if (mode === "visible") return windows.every((win) => win.hidden);
	return false;
}
