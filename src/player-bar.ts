import { Menu, setIcon } from "obsidian";
import { ReaderState } from "./reader";

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.5;
export const SPEED_STEP = 0.1;
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

export interface PlayerControls {
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

/** "1×", "1.25×". */
export function formatSpeed(speed: number): string {
	return `${Number(speed.toFixed(2))}×`;
}

/** Opens the speed presets under `anchor`, or at the mouse event. */
export function showSpeedMenu(controls: PlayerControls, at: MouseEvent): void {
	const menu = new Menu();
	const current = controls.speed();
	for (const preset of SPEED_PRESETS) {
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
		this.el.hidden = true;
		// The glow is drawn by elements of its own, not ::before/::after, which
		// themes and Obsidian style on many elements and could squash or hide.
		const glow = this.el.createDiv({ cls: "edge-voice-glow", attr: { "aria-hidden": "true" } });
		glow.createDiv({ cls: "edge-voice-glow-halo" });
		glow.createDiv({ cls: "edge-voice-glow-ring" });

		this.button("skip-back", "Previous sentence", () => controls.previous(), true);
		this.playButton = this.button("pause", "Pause", () => controls.toggle());
		this.button("skip-forward", "Next sentence", () => controls.next(), true);
		this.button("square", "Stop", () => controls.stop(), true);

		this.el.createDiv({ cls: "edge-voice-divider edge-voice-full" });

		this.button("minus", "Slower", () => controls.setSpeed(controls.speed() - SPEED_STEP), true);
		this.speedButton = this.el.createEl("button", {
			cls: "edge-voice-speed",
			attr: { "aria-label": "Playback speed" },
		});
		this.speedButton.addEventListener("click", (event) => showSpeedMenu(controls, event));
		this.button("plus", "Faster", () => controls.setSpeed(controls.speed() + SPEED_STEP), true);

		// Volume: just an icon; a vertical slider pops up above it on hover or
		// focus. Not shown when the bar is minimized.
		const volume = this.el.createDiv({ cls: "edge-voice-volume edge-voice-full" });
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
		if (state === "idle") this.heard = false;
		// Shown from the first synthesis on, so its glow says reading has started.
		if (state === "playing" || state === "loading") this.heard = true;
		this.el.hidden = !this.heard || !this.enabled;
		const playing = state === "playing" || state === "loading";
		setIcon(this.playButton, playing ? "pause" : "play");
		this.playButton.setAttribute("aria-label", playing ? "Pause" : "Resume");
		this.el.toggleClass("is-loading", state === "loading");
		if (detail) this.whereEl.setText(detail);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.el.hidden = !this.heard || !enabled;
	}

	showSpeed(speed: number): void {
		this.speedButton.setText(formatSpeed(speed));
	}

	destroy(): void {
		this.el.remove();
	}

	private applyVolume(volume: number, final: boolean): void {
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
