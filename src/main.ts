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
	SettingDefinition,
	SettingDefinitionControl,
	SettingDefinitionItem,
	setIcon,
} from "obsidian";
import { join } from "path";
import { highlightField, MarkdownSource } from "./markdown";
import { PdfSource, PdfStart } from "./pdf";
import {
	DEFAULT_VOICE,
	EDGE_VOICE_HOME,
	enginePython,
	engineStorage,
	EngineSearch,
	findEngine,
	formatBytes,
	mlxSupported,
	OLD_SETUP,
	removeCommand,
	setupSteps,
	StorageItem,
	voiceCommand,
} from "./engine";
import { StatusIndicator } from "./status";
import { IdleUnload, UNLOAD_CHOICES } from "./idle";
import { CommandNotice, SetupModal } from "./setup-modal";
import { InBackground, pausesInBackground } from "./background";
import { playChime } from "./chime";
import { clamp, isEngineId, savedSettings } from "./settings";
import { startsReading, statusFor, toggleAction } from "./controls";
import {
	customKeyProblem,
	DEFAULT_DOUBLE_TAP_KEY,
	DOUBLE_TAP_PRESETS,
	DoubleTapDetector,
	keyCap,
	keyLabel,
	shortKeyLabel,
} from "./double-tap";
import { Reader, ReaderState, SegmentSource } from "./reader";
import { MissingVoiceError, Sidecar } from "./sidecar";
import { megabytes, VOICE_SAMPLES, VoiceInfo, voiceGroups, voiceLabel } from "./voices";
import { DEFAULT_HIGHLIGHT_THEME, HIGHLIGHT_THEMES, highlightTheme } from "./colors";
import { formatSpeed, nearestSpeed, PlayerBar, PlayerControls, showSpeedMenu, SPEEDS, stepSpeed } from "./player-bar";

interface ReaderSettings {
	/** A Python with the engine installed, as a full path; empty means the one in ~/.edge-voice/engine. */
	pythonPath: string;
	language: string;
	voice: string;
	speed: number;
	prefetch: number;
	autoScroll: boolean;
	preloadVoice: boolean;
	/** On Apple silicon, run voices on the GPU with MLX, when its packages are installed. */
	fasterEngine: boolean;
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
	/** Minutes stopped or paused before the voice engine is unloaded to free memory; 0 is never. */
	unloadAfter: number;
}

