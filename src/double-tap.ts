/**
 * Detects a double tap of one key, such as Right Command: two short presses in
 * quick succession with nothing else pressed in between. Only sees keys while
 * Obsidian is focused; plugins have no system-wide hotkeys.
 */

// A press held longer than this is a hold, not a tap.
const TAP_MAX_MS = 350;
// The second tap must start within this long of the first one ending.
const DOUBLE_TAP_MS = 450;

const IS_MAC = process.platform === "darwin";

/**
 * The keys offered in the menu: ones that type nothing and are rarely
 * double-tapped by accident. Right Command (Mac) or Right Ctrl comes first and
 * is the default (Right Windows is often missing).
 */
export const DOUBLE_TAP_PRESETS: string[] = IS_MAC
	? ["MetaRight", "AltRight", "ShiftRight"]
	: ["ControlRight", "AltRight", "ShiftRight"];

export const DEFAULT_DOUBLE_TAP_KEY = DOUBLE_TAP_PRESETS[0];
export const DEFAULT_DICTATION_KEY = IS_MAC ? "MetaLeft" : "ControlLeft";
export const DICTATION_KEY_PRESETS = [DEFAULT_DICTATION_KEY, ...DOUBLE_TAP_PRESETS];

export interface SpeechShortcuts {
	doubleTapEnabled: boolean;
	doubleTapKey: string;
	dictationEnabled: boolean;
	dictationDoubleTapEnabled: boolean;
	dictationKey: string;
}

export function shortcutConflict(settings: SpeechShortcuts): boolean {
	return (
		settings.doubleTapEnabled &&
		settings.dictationEnabled &&
		settings.dictationDoubleTapEnabled &&
		settings.doubleTapKey === settings.dictationKey
	);
}

export function isDoubleTapKey(code: string): boolean {
	return customKeyProblem({ code, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false }) === null;
}

const MODIFIERS = ["Meta", "Alt", "Control", "Shift"];

/**
 * Why a key pressed for the custom shortcut can't be used, or null if it can.
 * Only single modifier keys and function keys are allowed: anything else types,
 * moves the cursor or already does something, so a double tap would do that too.
 */
export function customKeyProblem(
	event: Pick<KeyboardEvent, "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey">,
): string | null {
	const { code } = event;
	const base = code.replace(/(Right|Left)$/, "");
	const held = { Meta: event.metaKey, Alt: event.altKey, Control: event.ctrlKey, Shift: event.shiftKey };
	// A modifier's own flag is set while it is pressed, so only the others count.
	if (MODIFIERS.some((name) => name !== base && held[name as keyof typeof held])) {
		return "Press one key on its own, not a combination.";
	}
	if (MODIFIERS.includes(base) || /^F([1-9]|1\d|2[0-4])$/.test(code)) return null;
	if (code === "CapsLock") return "Caps Lock changes what you type.";
	if (code === "Escape") return "Escape already closes windows and menus.";
	return "That key types or moves the cursor. Use a modifier or function key.";
}

/** A readable name for a `KeyboardEvent.code`, in the platform's own terms. */
export function keyLabel(code: string): string {
	const side = code.endsWith("Right") ? "Right " : code.endsWith("Left") ? "Left " : "";
	const base = code.replace(/(Right|Left)$/, "");
	const names: Record<string, string> = {
		Meta: IS_MAC ? "Command" : process.platform === "win32" ? "Windows" : "Super",
		Alt: IS_MAC ? "Option" : "Alt",
		Control: IS_MAC ? "Control" : "Ctrl",
		Shift: "Shift",
	};
	if (names[base]) return side + names[base];
	return code.replace(/^Key/, "").replace(/^Digit/, "");
}

/**
 * A key as a key cap: its symbol on a Mac (⌘ ⌥ ⌃ ⇧), where keyboards and menus
 * use them, a short name elsewhere, and which side it's on, if it has two.
 */
export function keyCap(code: string): { symbol: string; side: "Left" | "Right" | null } {
	const side = code.endsWith("Right") ? "Right" : code.endsWith("Left") ? "Left" : null;
	const base = code.replace(/(Right|Left)$/, "");
	const symbols: Record<string, string> = IS_MAC
		? { Meta: "⌘", Alt: "⌥", Control: "⌃", Shift: "⇧" }
		: { Meta: process.platform === "win32" ? "Win" : "Super", Alt: "Alt", Control: "Ctrl", Shift: "Shift" };
	return { symbol: symbols[base] ?? keyLabel(code), side };
}

/** A short label for menus: "Right ⌘" on a Mac, "Right Ctrl" elsewhere, "F13". */
export function shortKeyLabel(code: string): string {
	const { symbol, side } = keyCap(code);
	return side ? `${side} ${symbol}` : symbol;
}

export class DoubleTapDetector {
	/** When the watched key went down, while it is held. */
	private pressedAt?: number;
	/** When the last tap ended, waiting for a second one. */
	private lastTapAt?: number;
	private stoppedAt?: number;

	constructor(
		private readonly key: () => string | null,
		private readonly onDoubleTap: () => void,
		private readonly singleTap?: { active: () => boolean; stop: () => void },
	) {}

	keydown(event: KeyboardEvent): void {
		const key = this.key();
		if (!key) {
			this.reset();
			return;
		}
		if (event.code !== key) {
			// Any other key breaks the sequence: this was part of a shortcut.
			this.reset();
			return;
		}
		if (customKeyProblem(event) !== null) {
			this.reset();
			return;
		}
		if (!event.repeat) this.pressedAt = event.timeStamp;
	}

	keyup(event: KeyboardEvent): void {
		const key = this.key();
		if (!key || event.code !== key || this.pressedAt === undefined) return;
		const held = event.timeStamp - this.pressedAt;
		this.pressedAt = undefined;
		if (held > TAP_MAX_MS) {
			this.lastTapAt = undefined;
			return;
		}
		if (this.stoppedAt !== undefined && event.timeStamp - this.stoppedAt <= DOUBLE_TAP_MS) {
			this.stoppedAt = undefined;
			this.lastTapAt = undefined;
			return;
		}
		this.stoppedAt = undefined;
		if (this.singleTap?.active()) {
			this.lastTapAt = undefined;
			this.stoppedAt = event.timeStamp;
			this.singleTap.stop();
			return;
		}

		if (this.lastTapAt !== undefined && event.timeStamp - this.lastTapAt <= DOUBLE_TAP_MS) {
			this.lastTapAt = undefined;
			this.onDoubleTap();
		} else {
			this.lastTapAt = event.timeStamp;
		}
	}

	/** Forget everything, e.g. when the window loses focus mid-sequence. */
	reset(): void {
		this.pressedAt = undefined;
		this.lastTapAt = undefined;
		this.stoppedAt = undefined;
	}
}
