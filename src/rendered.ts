import { wordTokens } from "./sentences";

const SENTENCE_HIGHLIGHT = "edge-voice-sentence";
const WORD_HIGHLIGHT = "edge-voice-word";

// Rendered text that has no counterpart in what is read aloud: KaTeX's hidden
// MathML copy, callout chrome, footnote marks, buttons.
const NOT_READ = [
	".katex-mathml",
	".callout-icon",
	".callout-fold",
	".collapse-indicator",
	".copy-code-button",
	".markdown-embed-link",
	".frontmatter-container",
	".metadata-container",
	".footnote-ref",
	".footnote-backref",
	".cm-widgetBuffer",
	"code",
	"pre",
].join(", ");

export interface TextIndex {
	nodes: Text[];
	/** Offset in `text` where each node begins. */
	starts: number[];
	/** Node texts joined by single spaces. */
	text: string;
}

/**
 * Highlights a sentence in rendered Markdown (Reading view, or a callout or
 * other block that Live Preview shows rendered) by matching its words against
 * the words on screen. Uses the CSS Custom Highlight API, so the page itself
 * is never modified.
 */
export class RenderedHighlight {
	private cache?: { roots: HTMLElement[]; length: number; matches: (Range | null)[] };

	constructor(private readonly words: string[]) {}

	static clear(): void {
		CSS.highlights.delete(SENTENCE_HIGHLIGHT);
		CSS.highlights.delete(WORD_HIGHLIGHT);
	}

	/**
	 * Shows the sentence, and word `word` if it is 0 or more, within `roots`.
	 * Returns the sentence's range, or null if its words were not found there.
	 */
	show(roots: HTMLElement[], word: number): Range | null {
		const matches = this.match(roots);
		const found = matches.filter((range): range is Range => range !== null);
		if (found.length === 0) {
			RenderedHighlight.clear();
			return null;
		}
		const sentence = document.createRange();
		sentence.setStart(found[0].startContainer, found[0].startOffset);
		const last = found[found.length - 1];
		sentence.setEnd(last.endContainer, last.endOffset);
		CSS.highlights.set(SENTENCE_HIGHLIGHT, new Highlight(sentence));
		const wordRange = word >= 0 ? matches[word] : null;
		if (wordRange) CSS.highlights.set(WORD_HIGHLIGHT, new Highlight(wordRange));
		else CSS.highlights.delete(WORD_HIGHLIGHT);
		return sentence;
	}

	/** One range per word of the sentence, or null for words not on screen. */
	private match(roots: HTMLElement[]): (Range | null)[] {
		const index = indexText(roots);
		const cache = this.cache;
		const sameRoots =
			cache && cache.roots.length === roots.length && cache.roots.every((root, i) => root === roots[i]);
		if (
			cache &&
			sameRoots &&
			cache.length === index.text.length &&
			cache.matches.every((r) => !r || r.startContainer.isConnected)
		) {
			return cache.matches;
		}
		const tokens = wordTokens(index.text);
		const matches = alignWords(
			this.words,
			tokens.map((token) => token.text),
		).map((at) => (at < 0 ? null : rangeAt(index, tokens[at].start, tokens[at].end)));
		this.cache = { roots, length: index.text.length, matches };
		return matches;
	}
}

export function indexText(roots: HTMLElement[]): TextIndex {
	const nodes: Text[] = [];
	const starts: number[] = [];
	let text = "";
	for (const root of roots) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) =>
				node.parentElement?.closest(NOT_READ) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
		});
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (text) text += " ";
			starts.push(text.length);
			nodes.push(node as Text);
			text += node.textContent ?? "";
		}
	}
	return { nodes, starts, text };
}

/**
 * Where a DOM position (as from a caret or selection) falls in `index.text`,
 * or -1 if it isn't in or before any indexed text.
 */
export function indexOffset(index: TextIndex, node: Node, offset: number): number {
	if (node.nodeType === Node.TEXT_NODE) {
		const at = index.nodes.indexOf(node as Text);
		return at < 0 ? -1 : index.starts[at] + Math.min(offset, (node as Text).length);
	}
	// An element position points between its children: take the first indexed
	// text at or after that child.
	const child = node.childNodes[offset] ?? null;
	for (let i = 0; i < index.nodes.length; i++) {
		const text = index.nodes[i];
		const after = child
			? child === text ||
				child.contains(text) ||
				(child.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
			: (node.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
		if (after) return index.starts[i];
	}
	return -1;
}

function rangeAt(index: TextIndex, start: number, end: number): Range | null {
	const at = (offset: number): [Text, number] | null => {
		for (let i = index.nodes.length - 1; i >= 0; i--) {
			if (index.starts[i] <= offset) {
				const node = index.nodes[i];
				return [node, Math.min(offset - index.starts[i], node.length)];
			}
		}
		return null;
	};
	const from = at(start);
	const to = at(end);
	if (!from || !to) return null;
	const range = document.createRange();
	range.setStart(from[0], from[1]);
	range.setEnd(to[0], to[1]);
	return range;
}

const comparable = (word: string) => word.toLowerCase().replace(/['’]/g, "");

/**
 * Maps each source word to a rendered word, in order, or -1. Starts where the
 * opening words match best, then walks forward allowing words on either side
 * to be missing (math renders differently, links lose their targets).
 */
export function alignWords(source: string[], rendered: string[]): number[] {
	const want = source.map(comparable);
	const have = rendered.map(comparable);
	const probe = Math.min(8, want.length);

	// Among starts matching as many opening words, the one skipping the fewest
	// rendered words: in "…on your own computer. Your notes never…", the
	// sentence "Your notes never…" starts at the second "your", not the first.
	let bestStart = -1;
	let bestScore = 0;
	let bestSkipped = Infinity;
	for (let k = 0; k < have.length; k++) {
		if (have[k] !== want[0] && have[k] !== want[1]) continue;
		let score = 0;
		let skipped = 0;
		let r = k;
		for (let i = 0; i < probe && r < have.length; i++) {
			const found = have.indexOf(want[i], r);
			if (found >= 0 && found - r < 6) {
				score++;
				skipped += found - r;
				r = found + 1;
			}
		}
		if (score > bestScore || (score === bestScore && skipped < bestSkipped)) {
			bestScore = score;
			bestSkipped = skipped;
			bestStart = k;
		}
	}
	if (bestStart < 0 || bestScore < Math.min(2, probe)) return source.map(() => -1);

	const out: number[] = [];
	let r = bestStart;
	for (const word of want) {
		let found = -1;
		for (let j = r; j < Math.min(have.length, r + 12); j++) {
			if (have[j] === word) {
				found = j;
				break;
			}
		}
		out.push(found);
		if (found >= 0) r = found + 1;
	}
	return out;
}
