/**
 * Frees the voice engine's memory once reading has sat stopped or paused for a
 * while (the "Free voice memory when idle" setting). The next play loads the
 * voice again first.
 */
export interface IdleUnloadOptions {
	/** Minutes to wait; 0 means never. */
	minutes: () => number;
	/** True while the engine is running and reading is stopped or paused: the countdown runs. */
	idle: () => boolean;
	/** True while the engine is preparing audio (e.g. the sentences ahead, just after a pause). */
	busy: () => boolean;
	unload: () => void;
	setTimer: (run: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
}

export const UNLOAD_CHOICES: Record<string, string> = {
	"0": "Never",
	"5": "After 5 minutes",
	"10": "After 10 minutes",
	"30": "After 30 minutes",
	"60": "After 1 hour",
};

const BUSY_RETRY_MS = 15_000;

export class IdleUnload {
	private timer?: number;

	constructor(private readonly options: IdleUnloadOptions) {}

	/** Starts the countdown afresh if unloading is on and reading is stopped or paused, or cancels it. */
	reset(): void {
		this.cancel();
		const minutes = this.options.minutes();
		if (minutes > 0 && this.options.idle()) this.wait(minutes * 60_000);
	}

	private wait(ms: number): void {
		this.timer = this.options.setTimer(() => {
			this.timer = undefined;
			if (!this.options.idle()) return;
			// Still preparing audio: never cut that off, look again shortly.
			if (this.options.busy()) this.wait(BUSY_RETRY_MS);
			else this.options.unload();
		}, ms);
	}

	cancel(): void {
		if (this.timer !== undefined) this.options.clearTimer(this.timer);
		this.timer = undefined;
	}

	get pending(): boolean {
		return this.timer !== undefined;
	}
}
