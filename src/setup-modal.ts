import { App, Modal, setIcon } from "obsidian";
import { platformSupport, SETUP_HOME, setUpEngine, SetupStep, VENV_PYTHON } from "./setup";

const STEPS: [SetupStep, string][] = [
	["uv", "Download the Python installer (uv)"],
	["python", "Install Python 3.12"],
	["package", "Install the speech engine"],
	["check", "Check it works"],
];

export interface SetupOptions {
	/** Whether the faster engine for Apple silicon will be installed too, so the list says so. */
	fasterEngine: boolean;
	/** Told when installing starts (true) and ends (false). */
	running: (on: boolean) => void;
	/** Called with the new interpreter once the engine works. */
	onReady: (python: string) => void | Promise<void>;
}

/**
 * The speech engine's setup: what it downloads, from where, where it goes and
 * how to remove it, then Install. Nothing is installed until the person
 * clicks Install. Shows progress and a log to look into.
 */
export class SetupModal extends Modal {
	private abort?: AbortController;
	private stepEls = new Map<SetupStep, HTMLElement>();
	private logEl!: HTMLElement;
	private detailsEl!: HTMLDetailsElement;
	private buttons!: HTMLElement;
	private messageEl!: HTMLElement;
	private stepsEl!: HTMLElement;

	constructor(
		app: App,
		private readonly options: SetupOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Set up the speech engine");
		contentEl.addClass("edge-voice-setup");

		contentEl.createEl("p", {
			text: "Edge Voice reads aloud with a speech engine that runs on your computer. Nothing is installed unless you choose to below.",
		});

		contentEl.createEl("h4", { text: "What will be downloaded" });
		const list = contentEl.createEl("ul");
		const items = [
			"uv, a Python installer by Astral, from GitHub, checked against its published checksum.",
			"Python 3.12, installed by uv from its own builds on GitHub.",
			"The speech engine (Moonshine) and the packages it needs, from PyPI (on Macs, the engine comes from this plugin's GitHub releases). Each is pinned to an exact version and checked against a checksum.",
			"The voice you read with, from Moonshine's download server, when it's first needed.",
		];
		if (this.options.fasterEngine) {
			items.push(
				"On Apple silicon, the faster engine: its packages (pinned and checked, as above), an English language model from GitHub, and its voice files from Hugging Face. A few hundred MB more; turn it off in settings to skip it.",
			);
		}
		for (const text of items) list.createEl("li", { text });

		contentEl.createEl("h4", { text: "Where it goes" });
		contentEl.createEl("p", {
			text:
				`About 100 MB for the engine and a few hundred MB for a voice, in ${SETUP_HOME}, outside your vaults ` +
				"and shared by all of them. To remove it, use Settings → Edge Voice → Storage, or delete that folder.",
		});
		contentEl.createEl("p", {
			cls: "edge-voice-setup-private",
			text: "Your notes never leave your computer. There's no account and no telemetry.",
		});

		this.stepsEl = contentEl.createDiv({ cls: "edge-voice-setup-steps" });
		this.stepsEl.hidden = true;
		for (const [step, label] of STEPS) {
			const row = this.stepsEl.createDiv({ cls: "edge-voice-setup-step" });
			setIcon(row.createSpan({ cls: "edge-voice-setup-icon" }), "circle");
			row.createSpan({ text: label });
			this.stepEls.set(step, row);
		}

		this.messageEl = contentEl.createDiv({ cls: "edge-voice-setup-message" });
		this.detailsEl = contentEl.createEl("details", { cls: "edge-voice-setup-log" });
		this.detailsEl.createEl("summary", { text: "Details" });
		this.logEl = this.detailsEl.createEl("pre");

		this.buttons = contentEl.createDiv({ cls: "modal-button-container" });
		this.showStartButtons();
	}

	onClose(): void {
		this.abort?.abort();
		this.contentEl.empty();
	}

	private showStartButtons(): void {
		this.buttons.empty();
		const support = platformSupport();
		if (support.supported) {
			this.buttons
				.createEl("button", { cls: "mod-cta", text: this.messageEl.getText() ? "Try again" : "Install" })
				.addEventListener("click", () => void this.start());
		} else if (!this.messageEl.getText()) {
			this.messageEl.setText(support.reason ?? "");
		}
		this.buttons.createEl("button", { text: "Not now" }).addEventListener("click", () => this.close());
	}

	private async start(): Promise<void> {
		this.abort = new AbortController();
		this.logEl.empty();
		this.messageEl.setText("");
		this.stepsEl.hidden = false;
		for (const [step] of STEPS) this.mark(step, "circle", "");
		this.buttons.empty();
		this.buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.abort?.abort());

		this.options.running(true);
		try {
			const version = await setUpEngine(
				{
					step: (step, state) => this.mark(step, state === "done" ? "check-circle-2" : "loader", state),
					log: (line) => {
						this.logEl.appendText(line + "\n");
						this.logEl.scrollTop = this.logEl.scrollHeight;
					},
				},
				this.abort.signal,
			);
			this.options.running(false);
			this.messageEl.setText(`Ready: speech engine ${version}. The voice downloads now; you can start reading.`);
			this.buttons.empty();
			this.buttons
				.createEl("button", { cls: "mod-cta", text: "Done" })
				.addEventListener("click", () => this.close());
			void this.options.onReady(VENV_PYTHON);
		} catch (error) {
			this.options.running(false);
			for (const [step, el] of this.stepEls) {
				if (el.hasClass("is-running")) this.mark(step, "x-circle", "failed");
			}
			const cancelled = this.abort.signal.aborted;
			this.messageEl.setText(cancelled ? "Cancelled." : `Setup failed: ${(error as Error).message}`);
			if (!cancelled) this.detailsEl.open = true;
			this.showStartButtons();
		}
	}

	private mark(step: SetupStep, icon: string, state: "" | "running" | "done" | "failed"): void {
		const row = this.stepEls.get(step);
		if (!row) return;
		row.toggleClass("is-running", state === "running");
		row.toggleClass("is-done", state === "done");
		row.toggleClass("is-failed", state === "failed");
		setIcon(row.querySelector<HTMLElement>(".edge-voice-setup-icon")!, icon);
	}
}
