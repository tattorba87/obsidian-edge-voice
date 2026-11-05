import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleUnload, UNLOAD_CHOICES } from "../src/idle";

describe("IdleUnload", () => {
	let minutes = 10;
	let allowed = true;
	let busy = false;
	let unloads = 0;
	const idle = () =>
		new IdleUnload({
			minutes: () => minutes,
			idle: () => allowed,
			busy: () => busy,
			unload: () => unloads++,
			setTimer: (run, ms) => setTimeout(run, ms) as unknown as number,
			clearTimer: (id) => clearTimeout(id),
		});

	beforeEach(() => {
		vi.useFakeTimers();
		minutes = 10;
		allowed = true;
		busy = false;
		unloads = 0;
	});
	afterEach(() => vi.useRealTimers());

	it("unloads after the chosen minutes stopped or paused", () => {
		const unload = idle();
		unload.reset();
		vi.advanceTimersByTime(10 * 60_000 - 1);
		expect(unloads).toBe(0);
		vi.advanceTimersByTime(1);
		expect(unloads).toBe(1);
		expect(unload.pending).toBe(false);
	});

	it("never unloads when set to never (the default)", () => {
		minutes = 0;
		idle().reset();
		vi.advanceTimersByTime(24 * 60 * 60_000);
		expect(unloads).toBe(0);
	});

	it("doesn't start the countdown while reading, and cancels it when reading starts", () => {
		allowed = false;
		const unload = idle();
		unload.reset();
		expect(unload.pending).toBe(false);
		allowed = true;
		unload.reset();
		vi.advanceTimersByTime(5 * 60_000);
		allowed = false;
		unload.reset();
		vi.advanceTimersByTime(60 * 60_000);
		expect(unloads).toBe(0);
	});

	it("starts the countdown afresh on each change, so a pause after a play waits the full time", () => {
		const unload = idle();
		unload.reset();
		vi.advanceTimersByTime(9 * 60_000);
		unload.reset();
		vi.advanceTimersByTime(9 * 60_000);
		expect(unloads).toBe(0);
		vi.advanceTimersByTime(60_000);
		expect(unloads).toBe(1);
	});

	it("counts down even if the engine is still preparing audio when reading pauses", () => {
		// Pausing leaves the sentences ahead being prepared for a moment.
		busy = true;
		const unload = idle();
		unload.reset();
		expect(unload.pending).toBe(true);
		busy = false;
		vi.advanceTimersByTime(10 * 60_000);
		expect(unloads).toBe(1);
	});

	it("never cuts off audio being prepared: looks again shortly", () => {
		idle().reset();
		busy = true;
		vi.advanceTimersByTime(10 * 60_000);
		expect(unloads).toBe(0);
		busy = false;
		vi.advanceTimersByTime(15_000);
		expect(unloads).toBe(1);
	});

	it("does nothing when time is up if reading has started again", () => {
		idle().reset();
		allowed = false;
		vi.advanceTimersByTime(60 * 60_000);
		expect(unloads).toBe(0);
	});

	it("offers never and a few lengths", () => {
		expect(Object.keys(UNLOAD_CHOICES)).toEqual(["0", "5", "10", "30", "60"]);
	});
});
