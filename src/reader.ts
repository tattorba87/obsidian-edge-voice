import { Sidecar, Synthesis } from "./sidecar";

/** One stretch of text that is spoken and highlighted as a unit. */
export interface Segment {
	/** What the synthesizer is given. */
	text: string;
	/** Short label for the status bar, e.g. "p. 4". */
	label: string;
	/** Relative duration of each spoken word, for timing the word highlight. */
	weights: number[];
	/** The pause after each word (see wordPauses), for finding clause breaks. */
	pauses: number[];
	/** What the synthesizer is given for words `[from, to)` alone. */
	spokenText(from: number, to: number): string;
	highlight(): void | Promise<void>;
	/** Marks word `index` (into `weights`) as the one being spoken. */
	highlightWord(index: number): void;
	unhighlight(): void;
}

/** Produces segments in reading order, lazily, so a long PDF starts at once. */
export interface SegmentSource {
	next(): Promise<Segment | null>;
	dispose(): void;
}

export type ReaderState = "idle" | "loading" | "playing" | "paused";

export interface ReaderOptions {
	speed: () => number;
	volume: () => number;
	prefetch: () => number;
	onState: (state: ReaderState, detail?: string) => void;
	onError: (error: Error) => void;
}

/**
 * Plays a source sentence by sentence. Synthesis runs a few segments ahead of
 * playback so the next one is usually ready before the current one ends.
 */
export class Reader {
	private source?: SegmentSource;
	private segments: Segment[] = [];
	private sourceDone = false;
	private index = 0;
	/** Audio asked for, by segment; `ready` once it has arrived. */
	private audio = new Map<number, { synthesis: Promise<Synthesis>; cancel: AbortController; ready: boolean }>();
	private generation = 0;
	private context?: AudioContext;
	private gain?: GainNode;
	private node?: AudioBufferSourceNode;
	private finishNode?: () => void;
	private startedAt = 0;
	private frame?: number;
	private pieceCancel?: AbortController;
	private current?: Segment;
	private _state: ReaderState = "idle";

	constructor(
		private readonly sidecar: Sidecar,
		private readonly options: ReaderOptions,
	) {}

	get state(): ReaderState {
		return this._state;
	}

	/** Starts reading `source` from its first segment, replacing anything playing. */
	start(source: SegmentSource): void {
		this.stop();
		this.source = source;
		this.segments = [];
		this.sourceDone = false;
		this.index = 0;
		void this.run(++this.generation);
	}

	pause(): void {
		if (this._state !== "playing" && this._state !== "loading") return;
		void this.context?.suspend();
		this.setState("paused");
	}

	resume(): void {
		if (this._state !== "paused") return;
		void this.context?.resume();
		this.setState("playing");
	}

	stop(): void {
		this.generation++;
		this.halt();
		this.source?.dispose();
		this.source = undefined;
		this.segments = [];
		this.dropAudio(() => true);
		if (this.context?.state === "suspended") void this.context.resume();
		this.setState("idle");
	}

	/** Moves `delta` segments from the one playing; negative goes back. */
	skip(delta: number): void {
		if (!this.source) return;
		this.index = Math.max(0, this.index + delta);
		this.halt();
		void this.run(++this.generation);
	}

	/** Draws the current sentence's highlight again, e.g. after its page switched between Reading view and editing. */
	refreshHighlight(): void {
		void this.current?.highlight();
	}

	/** Applies a new volume (0 to 1) at once, mid-sentence included. */
	setVolume(volume: number): void {
		if (this.gain && this.context) this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
	}

	/**
	 * Drops audio prepared ahead at the old speed, so a new speed is heard from
	 * the next segment on, and starts preparing it again straight away.
	 */
	invalidateAudio(): void {
		this.dropAudio((index) => index > this.index);
		if (this.source) this.prefetch();
	}

	private dropAudio(which: (index: number) => boolean): void {
		for (const [index, entry] of [...this.audio]) {
			if (!which(index)) continue;
			entry.cancel.abort();
			this.audio.delete(index);
		}
	}

	private prefetch(): void {
		for (let ahead = 1; ahead <= this.options.prefetch(); ahead++) {
			void this.synthesisAt(this.index + ahead).catch(() => undefined);
		}
	}

