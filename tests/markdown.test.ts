import { describe, expect, it } from "vitest";
import { MarkdownSource, sectionLines } from "../src/markdown";
import type { Segment } from "../src/reader";

/** A MarkdownView with just the editor calls MarkdownSource makes at construction. */
function viewOf(doc: string) {
	return {
		editor: {
			getValue: () => doc,
			posToOffset: () => 0,
			getCursor: () => ({ line: 0, ch: 0 }),
			offsetToPos: (offset: number) => ({ line: doc.slice(0, offset).split("\n").length - 1, ch: 0 }),
		},
	} as unknown as ConstructorParameters<typeof MarkdownSource>[0];
}

async function spoken(doc: string, from = 0): Promise<string[]> {
	const source = new MarkdownSource(viewOf(doc), () => false, from);
	const out: string[] = [];
	for (let segment: Segment | null = await source.next(); segment; segment = await source.next())
		out.push(segment.text);
	return out;
}

describe("MarkdownSource", () => {
	it("skips what isn't read aloud and keeps what a reader sees", async () => {
		const doc = [
			"---",
			"tags: [a]",
			"---",
			"# Heading One",
			"Some **bold** text with a [link](https://x.com/a) and [[Page|alias]] here.",
			"- [ ] A task item with `code` inside.",
			"> Quoted line with #tag and ==highlight==.",
			"```",
			"skip me()",
			"```",
			"Last one, with snake_case and *italics*.",
		].join("\n");
		expect(await spoken(doc)).toEqual([
			"Heading One",
			"Some bold text with a link and alias here.",
			"A task item with inside.",
			"Quoted line with and highlight.",
			"Last one, with snake case and italics.",
		]);
	});

	it("reads hard-wrapped prose as whole sentences", async () => {
		const doc =
			"Nor was there much cause for fear.  Since he was certain there were\n" +
			"no private arms in the whole principality, he was a hundred times\n" +
			"more certain there were none.";
		expect(await spoken(doc)).toEqual([
			"Nor was there much cause for fear.",
			"Since he was certain there were no private arms in the whole principality, he was a hundred times more certain there were none.",
		]);
	});

	it("keeps headings and list items apart from the text around them", async () => {
		expect(await spoken("## Chapter Two\n- a list item that wraps\n  onto a second line.\n- second item")).toEqual([
			"Chapter Two",
			"a list item that wraps onto a second line.",
			"second item",
		]);
	});

	it("starts at the word containing the start offset", async () => {
		const doc = "First sentence here. Second sentence starts here.";
		expect(await spoken(doc, doc.indexOf("cond"))).toEqual(["Second sentence starts here."]);
	});

	it("gives each segment its words, weights and partial text", async () => {
		const source = new MarkdownSource(viewOf("Since then, it has rained every day."), () => false, 0);
		const segment = (await source.next())!;
		expect(segment.weights).toHaveLength(7);
		expect(segment.pauses[1]).toBe(1);
		expect(segment.spokenText(0, 2)).toBe("Since then,");
		expect(segment.spokenText(2, 7)).toBe("it has rained every day.");
	});
});

describe("sectionLines", () => {
	const el = {} as HTMLElement;

	it("reads Reading view sections as Obsidian keeps them now, by start and end position", () => {
		expect(sectionLines([{ el, start: { line: 18 }, end: { line: 20 } }])).toEqual([
			{ el, lineStart: 18, lineEnd: 20 },
		]);
	});

	it("leaves out Obsidian's own header, which claims the note's first line too", () => {
		const header = { classList: { contains: (name: string) => name === "mod-ui" } } as unknown as HTMLElement;
		expect(
			sectionLines([
				{ el: header, start: { line: 0 }, end: { line: 0 } },
				{ el, start: { line: 0 }, end: { line: 0 } },
			]),
		).toEqual([{ el, lineStart: 0, lineEnd: 0 }]);
	});

	it("reads them as older Obsidian versions kept them, and skips any without lines", () => {
		expect(sectionLines([{ el, lineStart: 3, lineEnd: 4 }, { el }])).toEqual([{ el, lineStart: 3, lineEnd: 4 }]);
	});
});

describe("Long lines", () => {
	it("are handled quickly even when full of unclosed links, tags, code and maths", () => {
		// Each unclosed opener used to make masking rescan the rest of the line: quadratic, 4 s here.
		const n = 80000;
		const lines: Record<string, string> = {
			wikilinks: "[[a|".repeat(n / 4),
			html: "<a ".repeat(n / 3),
			links: "[a](".repeat(n / 4),
			code: "`a".repeat(n / 2),
			maths: "$a".repeat(n / 2),
		};
		for (const [name, line] of Object.entries(lines)) {
			const started = performance.now();
			new MarkdownSource(viewOf(line), () => false, 0);
			expect(performance.now() - started, name).toBeLessThan(1000);
		}
	});

	it("still masks a normal link after a long run of unclosed ones", async () => {
		const text = "[[a ".repeat(2000) + "Read [[Target|the shown words]] here.";
		const said = (await spoken(text)).join(" ");
		expect(said).toContain("the shown words here");
		expect(said).not.toContain("Target");
	});
});
