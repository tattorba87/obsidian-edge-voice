import { describe, expect, it } from "vitest";
import { EngineSetup } from "../src/engine-setup";

/** A promise with its resolve and reject, to finish an install when a test says so. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("EngineSetup", () => {
	it("doesn't install an engine that already works", async () => {
		let installs = 0;
		const setup = new EngineSetup(
			() => Promise.resolve(true),
			() => {
				installs++;
				return Promise.resolve();
			},
		);
		await expect(setup.ensure()).resolves.toBe("ready");
		expect(installs).toBe(0);
	});

	it("shares one install between everyone who asks while it runs", async () => {
		const done = deferred();
		let installs = 0;
		const setup = new EngineSetup(
			() => Promise.resolve(false),
			() => {
				installs++;
				return done.promise;
			},
		);
		const first = setup.ensure();
		const second = setup.ensure();
		await Promise.resolve();
		expect(setup.installing).toBe(true);
		done.resolve();
		await expect(first).resolves.toBe("installed");
		await expect(second).resolves.toBe("installed");
		expect(installs).toBe(1);
		expect(setup.installing).toBe(false);
	});

	it("tries again after a failed install", async () => {
		let attempt = 0;
		const setup = new EngineSetup(
			() => Promise.resolve(false),
			() => (++attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()),
		);
		await expect(setup.ensure()).rejects.toThrow("offline");
		await expect(setup.ensure()).resolves.toBe("installed");
	});

	it("cancels an install under way", async () => {
		const setup = new EngineSetup(
			() => Promise.resolve(false),
			(signal) =>
				new Promise<void>((_, reject) =>
					signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }),
				),
		);
		const running = setup.ensure();
		await new Promise((resolve) => setTimeout(resolve, 0));
		setup.cancel();
		await expect(running).rejects.toThrow("Cancelled");
	});
});