	private async run(generation: number): Promise<void> {
		const live = () => generation === this.generation;
		try {
			while (live()) {
				const segment = await this.segmentAt(this.index);
				if (!live()) return;
				if (!segment) {
					this.stop();
					return;
				}
				// Waiting only when the audio isn't here yet: audio prepared ahead plays straight on,
				// so the glow and "Synthesizing" don't flash between sentences.
				if (this._state !== "paused" && !this.audio.get(this.index)?.ready)
					this.setState("loading", segment.label);
				// Highlighted before its audio is ready, so a skip shows at once where it landed.
				this.current = segment;
				await segment.highlight();
				if (!live()) {
					// A newer run may have highlighted this same segment; leave that one be.
					if (this.current !== segment) segment.unhighlight();
					return;
				}
				// Nothing prepared means someone is waiting on this sentence:
				// speak its opening clause first rather than the whole thing.
				const pieces = this.audio.has(this.index) ? null : quickStartPieces(segment);
				const syntheses = pieces ? this.synthesizePieces(segment, pieces) : [this.synthesisAt(this.index)];
				this.prefetch();
				const ranges = pieces ?? [{ from: 0, to: segment.weights.length }];
				for (let piece = 0; piece < ranges.length; piece++) {
					const synthesis = await syntheses[piece];
					if (!live()) return;
					if (piece === 0 && this._state !== "paused") this.setState("playing", segment.label);
					const finished = this.play(synthesis);
					this.trackWords(segment, synthesis, generation, ranges[piece]);
					await finished;
					if (!live()) return;
				}
				segment.unhighlight();
				this.current = undefined;
				this.dropAudio((index) => index <= this.index);
				this.index++;
			}
		} catch (error) {
			if (!live()) return;
			this.options.onError(error as Error);
			this.stop();
		}
	}

	private async segmentAt(index: number): Promise<Segment | null> {
		while (this.segments.length <= index && !this.sourceDone && this.source) {
			const segment = await this.source.next();
			if (segment) this.segments.push(segment);
			else this.sourceDone = true;
		}
		return this.segments[index] ?? null;
	}

	private synthesisAt(index: number): Promise<Synthesis> {
		let entry = this.audio.get(index);
		if (!entry) {
			const cancel = new AbortController();
			const synthesis = this.segmentAt(index).then((segment) => {
				if (!segment) throw new Error("past the end");
				return this.sidecar.synthesize(segment.text, this.options.speed(), cancel.signal);
			});
			const added = { synthesis, cancel, ready: false };
			// Prefetches nobody awaits may be cancelled; keep that quiet.
			synthesis.then(
				() => (added.ready = true),
				() => undefined,
			);
			entry = added;
			this.audio.set(index, entry);
		}
		return entry.synthesis;
	}

	/** Queues each piece of `segment` with the synthesizer, in order. */
	private synthesizePieces(segment: Segment, pieces: WordRange[]): Promise<Synthesis>[] {
		const cancel = new AbortController();
		this.pieceCancel = cancel;
		return pieces.map((piece) => {
			const synthesis = this.sidecar.synthesize(
				segment.spokenText(piece.from, piece.to),
				this.options.speed(),
				cancel.signal,
			);
			synthesis.catch(() => undefined);
			return synthesis;
		});
	}

	private play(synthesis: Synthesis): Promise<void> {
		if (!this.context) {
			this.context = new AudioContext();
			this.gain = this.context.createGain();
			this.gain.gain.value = this.options.volume();
			this.gain.connect(this.context.destination);
		}
		const context = this.context;
		if (synthesis.samples.length === 0) return Promise.resolve();
		const buffer = context.createBuffer(1, synthesis.samples.length, synthesis.sampleRate);
		buffer.copyToChannel(synthesis.samples, 0);
		const node = context.createBufferSource();
		node.buffer = buffer;
		node.connect(this.gain ?? context.destination);
		this.node = node;
		this.startedAt = context.currentTime;
		return new Promise((resolve) => {
			this.finishNode = resolve;
			node.onended = () => {
				if (this.node === node) this.node = undefined;
				resolve();
			};
			node.start(this.startedAt);
		});
	}

