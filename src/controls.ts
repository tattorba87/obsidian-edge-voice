/**
 * Decisions behind play/pause and the status bar, kept apart from Obsidian so
 * they can be tested on their own. main.ts carries them out.
 */
import { ReaderState } from "./reader";
import { StatusKind } from "./status";

/** What play/pause does. "restart" stops reading the old page and starts the one in front of you. */
export type ToggleAction = "pause" | "resume" | "start" | "stop" | "restart";

/**
 * Play/pause, from a button (the ribbon, player bar and commands) or a double
 * tap. Reading pauses; paused reading resumes on its own page. Paused on
 * another page, a button starts reading the page you're on, while a double tap
 * stops (and the next one starts).
 */
export function toggleAction(state: ReaderState, onTargetPage: boolean, origin: "button" | "double-tap"): ToggleAction {
	if (state === "playing" || state === "loading") return "pause";
	if (state === "paused") return onTargetPage ? "resume" : origin === "button" ? "restart" : "stop";
	return "start";
}

/** Whether `action` starts or resumes reading, which the double-tap chime marks by rising. */
export function startsReading(action: ToggleAction): boolean {
	return action === "start" || action === "resume" || action === "restart";
}

/** What the status bar shows: an indicator and a line, with where reading is (`where`) and the speed. */
export function statusFor(state: ReaderState, where: string | undefined, speed: string): [StatusKind, string] {
	const details = `${where ? ` · ${where}` : ""} · ${speed}`;
	switch (state) {
		case "idle":
			return ["hidden", ""];
		case "loading":
			return ["busy", `Synthesizing${details}`];
		case "playing":
			return ["playing", `Reading${details}`];
		case "paused":
			return ["paused", `Paused${details}`];
	}
}
