import { Range as CmRange, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { Editor, MarkdownView } from "obsidian";
import { normalizeForSpeech } from "./normalize";
import { Segment, SegmentSource } from "./reader";
import { alignWords, indexOffset, indexText, RenderedHighlight } from "./rendered";
import {
	Span,
	sentenceSpans,
	wordPauses,
	wordRangeText,
	wordSpans,
	wordStart,
	wordTokens,
	wordWeights,
} from "./sentences";

interface EditorHighlight {
	sentence: Span;
	word?: Span;
}

const setHighlight = StateEffect.define<EditorHighlight | null>();
const sentenceMark = Decoration.mark({ class: "edge-voice-sentence" });
const wordMark = Decoration.mark({ class: "edge-voice-word" });

/** Editor extension that draws the sentence and word being spoken. */
export const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		value = value.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setHighlight)) continue;
			const highlight = effect.value;
			if (!highlight) {
				value = Decoration.none;
				continue;
			}
			const marks: CmRange<Decoration>[] = [sentenceMark.range(highlight.sentence.start, highlight.sentence.end)];
			if (highlight.word) marks.push(wordMark.range(highlight.word.start, highlight.word.end));
			value = Decoration.set(marks, true);
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Reads a note from a position (by default the cursor or selection start) to the end. */
export class MarkdownSource implements SegmentSource {
	private queue: Segment[];
	private readonly raw: string;

	constructor(
		private readonly view: MarkdownView,
		private readonly autoScroll: () => boolean,
		from = view.editor.posToOffset(view.editor.getCursor("from")),
	) {
		this.raw = view.editor.getValue();
		const masked = maskUnspoken(this.raw);
		const start = wordStart(masked, from);
		this.queue = [];
		for (const sentence of sentenceSpans(joinWrappedLines(this.raw, masked))) {
			if (sentence.end <= start) continue;
			const span = { start: Math.max(sentence.start, start), end: sentence.end };
			const words = wordSpans(masked, span.start, span.end);
			if (words.length === 0) continue;
			const text = normalizeForSpeech(masked.slice(span.start, span.end));
			this.queue.push(this.segment(masked, span, words, text));
		}
	}

	/** The editor offset of the word at `editor`'s cursor or selection start. */
	static cursorOffset(editor: Editor): number {
		return editor.posToOffset(editor.getCursor("from"));
	}

	/**
	 * Where reading starts: the selected text, or else the top of what is in
	 * view (the first visible line in the editor, the first visible section in
	 * Reading view).
	 */
	static startOffset(view: MarkdownView): number {
		const editor = view.editor;
		if (view.getMode() === "preview") {
			const selection = window.getSelection();
			const range =
				selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
			if (range && view.containerEl.contains(range.startContainer)) {
				return MarkdownSource.offsetInReadingView(view, range.startContainer, range.startOffset);
			}
			const top = view.previewMode.containerEl.getBoundingClientRect().top;
			const section = readingSections(view)?.find(
				(candidate) => candidate.el.isConnected && candidate.el.getBoundingClientRect().bottom > top + 4,
			);
			return section ? editor.posToOffset({ line: section.lineStart, ch: 0 }) : 0;
		}
		if (editor.somethingSelected()) return MarkdownSource.cursorOffset(editor);
		const cm = (editor as unknown as { cm?: EditorView }).cm;
		if (!cm) return MarkdownSource.cursorOffset(editor);
		const frame = cm.scrollDOM.getBoundingClientRect();
		const content = cm.contentDOM.getBoundingClientRect();
		const pos = cm.posAtCoords({ x: content.left + 4, y: Math.max(frame.top, content.top) + 4 }, false);
		return cm.state.doc.lineAt(pos).from;
	}

