import { Menu, setIcon } from "obsidian";
import { DictationState } from "./dictation";
import { ReaderState } from "./reader";

/** The reading speeds on offer: few, so picking one takes no thought. */
export const SPEEDS = [1, 1.5, 2];

/** The offered speed nearest `speed`, e.g. for one saved when finer speeds were offered. */
export function nearestSpeed(speed: number): number {
	return SPEEDS.reduce((best, candidate) =>
		Math.abs(candidate - speed) < Math.abs(best - speed) ? candidate : best,
	);
}

/** The next offered speed up (1) or down (-1) from `speed`, staying at the ends. */
export function stepSpeed(speed: number, direction: 1 | -1): number {
	const index = SPEEDS.indexOf(nearestSpeed(speed));
	return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, index + direction))];
}

export interface PlayerControls {
	dictate?(): void;
	toggle(): void;
	previous(): void;
	next(): void;
	stop(): void;
	speed(): number;
	setSpeed(speed: number): void;
	minimized(): boolean;
	setMinimized(minimized: boolean): void;
	volume(): number;
	/** `final` once the person has let go of the slider, to save it then. */
	setVolume(volume: number, final: boolean): void;
}

/** "1×", "1.5×". */
export function formatSpeed(speed: number): string {
	return `${Number(speed.toFixed(2))}×`;
}

/** Opens the speeds on offer at the mouse event. */
export function showSpeedMenu(controls: PlayerControls, at: MouseEvent): void {
	const menu = new Menu();
	const current = controls.speed();
	for (const preset of SPEEDS) {
		menu.addItem((item) =>
			item
				.setTitle(formatSpeed(preset))
				.setChecked(Math.abs(preset - current) < 0.001)
				.onClick(() => controls.setSpeed(preset)),
		);
	}
	menu.showAtMouseEvent(at);
}

/**
 * Floating controls shown while reading: previous, play/pause, next, stop,
 * and the speed with buttons and presets to change it as you go. Minimized,
 * it shrinks to play/pause and the speed in the bottom-right corner.
 */
export class PlayerBar {
	private readonly el: HTMLElement;
	private readonly playButton: HTMLElement;
	private readonly microphoneButton: HTMLButtonElement;
	private readerState: ReaderState = "idle";
	private readonly volumeEl: HTMLElement;
	private dictationEnabled = false;
	private dictationState: DictationState = "idle";
	private inputLevel = 0;
	private displayedLevel = 0;
	private meterFrame?: number;
	private readonly motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	private readonly motionChanged = () => {
		if (this.motion.matches) {
			if (this.meterFrame !== undefined) window.cancelAnimationFrame(this.meterFrame);
			this.meterFrame = undefined;
		} else this.animateMicrophone();
	};
	private readonly speedButton: HTMLElement;
	private readonly whereEl: HTMLElement;
	private readonly sizeButton: HTMLElement;
	private readonly volumeButton: HTMLElement;
	private readonly volumeTrack: HTMLElement;
	private readonly volumeFill: HTMLElement;
	private readonly volumeThumb: HTMLElement;
	/** The volume to go back to when unmuting. */
	private unmutedVolume = 1;
	/** Whether audio has started since reading began; the bar waits for it. */
	private heard = false;
	/** Off when the person has turned the bar off in settings. */
	private enabled = true;

