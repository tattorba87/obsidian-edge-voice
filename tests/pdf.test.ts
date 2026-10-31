import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPageText, marginLines, skippedItems } from "../src/pdf";

type Content = Parameters<typeof skippedItems>[0];

const BODY =
	"Speech recognition on small devices has improved quickly. We study how far it can go on a laptop CPU. " +
	"The results show that streaming models keep latency low while staying accurate on common benchmarks.";

/**
 * A three-page paper in miniature: 10 pt body text, a running header and a
 * page number on every page, an arXiv-style stamp rotated into the margin on
 * page 1, a 9 pt footnote on page 2, and a small-print figure caption on page 3.
 */
async function makePaper(): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.TimesRoman);
	for (let n = 1; n <= 3; n++) {
		const page = pdf.addPage([612, 792]);
		page.drawText("Preprint under review", { x: 72, y: 760, size: 9, font });
		let y = 700;
		for (const line of BODY.match(/.{1,90}(\s|$)/g)!) {
			page.drawText(line.trim(), { x: 72, y, size: 10, font });
			y -= 14;
		}
		page.drawText(String(n), { x: 300, y: 40, size: 10, font });
		if (n === 1)
			page.drawText("arXiv:2604.14493v1 [cs.AI] 16 Apr 2026", {
				x: 30,
				y: 300,
				size: 20,
				font,
				rotate: degrees(90),
			});
		if (n === 2) {
			page.drawText("1", { x: 200, y: 706, size: 7, font });
			page.drawText("1 https://github.com/example/leaderboard", { x: 72, y: 80, size: 9, font });
			page.drawText("with results kept up to date.", { x: 72, y: 70, size: 9, font });
		}
		if (n === 3) page.drawText("Figure 1: Latency against accuracy.", { x: 72, y: 80, size: 9, font });
	}
	return pdf.save();
}

let contents: Content[] = [];

beforeAll(async () => {
	const doc = await getDocument({ data: await makePaper(), verbosity: 0 }).promise;
	contents = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		contents[n] = { items: (await page.getTextContent()).items as Content["items"], view: page.view };
	}
});

/** What gets read on page `n`, and what gets skipped. */
function readPage(n: number, skipFootnotes: boolean) {
	const neighbours = [n - 1, n + 1]
		.filter((k) => contents[k])
		.map((k) => new Set(marginLines(contents[k]).map((l) => l.key)));
	const skip = skippedItems(contents[n], neighbours, skipFootnotes);
	const text = buildPageText(contents[n].items, skip).text.replace(/\s+/g, " ").trim();
	const skipped = contents[n].items.filter((item) => skip.has(item)).map((item) => item.str ?? "");
	return { text, skipped };
}

describe("PDF reading", () => {
	it("skips the rotated margin stamp", () => {
		const { text, skipped } = readPage(1, true);
		expect(skipped.join(" ")).toContain("arXiv:2604.14493v1");
		expect(text).not.toContain("arXiv");
	});

	it("skips page numbers and the running header, keeps the body", () => {
		const { text } = readPage(2, true);
		expect(text).not.toContain("Preprint under review");
		expect(text).not.toMatch(/\b2$/);
		expect(text).toContain("Speech recognition on small devices");
	});

	it("skips a footnote and its mark when asked", () => {
		const skipping = readPage(2, true);
		expect(skipping.text).not.toContain("github.com");
		expect(skipping.text).not.toContain("kept up to date");
		expect(skipping.skipped).toContain("1");
		const reading = readPage(2, false);
		expect(reading.text).toContain("github.com");
	});

	it("keeps a small-print caption: it doesn't start with a footnote mark", () => {
		expect(readPage(3, true).text).toContain("Figure 1: Latency against accuracy.");
	});

	it("keeps item indices aligned with the text layer", () => {
		const page = buildPageText(contents[1].items, skippedItems(contents[1], [], true));
		const withText = contents[1].items.filter((item) => item.str !== undefined);
		expect(page.items).toHaveLength(withText.length);
		expect(page.starts).toHaveLength(withText.length);
	});
});
