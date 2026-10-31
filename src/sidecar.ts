import { ChildProcessWithoutNullStreams, spawn } from "child_process";

export interface Synthesis {
	samples: Float32Array<ArrayBuffer>;
	sampleRate: number;
}

interface Pending {
	resolve: (reply: Record<string, unknown>) => void;
	reject: (error: Error) => void;
}

/** Rejects a request that was cancelled before the sidecar started on it. */
export class CancelledError extends Error {
	constructor() {
		super("Cancelled");
	}
}

/**
 * Runs server.py under the configured Python and speaks its JSON-lines
 * protocol. The server works on one request at a time, so requests wait here
 * and go out one by one; one still waiting can be cancelled, which is what
 * lets a speed change skip audio prepared at the old speed.
 */
export class Sidecar {
	onProgress?: (fraction: number, file: string) => void;
	onExit?: (message: string) => void;
	/** Called when synthesis starts (true) and when nothing is left to synthesize (false). */
	onBusy?: (busy: boolean) => void;

	private proc?: ChildProcessWithoutNullStreams;
	private ready?: Promise<void>;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private waiting: { id: number; body: Record<string, unknown> }[] = [];
	private inFlight?: number;
	/** Synthesis requests sent or waiting, which is what "busy" means. */
	private synthesizing = 0;
	private stdoutBuffer = "";
	private stderrTail: string[] = [];

	constructor(
		private readonly python: string,
		private readonly script: string,
	) {}

	get running(): boolean {
		return this.proc !== undefined;
	}

	start(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise((resolve, reject) => {
			let started = false;
			const proc = spawn(this.python, ["-u", this.script], { stdio: "pipe" });
			this.proc = proc;

			proc.stdout.setEncoding("utf8");
			proc.stdout.on("data", (data: string) => {
				this.stdoutBuffer += data;
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
				this.proc = undefined;
				this.ready = undefined;
				this.waiting = [];
				this.inFlight = undefined;
				const error = new Error(message);
				for (const pending of this.pending.values()) pending.reject(error);
				this.pending.clear();
				if (!started) reject(error);
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
		const proc = this.proc;
		this.proc = undefined;
		this.ready = undefined;
		this.waiting = [];
		this.inFlight = undefined;
		for (const pending of this.pending.values()) pending.reject(new Error("Sidecar stopped"));
		this.pending.clear();
		proc?.kill();
	}

	async load(language: string, voice: string): Promise<void> {
		await this.request({ op: "load", language, voice });
	}

	async voices(language: string): Promise<{ present: string[]; downloadable: string[] }> {
		const reply = await this.request({ op: "voices", language });
		return {
			present: (reply.present as string[]) ?? [],
			downloadable: (reply.downloadable as string[]) ?? [],
		};
	}

	/** Where the engine keeps downloaded voices. */
	async cacheDir(): Promise<string> {
		const reply = await this.request({ op: "paths" });
		return reply.cache as string;
	}

	async synthesize(text: string, speed: number, signal?: AbortSignal): Promise<Synthesis> {
		if (this.synthesizing++ === 0) this.onBusy?.(true);
		let reply: Record<string, unknown>;
		try {
			reply = await this.request({ op: "synth", text, speed }, signal);
		} finally {
			if (--this.synthesizing === 0) this.onBusy?.(false);
		}
		const bytes = Buffer.from(reply.audio as string, "base64");
		// Copy into a fresh buffer: Buffer slices can sit at unaligned offsets.
		const samples = new Float32Array(bytes.byteLength / 4);
		new Uint8Array(samples.buffer).set(bytes);
		return { samples, sampleRate: reply.sampleRate as number };
	}

	private async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
		await this.start();
		if (!this.proc) throw new Error("TTS sidecar is not running");
		if (signal?.aborted) throw new CancelledError();
		const id = this.nextId++;
		const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		const entry = { id, body };
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
	}

	private handle(message: Record<string, unknown>): void {
		if (message.event === "progress") {
			this.onProgress?.(message.fraction as number, message.file as string);
			return;
		}
		const id = message.id as number;
		if (id === this.inFlight) {
			this.inFlight = undefined;
			this.pump();
		}
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (typeof message.error === "string") pending.reject(new Error(message.error));
		else pending.resolve(message);
	}
}
