import { describe, expect, it } from "vitest";
import { normalizeForSpeech, spokenSyllables } from "../src/normalize";

// Each expectation was checked against Moonshine's G2P (en_us) when the rule
// was written: these are the spellings it reads correctly.
describe("normalizeForSpeech", () => {
	it.each([
		["Qwen3-ASR-1.7B at 5.90% WER", "Qwen 3 Ae S R 1.7 B at 5.90 percent W E R"],
		["Parakeet TDT-0.6B-v3", "Parakeet T D T 0.6 B version 3"],
		["It needs 2–7 GB of memory on the GPU.", "It needs 2 to 7 gigabytes of memory on the G P U."],
		["models—Qwen3", "models, Qwen 3"],
		["The LLMs ran on 8 GPUs", "The L L M's ran on 8 G P U's"],
		["at 1.4 GHz", "at 1.4 gigahertz"],
		["from 120 ms to 45ms", "from 120 milliseconds to 45 milliseconds"],
		["a 2.7x speedup", "a 2.7 times speedup"],
		// Plain decimals are read right as written; dotted runs and prices weren't.
		["0.75 of it, and 2.4. Results", "0.75 of it, and 2.4. Results"],
		["Version 1.2.3 and 10.0.1 are out", "Version 1 point 2 point 3 and 10 point 0 point 1 are out"],
		["Server 192.168.0.1 is down", "Server 192 dot 168 dot 0 dot 1 is down"],
		[
			"$4.99 each, $1 or $1.01, £2.50 and €3.00",
			"4 dollars 99 cents each, 1 dollar or 1 dollar 1 cent, 2 pounds 50 pence and 3 euros",
		],
		["in the 1990s and the 80s", "in the nineteen nineties and the eighties"],
		["the 1st and 22nd runs", "the first and twenty second runs"],
		["e.g. this, i.e. that", "for example, this, that is, that"],
		["see Fig. 4 and Eq. 2", "see Figure 4 and Equation 2"],
		["costs $40M", "costs 40 million dollars"],
		["accuracy ≥ 95% ± 2", "accuracy at least 95 percent plus or minus 2"],
		["about ~3% more", "about 3 percent more"],
		["x86_64 hosts", "x 86 64 hosts"],
	])("%s", (written, spoken) => {
		expect(normalizeForSpeech(written)).toBe(spoken);
	});

	it("keeps acronyms said as words", () => {
		expect(normalizeForSpeech("NASA's REST API returns JSON")).toBe("NASA's REST Ae P I returns JSON");
	});

	it("reads a heading in capitals as words", () => {
		expect(normalizeForSpeech("INTRODUCTION AND RELATED WORK")).toBe("introduction and related work");
	});

	it("drops citation markers and the punctuation they leave", () => {
		expect(normalizeForSpeech("on hosts [12], [3, 7–9].")).toBe("on hosts.");
	});

	it("reads links as 'link', even glued to a footnote mark", () => {
		expect(normalizeForSpeech("time 1https://github.com/x/y and see https://x.com/a).")).toBe(
			"time 1 link and see link).",
		);
	});
});

describe("spokenSyllables", () => {
	it("counts what is said, not what is written", () => {
		expect(spokenSyllables("GPU")).toBe(3);
		expect(spokenSyllables("the")).toBe(1);
		expect(spokenSyllables("Qwen3-ASR-1.7B")).toBeGreaterThan(spokenSyllables("model"));
	});
});