	/**
	 * The source offset of a position in Reading view (from a right-click),
	 * found by matching the rendered section's words against its source
	 * words. Falls back to the section start, or the cursor if the position is
	 * outside every section.
	 */
	static offsetInReadingView(view: MarkdownView, node: Node | null, offset: number): number {
		const editor = view.editor;
		const section = node ? readingSections(view)?.find((candidate) => candidate.el.contains(node)) : undefined;
		if (!node || !section) return MarkdownSource.cursorOffset(editor);

		const lastLine = Math.min(section.lineEnd, editor.lastLine());
		const from = editor.posToOffset({ line: section.lineStart, ch: 0 });
		const to = editor.posToOffset({ line: lastLine, ch: editor.getLine(lastLine).length });
		const masked = maskUnspoken(editor.getValue());
		const words = wordSpans(masked, from, to);
		if (words.length === 0) return from;

		const index = indexText([section.el]);
		const at = indexOffset(index, node, offset);
		const tokens = wordTokens(index.text);
		// The word clicked on, or the next one if the click fell between words.
		const clicked = at < 0 ? -1 : tokens.findIndex((token) => token.end > at);
		if (clicked < 0) return words[0].start;
		const matched = alignWords(
			words.map((word) => masked.slice(word.start, word.end)),
			tokens.map((token) => token.text),
		);
		const first = matched.findIndex((rendered) => rendered >= clicked);
		return first >= 0 ? words[first].start : words[0].start;
	}

	async next(): Promise<Segment | null> {
		return this.queue.shift() ?? null;
	}

	dispose(): void {
		this.queue = [];
		this.dispatch(null, false);
		RenderedHighlight.clear();
	}

	private segment(masked: string, sentence: Span, words: Span[], text: string): Segment {
		const wordTexts = words.map((word) => masked.slice(word.start, word.end));
		const line = this.view.editor.offsetToPos(sentence.start).line;
		const rendered = new RenderedHighlight(wordTexts);
		const show = async (word: number, scroll: boolean) => {
			// Rendered text first: Reading view, or a block Live Preview shows
			// rendered. Otherwise the sentence is editor text.
			const roots = await this.renderedRoots(sentence, line, scroll);
			const range = roots && rendered.show(roots, word);
			if (range) {
				this.dispatch(null, false);
				if (scroll) scrollToRange(range);
				return;
			}
			if (this.view.getMode() === "preview") {
				// Reading view shows no editor text, so a highlight there would be
				// invisible; until the sentence renders, keep what's shown, minus the last sentence.
				if (word < 0) RenderedHighlight.clear();
				return;
			}
			RenderedHighlight.clear();
			this.dispatch(word >= 0 ? { sentence, word: words[word] } : { sentence }, scroll);
		};
		return {
			text,
			label: `line ${line + 1}`,
			weights: wordWeights(masked, words),
			pauses: wordPauses(masked, words),
			spokenText: (from, to) => normalizeForSpeech(wordRangeText(masked, sentence, words, from, to)),
			highlight: () => show(-1, this.autoScroll()),
			highlightWord: (index) => void show(index, false),
			unhighlight: () => {
				this.dispatch(null, false);
				RenderedHighlight.clear();
			},
		};
	}

	/**
	 * The rendered elements that show `sentence`, or null when it is plain
	 * editor text (Source mode, or ordinary lines in Live Preview).
	 */
	private async renderedRoots(sentence: Span, line: number, scroll: boolean): Promise<HTMLElement[] | null> {
		if (this.view.getMode() === "preview") return this.readingRoots(line, scroll);

		const cm = (this.view.editor as unknown as { cm?: EditorView }).cm;
		if (!cm) return null;
		const blocks = Array.from(cm.contentDOM.querySelectorAll<HTMLElement>(".cm-embed-block, .math-block")).filter(
			(el) => !el.parentElement?.closest(".cm-embed-block, .math-block"),
		);
		for (const el of blocks) {
			let from: number;
			try {
				from = cm.posAtDOM(el);
			} catch {
				continue;
			}
			if (sentence.start >= from && sentence.start <= blockEnd(this.raw, from)) return [el];
		}
		return null;
	}

	/** Reading view: the rendered sections covering `line`, scrolled into existence if needed. */
	private async readingRoots(line: number, scroll: boolean): Promise<HTMLElement[] | null> {
		const preview = this.view.previewMode;
		const sections = readingSections(this.view);
		if (!sections) return [preview.containerEl];
		const hit = sections.filter((section) => section.lineStart <= line && line <= section.lineEnd);
		// No section covers the line: waiting for one to render can't help.
		if (hit.length === 0) return null;
		const find = () =>
			hit.every((section) => section.el.isConnected && section.el.textContent)
				? hit.map((section) => section.el)
				: undefined;
		let roots = find();
		if (!roots && scroll) {
			preview.applyScroll(line);
			roots = await waitFor(find, 2000);
		}
		return roots ?? null;
	}

