export type DictationState = "starting" | "recording" | "stopping" | "idle";

/** RMS mapped to a readable microphone glow; does not retain or inspect speech content. */
export function microphoneLevel(samples: Float32Array): number {
	return Math.min(1, rms(samples) * 8);
}

function rms(samples: Float32Array): number {
	if (!samples.length) return 0;
	let energy = 0;
	for (const value of samples) energy += value * value;
	return Math.sqrt(energy / samples.length);
}

/**
 * Input at least this loud (RMS, about -36 dBFS) counts as someone speaking: above a
 * microphone's usual noise floor (-50 to -60 dBFS), below conversational speech.
 */
export const VOICE_RMS = 0.015;

/** Conservative editor ownership: stop rather than overwrite an intervening edit. */
export class DictationText {
	private expected: string;
	private inserted = "";
	private readonly prefix: string;
	private readonly suffix: string;

	constructor(
		initial: string,
		private readonly from: number,
		to: number,
		private readonly lowercase: boolean,
	) {
		this.expected = initial;
		this.prefix = initial.slice(0, from);
		this.suffix = initial.slice(to);
	}

	update(current: string, transcript: string): { from: number; to: number; text: string } | null {
		if (current !== this.expected) throw new Error("Dictation stopped because the note was edited.");
		const words = (this.lowercase ? transcript.toLowerCase() : transcript).trim();
		if (!words) return null;
		const text = (/\S$/.test(this.prefix) ? " " : "") + words + (/^\S/.test(this.suffix) ? " " : "");
		if (text === this.inserted) return null;
		const change = { from: this.from, to: this.expected.length - this.suffix.length, text };
		this.inserted = text;
		this.expected = this.prefix + text + this.suffix;
		return change;
	}

	/**
	 * Where to leave the cursor once dictation ends: one space after the dictated words,
	 * and the space to add first if there isn't one (null if nothing was dictated).
	 */
	cursorAfter(): { at: number; insertSpace: boolean } | null {
		if (!this.inserted) return null;
		const end = this.from + this.inserted.length;
		if (/\s$/.test(this.inserted)) return { at: end, insertSpace: false };
		if (this.suffix.startsWith(" ")) return { at: end + 1, insertSpace: false };
		return { at: end + 1, insertSpace: true };
	}
}

export interface DictationBackend {
	/** Loads the model; calls `supported` as soon as the engine confirms it can dictate, before the slow load. */
	startDictation(path: string, model: string, supported?: () => void): Promise<void>;
	dictationAudio(samples: Float32Array, sampleRate: number): Promise<string>;
	stopDictation(): Promise<string>;
	stop(): void;
}

export interface Microphone {
	start?(): void;
	stop(): void;
}

export interface DictationOptions {
	backend: DictationBackend;
	capture: (receive: (samples: Float32Array, rate: number) => void, ended: () => void) => Promise<Microphone>;
	apply: (text: string) => void;
	ready?: () => void;
	/** After the final text is in: e.g. to put the cursor after it. */
	finished?: () => void;
	cancelled?: () => void;
	state: (state: DictationState) => void;
	level?: (level: number) => void;
	/**
	 * The recognized text is done and dictation is only waiting: seconds until the
	 * automatic stop (0 if it's off), or null once speech or recognition resumes.
	 */
	done?: (stopsIn: number | null) => void;
	error: (message: string) => void;
	chime: (recording: boolean) => Promise<void> | void;
	setTimer: (run: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
	now: () => number;
}

/**
 * How long the transcript must stay unchanged, and the microphone quiet, with recognition
 * keeping up, to count as done.
 */
export const DONE_AFTER_MS = 1000;

/** One bounded audio queue, one request at a time; cancellation invalidates late results. */
export class DictationSession {
	active = false;
	private generation = 0;
	private recording = false;
	private microphone?: Microphone;
	private queue: Float32Array[] = [];
	private queued = 0;
	private rate = 48000;
	private pending?: Promise<void>;
	private timer?: number;
	/** The last transcript change or audible input: silence is measured from here. */
	private lastSpeech = 0;
	/** The last audible input, and when the latest answered request was sent. */
	private heardAt = -Infinity;
	private answeredAt = -Infinity;
	private transcript = "";
	private stopping = false;
	/** The recognizer's model load, which runs while the microphone already records. */
	private loading?: Promise<void>;
	private loaded = false;

	constructor(private readonly options: DictationOptions) {}

