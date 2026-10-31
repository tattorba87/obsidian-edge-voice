import { describe, expect, it } from "vitest";
import { DEFAULT_HIGHLIGHT_THEME, HIGHLIGHT_THEMES, highlightTheme } from "../src/colors";
import { DoubleTapDetector, keyLabel } from "../src/double-tap";
import { quickStartPieces } from "../src/reader";
import { alignWords } from "../src/rendered";
import { wordTokens } from "../src/sentences";

describe("alignWords", () => {
	// The callout from Steven's notes: rendered math and a glued footnote label
	// appear only on screen.
	const rendered = wordTokens(
		"Problem. Take 10 seconds of audio and the medium-sized model from the paper, Conformer (M), " +
			"which has d=256 and N=16 blocks.gulati-tab1 How many frames does the encoder work on?",
	).map((token) => token.text);

	it("matches source words in order, skipping rendered-only words", () => {
		const source = wordTokens("How many frames does the encoder work on?").map((token) => token.text);
		const at = alignWords(source, rendered);
		expect(at.every((index) => index >= 0)).toBe(true);
		expect(at).toEqual([...at].sort((a, b) => a - b));
		expect(source.map((_, i) => rendered[at[i]])).toEqual(source);
	});

	it("marks words that aren't on screen with -1", () => {
		const source = wordTokens("which has and blocks").map((token) => token.text);
		expect(alignWords(source, rendered).filter((index) => index < 0)).toHaveLength(1);
	});

	it("gives up when the opening doesn't match", () => {
		expect(alignWords(["nothing", "like", "this"], rendered)).toEqual([-1, -1, -1]);
	});
});

describe("quickStartPieces", () => {
	const segment = (count: number, pauses: Record<number, number> = {}) => ({
		weights: Array.from({ length: count }, () => 3),
		pauses: Array.from({ length: count }, (_, i) => pauses[i] ?? 0.15),
	});

	it("leaves short sentences whole", () => {
		expect(quickStartPieces(segment(11))).toBeNull();
	});

	it("covers every word, in order, with a short opening", () => {
		const pieces = quickStartPieces(segment(60))!;
		expect(pieces[0].from).toBe(0);
		expect(pieces[pieces.length - 1].to).toBe(60);
		for (let i = 1; i < pieces.length; i++) expect(pieces[i].from).toBe(pieces[i - 1].to);
		expect(pieces[0].to).toBeGreaterThanOrEqual(4);
		expect(pieces[0].to).toBeLessThanOrEqual(13);
	});

	it("ends the opening at a clause break near the target", () => {
		expect(quickStartPieces(segment(30, { 11: 1 }))![0].to).toBe(12);
	});

	it("grows each piece at most about twice the one before", () => {
		const pieces = quickStartPieces(segment(120))!;
		for (let i = 1; i < pieces.length - 1; i++) {
			const before = pieces[i - 1].to - pieces[i - 1].from;
			expect(pieces[i].to - pieces[i].from).toBeLessThanOrEqual(Math.ceil(before * 2 * 1.6));
		}
	});
});

describe("DoubleTapDetector", () => {
	const make = () => {
		let fired = 0;
		const detector = new DoubleTapDetector(
			() => "MetaRight",
			() => fired++,
		);
		const event = (code: string, timeStamp: number, repeat = false) =>
			({ code, timeStamp, repeat }) as KeyboardEvent;
		const tap = (code: string, down: number, up: number) => {
			detector.keydown(event(code, down));
			detector.keyup(event(code, up));
		};
		return { detector, event, tap, fired: () => fired };
	};

	it("fires on a double tap", () => {
		const d = make();
		d.tap("MetaRight", 0, 80);
		d.tap("MetaRight", 200, 280);
		expect(d.fired()).toBe(1);
	});

	it.each([
		[
			"taps too far apart",
			[
				[0, 80],
				[700, 780],
			],
		],
		[
			"a press held too long",
			[
				[0, 600],
				[700, 780],
			],
		],
	])("ignores %s", (_name, taps) => {
		const d = make();
		for (const [down, up] of taps) d.tap("MetaRight", down, up);
		expect(d.fired()).toBe(0);
	});

	it("ignores a shortcut such as Cmd+C", () => {
		const d = make();
		d.tap("MetaRight", 0, 80);
		d.detector.keydown(d.event("MetaRight", 150));
		d.detector.keydown(d.event("KeyC", 170));
		d.detector.keyup(d.event("MetaRight", 230));
		expect(d.fired()).toBe(0);
	});

	it("ignores another key between the taps", () => {
		const d = make();
		d.tap("MetaRight", 0, 80);
		d.tap("KeyA", 120, 150);
		d.tap("MetaRight", 200, 280);
		expect(d.fired()).toBe(0);
	});

	it("fires once for a triple tap and ignores auto-repeat", () => {
		const d = make();
		d.tap("MetaRight", 0, 60);
		d.tap("MetaRight", 120, 180);
		d.tap("MetaRight", 240, 300);
		expect(d.fired()).toBe(1);
		const e = make();
		e.detector.keydown(e.event("MetaRight", 0));
		e.detector.keydown(e.event("MetaRight", 50, true));
		e.detector.keyup(e.event("MetaRight", 90));
		e.tap("MetaRight", 200, 260);
		expect(e.fired()).toBe(1);
	});

	it("names keys readably", () => {
		expect(keyLabel("ShiftRight")).toBe("Right Shift");
		expect(keyLabel("KeyK")).toBe("K");
		expect(keyLabel("F13")).toBe("F13");
	});
});

describe("highlight themes", () => {
	it("has unique ids, valid colours and the default", () => {
		const ids = HIGHLIGHT_THEMES.map((theme) => theme.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain(DEFAULT_HIGHLIGHT_THEME);
		for (const theme of HIGHLIGHT_THEMES) {
			for (const channels of [theme.sentence, theme.word]) {
				const values = channels.split(",").map(Number);
				expect(values).toHaveLength(3);
				for (const value of values) expect(value >= 0 && value <= 255).toBe(true);
			}
		}
	});

	it("falls back to the first theme for an unknown id", () => {
		expect(highlightTheme("nope")).toBe(HIGHLIGHT_THEMES[0]);
	});
});
