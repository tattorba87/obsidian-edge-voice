import {
	App,
	DropdownComponent,
	FileSystemAdapter,
	FileView,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import { highlightField, MarkdownSource } from "./markdown";
import { PdfSource, PdfStart } from "./pdf";
import { EngineSetup } from "./engine-setup";
import { installedVersion, installServerScript, SETUP_HOME, setUpEngine, SetupStep, VENV_PYTHON } from "./setup";
import { StatusIndicator, StatusKind } from "./status";
import { deleteItem, formatBytes, scanEngine, scanVoices, StorageItem } from "./storage";
import { SetupModal } from "./setup-modal";
import { InBackground, pausesInBackground } from "./background";
import { playChime } from "./chime";
import {
	customKeyProblem,
	DEFAULT_DOUBLE_TAP_KEY,
	DOUBLE_TAP_PRESETS,
	DoubleTapDetector,
	keyLabel,
} from "./double-tap";
import { Reader, ReaderState, SegmentSource } from "./reader";
import { Sidecar } from "./sidecar";
import { DEFAULT_HIGHLIGHT_THEME, HIGHLIGHT_THEMES, highlightTheme } from "./colors";
import { formatSpeed, MAX_SPEED, MIN_SPEED, PlayerBar, PlayerControls, showSpeedMenu, SPEED_STEP } from "./player-bar";

interface ReaderSettings {
	pythonPath: string;
	language: string;
	voice: string;
	speed: number;
	prefetch: number;
	autoScroll: boolean;
	preloadVoice: boolean;
	skipFootnotes: boolean;
	pauseOnPageSwitch: boolean;
	/** Leaving Obsidian for another app: pause, keep reading while a window shows, or keep reading. */
	inBackground: InBackground;
	doubleTapEnabled: boolean;
	doubleTapKey: string;
	/** The one key recorded under "Custom…", kept while a preset is chosen. */
	doubleTapCustomKey: string | null;
	doubleTapChime: boolean;
	volume: number;
	showPlayer: boolean;
	highlightTheme: string;
	playerMinimized: boolean;
}

const DEFAULT_SETTINGS: ReaderSettings = {
	pythonPath: VENV_PYTHON,
	language: "en_us",
	voice: "kokoro_af_heart",
	speed: 1.0,
	prefetch: 2,
	autoScroll: true,
	preloadVoice: true,
	skipFootnotes: true,
	pauseOnPageSwitch: true,
	inBackground: "visible",
	doubleTapEnabled: false,
	doubleTapKey: DEFAULT_DOUBLE_TAP_KEY,
	doubleTapCustomKey: null,
	doubleTapChime: true,
	volume: 1,
	showPlayer: true,
	highlightTheme: DEFAULT_HIGHLIGHT_THEME,
	playerMinimized: false,
};

const MENU_TITLE = "Start text-to-speech here";

/** A right-click on readable text, waiting for the menu it opens. */
interface MenuRequest {
	event: MouseEvent;
	/** The page clicked on. */
	view: FileView;
	/** Reads from the clicked position, worked out when the click happened. */
	source: () => SegmentSource;
	served: boolean;
}

export default class EdgeVoicePlugin extends Plugin {
	settings: ReaderSettings = DEFAULT_SETTINGS;
	sidecar!: Sidecar;
	private reader!: Reader;
	/** The voice loaded or loading in the sidecar, shared by everyone waiting on it. */
	private voice?: { key: string; ready: Promise<void> };
	private status!: StatusIndicator;
	private ribbonEl!: HTMLElement;
	private bar!: PlayerBar;
	private state: ReaderState = "idle";
	private stateDetail?: string;
	private readonly controls: PlayerControls = {
		toggle: () => this.toggle("button"),
		previous: () => this.reader.skip(-1),
		next: () => this.reader.skip(1),
		stop: () => this.stop(),
		speed: () => this.settings.speed,
		setSpeed: (speed) => this.setSpeed(speed),
		minimized: () => this.settings.playerMinimized,
		volume: () => this.settings.volume,
		setVolume: (volume, final) => {
			this.settings.volume = volume;
			this.reader.setVolume(volume);
			if (final) void this.saveSettings();
		},
		setMinimized: (minimized) => {
			this.settings.playerMinimized = minimized;
			void this.saveSettings();
		},
	};
	private menuRequest?: MenuRequest;
	/** While the settings record a custom key, the shortcut stays quiet. */
	recordingKey = false;
	private engine!: EngineSetup;
	/** The log of the last automatic install, shown if it fails. */
	private setupLog: string[] = [];
	/** The page being read: playback belongs to it, and pauses when you leave it. */
	private target?: { view: FileView; path: string | undefined };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.createSidecar();
		this.createReader();

		this.registerEditorExtension(highlightField);
		const statusEl = this.addStatusBarItem();
		statusEl.addClass("mod-clickable");
		statusEl.setAttribute("aria-label", "Playback speed");
		this.registerDomEvent(statusEl, "click", (event) => showSpeedMenu(this.controls, event));
		this.status = new StatusIndicator(statusEl);
		this.bar = new PlayerBar(this.controls);
		this.bar.setEnabled(this.settings.showPlayer);
		this.applyHighlightColor();
		this.register(() => {
			document.body.style.removeProperty("--edge-voice-base");
			document.body.style.removeProperty("--edge-voice-accent");
		});
		this.register(() => this.bar.destroy());
		this.ribbonEl = this.addRibbonIcon("audio-lines", "Read aloud", () => this.toggle("button"));
		this.showState("idle");
		this.engine = new EngineSetup(
			async () => (await installedVersion(this.settings.pythonPath)) !== null,
			(signal) => this.installEngine(signal),
		);
		this.register(() => this.engine.cancel());

		this.addCommand({ id: "toggle", name: "Read aloud / pause", callback: () => this.toggle("button") });
		this.addCommand({
			id: "read-from-here",
			name: "Read from current position",
			callback: () => this.readFromHere(),
		});
		this.addCommand({ id: "stop", name: "Stop reading", callback: () => this.stop() });
		this.addCommand({ id: "next", name: "Next sentence", callback: () => this.reader.skip(1) });
		this.addCommand({ id: "previous", name: "Previous sentence", callback: () => this.reader.skip(-1) });
		this.addCommand({
			id: "faster",
			name: "Read faster",
			callback: () => this.setSpeed(this.settings.speed + SPEED_STEP),
		});
		this.addCommand({
			id: "slower",
			name: "Read slower",
			callback: () => this.setSpeed(this.settings.speed - SPEED_STEP),
		});
		this.addCommand({
			id: "toggle-player",
			name: "Show or hide player controls",
			callback: () => this.setPlayerShown(!this.settings.showPlayer),
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!(info instanceof MarkdownView)) return;
				const offset = MarkdownSource.cursorOffset(editor);
				this.addMenuItems(menu, info, () => new MarkdownSource(info, () => this.settings.autoScroll, offset));
			}),
		);
		this.registerContextMenus();
		this.registerAutoPause();
		this.registerDoubleTap();

		this.addSettingTab(new ReaderSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => void this.prepareEngine());
	}

	onunload(): void {
		this.reader.stop();
		this.sidecar.stop();
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<ReaderSettings> | null) };
		// One setting used to cover both switching pages and leaving Obsidian.
		const old = this.settings as ReaderSettings & { keepReadingInBackground?: boolean };
		if (old.keepReadingInBackground) {
			this.settings.pauseOnPageSwitch = false;
			this.settings.inBackground = "always";
		}
		delete old.keepReadingInBackground;
		// A key recorded before there was one custom slot becomes the custom key.
		const { doubleTapKey, doubleTapCustomKey } = this.settings;
		if (!doubleTapCustomKey && !DOUBLE_TAP_PRESETS.includes(doubleTapKey)) {
			this.settings.doubleTapCustomKey = doubleTapKey;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Restarts the sidecar, e.g. after the Python path changed. */
	restartSidecar(): void {
		this.reader.stop();
		this.sidecar.stop();
		this.voice = undefined;
		this.createSidecar();
		this.createReader();
	}

	/** Makes the next read reload the voice, and loads it now if preloading. */
	voiceChanged(): void {
		this.reader.stop();
		this.voice = undefined;
		if (this.settings.preloadVoice) void this.preloadVoice();
	}

	/**
	 * Installs the engine if it's missing and downloads the voice, in the
	 * background, so the first read starts at once.
	 */
	private async prepareEngine(): Promise<void> {
		let result: "ready" | "installed";
		try {
			result = await this.engine.ensure();
		} catch {
			return; // installEngine has said why
		}
		if (result === "installed") {
			await this.preloadVoice();
			new Notice("Edge Voice is ready. Right-click in a note or PDF to start reading.", 10000);
			// The voice stays downloaded; this only frees the memory it holds.
			if (!this.settings.preloadVoice) this.restartSidecar();
		} else if (this.settings.preloadVoice) {
			void this.preloadVoice();
		}
	}

	private async installEngine(signal: AbortSignal): Promise<void> {
		const steps: Record<SetupStep, string> = {
			uv: "downloading the installer",
			python: "installing Python",
			package: "installing the speech engine",
			check: "checking it works",
		};
		this.setupLog = [];
		try {
			await setUpEngine(
				{
					step: (step, state) => {
						if (state === "running") this.status.show("busy", `Setting up Edge Voice: ${steps[step]}`);
					},
					log: (line) => this.setupLog.push(line),
				},
				signal,
			);
		} catch (error) {
			if (!signal.aborted) this.setupFailed((error as Error).message);
			throw error;
		} finally {
			if (this.reader.state === "idle") this.status.show("hidden");
		}
		this.settings.pythonPath = VENV_PYTHON;
		await this.saveSettings();
		this.restartSidecar();
	}

	/** A notice that stays until dismissed, with a button that shows the log and can try again. */
	private setupFailed(message: string): void {
		const notice = new Notice(
			createFragment((fragment) => {
				fragment.createDiv({ text: `Edge Voice couldn't set up its voice engine: ${message}` });
				fragment
					.createEl("button", { text: "Show details", cls: "mod-cta edge-voice-notice-button" })
					.addEventListener("click", () => {
						notice.hide();
						this.openSetup(undefined, { log: this.setupLog, message });
					});
			}),
			0,
		);
	}

	private async preloadVoice(): Promise<void> {
		try {
			await this.ensureVoice();
		} catch (error) {
			console.warn("[edge-voice] preloading the voice failed", error);
		} finally {
			if (this.reader.state === "idle") this.status.show("hidden");
		}
	}

	private createReader(): void {
		this.reader = new Reader(this.sidecar, {
			speed: () => this.settings.speed,
			volume: () => this.settings.volume,
			prefetch: () => this.settings.prefetch,
			onState: (state, detail) => this.showState(state, detail),
			onError: (error) => new Notice(`Edge Voice: ${error.message}`, 8000),
		});
	}

	private createSidecar(): void {
		if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error("Edge Voice needs the desktop app");
		this.sidecar = new Sidecar(this.settings.pythonPath, installServerScript());
		this.sidecar.onProgress = (fraction) =>
			this.status.show("download", `Downloading voice ${Math.round(fraction * 100)}%`, fraction);
		this.sidecar.onExit = (message) => {
			this.voice = undefined;
			console.warn("[edge-voice]", message);
		};
	}

	/**
	 * Play/pause, as the ribbon, player bar and commands ("button") and the
	 * double-tap shortcut use it. Reading pauses; paused reading resumes on its
	 * own page. Paused on another page, a button starts reading the page you're
	 * on, while a double tap stops (and the next one starts).
	 */
	private toggle(origin: "button" | "double-tap"): void {
		switch (this.reader.state) {
			case "playing":
			case "loading":
				this.reader.pause();
				break;
			case "paused":
				if (this.onTargetPage()) {
					this.reader.resume();
				} else {
					this.stop();
					if (origin === "button") void this.readFromHere();
				}
				break;
			default:
				void this.readFromHere();
		}
	}

	/** Whether a double tap now starts or resumes reading, rather than pausing or stopping it (see toggle). */
	private toggleStartsReading(): boolean {
		const state = this.reader.state;
		return state === "idle" || (state === "paused" && this.onTargetPage());
	}

	/** Stops reading the target page and forgets it. */
	private stop(): void {
		this.reader.stop();
		this.target = undefined;
	}

	/** Whether the page in front of you is the one being read. */
	private onTargetPage(): boolean {
		const active = this.app.workspace.getActiveViewOfType(FileView);
		return !!this.target && active === this.target.view && active.file?.path === this.target.path;
	}

	/** Reads the page in front of you, from the selected text or else the top of what's visible. */
	private async readFromHere(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(FileView);
		if (view instanceof MarkdownView) {
			const from = MarkdownSource.startOffset(view);
			await this.startReading(view, new MarkdownSource(view, () => this.settings.autoScroll, from));
		} else if (view?.getViewType() === "pdf") {
			await this.startReading(view, this.pdfSource(view, PdfSource.startFor(view)));
		} else {
			new Notice("Open a note or a PDF to read it aloud.");
		}
	}

	/**
	 * Pauses reading when you switch to another page or leave Obsidian, unless
	 * the setting to keep reading in the background is on. Sidebars (the file
	 * list, outline) don't count as leaving the page.
	 */
	private registerAutoPause(): void {
		const pause = () => {
			if (this.reader.state === "playing" || this.reader.state === "loading") this.reader.pause();
		};
		const workspace = this.app.workspace;
		this.registerEvent(
			workspace.on("active-leaf-change", (leaf) => {
				if (!this.settings.pauseOnPageSwitch) return;
				if (!leaf || !this.target || leaf.view === this.target.view) return;
				const root = leaf.getRoot();
				if (root === workspace.leftSplit || root === workspace.rightSplit) return;
				pause();
			}),
		);
		this.registerEvent(
			workspace.on("file-open", () => {
				if (!this.settings.pauseOnPageSwitch) return;
				if (this.target && this.target.view.file?.path !== this.target.path) pause();
			}),
		);
		// Leaving Obsidian: no Obsidian window has focus any more ("pause"), or
		// none is on screen, being minimized, hidden or covered ("visible").
		// Checked a moment later, since focus passes between windows through a blur.
		const windows = new Set<Window>([window]);
		const check = () => {
			const open = [...windows]
				.filter((win) => !win.closed)
				.map((win) => ({
					focused: win.document.hasFocus(),
					hidden: win.document.visibilityState === "hidden",
				}));
			if (pausesInBackground(this.settings.inBackground, open)) pause();
		};
		const watch = (win: Window) => {
			windows.add(win);
			this.registerDomEvent(win, "blur", () => window.setTimeout(check, 150));
			this.registerDomEvent(win.document, "visibilitychange", () => window.setTimeout(check, 150));
		};
		watch(window);
		this.registerEvent(workspace.on("window-open", (_workspaceWindow, win) => watch(win)));
	}

	private pdfSource(view: FileView, start: PdfStart): PdfSource {
		return new PdfSource(
			view,
			start,
			() => this.settings.autoScroll,
			() => this.settings.skipFootnotes,
		);
	}

	/** Double-tapping the chosen key reads aloud, pauses and resumes, in every Obsidian window. */
	private registerDoubleTap(): void {
		const detector = new DoubleTapDetector(
			() => (this.settings.doubleTapEnabled && !this.recordingKey ? this.settings.doubleTapKey : null),
			() => {
				if (this.settings.doubleTapChime) playChime(this.toggleStartsReading() ? "up" : "down");
				this.toggle("double-tap");
			},
		);
		const watch = (win: Window) => {
			this.registerDomEvent(win, "keydown", (event) => detector.keydown(event), { capture: true });
			this.registerDomEvent(win, "keyup", (event) => detector.keyup(event), { capture: true });
			this.registerDomEvent(win, "blur", () => detector.reset());
		};
		watch(window);
		this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => watch(win)));
	}

	/** What the engine has downloaded, and the engine itself, for the Storage settings. */
	async storageItems(): Promise<{ voices: StorageItem[]; engine: StorageItem | null }> {
		const engine = await scanEngine(SETUP_HOME);
		let voices: StorageItem[] = [];
		try {
			voices = await scanVoices(await this.sidecar.cacheDir());
		} catch {
			// No working engine: then there's nothing it downloaded to list either.
		}
		return { voices, engine };
	}

	/** Deletes downloads, stopping reading and the engine first so no file is in use. */
	async deleteStorage(items: StorageItem[]): Promise<void> {
		this.stop();
		this.sidecar.stop();
		this.voice = undefined;
		for (const item of items) await deleteItem(item);
		const freed = items.reduce((sum, item) => sum + item.bytes, 0);
		new Notice(`Freed ${formatBytes(freed)}.`);
	}

	get engineInstalling(): boolean {
		return this.engine.installing;
	}

	/**
	 * Opens the setup window, to reinstall or to retry a failed install (shown
	 * with `failed`); when it succeeds, the plugin switches to the new engine.
	 */
	openSetup(onReady?: () => void, failed?: { log: string[]; message: string }): void {
		if (this.engine.installing) {
			new Notice("Edge Voice is setting up its voice engine; see the status bar.");
			return;
		}
		new SetupModal(
			this.app,
			(python) => {
				this.settings.pythonPath = python;
				void this.saveSettings();
				this.restartSidecar();
				if (this.settings.preloadVoice) void this.preloadVoice();
				onReady?.();
			},
			failed,
		).open();
	}

	private async startReading(view: FileView, source: SegmentSource): Promise<void> {
		// The bar and its glow show at once, while the voice loads, not only once synthesis starts.
		this.bar.update("loading");
		if (!this.sidecar.running) {
			try {
				// Waits for an install under way, or starts one if the engine went missing.
				await this.engine.ensure();
			} catch {
				source.dispose();
				this.bar.update("idle");
				return; // installEngine has said why
			}
		}
		try {
			await this.ensureVoice();
		} catch (error) {
			source.dispose();
			this.showState("idle");
			new Notice(`Edge Voice could not load the voice: ${(error as Error).message}`, 10000);
			return;
		}
		this.reader.start(source);
		this.target = { view, path: view.file?.path };
	}

	private addMenuItems(menu: Menu, view: FileView, source: () => SegmentSource): void {
		menu.addItem((item) =>
			item
				.setTitle(MENU_TITLE)
				.setIcon("audio-lines")
				.onClick(() => void this.startReading(view, source())),
		);
		if (this.reader.state !== "idle") {
			menu.addItem((item) =>
				item
					.setTitle("Stop text-to-speech")
					.setIcon("square")
					.onClick(() => this.stop()),
			);
		}
	}

	/**
	 * Adds the menu items to the right-click menus of PDFs and of notes in
	 * Reading view (the editor has its own event, `editor-menu`). Obsidian has
	 * no event for these menus, so a right-click on their text is noted here
	 * and the next menu shown picks it up. If no menu appears, this shows one
	 * of its own.
	 */
	private registerContextMenus(): void {
		this.registerDomEvent(
			document,
			"contextmenu",
			(event) => {
				const found = this.sourceAtPointer(event);
				if (!found) return;
				const request: MenuRequest = { event, ...found, served: false };
				this.menuRequest = request;
				window.setTimeout(() => {
					if (request.served || this.menuRequest !== request) return;
					const menu = new Menu();
					this.serveMenu(menu);
					menu.showAtMouseEvent(event);
				}, 150);
			},
			{ capture: true },
		);

		const serve = (menu: Menu) => this.serveMenu(menu);
		// eslint-disable-next-line @typescript-eslint/unbound-method -- wrapping a prototype method needs the unbound original
		const original = Menu.prototype.showAtPosition;
		Menu.prototype.showAtPosition = function (this: Menu, ...args: Parameters<Menu["showAtPosition"]>) {
			serve(this);
			return original.apply(this, args);
		};
		this.register(() => {
			Menu.prototype.showAtPosition = original;
		});
	}

	/** What reading from a right-clicked spot would read, or undefined if it isn't readable text. */
	private sourceAtPointer(event: MouseEvent): { view: FileView; source: () => SegmentSource } | undefined {
		const target = event.target;
		if (!(target instanceof Element)) return undefined;
		const viewOf = (type: string) =>
			this.app.workspace.getLeavesOfType(type).find((leaf) => leaf.view.containerEl.contains(target))?.view;

		if (target.closest(".textLayer")) {
			const view = viewOf("pdf");
			if (!(view instanceof FileView)) return undefined;
			const { node, offset } = pointerPosition(event);
			const start = PdfSource.startAt(view, node, offset);
			return { view, source: () => this.pdfSource(view, start) };
		}
		if (target.closest(".markdown-reading-view")) {
			const view = viewOf("markdown");
			if (!(view instanceof MarkdownView) || view.getMode() !== "preview") return undefined;
			const { node, offset } = pointerPosition(event);
			const from = MarkdownSource.offsetInReadingView(view, node, offset);
			return { view, source: () => new MarkdownSource(view, () => this.settings.autoScroll, from) };
		}
		return undefined;
	}

	private serveMenu(menu: Menu): void {
		const request = this.menuRequest;
		if (!request || request.served || performance.now() - request.event.timeStamp > 1000) return;
		request.served = true;
		this.menuRequest = undefined;
		this.addMenuItems(menu, request.view, request.source);
	}

	private ensureVoice(): Promise<void> {
		const key = `${this.settings.language}/${this.settings.voice}`;
		if (this.voice?.key === key && this.sidecar.running) return this.voice.ready;
		this.status.show("busy", "Loading voice");
		const ready = this.sidecar.load(this.settings.language, this.settings.voice).catch((error: Error) => {
			if (this.voice?.ready === ready) this.voice = undefined;
			throw error;
		});
		this.voice = { key, ready };
		return ready;
	}

	/** Picks one of the highlight colour options (see colors.ts). */
	setHighlightTheme(id: string): void {
		this.settings.highlightTheme = id;
		void this.saveSettings();
		this.applyHighlightColor();
	}

	private applyHighlightColor(): void {
		const theme = highlightTheme(this.settings.highlightTheme);
		document.body.style.setProperty("--edge-voice-base", theme.sentence);
		document.body.style.setProperty("--edge-voice-accent", theme.word);
	}

	setPlayerShown(shown: boolean): void {
		this.settings.showPlayer = shown;
		void this.saveSettings();
		this.bar.setEnabled(shown);
	}

	/** Sets the reading speed; it is heard from the next sentence on. */
	setSpeed(value: number): void {
		const speed = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)) * 20) / 20;
		this.settings.speed = speed;
		void this.saveSettings();
		this.reader.invalidateAudio();
		this.bar.showSpeed(speed);
		this.showState(this.state, this.stateDetail);
		if (this.state === "idle") new Notice(`Reading speed ${formatSpeed(speed)}`, 1500);
	}

	private showState(state: ReaderState, detail?: string): void {
		this.state = state;
		if (detail) this.stateDetail = detail;
		if (state === "idle") {
			this.stateDetail = undefined;
			this.target = undefined;
		}
		const where = this.stateDetail ? ` · ${this.stateDetail}` : "";
		const speed = ` · ${formatSpeed(this.settings.speed)}`;
		const shown: Record<ReaderState, [StatusKind, string]> = {
			idle: ["hidden", ""],
			loading: ["busy", `Synthesizing${where}${speed}`],
			playing: ["playing", `Reading${where}${speed}`],
			paused: ["paused", `Paused${where}${speed}`],
		};
		this.status.show(...shown[state]);
		this.bar.update(state, this.stateDetail);
		setIcon(this.ribbonEl, state === "playing" || state === "loading" ? "pause" : "audio-lines");
		this.ribbonEl.setAttribute("aria-label", state === "playing" ? "Pause reading" : "Read aloud");
	}
}

