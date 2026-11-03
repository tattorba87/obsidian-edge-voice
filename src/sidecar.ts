import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { homedir } from "os";
import { dirname } from "path";
import { clearTimeout, setTimeout } from "timers";
import { childEnvironment } from "./environment";
import { isEngineId } from "./settings";
import { parseCatalog, VoiceInfo } from "./voices";

export interface SidecarLimits {
	/** The engine must say it's ready within this (ms), or it's taken to be stuck. */
	startMs: number;
	/** Any request (loading a voice, a synthesis, a voice list) must be answered within this (ms), counted from when it's sent. */
	answerMs: number;
	/** No reply line may be longer (characters): beyond a long sentence's audio, short of exhausting memory. */
	maxLine: number;
}

const LIMITS: SidecarLimits = { startMs: 120_000, answerMs: 120_000, maxLine: 64 * 1024 * 1024 };

export interface Synthesis {
	samples: Float32Array<ArrayBuffer>;
	sampleRate: number;
}

interface Pending {
	resolve: (reply: Record<string, unknown>) => void;
	reject: (error: Error) => void;
}

/** The voice isn't on this computer; the person gets it with `edge-voice-engine voices get <voice>`. */
export class MissingVoiceError extends Error {
	constructor(
		message: string,
		readonly voice: string,
	) {
		super(message);
	}
}

/** Rejects a request that was cancelled before the sidecar started on it. */
export class CancelledError extends Error {
	constructor() {
		super("Cancelled");
	}
}

/**
 * Runs the speech engine (`python -I -u -m edge_voice_engine`, or a script
 * given for tests) and speaks its JSON-lines protocol. The engine never
 * downloads anything; it reads voices the person fetched themselves. The server works on one request at a time, so requests wait here
 * and go out one by one; one still waiting can be cancelled, which is what
 * lets a speed change skip audio prepared at the old speed.
 */
export class Sidecar {
	onExit?: (message: string) => void;

	private proc?: ChildProcessWithoutNullStreams;
	private ready?: Promise<void>;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private waiting: { id: number; body: Record<string, unknown>; deadline?: number }[] = [];
	private answerTimer?: ReturnType<typeof setTimeout>;
	private inFlight?: number;
	private stdoutBuffer = "";
	private stderrTail: string[] = [];

	constructor(
		private readonly python: string,
		private readonly script?: string,
		private readonly limits: SidecarLimits = LIMITS,
	) {}

	get running(): boolean {
		return this.proc !== undefined;
	}

