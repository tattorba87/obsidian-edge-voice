import { App, Modal, Notice } from "obsidian";
import { EngineSearch, Step } from "./engine";

export interface SetupOptions {
	/** The steps for this computer (see setupSteps), or null if there's no engine for it. */
	steps: Step[] | null;
	/** Why the engine that was found can't be used, if one was. */
	problem?: string;
	/** Looks for the engine again. */
	check: () => Promise<EngineSearch>;
}

/**
 * How to set up the speech engine: Edge Voice installs and downloads nothing,
 * so this shows the steps the person runs themselves. Each says in plain words
 * what it does and where its downloads come from, with the command to copy.
 * "Check again" looks for the engine once they've run them.
 */
export class SetupModal extends Modal {
	private messageEl!: HTMLElement;
	/** Whether the engine was found, so the button closes the window. */
	private ready = false;

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
			text:
				"Edge Voice reads aloud with a speech engine that runs on your computer; your notes never leave it. " +
				"Obsidian plugins can't install programs, so you set the engine up yourself, once. Everything goes " +
				"into one folder, .edge-voice in your home folder, and nothing needs administrator rights.",
		});
		if (this.options.problem)
			contentEl.createEl("p", { cls: "edge-voice-setup-problem", text: this.options.problem });

		const { steps } = this.options;
		if (!steps) {
			contentEl.createEl("p", {
				text: `There's no speech engine for this computer (${process.platform}, ${process.arch}) yet.`,
			});
		} else {
			const list = contentEl.createEl("ol", { cls: "edge-voice-setup-steps" });
			for (const step of steps) this.showStep(list.createEl("li"), step);
			contentEl.createEl("p", {
				cls: "setting-item-description",
				text: "To remove everything later, delete the .edge-voice folder in your home folder.",
			});
		}

		this.messageEl = contentEl.createDiv({ cls: "edge-voice-setup-message" });
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const check = buttons.createEl("button", { cls: "mod-cta", text: "Check again" });
		check.addEventListener("click", () => {
			if (this.ready) this.close();
			else void this.check(check);
		});
		buttons.createEl("button", { text: "Close" }).addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private showStep(el: HTMLElement, step: Step): void {
		el.createEl("strong", { text: step.title });
		el.createEl("p", { text: step.text });
		if (step.command) showCommand(el, step.command);
		if (step.link) {
			el.createEl("a", {
				href: step.link,
				text: step.command ? "Read the file first" : "Open the instructions",
				cls: "edge-voice-setup-link",
			});
		}
	}

	private async check(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		this.messageEl.setText("Looking for the engine…");
		const { engine, problem } = await this.options.check();
		button.disabled = false;
		if (engine) {
			this.messageEl.setText(
				`Ready: speech engine ${engine.version}. Right-click in a note or PDF to start reading.`,
			);
			button.setText("Done");
			this.ready = true;
		} else {
			this.messageEl.setText(problem ?? "No engine found yet. Run the steps above, then check again.");
		}
	}
}

/** A command in a code box with a Copy button. */
function showCommand(el: HTMLElement, command: string): void {
	const box = el.createDiv({ cls: "edge-voice-command-box" });
	box.createEl("code", { cls: "edge-voice-command", text: command });
	box.createEl("button", { text: "Copy" }).addEventListener("click", () => {
		void navigator.clipboard.writeText(command).then(() => new Notice("Copied."));
	});
}

/** A notice that stays until dismissed, showing a command to copy. */
export class CommandNotice {
	constructor(message: string, command: string) {
		new Notice(
			createFragment((fragment) => {
				fragment.createDiv({ text: message });
				showCommand(fragment.createDiv(), command);
			}),
			0,
		);
	}
}
