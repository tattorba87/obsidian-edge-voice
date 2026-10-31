import { FileView, loadPdfJs } from "obsidian";
import { normalizeForSpeech } from "./normalize";
import { Segment, SegmentSource } from "./reader";
import { Span, sentenceSpans, wordPauses, wordRangeText, wordSpans, wordStart, wordWeights } from "./sentences";

const LAYER_CLASS = "edge-voice-layer";
const SENTENCE_CLASS = "edge-voice-sentence";
const WORD_CLASS = "edge-voice-word";

/** Where to begin: a page, and optionally a point in its text layer. */
export interface PdfStart {
	page: number;
	node?: Node;
	offset?: number;
}

interface PageText {
	/** Item strings joined, with "\n" where pdf.js marks an end of line. */
	text: string;
	/** Item strings, in the order pdf.js emits text-layer spans for them. */
	items: string[];
	/** Offset in `text` where each item begins. */
	starts: number[];
	/** Items left out of `text`: margin stamps, page numbers, running headers. */
	skipped: boolean[];
}

interface PageContent {
	items: PdfTextItem[];
	/** The page box in PDF units: [x0, y0, x1, y1], y growing upwards. */
	view: number[];
}

// Share of the page height at the top and bottom where headers, footers and
// page numbers live.
const MARGIN_BAND = 0.08;
const PAGE_NUMBER =
	/^\s*(?:page\s+)?(?:\d{1,4}|(?=[ivxlc])x{0,3}(?:ix|iv|v?i{0,3})|[xl]?x{0,3})(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;

/**
 * Reads the PDF open in an Obsidian PDF view, a page at a time. The sentence
 * and the word being spoken are drawn as boxes over the page.
 */
export class PdfSource implements SegmentSource {
	private doc?: PdfDocument;
	private page: number;
	private queue: Segment[] = [];
	private contents = new Map<number, Promise<PageContent>>();
	private disposed = false;

	constructor(
		private readonly view: FileView,
		private readonly start: PdfStart,
		private readonly autoScroll: () => boolean,
		private readonly skipFootnotes: () => boolean = () => true,
	) {
		this.page = start.page;
	}

	/** Start at a text position, e.g. under the pointer, or else the page in view. */
	static startAt(view: FileView, node?: Node | null, offset = 0): PdfStart {
		const element = node instanceof Element ? node : node?.parentElement;
		const page = element?.closest<HTMLElement>(".page[data-page-number]");
		if (node && page && view.containerEl.contains(page) && element?.closest(".textLayer")) {
			return { page: Number(page.dataset.pageNumber), node, offset };
		}
		return { page: visiblePage(view.containerEl) };
	}

	/** Start at the selection if there is one in this view, or else the page in view. */
	/** Start at the selection if there is one in this view, or else the first line in view. */
	static startFor(view: FileView): PdfStart {
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (view.containerEl.contains(range.startContainer)) {
				return PdfSource.startAt(view, range.startContainer, range.startOffset);
			}
		}
		const root = view.containerEl;
		const page = visiblePage(root);
		const top = (root.querySelector<HTMLElement>(".pdf-viewer-container") ?? root).getBoundingClientRect().top;
		const spans = root.querySelectorAll<HTMLElement>(`.page[data-page-number="${page}"] .textLayer span`);
		const first = Array.from(spans).find((span) => {
			const box = span.getBoundingClientRect();
			return box.height > 0 && box.bottom > top + 4 && span.textContent?.trim();
		});
		return first ? PdfSource.startAt(view, first.firstChild ?? first, 0) : { page };
	}

	async next(): Promise<Segment | null> {
		while (this.queue.length === 0) {
			if (this.disposed) return null;
			const doc = await this.document();
			if (this.page > doc.numPages) return null;
			this.queue = await this.segmentsFor(doc, this.page);
			this.page++;
		}
		return this.queue.shift() ?? null;
	}

	dispose(): void {
		this.disposed = true;
		this.queue = [];
		this.view.containerEl.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) => layer.remove());
		void this.doc?.destroy();
		this.doc = undefined;
	}

	private async document(): Promise<PdfDocument> {
		if (!this.doc) {
			const file = this.view.file;
			if (!file) throw new Error("This PDF view has no file");
			// Obsidian types pdf.js as any; only getDocument is used.
			const pdfjs = (await loadPdfJs()) as {
				getDocument(source: { data: Uint8Array }): { promise: Promise<PdfDocument> };
			};
			const data = new Uint8Array(await this.view.app.vault.readBinary(file));
			this.doc = await pdfjs.getDocument({ data }).promise;
		}
		return this.doc;
	}

	private async segmentsFor(doc: PdfDocument, pageNumber: number): Promise<Segment[]> {
		const content = await this.content(doc, pageNumber);
		// Running headers and footers repeat on the pages either side.
		const neighbours = await Promise.all(
			[pageNumber - 1, pageNumber + 1]
				.filter((n) => n >= 1 && n <= doc.numPages)
				.map(async (n) => new Set(marginLines(await this.content(doc, n)).map((line) => line.key))),
		);
		const pageText = buildPageText(content.items, skippedItems(content, neighbours, this.skipFootnotes()));
		for (const n of this.contents.keys()) {
			if (n < pageNumber - 1) this.contents.delete(n);
		}

		// Segment on a copy with line breaks as spaces: a newline would end
		// every sentence at the end of its line.
		let spans = sentenceSpans(pageText.text.replace(/\n/g, " "));

		if (pageNumber === this.start.page && this.start.node) {
			const offset = this.textOffset(pageNumber, pageText, this.start.node, this.start.offset ?? 0);
			if (offset >= 0) {
				const from = wordStart(pageText.text, offset);
				spans = spans
					.filter((span) => span.end > from)
					.map((span) => ({ start: Math.max(span.start, from), end: span.end }));
			}
		}

		const segments: Segment[] = [];
		for (const span of spans) {
			const text = normalizeForSpeech(speakable(pageText.text.slice(span.start, span.end)));
			const words = wordSpans(pageText.text, span.start, span.end);
			if (words.length === 0) continue;
			segments.push(this.segment(pageNumber, pageText, span, words, text));
		}
		return segments;
	}

	private content(doc: PdfDocument, pageNumber: number): Promise<PageContent> {
		let content = this.contents.get(pageNumber);
		if (!content) {
			content = doc.getPage(pageNumber).then(async (page) => {
				const { items } = await page.getTextContent();
				page.cleanup();
				return { items, view: page.view };
			});
			this.contents.set(pageNumber, content);
		}
		return content;
	}

	private segment(pageNumber: number, pageText: PageText, span: Span, words: Span[], text: string): Segment {
		let spans: (HTMLElement | undefined)[] = [];
		let word = -1;
		const draw = () => {
			const pageEl = this.pageEl(pageNumber);
			if (!pageEl) return;
			if (!spans.some((el) => el?.isConnected)) {
				spans = alignSpans(pageText.items, this.layerSpans(pageNumber));
			}
			const layer = overlayLayer(pageEl);
			layer.empty();
			drawBoxes(layer, pageEl, rangeRects(pageText, spans, span.start, span.end), SENTENCE_CLASS);
			if (word >= 0) {
				const { start, end } = words[word];
				drawBoxes(layer, pageEl, rangeRects(pageText, spans, start, end), WORD_CLASS);
			}
		};
		return {
			text,
			label: `p. ${pageNumber}`,
			weights: wordWeights(pageText.text, words),
			pauses: wordPauses(pageText.text, words),
			spokenText: (from, to) =>
				normalizeForSpeech(speakable(wordRangeText(pageText.text, span, words, from, to))),
			highlight: async () => {
				word = -1;
				spans = await this.spansFor(pageNumber, pageText);
				draw();
				if (this.autoScroll()) {
					const target =
						this.view.containerEl.querySelector<HTMLElement>(`.${SENTENCE_CLASS}`) ??
						this.pageEl(pageNumber);
					if (target && !inView(target, this.scroller())) {
						target.scrollIntoView({ block: "center", behavior: "smooth" });
					}
				}
			},
			highlightWord: (index) => {
				word = index;
				draw();
			},
			unhighlight: () => {
				word = -1;
				this.pageEl(pageNumber)?.querySelector(`:scope > .${LAYER_CLASS}`)?.remove();
			},
		};
	}

	/** Text-layer spans indexed like `pageText.items`, rendering the page if needed. */
	private async spansFor(pageNumber: number, pageText: PageText): Promise<(HTMLElement | undefined)[]> {
		let spans = this.layerSpans(pageNumber);
		if (spans.length === 0) {
			const pageEl = this.pageEl(pageNumber);
			if (!pageEl) return [];
			// pdf.js only renders text layers near the viewport.
			if (this.autoScroll()) pageEl.scrollIntoView({ block: "start" });
			spans =
				(await waitFor(() => {
					const found = this.layerSpans(pageNumber);
					return found.length > 0 ? found : undefined;
				}, 4000)) ?? [];
		}
		return alignSpans(pageText.items, spans);
	}

	/** Offset in `pageText.text` of a DOM position inside the page's text layer, or -1. */
	private textOffset(pageNumber: number, pageText: PageText, node: Node, offset: number): number {
		const aligned = alignSpans(pageText.items, this.layerSpans(pageNumber));
		for (let i = 0; i < aligned.length; i++) {
			const span = aligned[i];
			if (!span?.contains(node)) continue;
			let inner = 0;
			if (node.nodeType === Node.TEXT_NODE) {
				const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
				for (let text = walker.nextNode(); text && text !== node; text = walker.nextNode()) {
					inner += text.textContent?.length ?? 0;
				}
				inner += offset;
			}
			if (pageText.skipped[i]) return pageText.starts[i];
			return pageText.starts[i] + Math.min(inner, pageText.items[i].length);
		}
		return -1;
	}

	private pageEl(pageNumber: number): HTMLElement | null {
		return this.view.containerEl.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
	}

	private layerSpans(pageNumber: number): HTMLElement[] {
		const layer = this.pageEl(pageNumber)?.querySelector(".textLayer");
		if (!layer) return [];
		// Leaf spans are pdf.js's one-per-item text nodes; wrappers for marked
		// content and highlight spans inside a node are skipped.
		return Array.from(layer.querySelectorAll<HTMLElement>("span")).filter(
			(el) =>
				!el.classList.contains("markedContent") &&
				el.parentElement?.closest(".textLayer span:not(.markedContent)") === null,
		);
	}

	private scroller(): HTMLElement {
		return this.view.containerEl.querySelector<HTMLElement>(".pdf-viewer-container") ?? this.view.containerEl;
	}
}

