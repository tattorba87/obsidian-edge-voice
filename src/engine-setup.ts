/**
 * Installs the speech engine when it's missing, one install at a time: the
 * plugin starts one as soon as it loads, and anything that needs the engine
 * meanwhile (pressing play, say) waits for that same install instead of
 * starting a second one into the same folder.
 */
export class EngineSetup {
	private running?: Promise<"ready" | "installed">;
	private abort?: AbortController;

	constructor(
		/** Whether the engine is usable as it is. */
		private readonly isReady: () => Promise<boolean>,
		/** Installs it; rejects on failure or when `signal` aborts. */
		private readonly install: (signal: AbortSignal) => Promise<void>,
	) {}

	/** Whether an install is under way. */
	get installing(): boolean {
		return this.running !== undefined;
	}

	/**
	 * Resolves "ready" if the engine already works, or "installed" once it has
	 * been installed. A failed install rejects, and the next call tries again.
	 */
	ensure(): Promise<"ready" | "installed"> {
		this.running ??= this.run().finally(() => {
			this.running = undefined;
			this.abort = undefined;
		});
		return this.running;
	}

	/** Stops an install under way, which then rejects. */
	cancel(): void {
		this.abort?.abort();
	}

	private async run(): Promise<"ready" | "installed"> {
		if (await this.isReady()) return "ready";
		this.abort = new AbortController();
		await this.install(this.abort.signal);
		return "installed";
	}
}
