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

/** Keys that make good double-tap triggers: they don't type anything. */
export const DOUBLE_TAP_KEYS: string[] = [
	"MetaRight",
	"AltRight",
	"ControlRight",
	"ShiftRight",
	"MetaLeft",
	"AltLeft",
	"ControlLeft",
	"ShiftLeft",
];

/** The default: Right Command on a Mac, Right Ctrl elsewhere (Right Windows is often missing). */
export const DEFAULT_DOUBLE_TAP_KEY = IS_MAC ? "MetaRight" : "ControlRight";

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

export class DoubleTapDetector {
	/** When the watched key went down, while it is held. */
	private pressedAt?: number;
	/** When the last tap ended, waiting for a second one. */
	private lastTapAt?: number;

	constructor(
		private readonly key: () => string | null,
		private readonly onDoubleTap: () => void,
	) {}

	keydown(event: KeyboardEvent): void {
		const key = this.key();
		if (!key) return;
		if (event.code !== key) {
			// Any other key breaks the sequence: this was part of a shortcut.
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
	}
}