const DEFAULT_SETTINGS: ReaderSettings = {
	pythonPath: "",
	language: "en_us",
	voice: DEFAULT_VOICE,
	speed: 1.0,
	prefetch: 2,
	autoScroll: true,
	preloadVoice: true,
	fasterEngine: true,
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
	unloadAfter: 0,
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
	/** Unloads the voice after a while stopped or paused, if the person asked for that. */
	private idle!: IdleUnload;
	/** The voice was unloaded to free memory; loading it again says "Reloading". */
	private unloaded = false;
	private readonly controls: PlayerControls = {
		toggle: () => this.toggle("button"),
		previous: () => void this.skip(-1),
		next: () => void this.skip(1),
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
	/** The engine found at the last look (see findEngine), or why there's none to use. */
	engineSearch?: EngineSearch;
	/** Which engine the loaded voice runs on, and why not the faster one. */
	private engineInUse?: { engine: string; fallback?: string };
	/** The page being read: playback belongs to it, and pauses when you leave it. */
	private target?: { view: FileView; path: string | undefined; mode?: string };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.idle = new IdleUnload({
			minutes: () => this.settings.unloadAfter,
			idle: () => this.sidecar.running && (this.reader.state === "idle" || this.reader.state === "paused"),
			busy: () => this.sidecar.busy,
			unload: () => this.unloadVoice(),
			setTimer: (run, ms) => window.setTimeout(run, ms),
			clearTimer: (id) => window.clearTimeout(id),
		});
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

		this.addCommand({ id: "toggle", name: "Read aloud / pause", callback: () => this.toggle("button") });
		this.addCommand({
			id: "read-from-here",
			name: "Read from current position",
			callback: () => this.readFromHere(),
		});
		this.addCommand({ id: "stop", name: "Stop reading", callback: () => this.stop() });
		this.addCommand({ id: "next", name: "Next sentence", callback: () => void this.skip(1) });
		this.addCommand({ id: "previous", name: "Previous sentence", callback: () => void this.skip(-1) });
		this.addCommand({
			id: "faster",
			name: "Read faster",
			callback: () => this.setSpeed(stepSpeed(this.settings.speed, 1)),
		});
		this.addCommand({
			id: "slower",
			name: "Read slower",
			callback: () => this.setSpeed(stepSpeed(this.settings.speed, -1)),
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
		this.idle.cancel();
		this.reader.stop();
		this.sidecar.stop();
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as unknown;
		// Only values of the right type are kept (see settings.ts); then what each must be.
		const settings: ReaderSettings = { ...DEFAULT_SETTINGS, ...savedSettings(saved, DEFAULT_SETTINGS) };
		if (!isEngineId(settings.voice)) settings.voice = DEFAULT_SETTINGS.voice;
		if (!isEngineId(settings.language)) settings.language = DEFAULT_SETTINGS.language;
		if (!["pause", "visible", "always"].includes(settings.inBackground)) {
			settings.inBackground = DEFAULT_SETTINGS.inBackground;
		}
		// The Python the old setup installed into ~/.edge-voice/venv was the default; now it's automatic.
		if (OLD_SETUP.some((name) => settings.pythonPath.startsWith(join(EDGE_VOICE_HOME, name)))) {
			settings.pythonPath = "";
		}
		settings.volume = clamp(settings.volume, 0, 1);
		// The settings offer 1 to 4.
		settings.prefetch = Math.round(clamp(settings.prefetch, 1, 4));
		if (!(String(settings.unloadAfter) in UNLOAD_CHOICES)) settings.unloadAfter = DEFAULT_SETTINGS.unloadAfter;
		// Finer speeds were offered before; keep the closest of the ones offered now.
		settings.speed = nearestSpeed(settings.speed);
		// One setting used to cover both switching pages and leaving Obsidian.
		if ((saved as { keepReadingInBackground?: unknown } | null)?.keepReadingInBackground === true) {
			settings.pauseOnPageSwitch = false;
			settings.inBackground = "always";
		}
		// A key recorded before there was one custom slot becomes the custom key.
		if (!settings.doubleTapCustomKey && !DOUBLE_TAP_PRESETS.includes(settings.doubleTapKey)) {
			settings.doubleTapCustomKey = settings.doubleTapKey;
		}
		this.settings = settings;
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
	 * At start-up: with an engine, loads the voice so the first read starts at
	 * once. Without one, says how to set it up; Edge Voice never installs or
	 * downloads anything itself.
	 */
	private async prepareEngine(): Promise<void> {
		const search = await this.checkEngine();
		if (!search.engine) {
			this.offerSetup(search.problem);
			return;
		}
		if (this.settings.preloadVoice) void this.preloadVoice();
	}

	/**
	 * Looks for the engine again (after the person ran the setup steps, or
	 * changed the Python path), and switches to it if it moved.
	 */
	async checkEngine(): Promise<EngineSearch> {
		const search = await findEngine(this.settings.pythonPath);
		const before = this.enginePythonInUse();
		this.engineSearch = search;
		if (this.enginePythonInUse() !== before) this.restartSidecar();
		return search;
	}

	/** The Python the sidecar runs: the engine found, else the configured one or the default place. */
	private enginePythonInUse(): string {
		return this.engineSearch?.engine?.python ?? (this.settings.pythonPath.trim() || enginePython());
	}

	/** A notice that stays until dismissed, with a button that opens the setup steps. */
	private offerSetup(problem?: string): void {
		const notice = new Notice(
			createFragment((fragment) => {
				fragment.createDiv({ text: problem ?? "Edge Voice needs its speech engine before it can read aloud." });
				fragment
					.createEl("button", { text: "How to set it up", cls: "mod-cta edge-voice-notice-button" })
					.addEventListener("click", () => {
						notice.hide();
						this.openSetup();
					});
			}),
			0,
		);
	}

	/** Whether the faster engine will be asked for: on, supported here, and its packages installed. */
	get fasterReady(): boolean {
		return this.settings.fasterEngine && mlxSupported() && this.engineSearch?.engine?.faster === true;
	}

	/** Turns the faster engine on or off; it takes effect from the next voice loaded. */
	setFasterEngine(on: boolean): void {
		this.settings.fasterEngine = on;
		void this.saveSettings();
		if (this.reader.state === "idle" && this.settings.preloadVoice) void this.preloadVoice();
	}

	/** What the faster engine is doing, for the settings. */
	fasterEngineStatus(): string {
		if (!this.settings.fasterEngine) return "Off: voices run on the processor.";
		if (!this.engineSearch?.engine) return "Set up the speech engine first.";
		if (!this.engineSearch.engine.faster) {
			return "Its packages aren't installed. The setup steps include them on Apple silicon; run steps 2 to 4 again.";
		}
		if (this.engineInUse?.engine === "mlx") return "On: voices run on the GPU, about twice as fast.";
		if (this.engineInUse?.fallback) return `On, but the standard engine is speaking: ${this.engineInUse.fallback}.`;
		return "On: used from the next voice loaded.";
	}

	private async preloadVoice(): Promise<void> {
		try {
			await this.ensureVoice();
		} catch (error) {
			console.warn("[edge-voice] preloading the voice failed", error);
		} finally {
			if (this.reader.state === "idle") this.status.show("hidden");
			this.idle.reset();
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
		this.sidecar = new Sidecar(this.enginePythonInUse());
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
		switch (toggleAction(this.reader.state, this.onTargetPage(), origin)) {
			case "pause":
				this.reader.pause();
				break;
			case "resume":
				void this.resume();
				break;
			case "stop":
				this.stop();
				break;
			case "restart":
				this.stop();
				void this.readFromHere();
				break;
			case "start":
				void this.readFromHere();
		}
	}

	/** Resumes, loading the voice again first if it was unloaded while paused. */
	private async resume(): Promise<void> {
		if (await this.reload()) this.reader.resume();
	}

	private async skip(delta: number): Promise<void> {
		if (await this.reload()) this.reader.skip(delta);
	}

	/**
	 * Loads the voice again if it was unloaded to free memory, showing
	 * "Reloading voice". False if that failed (the person has been told).
	 */
	private async reload(): Promise<boolean> {
		if (!this.unloaded || this.sidecar.running) return true;
		try {
			await this.ensureVoice();
			this.showState(this.state, this.stateDetail);
			return true;
		} catch (error) {
			if (error instanceof MissingVoiceError) this.showMissingVoice(error.voice);
			else new Notice(`Edge Voice could not load the voice: ${(error as Error).message}`, 10000);
			this.showState(this.state, this.stateDetail);
			return false;
		}
	}

	/** Stops the engine to free its memory; the next play loads the voice again. */
	private unloadVoice(): void {
		this.status.show("busy", "Unloading voice");
		this.sidecar.stop();
		this.voice = undefined;
		this.unloaded = true;
		window.setTimeout(() => {
			if (!this.sidecar.running) this.showState(this.state, this.stateDetail);
		}, 1500);
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
		// Switching the page being read between Reading view and editing: its
		// highlight is drawn again in the new mode, and scrolled to.
		this.registerEvent(
			workspace.on("layout-change", () => {
				const target = this.target;
				if (!target || !(target.view instanceof MarkdownView)) return;
				const mode = target.view.getMode();
				if (mode === target.mode) return;
				target.mode = mode;
				// A moment for the new mode to render before placing the highlight in it.
				window.setTimeout(() => this.reader.refreshHighlight(), 100);
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
				if (this.settings.doubleTapChime)
					playChime(
						startsReading(toggleAction(this.reader.state, this.onTargetPage(), "double-tap"))
							? "up"
							: "down",
					);
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

	/**
	 * The voices downloaded, for the Storage settings, as the engine lists them
	 * (`edge-voice-engine storage`): "none" without an engine, null when the
	 * engine is too old to say. The plugin reads no files itself.
	 */
	async storageItems(): Promise<StorageItem[] | null | "none"> {
		const search = this.engineSearch ?? (await this.checkEngine());
		if (!search.engine) return "none";
		return engineStorage(search.engine.python);
	}

	/**
	 * Stops reading and the engine, so no voice file is in use while the person
	 * removes voices with the command they just copied.
	 */
	releaseVoiceFiles(): void {
		this.stop();
		this.sidecar.stop();
		this.voice = undefined;
	}

	/** Opens the setup steps for this computer; "Check again" there looks for the engine. */
	openSetup(onReady?: () => void): void {
		const faster = this.settings.fasterEngine && mlxSupported();
		const voice = this.settings.voice;
		new SetupModal(this.app, {
			steps: setupSteps({ platform: process.platform, arch: process.arch, faster }, voice),
			problem: this.engineSearch?.problem,
			check: async () => {
				const search = await this.checkEngine();
				if (search.engine) {
					onReady?.();
					if (this.settings.preloadVoice) void this.preloadVoice();
				}
				return search;
			},
		}).open();
	}

	private async startReading(view: FileView, source: SegmentSource): Promise<void> {
		// The bar and its glow show at once, while the voice loads, not only once synthesis starts.
		this.bar.update("loading");
		if (!this.sidecar.running && !(await this.checkEngine()).engine) {
			// No engine: show how to set it up.
			source.dispose();
			this.bar.update("idle");
			this.openSetup();
			return;
		}
		try {
			await this.ensureVoice();
		} catch (error) {
			source.dispose();
			this.showState("idle");
			if (error instanceof MissingVoiceError) this.showMissingVoice(error.voice);
			else new Notice(`Edge Voice could not load the voice: ${(error as Error).message}`, 10000);
			return;
		}
		this.reader.start(source);
		this.target = { view, path: view.file?.path, mode: view instanceof MarkdownView ? view.getMode() : undefined };
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

	/** The voice isn't on this computer: the command that gets it, to copy. */
	private showMissingVoice(voice: string): void {
		const faster = this.fasterReady && voice.startsWith("kokoro_");
		new CommandNotice(
			`The voice ${voice} isn't downloaded yet. Run this in ${process.platform === "win32" ? "PowerShell" : "Terminal"} to get it, then start reading again:`,
			voiceCommand(voice, faster),
		);
	}

	private ensureVoice(): Promise<void> {
		const engine = this.fasterReady ? "mlx" : undefined;
		const key = `${this.settings.language}/${this.settings.voice}/${engine ?? "moonshine"}`;
		if (this.voice?.key === key && this.sidecar.running) return this.voice.ready;
		this.idle.cancel();
		this.status.show("busy", this.unloaded ? "Reloading voice" : "Loading voice");
		const ready = this.sidecar
			.load(this.settings.language, this.settings.voice, engine)
			.then((loaded) => {
				this.unloaded = false;
				this.engineInUse = loaded;
				if (loaded.fallback) console.warn("[edge-voice] the standard engine is speaking:", loaded.fallback);
			})
			.catch((error: Error) => {
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

	/** How long to wait, stopped or paused, before unloading the voice; 0 is never. */
	setUnloadAfter(minutes: number): void {
		this.settings.unloadAfter = String(minutes) in UNLOAD_CHOICES ? minutes : 0;
		void this.saveSettings();
		this.idle.reset();
	}

	/** Sets the reading speed; it is heard from the next sentence on. */
	setSpeed(value: number): void {
		const speed = nearestSpeed(value);
		this.settings.speed = speed;
		void this.saveSettings();
		// Speed changes prepare audio again: the voice must be there first.
		if (this.unloaded && this.state !== "idle") void this.reload().then(() => this.reader.invalidateAudio());
		else this.reader.invalidateAudio();
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
		this.status.show(...statusFor(state, this.stateDetail, formatSpeed(this.settings.speed)));
		this.idle?.reset();
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

/** What Settings → Storage knows: not asked yet, asking the engine, or its answer (see storageItems). */
type StorageState = { status: "idle" | "loading" } | { status: "done"; items: StorageItem[] | null | "none" };

/**
 * The settings tab, as Obsidian's setting definitions (1.13+), so every row
 * shows up in Obsidian's settings search. Plain toggles, menus and the slider
 * are controls; rows with their own drawing (voices, colours, the double-tap
 * key, Storage, the engine) are render definitions around the code that drew
 * them before.
 */
class ReaderSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: EdgeVoicePlugin,
	) {
		super(app, plugin);
	}

	/** The Voice row, filled in together with Get another voice (see showVoices). */
	private voiceRow?: Setting;

	private storage: StorageState = { status: "idle" };

	getControlValue(key: string): unknown {
		if (key === "speed") return String(nearestSpeed(this.plugin.settings.speed));
		if (key === "unloadAfter") return String(this.plugin.settings.unloadAfter);
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	setControlValue(key: string, value: unknown): void {
		if (key === "speed") return this.plugin.setSpeed(Number(value));
		if (key === "showPlayer") return this.plugin.setPlayerShown(value === true);
		if (key === "unloadAfter") return this.plugin.setUnloadAfter(Number(value));
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		void this.plugin.saveSettings();
	}

	hide(): void {
		super.hide();
		// Ask the engine again next time the tab opens.
		this.storage = { status: "idle" };
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		const toggle = (
			key: string,
			name: string,
			desc: string,
			disabled?: () => boolean,
		): SettingDefinitionControl => ({
			name,
			desc,
			control: { type: "toggle", key, disabled },
		});
		return [
			{
				type: "group",
				items: [
					{
						name: "Voice",
						desc: "Kokoro voices sound the most natural; Piper voices start reading sooner.",
						render: (setting) => {
							this.voiceRow = setting;
						},
					},
					{
						name: "Get another voice",
						desc: "Voices are downloaded by you, with a command; Edge Voice doesn't download anything.",
						aliases: ["Download a voice", "Kokoro", "Piper"],
						render: (setting) => {
							if (this.voiceRow) this.showVoices(this.voiceRow, setting);
						},
					},
					{
						name: "Speed",
						desc: "Also adjustable while reading, from the player bar, the status bar or the commands to read faster and slower.",
						control: {
							type: "dropdown",
							key: "speed",
							options: Object.fromEntries(SPEEDS.map((speed) => [String(speed), formatSpeed(speed)])),
						},
					},
					{
						name: "Highlight colour",
						desc: "A soft tint for the sentence, a deeper shade for the word being spoken.",
						aliases: ["Highlight color", "Theme"],
						render: (setting) => this.highlightColour(setting),
					},
					toggle(
						"showPlayer",
						"Show player controls",
						"The floating bar with play/pause, skip, speed and volume while reading. Without it, use the status bar, commands and hotkeys.",
					),
					toggle(
						"preloadVoice",
						"Load the voice when Obsidian starts",
						"Reading then starts at once. Keeps the voice in memory (a few hundred MB for Kokoro) while Obsidian is open.",
					),
					{
						name: "Double-tap shortcut",
						desc: "Double-tap a key to start reading, and again to pause or resume. Works while Obsidian is the active app.",
						aliases: ["Hotkey", "Key"],
						render: (setting) => this.doubleTapSetting(setting),
					},
					toggle(
						"doubleTapChime",
						"Chime on double tap",
						"A short chime, rising when reading starts or resumes and falling when it pauses.",
						() => !settings.doubleTapEnabled,
					),
					toggle(
						"pauseOnPageSwitch",
						"Pause when switching pages",
						"Reading pauses when you open another page, and resumes where it stopped. Sidebars don't count.",
					),
					{
						name: "When Obsidian is in the background",
						desc: "While you use another app. Visible means an Obsidian window is still on screen, not minimized, hidden or covered.",
						control: {
							type: "dropdown",
							key: "inBackground",
							options: { pause: "Pause", visible: "Keep reading while visible", always: "Keep reading" },
						},
					},
					toggle(
						"skipFootnotes",
						"Skip footnotes in PDFs",
						"Leave out the small-print notes at the bottom of a page and the little marks that point to them.",
					),
					toggle("autoScroll", "Follow along", "Scroll to keep the sentence being read in view."),
				],
			},
			{ type: "group", heading: "Storage", items: this.storageDefinitions() },
			{
				type: "group",
				heading: "Advanced",
				items: [
					{
						name: "Speech engine",
						desc: "Looking for it…",
						aliases: ["Setup", "Install"],
						render: (setting) => this.engineSetting(setting),
					},
					{
						name: "Faster voice engine",
						desc: this.plugin.fasterEngineStatus(),
						aliases: ["MLX", "Apple silicon"],
						visible: mlxSupported(),
						render: (setting) => {
							setting.addToggle((component) =>
								component.setValue(settings.fasterEngine).onChange((value) => {
									this.plugin.setFasterEngine(value);
									setting.setDesc(this.plugin.fasterEngineStatus());
								}),
							);
						},
					},
					{
						name: "Python interpreter",
						desc:
							"Leave empty to use the engine in the .edge-voice/engine folder in your home folder. To use another " +
							"Python with the engine installed, enter its full path.",
						render: (setting) => {
							setting
								.addText((text) =>
									text
										.setPlaceholder("Automatic")
										.setValue(settings.pythonPath)
										.onChange((value) => {
											settings.pythonPath = value.trim();
											void this.plugin.saveSettings();
										}),
								)
								// Drawing the tab again looks for the engine there.
								.addButton((button) => button.setButtonText("Use it").onClick(() => this.update()));
						},
					},
					{
						name: "Free voice memory when idle",
						desc: 'After this long stopped or paused, Edge Voice unloads the voice engine and gives its memory back (several hundred MB; about 800 MB with a Kokoro voice). The next time you play, resume or skip, it loads the voice again first: expect about 2–3 seconds for a Kokoro voice and 1–2 seconds for a Piper voice, a little more on older computers. The status bar shows "Unloading voice" and "Reloading voice".',
						aliases: ["memory", "RAM", "unload", "idle", "resources"],
						control: { type: "dropdown", key: "unloadAfter", options: UNLOAD_CHOICES },
					},
					{
						name: "Sentences to prepare ahead",
						desc: "More smooths over slow sentences; fewer reacts faster to skips and speed changes.",
						control: { type: "slider", key: "prefetch", min: 1, max: 4, step: 1 },
					},
				],
			},
		];
	}

	/** Colour swatches, with a preview of the sentence and word highlights below. */
	private highlightColour(setting: Setting): void {
		const settings = this.plugin.settings;
		const swatches = setting.controlEl.createDiv({ cls: "edge-voice-swatches" });
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
		const preview = setting.descEl.createDiv({ cls: "edge-voice-preview" });
		preview.createSpan({ text: "Before it. " });
		const sentence = preview.createSpan({ cls: "edge-voice-sentence", text: "This sentence is being read, and " });
		sentence.createSpan({ cls: "edge-voice-word", text: "this" });
		sentence.appendText(" word is being spoken.");
		preview.createSpan({ text: " After it." });
	}

	/** The engine row: what was found, the setup steps, and Check again. */
	private engineSetting(setting: Setting): void {
		const lookForEngine = () => {
			setting.setDesc("Looking for it…");
			void this.plugin.checkEngine().then(({ engine: found, problem }) => {
				setting.setDesc(
					found
						? `Ready: speech engine ${found.version}, in ${found.python}.`
						: (problem ?? "Not set up yet. See the setup steps."),
				);
				setting.controlEl.querySelector("button")?.toggleClass("mod-cta", !found);
			});
		};
		setting.addButton((button) =>
			button.setButtonText("Setup steps").onClick(() =>
				// Once the engine is found, draw again what depends on it.
				this.plugin.openSetup(() => {
					this.storage = { status: "idle" };
					this.update();
				}),
			),
		);
		setting.addButton((button) => button.setButtonText("Check again").onClick(lookForEngine));
		lookForEngine();
	}

	/**
	 * Fills in the voice to read with (those on this computer) and the voices to
	 * get, asking the engine again each time, so Check again finds a voice just
	 * downloaded.
	 */
	private showVoices(voiceSetting: Setting, moreSetting: Setting): void {
		const settings = this.plugin.settings;
		voiceSetting.controlEl.empty();
		moreSetting.controlEl.empty();
		moreSetting.descEl.empty();
		moreSetting.descEl.setText(
			"Voices are downloaded by you, with a command; Edge Voice doesn't download anything.",
		);
		voiceSetting.addDropdown((dropdown) => {
			dropdown.addOption(settings.voice, settings.voice).setValue(settings.voice);
			let catalog: VoiceInfo[] = [];
			dropdown.onChange((value) => {
				settings.voice = value;
				// A British voice reads with British English's rules and voice files.
				const chosen = catalog.find((voice) => voice.id === value);
				if (chosen) settings.language = chosen.language;
				void this.plugin.saveSettings();
				this.plugin.voiceChanged();
			});
			this.plugin.sidecar
				.voices(settings.language)
				.then((voices) => {
					catalog = voices.catalog;
					dropdown.selectEl.empty();
					if (catalog.length > 0) {
						// Only voices on this computer, and the chosen one even if it isn't (yet).
						const here = catalog.filter((voice) => voice.installed);
						const chosen = catalog.find((voice) => voice.id === settings.voice);
						if (!chosen?.installed)
							dropdown.addOption(
								settings.voice,
								`${chosen ? voiceLabel(chosen) : settings.voice} (not downloaded)`,
							);
						for (const voice of here) dropdown.addOption(voice.id, voiceLabel(voice));
					} else {
						// An engine without a catalog: plain IDs.
						for (const voice of new Set([settings.voice, ...voices.present])) {
							dropdown.addOption(
								voice,
								voices.present.includes(voice) ? voice : `${voice} (not downloaded)`,
							);
						}
					}
					dropdown.setValue(settings.voice);
					this.anotherVoice(moreSetting, catalog, voices.downloadable, () =>
						this.showVoices(voiceSetting, moreSetting),
					);
				})
				// Braces, not a returned Setting: Setting has a then() method, so a promise
				// treats it as one and calls it, and it calls back, over and over, freezing Obsidian.
				.catch((error: Error) => {
					voiceSetting.setDesc(`Could not list voices: ${error.message}`);
				});
		});
	}

	/**
	 * The voices to get, grouped with their sizes, links to hear them first, the
	 * command that downloads the one picked (to copy), and Check again.
	 */
	private anotherVoice(setting: Setting, catalog: VoiceInfo[], downloadable: string[], refresh: () => void): void {
		const samples = setting.descEl.createDiv();
		samples.appendText("Hear them first: ");
		samples.createEl("a", { text: "Kokoro voices", href: VOICE_SAMPLES.Kokoro });
		samples.appendText(", ");
		samples.createEl("a", { text: "Piper voices", href: VOICE_SAMPLES.Piper });
		samples.appendText(".");
		const command = setting.descEl.createEl("code", { cls: "edge-voice-command" });
		command.hidden = true;
		let picked = "";
		const commandFor = (id: string) => {
			const voice = catalog.find((item) => item.id === id);
			const faster = this.plugin.fasterReady && (voice ? voice.faster : id.startsWith("kokoro_"));
			return voiceCommand(id, faster);
		};
		const groups = voiceGroups(catalog);
		if (groups.length > 0 || downloadable.length > 0) {
			setting.addDropdown((dropdown) => {
				dropdown.addOption("", "Choose a voice…");
				if (catalog.length > 0) {
					for (const group of groups) {
						const optgroup = dropdown.selectEl.createEl("optgroup", { attr: { label: group.label } });
						for (const voice of group.voices)
							optgroup.createEl("option", {
								value: voice.id,
								text: `${voiceLabel(voice)} (${megabytes(voice.download)})`,
							});
					}
				} else {
					for (const voice of downloadable) dropdown.addOption(voice, voice);
				}
				dropdown.onChange((voice) => {
					picked = voice;
					command.setText(voice ? commandFor(voice) : "");
					command.hidden = !voice;
				});
			});
			setting.addButton((button) =>
				button.setButtonText("Copy command").onClick(async () => {
					if (!picked) return;
					await navigator.clipboard.writeText(commandFor(picked));
					new Notice(
						`Copied. Run it in ${process.platform === "win32" ? "PowerShell" : "Terminal"}, then click Check again.`,
					);
				}),
			);
		}
		setting.addButton((button) =>
			button.setButtonText("Check again").setTooltip("Look for voices you've just downloaded").onClick(refresh),
		);
	}

	/**
	 * The double-tap shortcut row: on or off, a menu of three good keys or
	 * "Custom…". Custom opens a box that shows the key being pressed, refuses
	 * keys that type or already do something, and saves only when confirmed;
	 * there is one custom key, replaced each time. The chime is its own row,
	 * disabled with the shortcut (refreshDomState).
	 */
	private doubleTapSetting(setting: Setting): void {
		const settings = this.plugin.settings;
		const CUSTOM = "custom";
		const isPreset = (code: string) => DOUBLE_TAP_PRESETS.includes(code);
		const save = () => void this.plugin.saveSettings();

		// Custom: a panel inside the setting's own box, with the key, Save and clear in a row
		// and a message line below that always keeps its space, so nothing shifts.
		setting.settingEl.addClass("edge-voice-key-setting");
		const panel = setting.settingEl.createDiv({ cls: "edge-voice-key-panel" });
		const row = panel.createDiv({ cls: "edge-voice-key-row" });
		const capture = row.createDiv({ cls: "edge-voice-key-capture", attr: { tabindex: "0", role: "button" } });
		const confirm = row.createEl("button", { cls: "mod-cta", text: "Save" });
		const clear = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Clear the custom key" } });
		setIcon(clear, "x");
		const message = panel.createDiv({ cls: "edge-voice-key-message" });
		let dropdown!: DropdownComponent;
		let pending: string | null = null;

		/** Draws `code` as a key cap (⌘ and "Right"), or the placeholder. */
		const showKey = (code: string | null) => {
			capture.empty();
			capture.toggleClass("is-empty", !code);
			if (!code) {
				capture.createSpan({ text: "Click to record a key" });
				capture.setAttr("aria-label", "Record a custom key");
				return;
			}
			const { symbol, side } = keyCap(code);
			capture.createEl("kbd", { text: symbol });
			if (side) capture.createSpan({ cls: "edge-voice-key-side", text: side });
			capture.setAttr("aria-label", `${keyLabel(code)}; click to change`);
		};
		const say = (text: string, error = false) => {
			message.setText(text);
			message.toggleClass("is-error", error);
		};
		/** The resting state: the saved custom key, or the placeholder. */
		const rest = () => {
			pending = null;
			const saved = settings.doubleTapCustomKey;
			showKey(saved);
			capture.removeClass("is-invalid");
			confirm.disabled = true;
			clear.disabled = !saved;
			say(saved ? `Double-tap ${keyLabel(saved)} to read.` : "Click the key above, then press the one you want.");
		};
		const refresh = () => {
			dropdown.setValue(isPreset(settings.doubleTapKey) ? settings.doubleTapKey : CUSTOM);
			dropdown.setDisabled(!settings.doubleTapEnabled);
			panel.hidden = !settings.doubleTapEnabled || dropdown.getValue() !== CUSTOM;
			// The chime row follows the shortcut's on/off.
			this.refreshDomState();
		};

		capture.addEventListener("focus", () => {
			this.plugin.recordingKey = true;
			capture.addClass("is-recording");
			if (!pending) say("Press a key. Esc cancels.");
		});
		capture.addEventListener("blur", () => {
			this.plugin.recordingKey = false;
			capture.removeClass("is-recording");
			if (!pending) rest();
		});
		capture.addEventListener("keydown", (event) => {
			if (event.code === "Tab") return; // still moves focus
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			if (event.code === "Escape") {
				pending = null;
				capture.blur();
				return;
			}
			const problem = customKeyProblem(event);
			showKey(event.code);
			capture.toggleClass("is-invalid", problem !== null);
			if (problem) {
				pending = null;
				confirm.disabled = true;
				say(problem, true);
				return;
			}
			pending = event.code;
			confirm.disabled = false;
			clear.disabled = false;
			say(
				isPreset(event.code)
					? `${keyLabel(event.code)} is also in the menu. Save to use it.`
					: `Save to use ${keyLabel(event.code)}.`,
			);
		});
		confirm.addEventListener("click", () => {
			if (!pending) return;
			settings.doubleTapCustomKey = pending;
			settings.doubleTapKey = pending;
			save();
			rest();
			refresh();
		});
		clear.addEventListener("click", () => {
			// A key pressed but not saved is only discarded; the saved one stays.
			if (pending) {
				rest();
				return;
			}
			const wasActive = settings.doubleTapKey === settings.doubleTapCustomKey;
			settings.doubleTapCustomKey = null;
			if (wasActive) settings.doubleTapKey = DEFAULT_DOUBLE_TAP_KEY;
			save();
			rest();
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
			dropdown.selectEl.addClass("edge-voice-key-menu");
			for (const code of DOUBLE_TAP_PRESETS) dropdown.addOption(code, shortKeyLabel(code));
			dropdown.addOption(CUSTOM, "Custom");
			dropdown.onChange((value) => {
				rest();
				if (value === CUSTOM) {
					// The saved custom key comes back; with none yet, the panel waits for one.
					if (settings.doubleTapCustomKey) {
						settings.doubleTapKey = settings.doubleTapCustomKey;
						save();
					}
					panel.hidden = false;
					if (!settings.doubleTapCustomKey) capture.focus();
					return;
				}
				settings.doubleTapKey = value;
				save();
				refresh();
			});
		});
		rest();
		refresh();
	}

	/**
	 * Settings → Storage: downloaded voices with their sizes, as the engine
	 * reports them, and for each the command that removes it, with a Copy
	 * button. Edge Voice deletes nothing itself: the person runs the command,
	 * as with setup. The engine is asked when the tab is drawn, not when
	 * Obsidian starts.
	 */
	private storageDefinitions(): SettingDefinition[] {
		const state = this.storage;
		const items = state.status === "done" ? state.items : undefined;
		const shell = process.platform === "win32" ? "PowerShell" : "Terminal";
		const refresh = () => {
			this.storage = { status: "idle" };
			this.update();
		};
		const copyButton = (setting: Setting, ids: string[], label = "Copy remove command") =>
			setting.addButton((button) =>
				button.setButtonText(label).onClick(async () => {
					// Nothing may hold a voice file open while it's removed.
					this.plugin.releaseVoiceFiles();
					await navigator.clipboard.writeText(removeCommand(ids));
					new Notice(`Copied. Run it in ${shell}, then click Check again.`);
				}),
			);
		const total = Array.isArray(items) ? items.reduce((sum, item) => sum + item.bytes, 0) : 0;
		let desc = "Checking downloads…";
		if (items === "none") desc = "Set up the speech engine first (see Speech engine, under Advanced).";
		else if (items === null)
			desc =
				"This version of the speech engine can't list what it has downloaded. Run the setup steps again to update it.";
		else if (items?.length === 0) desc = "Nothing downloaded yet.";
		else if (items)
			desc =
				`${formatBytes(total)} in all. Edge Voice doesn't delete files itself: copy a voice's remove command ` +
				`and run it in ${shell}. Copying stops reading, so no voice is in use. ` +
				"To use a removed voice again, get it again (see Get another voice).";
		const summary: SettingDefinition = {
			name: "Downloaded voices",
			desc,
			aliases: ["Delete voices", "Remove voices", "Disk space"],
			render: (setting) => {
				if (state.status === "idle") {
					this.storage = { status: "loading" };
					void this.plugin.storageItems().then((found) => {
						this.storage = { status: "done", items: found };
						this.update();
					});
				}
				if (items === null)
					setting.addButton((button) =>
						button.setButtonText("Setup steps").onClick(() => this.plugin.openSetup(refresh)),
					);
				setting.addButton((button) => button.setButtonText("Check again").onClick(refresh));
				if (Array.isArray(items) && items.length > 1) copyButton(setting, [], "Copy command to remove all");
			},
		};
		const rows: SettingDefinition[] = Array.isArray(items)
			? items.map((item) => ({
					name: item.label,
					desc: `${formatBytes(item.bytes)} · ${item.description}`,
					render: (setting: Setting) => {
						copyButton(setting, [item.id]);
					},
				}))
			: [];
		return [summary, ...rows];
	}
}