	constructor(private readonly controls: PlayerControls) {
		this.el = document.body.createDiv({ cls: "edge-voice-bar" });
		this.motion.addEventListener("change", this.motionChanged);
		this.el.hidden = true;
		// The glow is drawn by elements of its own, not ::before/::after, which
		// themes and Obsidian style on many elements and could squash or hide.
		const glow = this.el.createDiv({ cls: "edge-voice-glow", attr: { "aria-hidden": "true" } });
		glow.createDiv({ cls: "edge-voice-glow-halo" });
		glow.createDiv({ cls: "edge-voice-glow-ring" });

		this.microphoneButton = this.button("mic", "Start dictation", () => controls.dictate?.()) as HTMLButtonElement;
		this.microphoneButton.addClass("edge-voice-microphone");
		this.microphoneButton.hidden = true;

		this.button("skip-back", "Previous sentence", () => controls.previous(), true);
		this.playButton = this.button("pause", "Pause", () => controls.toggle());
		this.button("skip-forward", "Next sentence", () => controls.next(), true);
		this.button("square", "Stop", () => controls.stop(), true);

		this.el.createDiv({ cls: "edge-voice-divider edge-voice-full" });

		this.button("minus", "Slower", () => controls.setSpeed(stepSpeed(controls.speed(), -1)), true);
		this.speedButton = this.el.createEl("button", {
			cls: "edge-voice-speed",
			attr: { "aria-label": "Playback speed" },
		});
		this.speedButton.addEventListener("click", (event) => showSpeedMenu(controls, event));
		this.button("plus", "Faster", () => controls.setSpeed(stepSpeed(controls.speed(), 1)), true);

		// Volume: just an icon; a vertical slider pops up above it on hover or
		// focus. Not shown when the bar is minimized.
		const volume = (this.volumeEl = this.el.createDiv({ cls: "edge-voice-volume edge-voice-full" }));
		this.volumeButton = volume.createEl("button", {
			cls: "clickable-icon edge-voice-button",
			attr: { "aria-label": "Mute" },
		});
		this.volumeButton.addEventListener("click", () => {
			const current = controls.volume();
			if (current > 0) this.unmutedVolume = current;
			this.applyVolume(current > 0 ? 0 : this.unmutedVolume || 1, true);
		});
		// Drawn here rather than an <input type=range>, which themes restyle.
		const panel = volume
			.createDiv({ cls: "edge-voice-volume-popup" })
			.createDiv({ cls: "edge-voice-volume-panel" });
		this.volumeTrack = panel.createDiv({
			cls: "edge-voice-volume-track",
			attr: {
				role: "slider",
				tabindex: "0",
				"aria-label": "Volume",
				"aria-orientation": "vertical",
				"aria-valuemin": "0",
				"aria-valuemax": "100",
			},
		});
		this.volumeFill = this.volumeTrack.createDiv({ cls: "edge-voice-volume-fill" });
		this.volumeThumb = this.volumeTrack.createDiv({ cls: "edge-voice-volume-thumb" });
		const fromPointer = (event: PointerEvent) => {
			const box = this.volumeTrack.getBoundingClientRect();
			return Math.min(1, Math.max(0, (box.bottom - event.clientY) / box.height));
		};
		// The panel is the hit area, so a slightly-off click still lands.
		panel.addEventListener("pointerdown", (event) => {
			if (this.dictationState !== "idle") return;
			event.preventDefault();
			panel.setPointerCapture(event.pointerId);
			volume.addClass("is-dragging");
			this.volumeTrack.focus();
			this.applyVolume(fromPointer(event), false);
		});
		panel.addEventListener("pointermove", (event) => {
			if (panel.hasPointerCapture(event.pointerId)) this.applyVolume(fromPointer(event), false);
		});
		const release = (event: PointerEvent) => {
			if (!panel.hasPointerCapture(event.pointerId)) return;
			panel.releasePointerCapture(event.pointerId);
			volume.removeClass("is-dragging");
			this.applyVolume(controls.volume(), true);
		};
		panel.addEventListener("pointerup", release);
		panel.addEventListener("pointercancel", release);
		this.volumeTrack.addEventListener("keydown", (event) => {
			const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[event.key];
			const jump = event.key === "Home" ? 0 : event.key === "End" ? 1 : undefined;
			if (step === undefined && jump === undefined) return;
			event.preventDefault();
			this.applyVolume(jump ?? Math.min(1, Math.max(0, controls.volume() + step!)), true);
		});
		volume.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				this.applyVolume(Math.min(1, Math.max(0, controls.volume() - Math.sign(event.deltaY) * 0.05)), true);
			},
			{ passive: false },
		);

		this.whereEl = this.el.createSpan({ cls: "edge-voice-where edge-voice-full" });
		this.sizeButton = this.button("chevron-down", "Minimize", () => {
			controls.setMinimized(!controls.minimized());
			this.showSize();
		});
		this.showSpeed(controls.speed());
		this.showSize();
		this.showVolume(controls.volume());
	}

	update(state: ReaderState, detail?: string): void {
		this.readerState = state;
		if (state === "idle") this.heard = false;
		// Shown from the first synthesis on, so its glow says reading has started.
		if (state === "playing" || state === "loading") this.heard = true;
		this.refreshVisibility();
		const playing = state === "playing" || state === "loading";
		setIcon(this.playButton, playing ? "pause" : "play");
		this.playButton.setAttribute("aria-label", playing ? "Pause" : "Resume");
		if (detail || state === "idle") this.whereEl.setText(detail ?? "");
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.refreshVisibility();
	}

	setDictationEnabled(enabled: boolean): void {
		this.dictationEnabled = enabled;
		this.refreshVisibility();
	}

	setDictationState(state: DictationState): void {
		this.dictationState = state;
		const active = state !== "idle";
		this.microphoneButton.setAttribute("aria-label", active ? "Stop dictation" : "Start dictation");
		this.microphoneButton.setAttribute("aria-pressed", String(active));
		this.el.toggleClass("edge-voice-recording", state === "recording");
		if (state !== "recording") this.el.removeClass("edge-voice-dictation-done");
		if (state === "recording") this.animateMicrophone();
		else {
			if (this.meterFrame !== undefined) window.cancelAnimationFrame(this.meterFrame);
			this.meterFrame = undefined;
			this.inputLevel = this.displayedLevel = 0;
			this.el.setCssProps({ "--edge-voice-mic-level": "0" });
		}
		this.refreshVisibility();
	}

	/**
	 * Recognition has caught up and dictation is only waiting to stop: a pulsing
	 * green ring on the microphone. `stopsIn` is seconds to the automatic stop (0: none);
	 * null when speech or recognition resumes.
	 */
	setDictationDone(stopsIn: number | null): void {
		const done = stopsIn !== null && this.dictationState === "recording";
		this.el.toggleClass("edge-voice-dictation-done", done);
		this.microphoneButton.setAttribute(
			"aria-label",
			!done
				? this.dictationState === "idle"
					? "Start dictation"
					: "Stop dictation"
				: stopsIn > 0
					? `Text done. Dictation stops in ${stopsIn} seconds; click to stop now`
					: "Text done. Click to stop dictation",
		);
	}

	setMicrophoneLevel(level: number): void {
		const bounded = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
		if (bounded === this.inputLevel) return;
		this.inputLevel = bounded;
		this.animateMicrophone();
	}

	private animateMicrophone(): void {
		if (
			this.meterFrame !== undefined ||
			this.motion.matches ||
			this.dictationState !== "recording" ||
			Math.abs(this.inputLevel - this.displayedLevel) < 0.001
		)
			return;
		const frame = () => {
			this.meterFrame = undefined;
			const difference = this.inputLevel - this.displayedLevel;
			this.displayedLevel =
				Math.abs(difference) < 0.002 ? this.inputLevel : this.displayedLevel + difference * 0.3;
			this.el.setCssProps({ "--edge-voice-mic-level": this.displayedLevel.toFixed(3) });
			this.animateMicrophone();
		};
		this.meterFrame = window.requestAnimationFrame(frame);
	}

	private refreshVisibility(): void {
		const active = this.dictationState !== "idle";
		this.el.hidden = !active && (!this.enabled || (!this.heard && !this.dictationEnabled));
		this.el.toggleClass("edge-voice-dictating", active);
		// Not "is-loading": Obsidian draws its own progress bar on that class.
		this.el.toggleClass("edge-voice-synthesizing", active || this.readerState === "loading");
		this.microphoneButton.hidden = !active && !this.dictationEnabled;
		this.microphoneButton.disabled = this.dictationState === "stopping" || (!active && this.readerState !== "idle");
		for (const button of this.el.querySelectorAll<HTMLButtonElement>("button")) {
			if (button !== this.microphoneButton && button !== this.sizeButton) button.disabled = active;
		}
		this.volumeEl.inert = active;
		if (active) this.volumeEl.removeClass("is-dragging");
		this.volumeEl.setAttribute("aria-disabled", String(active));
		this.volumeTrack.tabIndex = active ? -1 : 0;
	}

	showSpeed(speed: number): void {
		this.speedButton.setText(formatSpeed(speed));
	}

	destroy(): void {
		this.motion.removeEventListener("change", this.motionChanged);
		if (this.meterFrame !== undefined) window.cancelAnimationFrame(this.meterFrame);
		this.el.remove();
	}

	private applyVolume(volume: number, final: boolean): void {
		if (this.dictationState !== "idle") return;
		const rounded = Math.round(volume * 20) / 20;
		this.controls.setVolume(rounded, final);
		this.showVolume(rounded);
	}

	private showVolume(volume: number): void {
		this.volumeFill.style.height = `${volume * 100}%`;
		this.volumeThumb.style.bottom = `${volume * 100}%`;
		this.volumeTrack.setAttribute("aria-valuenow", String(Math.round(volume * 100)));
		setIcon(this.volumeButton, volume === 0 ? "volume-x" : volume < 0.5 ? "volume-1" : "volume-2");
		this.volumeButton.setAttribute(
			"aria-label",
			volume === 0 ? "Unmute" : `Volume ${Math.round(volume * 100)}% (click to mute)`,
		);
	}

	private showSize(): void {
		const minimized = this.controls.minimized();
		this.el.toggleClass("is-minimized", minimized);
		setIcon(this.sizeButton, minimized ? "chevron-up" : "chevron-down");
		this.sizeButton.setAttribute("aria-label", minimized ? "Show all controls" : "Minimize");
	}

	/** `full`: a control only the expanded bar shows. */
	private button(icon: string, label: string, onClick: () => void, full = false): HTMLElement {
		const button = this.el.createEl("button", {
			cls: `clickable-icon edge-voice-button${full ? " edge-voice-full" : ""}`,
			attr: { "aria-label": label },
		});
		setIcon(button, icon);
		button.addEventListener("click", onClick);
		return button;
	}
}