	/**
	 * Moves the word highlight along with playback. The audio clock stops while
	 * the context is suspended, so pausing holds the highlight too.
	 */
	private trackWords(segment: Segment, synthesis: Synthesis, generation: number, words: WordRange): void {
		const times = wordStartTimes(synthesis, segment.weights.slice(words.from, words.to));
		if (times.length === 0 || !this.context) return;
		const context = this.context;
		let shown = -1;
		const tick = () => {
			if (generation !== this.generation || this.current !== segment) return;
			const elapsed = context.currentTime - this.startedAt;
			let index = Math.max(shown, 0);
			while (index + 1 < times.length && times[index + 1] <= elapsed) index++;
			if (elapsed >= times[0] && index !== shown) {
				shown = index;
				segment.highlightWord(words.from + index);
			}
			this.frame = window.requestAnimationFrame(tick);
		};
		this.frame = window.requestAnimationFrame(tick);
	}

	/** Cuts the current sound and highlight without touching the source. */
	private halt(): void {
		if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
		this.frame = undefined;
		this.pieceCancel?.abort();
		this.pieceCancel = undefined;
		const node = this.node;
		this.node = undefined;
		if (node) {
			node.onended = null;
			try {
				node.stop();
			} catch {
				// Already stopped.
			}
		}
		this.finishNode?.();
		this.finishNode = undefined;
		this.current?.unhighlight();
		this.current = undefined;
	}

	private setState(state: ReaderState, detail?: string): void {
		this._state = state;
		this.options.onState(state, detail);
	}
}

// Quieter than this counts as the silence a voice leaves around a sentence.
const SILENCE = 0.02;

/**
 * When each word starts, in seconds from the start of the audio: the words
 * share the voiced stretch in proportion to their weights.
 */
function wordStartTimes(synthesis: Synthesis, weights: number[]): number[] {
	const { samples, sampleRate } = synthesis;
	let first = 0;
	while (first < samples.length && Math.abs(samples[first]) < SILENCE) first++;
	let last = samples.length - 1;
	while (last > first && Math.abs(samples[last]) < SILENCE) last--;
	if (last <= first || weights.length === 0) return [];
	const voiced = (last - first) / sampleRate;
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const times: number[] = [];
	let elapsed = 0;
	for (const weight of weights) {
		times.push(first / sampleRate + (elapsed / total) * voiced);
		elapsed += weight;
	}
	return times;
}

/** Words `[from, to)` of a segment. */
interface WordRange {
	from: number;
	to: number;
}

// A sentence shorter than this is quick enough to synthesize whole.
const QUICK_START_MIN_WORDS = 12;
// Each piece may be this much longer than the one before. Synthesis runs at
// roughly 0.4x real time, so a piece about twice as long as the one playing
// is ready before it finishes.
const PIECE_GROWTH = 2;

/**
 * Splits a segment for a fast start: an opening of about 4 to 13 words, ended
 * at a clause break when there is one, then pieces that grow so each is ready
 * before the one before it has finished playing. Returns null when the
 * segment is short enough to start whole.
 */
export function quickStartPieces(segment: Pick<Segment, "weights" | "pauses">): WordRange[] | null {
	const count = segment.weights.length;
	if (count < QUICK_START_MIN_WORDS) return null;
	const pieces: WordRange[] = [];
	let from = 0;
	let target = 8;
	while (from < count) {
		// Close enough to the end: take the rest rather than leave a scrap.
		if (count - from <= target * 1.5) {
			pieces.push({ from, to: count });
			break;
		}
		// End at the clause break nearest the target length, if one is in reach.
		const ideal = from + target;
		const earliest = from + Math.max(4, Math.floor(target / 2));
		const latest = Math.min(from + Math.ceil(target * 1.6), count - 3);
		let to = Math.min(ideal, count);
		let bestDistance = Infinity;
		for (let end = earliest; end <= latest; end++) {
			if (segment.pauses[end - 1] >= 1 && Math.abs(end - ideal) < bestDistance) {
				bestDistance = Math.abs(end - ideal);
				to = end;
			}
		}
		pieces.push({ from, to });
		target = Math.round((to - from) * PIECE_GROWTH);
		from = to;
	}
	return pieces;
}
