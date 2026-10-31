/** What the status-bar indicator shows. */
export type StatusKind = "hidden" | "busy" | "download" | "playing" | "paused";

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

	constructor(private readonly el: HTMLElement) {
		el.addClass("edge-voice-status");
		this.indicator = el.createSpan({ cls: "edge-voice-indicator" });
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
		this.textEl.setText(text);
		this.progressEl.toggle(kind === "download");
		this.progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
	}
}