	private dispatch(highlight: EditorHighlight | null, scroll: boolean): void {
		// Obsidian exposes the CodeMirror 6 view as `editor.cm`, untyped.
		const cm = (this.view.editor as unknown as { cm?: EditorView }).cm;
		if (!cm) return;
		const length = cm.state.doc.length;
		const clamp = (span?: Span) => span && { start: Math.min(span.start, length), end: Math.min(span.end, length) };
		const clamped = highlight && { sentence: clamp(highlight.sentence)!, word: clamp(highlight.word) };
		const effects: StateEffect<unknown>[] = [setHighlight.of(clamped)];
		if (clamped && scroll) {
			effects.push(EditorView.scrollIntoView(clamped.sentence.start, { y: "center" }));
		}
		cm.dispatch({ effects });
	}
}

/**
 * Blanks out everything that should not be read aloud (frontmatter, code,
 * comments, embeds, link targets, formatting marks) with spaces. Offsets stay
 * aligned with the editor text, so the words left are exactly where the
 * highlight goes.
 */
function maskUnspoken(text: string): string {
	const blank = (match: string) => match.replace(/[^\n]/g, " ");
	// Keeps `length` characters of a match starting at `at`, blanking the rest.
	const keep = (match: string, at: number, length: number) =>
		blank(match.slice(0, at)) + match.slice(at, at + length) + blank(match.slice(at + length));
	// Inline patterns scan at most 300 characters for their closing mark (1000 for a link's URL): unbounded, a long line
	// with many unclosed openers ("[[", "<", "[") took quadratic time, seconds for 80k characters.
	return (
		text
			// Whole regions.
			.replace(/^---\n[\s\S]*?\n---(?=\n|$)/, blank)
			.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, blank)
			.replace(/\$\$[\s\S]*?\$\$/g, blank)
			.replace(/%%[\s\S]*?%%/g, blank)
			.replace(/<!--[\s\S]*?-->/g, blank)
			.replace(/^\|.*\|$/gm, blank)
			// Embeds, inline code and math, footnote refs, block ids, tags, HTML.
			.replace(/!\[\[[^\]\n]{0,300}\]\]|!\[[^\]\n]{0,300}\]\([^)\n]{0,1000}\)/g, blank)
			.replace(/`[^`\n]{0,300}`|\$[^$\n]{1,300}\$/g, blank)
			.replace(/\[\^[^\]\n]{0,300}\]|\s\^[\w-]+$/gm, blank)
			.replace(/<\/?[a-zA-Z][^>\n]{0,300}>/g, blank)
			.replace(/(?<=^|\s)#[\p{L}\p{N}_/-]+/gu, blank)
			// Links keep only the words a reader sees.
			.replace(/\[\[(?:[^\]|\n]{0,300}\|)?([^\]\n]{0,300})\]\]/g, (match, shown: string) =>
				keep(match, match.length - 2 - shown.length, shown.length),
			)
			.replace(/\[([^\]\n]{0,300})\]\([^)\n]{0,1000}\)/g, (match, shown: string) => keep(match, 1, shown.length))
			.replace(/https?:\/\/[^\s)>\]]+/g, blank)
			// Line prefixes: headings, quotes, list bullets, task boxes, callout headers.
			.replace(/^[ \t]*(?:>[ \t]*)*(?:\[![\w-]+\][+-]?)?/gm, blank)
			.replace(/^([ \t]*)(#{1,6}|[-*+]|\d+[.)])([ \t]+\[[ xX]\])?(?=[ \t])/gm, blank)
			// Emphasis and highlight marks.
			.replace(/\*\*|__|~~|==/g, blank)
			.replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s.,;:!?)]|$)/gm, (match) => match.replace(/[*_]/, " "))
	);
}

interface ReadingSection {
	el: HTMLElement;
	lineStart: number;
	lineEnd: number;
}

/** A section as Obsidian's renderer keeps it: `start`/`end` positions now, `lineStart`/`lineEnd` in older versions. */
interface RawReadingSection {
	el: HTMLElement;
	start?: { line: number };
	end?: { line: number };
	lineStart?: number;
	lineEnd?: number;
}

/** Reading view's rendered sections. Obsidian's renderer is not public API. */
function readingSections(view: MarkdownView): ReadingSection[] | undefined {
	const sections = (view.previewMode as unknown as { renderer?: { sections?: RawReadingSection[] } }).renderer
		?.sections;
	return sections && sectionLines(sections);
}

/** The source lines each rendered section covers, whichever way this Obsidian version records them. */
export function sectionLines(sections: RawReadingSection[]): ReadingSection[] {
	const lines: ReadingSection[] = [];
	for (const section of sections) {
		// Obsidian's own header and footer (inline title, properties, backlinks) claim lines too,
		// line 0 for the header, which would mix their text into the note's first sentence.
		if (section.el.classList?.contains("mod-ui")) continue;
		const lineStart = section.start?.line ?? section.lineStart;
		const lineEnd = section.end?.line ?? section.lineEnd;
		if (typeof lineStart === "number" && typeof lineEnd === "number") {
			lines.push({ el: section.el, lineStart, lineEnd });
		}
	}
	return lines;
}

/**
 * Where the block starting at `from` ends in the source: a callout or quote
 * runs while lines start with ">", math and code to their closing fence, a
 * table while lines start with "|", anything else to the end of its line.
 */
function blockEnd(raw: string, from: number): number {
	const lineStart = raw.lastIndexOf("\n", from - 1) + 1;
	const lines = raw.slice(lineStart).split("\n");
	const first = lines[0].trimStart();
	let count = 1;
	const fence = first.startsWith("$$")
		? "$$"
		: first.startsWith("```")
			? "```"
			: first.startsWith("~~~")
				? "~~~"
				: null;
	if (fence) {
		while (count < lines.length && !lines[count].trimStart().startsWith(fence)) count++;
		count++;
	} else if (first.startsWith(">") || first.startsWith("|")) {
		while (count < lines.length && lines[count].trimStart().startsWith(first[0])) count++;
	}
	return lineStart + lines.slice(0, count).join("\n").length;
}