interface PdfTextItem {
	str?: string;
	hasEOL?: boolean;
	/** [a, b, c, d, x, y]: rotation/scale, then the baseline origin. */
	transform?: number[];
}

interface PdfDocument {
	numPages: number;
	getPage(n: number): Promise<{
		view: number[];
		getTextContent(): Promise<{ items: PdfTextItem[] }>;
		cleanup(): void;
	}>;
	destroy(): Promise<void>;
}

/**
 * Builds the page's readable text. Skipped items keep their place in `items`
 * and `starts`, so indices still line up with the text-layer spans, but add
 * only a line break to `text`.
 */
export function buildPageText(rawItems: PdfTextItem[], skip: Set<PdfTextItem>): PageText {
	const items: string[] = [];
	const starts: number[] = [];
	const skipped: boolean[] = [];
	let text = "";
	for (const item of rawItems) {
		if (item.str === undefined) continue; // marked-content boundary
		starts.push(text.length);
		items.push(item.str);
		skipped.push(skip.has(item));
		if (skip.has(item)) {
			text += "\n";
			continue;
		}
		text += item.str;
		if (item.hasEOL) text += "\n";
	}
	return { text, items, starts, skipped };
}

/** Lines of text in the top and bottom bands of a page, keyed with digits masked. */
export function marginLines(content: PageContent): { key: string; text: string; items: PdfTextItem[] }[] {
	const [, y0, , y1] = content.view;
	const band = (y1 - y0) * MARGIN_BAND;
	const lines = new Map<number, PdfTextItem[]>();
	for (const item of content.items) {
		if (!item.str?.trim() || !item.transform || isRotated(item)) continue;
		const y = item.transform[5];
		if (y > y0 + band && y < y1 - band) continue;
		const row = Math.round(y);
		lines.set(row, [...(lines.get(row) ?? []), item]);
	}
	return [...lines.values()].map((items) => {
		const text = items
			.map((item) => item.str)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		return { key: text.toLowerCase().replace(/\d+/g, "#"), text, items };
	});
}

