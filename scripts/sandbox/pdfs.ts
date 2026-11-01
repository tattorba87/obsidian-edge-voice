/**
 * The sandbox's sample PDFs, made with pdf-lib (as tests/pdf.test.ts does), so
 * there's no copyrighted document in the repository. They hold what the PDF
 * reader has to skip: running headers, page numbers, a rotated margin stamp
 * and footnotes, plus a two-column page for reading order.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { degrees, PDFDocument, PDFFont, PDFPage, StandardFonts } from "pdf-lib";

const PARAGRAPHS = [
	"Reading along with audio can help people stay with a text. In this short paper we describe a reader that speaks a document aloud on the reader's own computer, highlighting each sentence and word as it is spoken.",
	"The reader splits the text into sentences and sends them to a speech engine one at a time. While one sentence plays, the next few are prepared, so there is no gap between them.",
	"Documents bring their own difficulties. Page numbers, running headers and notes in the margin are part of the page but not part of the text, and a person reading aloud would skip them without thinking.",
	"Footnotes are a harder case. They sit at the bottom of the page in smaller type, and reading them in the middle of a paragraph breaks the thread of the argument.",
	"We tested the reader on a range of documents, from single-column reports to papers set in two columns. In every case the reading order followed the text as a person would read it.",
	"The results suggest that careful handling of layout matters as much as the quality of the voice. A clear voice reading page numbers aloud is still a distraction.",
];

/** Draws `text` wrapped to `width` points from (x, y) downwards; returns the y below it. */
function drawWrapped(page: PDFPage, font: PDFFont, text: string, x: number, y: number, width: number, size: number) {
	let line = "";
	for (const word of text.split(" ")) {
		const next = line ? `${line} ${word}` : word;
		if (font.widthOfTextAtSize(next, size) > width && line) {
			page.drawText(line, { x, y, size, font });
			y -= size * 1.4;
			line = word;
		} else line = next;
	}
	if (line) page.drawText(line, { x, y, size, font });
	return y - size * 2;
}

async function paper(): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.TimesRoman);
	for (let n = 1; n <= 3; n++) {
		const page = pdf.addPage([612, 792]);
		page.drawText("Reading Along: A Short Paper", { x: 72, y: 750, size: 9, font });
		let y = n === 1 ? 680 : 700;
		if (n === 1) page.drawText("Reading Along", { x: 72, y: 710, size: 20, font });
		for (const text of PARAGRAPHS.slice((n - 1) * 2, n * 2)) y = drawWrapped(page, font, text, 72, y, 468, 11);
		page.drawText(String(n), { x: 303, y: 40, size: 10, font });
		if (n === 1) {
			page.drawText("sandbox:0001.sample [cs.HC] 1 Nov 2026", {
				x: 30,
				y: 280,
				size: 18,
				font,
				rotate: degrees(90),
			});
		}
		if (n === 2) {
			page.drawText("1", { x: 260, y: 706, size: 7, font });
			drawWrapped(
				page,
				font,
				"1 A footnote in smaller type, which is skipped unless turned on in settings.",
				72,
				90,
				468,
				9,
			);
		}
	}
	return pdf.save();
}

async function twoColumns(): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.TimesRoman);
	const page = pdf.addPage([612, 792]);
	page.drawText("Two Columns", { x: 72, y: 720, size: 18, font });
	let left = 680;
	let right = 680;
	PARAGRAPHS.forEach((text, i) => {
		if (i < 3) left = drawWrapped(page, font, text, 72, left, 220, 10);
		else right = drawWrapped(page, font, text, 320, right, 220, 10);
	});
	page.drawText("1", { x: 303, y: 40, size: 10, font });
	return pdf.save();
}

/** Writes the sample PDFs into `folder`. */
export async function writeSamplePdfs(folder: string): Promise<void> {
	writeFileSync(join(folder, "A short paper.pdf"), await paper());
	writeFileSync(join(folder, "Two columns.pdf"), await twoColumns());
}