function scrollToRange(range: Range): void {
	const box = range.getBoundingClientRect();
	const element = range.startContainer.parentElement;
	if (!element) return;
	const scroller = element.closest(".markdown-preview-view, .cm-scroller") ?? document.documentElement;
	const frame = scroller.getBoundingClientRect();
	if (box.top < frame.top + 20 || box.bottom > frame.bottom - 20) {
		element.scrollIntoView({ block: "center", behavior: "smooth" });
	}
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== undefined || Date.now() > deadline) return value;
		await new Promise((resolve) => window.setTimeout(resolve, 100));
	}
}

type LineKind = "blank" | "text" | "list" | "block";

/** What a source line is, looking past any quote or callout markers. */
function lineKind(line: string): { kind: LineKind; depth: number } {
	const quote = /^\s*((?:>\s?)*)/.exec(line)?.[1] ?? "";
	const depth = (quote.match(/>/g) ?? []).length;
	const rest = line.slice(quote.length).trim();
	if (!rest) return { kind: "blank", depth };
	if (/^(#{1,6}\s|```|~~~|\$\$|\||\[!|---+$|\*\*\*+$)/.test(rest)) return { kind: "block", depth };
	if (/^([-*+]|\d+[.)])\s/.test(rest)) return { kind: "list", depth };
	return { kind: "text", depth };
}

/**
 * Turns line breaks inside a paragraph into spaces, so hard-wrapped prose is
 * split into sentences rather than lines. A break stays where Markdown starts
 * something new: a blank line, heading, list item, table, fence, or a change
 * of quote depth. Same length as `masked`, so offsets still line up.
 */
function joinWrappedLines(raw: string, masked: string): string {
	const lines = raw.split("\n");
	const out = masked.split("");
	let offset = 0;
	for (let i = 0; i < lines.length - 1; i++) {
		offset += lines[i].length;
		const here = lineKind(lines[i]);
		const next = lineKind(lines[i + 1]);
		if ((here.kind === "text" || here.kind === "list") && next.kind === "text" && here.depth === next.depth) {
			out[offset] = " ";
		}
		offset += 1;
	}
	return out.join("");
}