	start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise((resolve, reject) => {
			let started = false;
			// -I: isolated mode, so no PYTHON* variable, user site-packages, or module in the
			// working folder or next to the script can change what runs; the engine comes only
			// from the interpreter's own environment.
			const target = this.script ? [this.script] : ["-m", "edge_voice_engine"];
			const proc = spawn(this.python, ["-I", "-u", ...target], {
				stdio: "pipe",
				cwd: this.script ? dirname(this.script) : homedir(),
				env: childEnvironment(),
			});
			this.proc = proc;

			const startTimer = setTimeout(
				() => fail(`The speech engine didn't start within ${this.limits.startMs / 1000} s.`),
				this.limits.startMs,
			);

			proc.stdout.setEncoding("utf8");
			proc.stdout.on("data", (data: string) => {
				this.stdoutBuffer += data;
				if (this.stdoutBuffer.length > this.limits.maxLine && !this.stdoutBuffer.includes("\n")) {
					fail("The speech engine sent a reply too large to read.");
					return;
				}
				let newline: number;
				while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
					const line = this.stdoutBuffer.slice(0, newline).trim();
					this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
					if (!line) continue;
					let message: Record<string, unknown>;
					try {
						message = JSON.parse(line) as Record<string, unknown>;
					} catch {
						console.warn("[edge-voice] unparsable sidecar line", line);
						continue;
					}
					if (message.event === "ready") {
						started = true;
						clearTimeout(startTimer);
						resolve();
					} else {
						this.handle(message);
					}
				}
			});

			proc.stderr.setEncoding("utf8");
			proc.stderr.on("data", (data: string) => {
				for (const line of data.split("\n")) {
					if (!line.trim()) continue;
					console.debug("[edge-voice]", line);
					this.stderrTail.push(line);
					if (this.stderrTail.length > 20) this.stderrTail.shift();
				}
			});

			const fail = (message: string) => {
				if (this.proc !== proc) return;
				clearTimeout(startTimer);
				this.abandon(message);
				if (!started) reject(new Error(message));
				this.onExit?.(message);
			};
			proc.on("error", (error) => fail(`Could not start ${this.python}: ${error.message}`));
			proc.on("exit", (code, signal) => {
				if (this.proc !== proc) return;
				const tail = this.stderrTail.slice(-3).join("\n");
				fail(`TTS sidecar exited (${signal ?? code})${tail ? `:\n${tail}` : ""}`);
			});
		});
		return this.ready;
	}

	stop(): void {
		this.abandon("Sidecar stopped");
	}

	/** Ends the engine and fails everything waiting on it with `message`; the next request starts it again. */
	private abandon(message: string): void {
		const proc = this.proc;
		this.proc = undefined;
		this.ready = undefined;
		this.waiting = [];
		this.inFlight = undefined;
		this.stdoutBuffer = "";
		clearTimeout(this.answerTimer);
		const error = new Error(message);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		proc?.kill();
	}

	/**
	 * Loads a voice from disk (MissingVoiceError if it isn't there). With
	 * `engine: "mlx"` the sidecar tries the faster engine and falls back to
	 * Moonshine; the result says which loaded, and why not MLX.
	 */
	async load(language: string, voice: string, engine?: "mlx"): Promise<{ engine: string; fallback?: string }> {
		if (!isEngineId(language) || !isEngineId(voice)) throw new Error(`Not a voice: ${language}/${voice}`);
		const reply = await this.ask(
			engine ? { op: "load", language, voice, engine } : { op: "load", language, voice },
			undefined,
			this.limits.answerMs,
		);
		return {
			engine: typeof reply.engine === "string" ? reply.engine : "moonshine",
			fallback: typeof reply.fallback === "string" ? reply.fallback : undefined,
		};
	}

	/**
	 * The voices on this computer and the ones to get, for this language; and the
	 * catalog of every voice with readable names and sizes (empty from an engine
	 * without one).
	 */
	async voices(language: string): Promise<{ present: string[]; downloadable: string[]; catalog: VoiceInfo[] }> {
		const reply = await this.ask({ op: "voices", language }, undefined, this.limits.answerMs);
		const ids = (value: unknown) => (Array.isArray(value) ? value.filter(isEngineId) : []);
		return {
			present: ids(reply.present),
			downloadable: ids(reply.downloadable),
			catalog: parseCatalog(reply.catalog),
		};
	}

	async synthesize(text: string, speed: number, signal?: AbortSignal): Promise<Synthesis> {
		const reply = await this.ask({ op: "synth", text, speed }, signal, this.limits.answerMs);
		const rate = reply.sampleRate;
		if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 1000 || rate > 384000) {
			throw new Error("The engine's audio has an impossible sample rate");
		}
		if (typeof reply.audio !== "string") throw new Error("The engine sent no audio");
		const bytes = Buffer.from(reply.audio, "base64");
		if (bytes.byteLength % 4 !== 0) throw new Error("The engine's audio isn't whole samples");
		// Copy into a fresh buffer: Buffer slices can sit at unaligned offsets.
		const samples = new Float32Array(bytes.byteLength / 4);
		new Uint8Array(samples.buffer).set(bytes);
		return { samples, sampleRate: rate };
	}

	/** Sends `body` once the engine is free. `deadline` (ms) counts from sending; past it, the engine is restarted. */
	private async ask(
		body: Record<string, unknown>,
		signal?: AbortSignal,
		deadline?: number,
	): Promise<Record<string, unknown>> {
		await this.start();
		if (!this.proc) throw new Error("TTS sidecar is not running");
		if (signal?.aborted) throw new CancelledError();
		const id = this.nextId++;
		const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		const entry = { id, body, deadline };
		this.waiting.push(entry);
		signal?.addEventListener(
			"abort",
			() => {
				const at = this.waiting.indexOf(entry);
				if (at < 0) return; // Already sent; its reply is simply ignored.
				this.waiting.splice(at, 1);
				this.pending.get(id)?.reject(new CancelledError());
				this.pending.delete(id);
			},
			{ once: true },
		);
		this.pump();
		return reply;
	}

	private pump(): void {
		if (this.inFlight !== undefined || !this.proc) return;
		const next = this.waiting.shift();
		if (!next) return;
		this.inFlight = next.id;
		this.proc.stdin.write(JSON.stringify({ id: next.id, ...next.body }) + "\n");
		if (next.deadline) {
			const { id, deadline } = next;
			this.answerTimer = setTimeout(() => {
				if (this.inFlight === id) this.abandon(`The speech engine didn't answer within ${deadline / 1000} s.`);
			}, deadline);
		}
	}

	private handle(message: Record<string, unknown>): void {
		const id = message.id;
		if (typeof id !== "number") return;
		if (id === this.inFlight) {
			clearTimeout(this.answerTimer);
			this.inFlight = undefined;
			this.pump();
		}
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (typeof message.error !== "string") pending.resolve(message);
		else if (isEngineId(message.missing)) pending.reject(new MissingVoiceError(message.error, message.missing));
		else pending.reject(new Error(message.error));
	}
}
