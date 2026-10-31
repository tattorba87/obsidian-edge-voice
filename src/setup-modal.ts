import { App, Modal, setIcon } from "obsidian";
import { platformSupport, SETUP_HOME, setUpEngine, SetupStep, VENV_PYTHON } from "./setup";

const STEPS: [SetupStep, string][] = [
	["uv", "Download the Python installer (uv)"],
	["python", "Install Python 3.12"],
	["package", "Install the speech engine"],
	["check", "Check it works"],
];

/** The path of a file the person picked, across Electron versions. */
function pathOf(file: File): string | undefined {
	// Electron 32 removed File.path in favour of webUtils.getPathForFile.
	const electron = (
		window as unknown as { require?: (id: string) => { webUtils?: { getPathForFile(file: File): string } } }
	).require?.("electron");
	return electron?.webUtils?.getPathForFile(file) || (file as File & { path?: string }).path;
}

/** One-click setup of the speech engine, with progress and a log to look into. */
export class SetupModal extends Modal {
	private abort?: AbortController;
	private stepEls = new Map<SetupStep, HTMLElement>();
	private logEl!: HTMLElement;
	private detailsEl!: HTMLDetailsElement;
	private buttons!: HTMLElement;
	private messageEl!: HTMLElement;

	constructor(
		app: App,
		private readonly onReady: (python: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Set up the voice engine");
		contentEl.addClass("edge-voice-setup");

		contentEl.createEl("p", {
			text:
				"Edge Voice speaks with an engine that runs on your computer. Setting it up downloads about 100 MB " +
				`into ${SETUP_HOME}: the uv installer, Python and the speech engine (Moonshine). The voice itself (a few ` +
				"hundred MB) downloads the first time you read. Your notes never leave your computer.",
		});

		const steps = contentEl.createDiv({ cls: "edge-voice-setup-steps" });
		for (const [step, label] of STEPS) {
			const row = steps.createDiv({ cls: "edge-voice-setup-step" });
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
				.createEl("button", { cls: "mod-cta", text: "Set up" })
				.addEventListener("click", () => void this.start());
		} else if (!this.messageEl.getText()) {
			this.messageEl.setText(support.reason ?? "");
		}
		// A wheel file works everywhere, and is the only way on platforms without a package.
		const input = this.buttons.createEl("input", { attr: { type: "file", accept: ".whl" } });
		input.hidden = true;
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			const path = file && pathOf(file);
			if (path) void this.start(path);
		});
		this.buttons
			.createEl("button", { cls: support.supported ? "" : "mod-cta", text: "Install from a wheel file…" })
			.addEventListener("click", () => input.click());
		this.buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
	}

	private async start(wheel?: string): Promise<void> {
		this.abort = new AbortController();
		this.logEl.empty();
		this.messageEl.setText("");
		for (const [step] of STEPS) this.mark(step, "circle", "");
		this.buttons.empty();
		this.buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.abort?.abort());

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
				wheel,
			);
			this.messageEl.setText(`Ready: speech engine ${version}. You can start reading.`);
			this.buttons.empty();
			this.buttons
				.createEl("button", { cls: "mod-cta", text: "Done" })
				.addEventListener("click", () => this.close());
			this.onReady(VENV_PYTHON);
		} catch (error) {
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
