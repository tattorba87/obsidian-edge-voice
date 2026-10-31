import { describe, expect, it } from "vitest";
import {
	sentenceSpans,
	wordPauses,
	wordRangeText,
	wordSpans,
	wordStart,
	wordTokens,
	wordWeights,
} from "../src/sentences";

const texts = (text: string) => sentenceSpans(text).map((span) => text.slice(span.start, span.end));

describe("sentenceSpans", () => {
	it("splits sentences and trims them", () => {
		expect(texts("  First one here.  Second one, too.  ")).toEqual(["First one here.", "Second one, too."]);
	});

	it("folds a very short sentence into the next", () => {
		expect(texts("Fig. 2. The results are clear.")).toEqual(["Fig. 2. The results are clear."]);
	});

	it("never merges across a line break", () => {
		expect(texts("Intro\nThe body text follows.")).toEqual(["Intro", "The body text follows."]);
	});

	it("splits a long sentence at a clause, keeping every character", () => {
		const long = "word ".repeat(40).trim() + ", " + "more ".repeat(40).trim() + ".";
		const spans = sentenceSpans(long);
		expect(spans.length).toBeGreaterThan(1);
		for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(320);
		expect(spans.map((span) => long.slice(span.start, span.end)).join(" ")).toBe(long);
	});
});

describe("words", () => {
	it("keeps technical tokens whole", () => {
		expect(wordTokens("Qwen3-ASR-1.7B at 5.90% and 2–7 GB, $40").map((token) => token.text)).toEqual([
			"Qwen3-ASR-1.7B",
			"at",
			"5.90%",
			"and",
			"2–7",
			"GB",
			"$40",
		]);
	});

	it("finds word ranges within a span", () => {
		const text = "Skip this. Read these words.";
		const words = wordSpans(text, 11, text.length);
		expect(words.map((word) => text.slice(word.start, word.end))).toEqual(["Read", "these", "words"]);
	});

	it("gives punctuation pauses", () => {
		const text = "One, two. Three";
		expect(wordPauses(text, wordSpans(text, 0, text.length))).toEqual([1, 2, 0.15]);
	});

	it("weighs long spoken words more", () => {
		const text = "the GPU";
		const [the, gpu] = wordWeights(text, wordSpans(text, 0, text.length));
		expect(gpu).toBeGreaterThan(the);
	});

	it("moves an offset back to the start of its word", () => {
		expect(wordStart("hello world", 8)).toBe(6);
		expect(wordStart("hello world", 6)).toBe(6);
	});

	it("gives the text of a run of words with its punctuation", () => {
		const text = "Since then, it rained.";
		const span = { start: 0, end: text.length };
		const words = wordSpans(text, 0, text.length);
		expect(wordRangeText(text, span, words, 0, 2)).toBe("Since then, ");
		expect(wordRangeText(text, span, words, 2, 4)).toBe("it rained.");
	});
});
