import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// The plugin reads and deletes no files itself (notes and PDFs come through
// Obsidian's vault API; the engine lists and removes its own downloads). Keep
// it that way: no source file may use Node's fs module.
describe("File access", () => {
	it("no plugin source imports fs", () => {
		const src = join(__dirname, "..", "src");
		const offenders = readdirSync(src)
			.filter((name) => name.endsWith(".ts"))
			.filter((name) =>
				/from\s+["'](node:)?fs(\/promises)?["']|require\(\s*["'](node:)?fs/.test(
					readFileSync(join(src, name), "utf8"),
				),
			);
		expect(offenders).toEqual([]);
	});
});
