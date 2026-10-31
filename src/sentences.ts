import { spokenSyllables } from "./normalize";

/** A sentence as a half-open character range of the text it came from. */
export interface Span {
	start: number;
	end: number;
}

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// Below this, a "sentence" is usually a heading number or an abbreviation the
// segmenter split on, and sounds better folded into its neighbour.
const MIN_SENTENCE_CHARS = 12;
// Above this, the first audio takes noticeably long, so split at a clause.
const MAX_SENTENCE_CHARS = 320;

/** Splits `text` into speakable sentence ranges, skipping blank stretches. */
export function sentenceSpans(text: string): Span[] {
	const raw: Span[] = [];
	for (const { index, segment } of segmenter.segment(text)) {
		const start = index + (segment.length - segment.trimStart().length);
		const end = index + segment.trimEnd().length;
		if (end > start) raw.push({ start, end });
	}

	const merged: Span[] = [];
	for (const span of raw) {
		const previous = merged[merged.length - 1];
		// Never across a line break: by now one only remains where Markdown
		// starts something new (a heading, a list item).
		const sameBlock = previous && !text.slice(previous.start, span.start).includes("\n");
		if (previous && sameBlock && previous.end - previous.start < MIN_SENTENCE_CHARS) {
			previous.end = span.end;
		} else {
			merged.push({ ...span });
		}
	}

	return merged.flatMap((span) => splitLong(text, span));
}

function splitLong(text: string, span: Span): Span[] {
	const out: Span[] = [];
	let start = span.start;
	while (span.end - start > MAX_SENTENCE_CHARS) {
		const window = text.slice(start, start + MAX_SENTENCE_CHARS);
		// The space to split at: after a clause mark if there is one, else any.
		const clause = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "));
		const space = clause >= MAX_SENTENCE_CHARS / 3 ? clause + 1 : window.lastIndexOf(" ");
		if (space < MAX_SENTENCE_CHARS / 3) break;
		out.push({ start, end: start + space });
		start += space + 1;
	}
	out.push({ start, end: span.end });
	return out;
}

// A word as highlighted: "Qwen3-ASR-1.7B", "5.90%", "2–7" and "$40" are one each.
const WORD = /[$€£]?[\p{L}\p{N}]+(?:['’.\-–_/][\p{L}\p{N}]+)*%?/gu;

/** Every word in `text`, with its range. */
export function wordTokens(text: string): (Span & { text: string })[] {
	return [...text.matchAll(WORD)].map((match) => ({
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
		text: match[0],
	}));
}

/** The words of `text` between `start` and `end`, as ranges of `text`. */
export function wordSpans(text: string, start: number, end: number): Span[] {
	const words: Span[] = [];
	for (const match of text.slice(start, end).matchAll(WORD)) {
		const from = start + (match.index ?? 0);
		words.push({ start: from, end: from + match[0].length });
	}
	return words;
}

/**
 * How long each word takes relative to the others: its syllables once spoken
 * ("GPU" is three, "5.90%" six), plus the pause the punctuation after it buys.
 */
export function wordWeights(text: string, words: Span[]): number[] {
	const pauses = wordPauses(text, words);
	return words.map((word, i) => spokenSyllables(text.slice(word.start, word.end)) + pauses[i]);
}

/** The pause after each word: 2 at a sentence or clause stop, 1 at a comma or dash. */
export function wordPauses(text: string, words: Span[]): number[] {
	return words.map((word, i) => {
		const gap = text.slice(word.end, words[i + 1]?.start ?? word.end + 2);
		return /[.!?;:]/.test(gap) ? 2 : /[,—–()]/.test(gap) ? 1 : 0.15;
	});
}

/**
 * The text of words `[from, to)` of a sentence spanning `span`: from the
 * sentence start (or word `from`) up to the next word after the range (or the
 * sentence end), so punctuation between them stays with the earlier part.
 */
export function wordRangeText(text: string, span: Span, words: Span[], from: number, to: number): string {
	const start = from === 0 ? span.start : words[from].start;
	const end = to >= words.length ? span.end : words[to].start;
	return text.slice(start, end);
}

/** Moves `offset` back to the start of the word it falls in. */
export function wordStart(text: string, offset: number): number {
	while (offset > 0 && /[\p{L}\p{N}'’]/u.test(text[offset - 1])) offset--;
	return offset;
}
