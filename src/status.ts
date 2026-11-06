/** What the status-bar indicator shows. */
export type StatusKind = "hidden" | "busy" | "download" | "playing" | "paused" | "dictating";

/**
 * The status-bar item: an animated indicator and a line of text. A spinner
 * while the engine or a sentence is being prepared, a progress bar while a
 * voice downloads, and equalizer bars that move while reading and rest while
 * paused.
 */
export class StatusIndicator {
	private readonly indicator: HTMLElement;
	private readonly textEl: HTMLElement;
	private readonly progressEl: HTMLElement;
	private readonly progressFill: HTMLElement;
	private inputLevel = 0;
	private levelAt = -Infinity;

	constructor(private readonly el: HTMLElement) {
		el.addClass("edge-voice-status");
		this.indicator = el.createSpan({ cls: "edge-voice-indicator", attr: { "aria-hidden": "true" } });
		for (let i = 0; i < 3; i++) this.indicator.createSpan({ cls: "edge-voice-eq-bar" });
		this.textEl = el.createSpan({ cls: "edge-voice-status-text" });
		this.progressEl = el.createSpan({ cls: "edge-voice-progress" });
		this.progressFill = this.progressEl.createSpan({ cls: "edge-voice-progress-fill" });
		this.show("hidden");
	}

	/** `progress` (0 to 1) applies to "download". */
	show(kind: StatusKind, text = "", progress = 0): void {
		this.el.toggle(kind !== "hidden");
		this.el.dataset.state = kind;
		this.inputLevel = 0;
		this.levelAt = -Infinity;
		this.el.setCssProps({ "--edge-voice-input-level": "0" });
		this.textEl.setText(text);
		this.progressEl.toggle(kind === "download");
		this.progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
	}
	/** Three input-driven bars, with a quiet-input floor and no free-running animation. */
	setInputLevel(level: number): void {
		if (this.el.dataset.state !== "dictating") return;
		const bounded = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
		const next = bounded <= 0.05 ? 0 : Math.round(((bounded - 0.05) / 0.95) * 100) / 100;
		const now = performance.now();
		// Limit DOM writes to 30 Hz, but never delay a return to silence.
		if (next === this.inputLevel || (next !== 0 && now - this.levelAt < 1000 / 30)) return;
		this.inputLevel = next;
		this.levelAt = now;
		this.el.setCssProps({ "--edge-voice-input-level": String(next) });
	}
}