/**
 * Items not worth reading: text set at an angle (arXiv's sidebar stamp, line
 * numbers rotated into the margin), page numbers, and header or footer lines
 * that also appear on a neighbouring page.
 */
export function skippedItems(content: PageContent, neighbours: Set<string>[], skipFootnotes = false): Set<PdfTextItem> {
	const skip = new Set<PdfTextItem>();
	for (const item of content.items) {
		if (item.transform && isRotated(item)) skip.add(item);
	}
	for (const line of marginLines(content)) {
		const repeated = line.key.length > 1 && neighbours.some((keys) => keys.has(line.key));
		if (PAGE_NUMBER.test(line.text) || repeated) {
			for (const item of line.items) skip.add(item);
		}
	}
	if (skipFootnotes) {
		for (const item of footnoteItems(content, skip)) skip.add(item);
	}
	return skip;
}

// Text below this share of the body size is small print: footnotes are
// commonly set at 80-90% of it (9 pt under 10 pt, 8 pt under 9 pt).
const SMALL_PRINT = 0.93;
// Superscript marks are smaller still.
const MARK_PRINT = 0.75;
// Footnotes sit in the lower part of the page.
const FOOTNOTE_REGION = 0.45;
// Marks include the maths asterisk (∗) that LaTeX papers use for footnotes.
const FOOTNOTE_START = /^\s*(?:\d{1,3}|[*∗⁎†‡§¶#]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)/u;
const CAPTION_START = /^\s*(?:fig(?:ure)?|tab(?:le)?|algorithm|listing)\b/i;
const FOOTNOTE_MARK = /^\s*(?:\d{1,3}|[*∗⁎†‡§¶]{1,2}|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)\s*$/u;

/** An item's font size: the length of its vertical axis. */
function fontSize(item: PdfTextItem): number {
	const [, , c = 0, d = 0] = item.transform ?? [];
	return Math.hypot(c, d);
}

/**
 * Footnotes and the marks that point at them: a block of small-print lines at
 * the bottom of the page whose first line starts with a footnote mark, and the
 * small superscript marks left in the body text. `already` holds items skipped
 * for other reasons (page numbers, running footers), which are passed over.
 */
function footnoteItems(content: PageContent, already: Set<PdfTextItem>): PdfTextItem[] {
	const items = content.items.filter(
		(item) => item.str?.trim() && item.transform && !already.has(item) && !isRotated(item),
	);
	if (items.length === 0) return [];

	// The body size is the size most of the page's text is set in.
	const weight = new Map<number, number>();
	for (const item of items) {
		const size = Math.round(fontSize(item) * 2) / 2;
		weight.set(size, (weight.get(size) ?? 0) + item.str!.length);
	}
	const body = [...weight].sort((a, b) => b[1] - a[1])[0][0];
	if (body <= 0) return [];

	// Lines, bottom of the page first (PDF y grows upwards).
	const rows = new Map<number, PdfTextItem[]>();
	for (const item of items) {
		const row = Math.round(item.transform![5]);
		rows.set(row, [...(rows.get(row) ?? []), item]);
	}
	const lines = [...rows]
		.sort((a, b) => a[0] - b[0])
		.map(([y, row]) => ({
			y,
			items: row,
			text: row.map((item) => item.str).join(""),
			size: Math.max(...row.map(fontSize)),
		}));

	const [, y0, , y1] = content.view;
	const regionTop = y0 + (y1 - y0) * FOOTNOTE_REGION;
	const block: typeof lines = [];
	for (const line of lines) {
		if (line.size >= body * SMALL_PRINT || line.y > regionTop) break;
		block.push(line);
	}
	const out: PdfTextItem[] = [];
	// The block's top line opens the first footnote, so it carries the mark.
	const top = block[block.length - 1];
	if (top && FOOTNOTE_START.test(top.text) && !CAPTION_START.test(top.text)) {
		for (const line of block) out.push(...line.items);
	}
	if (out.length > 0) {
		// Marks in the text only go when there are footnotes for them to point at.
		const inBlock = new Set(out);
		for (const item of items) {
			if (!inBlock.has(item) && fontSize(item) < body * MARK_PRINT && FOOTNOTE_MARK.test(item.str!))
				out.push(item);
		}
	}
	return out;
}

function isRotated(item: PdfTextItem): boolean {
	const [a, b] = item.transform ?? [1, 0];
	return Math.abs(Math.atan2(b, a)) > 0.1;
}

function itemAt(pageText: PageText, offset: number): number {
	let low = 0;
	let high = pageText.starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (pageText.starts[mid] <= offset) low = mid;
		else high = mid - 1;
	}
	return low;
}

/**
 * Pairs each item with the span that shows it. Usually the two lists line up
 * one to one; matching on text keeps it working when a pdf.js version drops
 * spans for empty items.
 */
function alignSpans(items: string[], spans: HTMLElement[]): (HTMLElement | undefined)[] {
	if (spans.length === items.length) return spans;
	const out = new Array<HTMLElement | undefined>(items.length);
	let j = 0;
	for (let i = 0; i < items.length && j < spans.length; i++) {
		if (!items[i]) continue;
		for (let look = j; look < Math.min(spans.length, j + 6); look++) {
			if (spans[look].textContent === items[i]) {
				out[i] = spans[look];
				j = look + 1;
				break;
			}
		}
	}
	return out;
}

/** Screen rectangles covering `pageText.text[start, end)` in the text layer. */
function rangeRects(pageText: PageText, spans: (HTMLElement | undefined)[], start: number, end: number): DOMRect[] {
	const rects: DOMRect[] = [];
	if (pageText.items.length === 0) return rects;
	for (let i = itemAt(pageText, start); i < pageText.items.length && pageText.starts[i] < end; i++) {
		const span = spans[i];
		if (!span?.isConnected || pageText.skipped[i]) continue;
		const from = Math.max(0, start - pageText.starts[i]);
		const to = Math.min(pageText.items[i].length, end - pageText.starts[i]);
		if (to <= from) continue;
		const range = textRange(span, from, to);
		if (!range) continue;
		for (const rect of Array.from(range.getClientRects())) {
			if (rect.width > 0 && rect.height > 0) rects.push(rect);
		}
	}
	return rects;
}

/** A DOM range over characters `[from, to)` of the text inside `el`. */
function textRange(el: HTMLElement, from: number, to: number): Range | null {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	let seen = 0;
	let started = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const length = node.textContent?.length ?? 0;
		if (!started && from <= seen + length) {
			range.setStart(node, from - seen);
			started = true;
		}
		if (started && to <= seen + length) {
			range.setEnd(node, to - seen);
			return range;
		}
		seen += length;
	}
	return null;
}