	async start(path: string, model: string, silenceSeconds: number): Promise<void> {
		if (this.active) return;
		this.active = true;
		this.loaded = false;
		const generation = ++this.generation;
		this.options.state("starting");
		try {
			// The engine first says whether it can dictate (a fraction of a second), so an old
			// engine never asks for the microphone. Then the microphone opens at once while the
			// model loads, and what you say meanwhile is kept and recognized once it's ready.
			let supported!: () => void;
			const canDictate = new Promise<void>((done) => (supported = done));
			const loading = this.options.backend.startDictation(path, model, supported);
			this.loading = loading;
			loading.catch(() => undefined);
			await Promise.race([canDictate, loading]);
			if (generation !== this.generation) return;
			const microphone = await this.options.capture(
				(samples, rate) => this.receive(samples, rate),
				() => this.fail("Microphone disconnected. Dictation stopped."),
			);
			if (generation !== this.generation) {
				microphone.stop();
				return;
			}
			this.microphone = microphone;
			// Permission has been granted. Capture is muted until the chime finishes.
			await this.options.chime(true);
			if (generation !== this.generation) return;
			this.options.ready?.();
			this.recording = true;
			this.microphone.start?.();
			this.lastSpeech = this.options.now();
			this.options.state("recording");
			void loading.then(
				() => {
					if (generation !== this.generation) return;
					this.loaded = true;
					// The silence countdown starts once words can be recognized.
					this.lastSpeech = this.options.now();
					this.pump();
				},
				(error: Error) => {
					if (generation === this.generation) this.fail(error.message);
				},
			);
			// Every quarter second: auto-stop after silence, and say when the text is done.
			let shown: number | null = null;
			const check = () => {
				if (!this.recording) return;
				const quiet = this.options.now() - this.lastSpeech;
				if (this.loaded && silenceSeconds > 0 && quiet >= silenceSeconds * 1000) {
					void this.finish();
					return;
				}
				// Done: words recognized, unchanged for a moment, and recognition keeping up. It
				// ends only when the words change, so the countdown runs on without flickering
				// while the microphone keeps sending silence.
				// The last answer must also cover audio sent after the speaker went quiet: on a slow
				// computer the recognizer can still be working through the end of what was said.
				const done =
					this.loaded &&
					this.transcript !== "" &&
					quiet >= DONE_AFTER_MS &&
					this.queued < this.rate &&
					this.answeredAt > this.heardAt;
				const next = !done
					? null
					: silenceSeconds > 0
						? Math.max(1, Math.ceil(silenceSeconds - quiet / 1000))
						: 0;
				if (next !== shown) {
					shown = next;
					this.options.done?.(next);
				}
				this.timer = this.options.setTimer(check, 250);
			};
			this.timer = this.options.setTimer(check, 250);
		} catch (error) {
			if (generation === this.generation) this.fail((error as Error).message);
		}
	}

	private receive(samples: Float32Array, rate: number): void {
		if (!this.recording) return;
		this.options.level?.(microphoneLevel(samples));
		// Someone still talking is not silence, even while recognition is too busy to
		// change the transcript; otherwise a slow computer would stop them mid-sentence.
		if (this.loaded && rms(samples) >= VOICE_RMS) this.lastSpeech = this.heardAt = this.options.now();
		if (this.queued + samples.length > rate * 20) {
			this.fail("Dictation could not keep up with the microphone. Try a smaller model.");
			return;
		}
		this.rate = rate;
		this.queue.push(samples);
		this.queued += samples.length;
		if (this.queued >= rate / 10) this.pump();
	}

	private pump(): void {
		if (this.pending || !this.queued || !this.active || !this.loaded) return;
		const audio = new Float32Array(Math.min(this.queued, this.rate * 2));
		let offset = 0;
		while (offset < audio.length) {
			const chunk = this.queue[0];
			const count = Math.min(chunk.length, audio.length - offset);
			audio.set(chunk.subarray(0, count), offset);
			offset += count;
			if (count === chunk.length) this.queue.shift();
			else this.queue[0] = chunk.subarray(count);
		}
		this.queued -= audio.length;
		const generation = this.generation;
		const sentAt = this.options.now();
		const pending = this.options.backend
			.dictationAudio(audio, this.rate)
			.then((text) => {
				if (generation !== this.generation) return;
				this.answeredAt = Math.max(this.answeredAt, sentAt);
				if (text !== this.transcript) this.lastSpeech = this.options.now();
				this.transcript = text;
				this.options.apply(text);
			})
			.catch((error: Error) => {
				if (generation === this.generation) this.fail(error.message);
			})
			.finally(() => {
				if (this.pending === pending) this.pending = undefined;
				if (generation === this.generation) this.pump();
			});
		this.pending = pending;
	}

	/** A native permission prompt can blur the window while capture is starting. */
	blur(): void {
		if (this.recording) void this.finish();
	}

	async finish(): Promise<void> {
		if (!this.active || this.stopping) return;
		if (!this.recording) {
			this.cancel();
			this.options.cancelled?.();
			return;
		}
		this.stopping = true;
		const generation = this.generation;
		this.releaseMicrophone();
		this.options.state("stopping");
		void this.options.chime(false);
		try {
			// Stopped while the model was still loading: what was said is recognized once it's ready.
			if (!this.loaded) {
				await this.loading;
				if (generation !== this.generation) return;
				this.loaded = true;
			}
			while (this.pending || this.queued) {
				this.pump();
				await this.pending;
				if (generation !== this.generation) return;
			}
			const text = await this.options.backend.stopDictation();
			if (generation !== this.generation) return;
			this.options.apply(text);
			this.options.finished?.();
			this.cancel();
		} catch (error) {
			if (generation === this.generation) this.fail((error as Error).message);
		}
	}

	cancel(): void {
		++this.generation;
		this.releaseMicrophone();
		this.active = false;
		this.stopping = false;
		this.queue = [];
		this.queued = 0;
		this.pending = undefined;
		this.loading = undefined;
		this.loaded = false;
		this.transcript = "";
		this.heardAt = this.answeredAt = -Infinity;
		this.options.backend.stop();
		this.options.state("idle");
	}

	/** True while the microphone is open and recording (not starting or finishing). */
	get recordingNow(): boolean {
		return this.recording;
	}

	private releaseMicrophone(): void {
		this.recording = false;
		this.options.level?.(0);
		this.options.done?.(null);
		this.microphone?.stop();
		this.microphone = undefined;
		if (this.timer !== undefined) this.options.clearTimer(this.timer);
		this.timer = undefined;
	}

	private fail(message: string): void {
		if (!this.active) return;
		this.cancel();
		this.options.error(message);
	}
}