/**
 * The text position a right-click points at: the start of the selection when
 * the click lands inside it, or else the character under the pointer.
 */
function pointerPosition(event: MouseEvent): { node: Node | null; offset: number } {
	const selection = window.getSelection();
	if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		const inside = Array.from(range.getClientRects()).some(
			(rect) =>
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom,
		);
		if (inside) return { node: range.startContainer, offset: range.startOffset };
	}
	// caretPositionFromPoint arrived in Chromium 128; older Obsidian builds have
	// only the WebKit caretRangeFromPoint, typed here because it is deprecated.
	const position =
		"caretPositionFromPoint" in document ? document.caretPositionFromPoint(event.clientX, event.clientY) : null;
	if (position) return { node: position.offsetNode, offset: position.offset };
	const legacy = document as { caretRangeFromPoint?: (x: number, y: number) => Range | null };
	const caret = legacy.caretRangeFromPoint?.(event.clientX, event.clientY);
	return caret
		? { node: caret.startContainer, offset: caret.startOffset }
		: { node: event.target as Node, offset: 0 };
}

class ReaderSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: EdgeVoicePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		const engine = new Setting(containerEl).setName("Voice engine").setDesc("Checking…");
		engine.addButton((button) =>
			button.setButtonText("Set up").onClick(() => this.plugin.openSetup(() => this.display())),
		);
		void installedVersion(settings.pythonPath).then((version) => {
			engine.setDesc(
				version
					? `Ready: speech engine (moonshine-voice ${version}).`
					: this.plugin.engineInstalling
						? "Setting up; see the status bar."
						: "Not set up. Downloads about 100 MB, once.",
			);
			const button = engine.controlEl.querySelector("button");
			if (button) {
				button.setText(version ? "Reinstall" : "Set up");
				button.toggleClass("mod-cta", !version);
			}
		});

		new Setting(containerEl)
			.setName("Python interpreter")
			.setDesc(
				"Advanced: the Python the engine runs in. Set up fills this in; change it only to use a Python you set up yourself.",
			)
			.addText((text) =>
				text.setValue(settings.pythonPath).onChange((value) => {
					settings.pythonPath = value.trim();
					void this.plugin.saveSettings();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Restart").onClick(() => {
					this.plugin.restartSidecar();
					this.display();
				}),
			);

		const voiceSetting = new Setting(containerEl)
			.setName("Voice")
			.setDesc(
				"Kokoro voices sound the most natural; Piper voices start reading sooner. Downloaded on first use.",
			);
		voiceSetting.addDropdown((dropdown) => {
			dropdown.addOption(settings.voice, settings.voice).setValue(settings.voice);
			dropdown.onChange((value) => {
				settings.voice = value;
				void this.plugin.saveSettings();
				this.plugin.voiceChanged();
			});
			this.plugin.sidecar
				.voices(settings.language)
				.then(({ present, downloadable }) => {
					dropdown.selectEl.empty();
					const all = [...new Set([settings.voice, ...present, ...downloadable])];
					for (const voice of all) {
						const mark = present.includes(voice) ? " ✓" : "";
						dropdown.addOption(voice, voice + mark);
					}
					dropdown.setValue(settings.voice);
				})
				.catch((error: Error) => voiceSetting.setDesc(`Could not list voices: ${error.message}`));
		});

		new Setting(containerEl)
			.setName("Speed")
			.setDesc(
				"Also adjustable while reading, from the player bar, the status bar or the commands to read faster and slower.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(MIN_SPEED, MAX_SPEED, 0.05)
					.setValue(settings.speed)
					.onChange((value) => this.plugin.setSpeed(value)),
			);

		new Setting(containerEl)
			.setName("Sentences to prepare ahead")
			.setDesc("More smooths over slow sentences; fewer reacts faster to skips and speed changes.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 4, 1)
					.setValue(settings.prefetch)
					.onChange((value) => {
						settings.prefetch = value;
						void this.plugin.saveSettings();
					}),
			);

		const colorSetting = new Setting(containerEl)
			.setName("Highlight colour")
			.setDesc("A soft tint for the sentence, a deeper shade for the word being spoken.");
		const swatches = colorSetting.controlEl.createDiv({ cls: "edge-voice-swatches" });
		for (const theme of HIGHLIGHT_THEMES) {
			const swatch = swatches.createEl("button", {
				cls: "edge-voice-swatch",
				attr: { "aria-label": theme.name, "aria-pressed": String(theme.id === settings.highlightTheme) },
			});
			swatch.style.setProperty("--swatch-sentence", `rgb(${theme.sentence})`);
			swatch.style.setProperty("--swatch-word", `rgb(${theme.word})`);
			swatch.toggleClass("is-selected", theme.id === settings.highlightTheme);
			swatch.addEventListener("click", () => {
				this.plugin.setHighlightTheme(theme.id);
				swatches.querySelectorAll(".edge-voice-swatch").forEach((el) => {
					el.toggleClass("is-selected", el === swatch);
					el.setAttribute("aria-pressed", String(el === swatch));
				});
			});
		}
		const preview = containerEl.createDiv({ cls: "edge-voice-preview" });
		preview.createSpan({ text: "Before it. " });
		const sentence = preview.createSpan({ cls: "edge-voice-sentence", text: "This sentence is being read, and " });
		sentence.createSpan({ cls: "edge-voice-word", text: "this" });
		sentence.appendText(" word is being spoken.");
		preview.createSpan({ text: " After it." });

		new Setting(containerEl)
			.setName("Show player controls")
			.setDesc(
				"The floating bar with play/pause, skip, speed and volume while reading. Without it, use the status bar, commands and hotkeys.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showPlayer).onChange((value) => this.plugin.setPlayerShown(value)),
			);

		new Setting(containerEl)
			.setName("Load the voice when Obsidian starts")
			.setDesc(
				"Reading then starts at once. Keeps the voice in memory (a few hundred MB for Kokoro) while Obsidian is open.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.preloadVoice).onChange((value) => {
					settings.preloadVoice = value;
					void this.plugin.saveSettings();
				}),
			);

		this.doubleTapSettings(containerEl);

		new Setting(containerEl)
			.setName("Pause when switching pages")
			.setDesc("Reading pauses when you open another page, and resumes where it stopped. Sidebars don't count.")
			.addToggle((toggle) =>
				toggle.setValue(settings.pauseOnPageSwitch).onChange((value) => {
					settings.pauseOnPageSwitch = value;
					void this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("When Obsidian is in the background")
			.setDesc(
				"While you use another app. Visible means an Obsidian window is still on screen, not minimized, hidden or covered.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						pause: "Pause",
						visible: "Keep reading while visible",
						always: "Keep reading",
					})
					.setValue(settings.inBackground)
					.onChange((value) => {
						settings.inBackground = value as InBackground;
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Skip footnotes in PDFs")
			.setDesc("Leave out the small-print notes at the bottom of a page and the little marks that point to them.")
			.addToggle((toggle) =>
				toggle.setValue(settings.skipFootnotes).onChange((value) => {
					settings.skipFootnotes = value;
					void this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Follow along")
			.setDesc("Scroll to keep the sentence being read in view.")
			.addToggle((toggle) =>
				toggle.setValue(settings.autoScroll).onChange((value) => {
					settings.autoScroll = value;
					void this.plugin.saveSettings();

					new Setting(containerEl).setName("Storage").setHeading();
					const storage = containerEl.createDiv();
					storage.createDiv({ cls: "setting-item-description", text: "Checking downloads…" });
					void this.showStorage(storage);
				}),
			);
	}

	/**
	 * The double-tap shortcut: on or off, a menu of three good keys or
	 * "Custom…", and the chime. Custom opens a box that shows the key being
	 * pressed, refuses keys that type or already do something, and saves only
	 * when confirmed; there is one custom key, replaced each time.
	 */
	private doubleTapSettings(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		const CUSTOM = "custom";
		const isPreset = (code: string) => DOUBLE_TAP_PRESETS.includes(code);
		const save = () => void this.plugin.saveSettings();

		const setting = new Setting(containerEl)
			.setName("Double-tap shortcut")
			.setDesc(
				"Double-tap a key to start reading, and again to pause or resume. Works while Obsidian is the active app.",
			);
		const recorder = containerEl.createDiv({ cls: "edge-voice-key-recorder" });
		const chime = new Setting(containerEl)
			.setName("Chime on double tap")
			.setDesc("A short chime, rising when reading starts or resumes and falling when it pauses.")
			.addToggle((toggle) =>
				toggle.setValue(settings.doubleTapChime).onChange((value) => {
					settings.doubleTapChime = value;
					save();
				}),
			);

		let dropdown!: DropdownComponent;
		const customLabel = () =>
			settings.doubleTapCustomKey ? `Custom: ${keyLabel(settings.doubleTapCustomKey)}` : "Custom…";
		const refresh = () => {
			const custom = !isPreset(settings.doubleTapKey);
			dropdown.selectEl.querySelector(`option[value="${CUSTOM}"]`)?.setText(customLabel());
			dropdown.setValue(custom ? CUSTOM : settings.doubleTapKey);
			dropdown.setDisabled(!settings.doubleTapEnabled);
			chime.setDisabled(!settings.doubleTapEnabled);
			recorder.hidden = !settings.doubleTapEnabled || dropdown.getValue() !== CUSTOM;
		};

		// The box: shows the saved custom key, or the key being pressed and why it can't be used.
		const box = recorder.createDiv({ cls: "edge-voice-key-box", attr: { tabindex: "0", role: "textbox" } });
		const keyText = box.createSpan({ cls: "edge-voice-key-text" });
		const clear = box.createEl("button", {
			cls: "edge-voice-key-clear clickable-icon",
			attr: { "aria-label": "Clear" },
		});
		setIcon(clear, "x-circle");
		const footer = recorder.createDiv({ cls: "edge-voice-key-footer" });
		const message = footer.createSpan({ cls: "edge-voice-key-message" });
		const confirm = footer.createEl("button", { cls: "mod-cta", text: "Use this key" });
		let pending: string | null = null;

		const showBox = () => {
			const saved = settings.doubleTapCustomKey;
			keyText.setText(pending ? keyLabel(pending) : saved ? keyLabel(saved) : "Click here, then press a key");
			box.toggleClass("is-empty", !pending && !saved);
			confirm.hidden = !pending;
			clear.hidden = !pending && !saved;
		};
		const stopRecording = () => {
			this.plugin.recordingKey = false;
			box.removeClass("is-recording");
		};

		box.addEventListener("focus", () => {
			this.plugin.recordingKey = true;
			box.addClass("is-recording");
			if (!pending) {
				keyText.setText("Press a key…");
				message.setText("");
			}
		});
		box.addEventListener("blur", () => {
			stopRecording();
			if (!pending) showBox();
		});
		box.addEventListener("keydown", (event) => {
			if (event.code === "Tab") return; // still moves focus
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			if (event.code === "Escape") {
				pending = null;
				message.setText("");
				box.blur();
				return;
			}
			const problem = customKeyProblem(event);
			box.toggleClass("is-invalid", problem !== null);
			if (problem) {
				pending = null;
				keyText.setText(keyLabel(event.code));
				message.setText(problem);
				confirm.hidden = true;
				return;
			}
			pending = event.code;
			message.setText(
				isPreset(event.code)
					? `${keyLabel(event.code)} is also in the menu above.`
					: "Double-tap it to test after saving.",
			);
			showBox();
		});
		confirm.addEventListener("click", () => {
			if (!pending) return;
			settings.doubleTapCustomKey = pending;
			settings.doubleTapKey = pending;
			pending = null;
			message.setText("Saved.");
			box.removeClass("is-invalid");
			save();
			showBox();
			refresh();
		});
		clear.addEventListener("click", (event) => {
			event.stopPropagation();
			pending = null;
			const wasActive = settings.doubleTapKey === settings.doubleTapCustomKey;
			settings.doubleTapCustomKey = null;
			if (wasActive) settings.doubleTapKey = DEFAULT_DOUBLE_TAP_KEY;
			message.setText("");
			box.removeClass("is-invalid");
			save();
			showBox();
			refresh();
		});

		setting.addToggle((toggle) =>
			toggle.setValue(settings.doubleTapEnabled).onChange((value) => {
				settings.doubleTapEnabled = value;
				save();
				refresh();
			}),
		);
		setting.addDropdown((component) => {
			dropdown = component;
			for (const code of DOUBLE_TAP_PRESETS) dropdown.addOption(code, keyLabel(code));
			dropdown.addOption(CUSTOM, customLabel());
			dropdown.onChange((value) => {
				pending = null;
				message.setText("");
				box.removeClass("is-invalid");
				if (value === CUSTOM) {
					// The saved custom key comes back; with none yet, the box waits for one.
					if (settings.doubleTapCustomKey) {
						settings.doubleTapKey = settings.doubleTapCustomKey;
						save();
					}
					showBox();
					recorder.hidden = false;
					if (!settings.doubleTapCustomKey) box.focus();
					return;
				}
				settings.doubleTapKey = value;
				save();
				refresh();
			});
		});
		showBox();
		refresh();
	}

	/** Lists downloads with their sizes and a Delete button each (click twice to confirm). */
	private async showStorage(el: HTMLElement): Promise<void> {
		const { voices, engine } = await this.plugin.storageItems();
		el.empty();
		const deleteButton = (setting: Setting, items: StorageItem[], label = "Delete") =>
			setting.addButton((button) => {
				let armed = false;
				// The red "warning" look, on every Obsidian version (setDestructive is 1.13+).
				button.buttonEl.addClass("mod-warning");
				button.setButtonText(label).onClick(async () => {
					if (!armed) {
						armed = true;
						button.setButtonText("Click again to delete");
						return;
					}
					button.setDisabled(true);
					await this.plugin.deleteStorage(items);
					void this.showStorage(el);
				});
			});

		if (voices.length === 0 && !engine) {
			el.createDiv({ cls: "setting-item-description", text: "Nothing downloaded." });
			return;
		}
		if (voices.length > 0) {
			const total = voices.reduce((sum, item) => sum + item.bytes, 0);
			const all = new Setting(el)
				.setName("Downloaded voices")
				.setDesc(`${formatBytes(total)} in all. A deleted voice downloads again the next time it's used.`);
			if (voices.length > 1) deleteButton(all, voices, "Delete all voices");
		}
		for (const item of voices) {
			deleteButton(
				new Setting(el).setName(item.label).setDesc(`${formatBytes(item.bytes)} · ${item.description}`),
				[item],
			);
		}
		if (engine) {
			deleteButton(
				new Setting(el).setName(engine.label).setDesc(`${formatBytes(engine.bytes)} · ${engine.description}`),
				[engine],
			);
		}
	}
}