/** The overlay that boxes are drawn into, kept as the last child of the page. */
function overlayLayer(pageEl: HTMLElement): HTMLElement {
	let layer = pageEl.querySelector<HTMLElement>(`:scope > .${LAYER_CLASS}`);
	if (!layer) layer = pageEl.createDiv({ cls: LAYER_CLASS });
	return layer;
}

function drawBoxes(layer: HTMLElement, pageEl: HTMLElement, rects: DOMRect[], cls: string): void {
	const page = pageEl.getBoundingClientRect();
	// The page may be CSS-scaled; boxes are positioned in its unscaled pixels.
	const scale = pageEl.offsetWidth > 0 ? page.width / pageEl.offsetWidth : 1;
	for (const rect of rects) {
		const box = layer.createDiv({ cls });
		box.style.left = `${(rect.left - page.left) / scale - pageEl.clientLeft - 1}px`;
		box.style.top = `${(rect.top - page.top) / scale - pageEl.clientTop - 1}px`;
		box.style.width = `${rect.width / scale + 2}px`;
		box.style.height = `${rect.height / scale + 2}px`;
	}
}

/** Joins words hyphenated across a line break and collapses whitespace. */
function speakable(raw: string): string {
	return raw
		.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

function visiblePage(root: HTMLElement): number {
	const scroller = root.querySelector<HTMLElement>(".pdf-viewer-container") ?? root;
	const top = scroller.getBoundingClientRect().top;
	for (const page of Array.from(root.querySelectorAll<HTMLElement>(".page[data-page-number]"))) {
		if (page.getBoundingClientRect().bottom > top + 40) return Number(page.dataset.pageNumber);
	}
	return 1;
}

function inView(el: HTMLElement, scroller: HTMLElement): boolean {
	const box = el.getBoundingClientRect();
	const frame = scroller.getBoundingClientRect();
	return box.top >= frame.top + 20 && box.bottom <= frame.bottom - 20;
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== undefined || Date.now() > deadline) return value;
		await new Promise((resolve) => window.setTimeout(resolve, 100));
	}
}
