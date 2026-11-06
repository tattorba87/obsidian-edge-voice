export type DictationState = "starting" | "recording" | "stopping" | "idle";

/** RMS mapped to a readable microphone glow; does not retain or inspect speech content. */
export function microphoneLevel(samples: Float32Array): number {
	if (!samples.length) return 0;
	let energy = 0;
	for (const value of samples) energy += value * value;
	return Math.min(1, Math.sqrt(energy / samples.length) * 8);
}

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
}

export interface DictationBackend {
	startDictation(path: string, model: string): Promise<void>;
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
	cancelled?: () => void;
	state: (state: DictationState) => void;
	level?: (level: number) => void;
	error: (message: string) => void;
	chime: (recording: boolean) => Promise<void> | void;
	setTimer: (run: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
	now: () => number;
}

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
	private lastSpeech = 0;
	private transcript = "";
	private stopping = false;

	constructor(private readonly options: DictationOptions) {}

	async start(path: string, model: string, silenceSeconds: number): Promise<void> {
		if (this.active) return;
		this.active = true;
		const generation = ++this.generation;
		this.options.state("starting");
		try {
			await this.options.backend.startDictation(path, model);
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
			if (silenceSeconds > 0) {
				const check = () => {
					if (!this.recording) return;
					if (this.options.now() - this.lastSpeech >= silenceSeconds * 1000) void this.finish();
					else this.timer = this.options.setTimer(check, 250);
				};
				this.timer = this.options.setTimer(check, 250);
			}
		} catch (error) {
			if (generation === this.generation) this.fail((error as Error).message);
		}
	}

	private receive(samples: Float32Array, rate: number): void {
		if (!this.recording) return;
		this.options.level?.(microphoneLevel(samples));
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
		if (this.pending || !this.queued || !this.active) return;
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
		const pending = this.options.backend
			.dictationAudio(audio, this.rate)
			.then((text) => {
				if (generation !== this.generation) return;
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
			while (this.pending || this.queued) {
				this.pump();
				await this.pending;
				if (generation !== this.generation) return;
			}
			const text = await this.options.backend.stopDictation();
			if (generation !== this.generation) return;
			this.options.apply(text);
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
		this.transcript = "";
		this.options.backend.stop();
		this.options.state("idle");
	}

	private releaseMicrophone(): void {
		this.recording = false;
		this.options.level?.(0);
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
