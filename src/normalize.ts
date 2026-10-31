/**
 * Rewrites written English into the words a reader would say, before it goes
 * to the synthesizer. Moonshine's front end reads plain words, plain numbers
 * and known acronyms well, but guesses at symbols, units, mixed letter-digit
 * tokens and unknown acronyms ("GPU" came out as "gyoo-poo", "2–7 GB" as
 * "elva eb", "%" vanished). Each rule here turns one of those into something
 * it reads correctly; the rules were checked against its G2P output.
 */

// Acronyms people say as a word. Everything else in capitals is spelled out.
const SAID_AS_WORD = new Set([
	"NASA",
	"NATO",
	"JSON",
	"YAML",
	"RAM",
	"ROM",
	"LASER",
	"RADAR",
	"SONAR",
	"LIDAR",
	"SCUBA",
	"UNESCO",
	"UNICEF",
	"COVID",
	"AIDS",
	"FIFA",
	"OPEC",
	"GIF",
	"CRUD",
	"SWAT",
	"PIN",
	"SIM",
	"LAN",
	"WAN",
	"CAD",
	"SQL",
	"OK",
	"TOEFL",
	"IELTS",
	"FAQ",
	"WASM",
	"ASCII",
	"DARPA",
	"REST",
	"ISO",
	"ANSI",
	"MIDI",
	"NAND",
	"FORTRAN",
	"COBOL",
	"BASIC",
	"SPICE",
	"LINQ",
]);

// "Ae" is the spelling the front end reads as the letter A; a bare "A" is "uh".
const LETTER: Record<string, string> = { A: "Ae" };

const ABBREVIATIONS: [RegExp, string][] = [
	[/\be\.g\.,?/gi, "for example,"],
	[/\bi\.e\.,?/gi, "that is,"],
	[/\betc\./gi, "et cetera"],
	[/\bvs?\.(?=\s)/gi, "versus"],
	[/\bet al\./gi, "et al"],
	[/\bcf\./gi, "compare"],
	[/\bw\.r\.t\./gi, "with respect to"],
	[/\ba\.k\.a\./gi, "also known as"],
	[/\bapprox\./gi, "approximately"],
	[/\bFigs?\.(?=\s*\d)/g, "Figure"],
	[/\bEqs?\.(?=\s*\(?\d)/g, "Equation"],
	[/\bSecs?\.(?=\s*\d)/g, "Section"],
	[/\bCh\.(?=\s*\d)/g, "Chapter"],
	[/\bNo\.(?=\s*\d)/g, "number"],
	[/\bpp?\.(?=\s*\d)/g, "page"],
];

const UNITS: Record<string, [string, string]> = {
	KB: ["kilobyte", "kilobytes"],
	MB: ["megabyte", "megabytes"],
	GB: ["gigabyte", "gigabytes"],
	TB: ["terabyte", "terabytes"],
	PB: ["petabyte", "petabytes"],
	KiB: ["kibibyte", "kibibytes"],
	MiB: ["mebibyte", "mebibytes"],
	GiB: ["gibibyte", "gibibytes"],
	Gb: ["gigabit", "gigabits"],
	Mb: ["megabit", "megabits"],
	Hz: ["hertz", "hertz"],
	kHz: ["kilohertz", "kilohertz"],
	MHz: ["megahertz", "megahertz"],
	GHz: ["gigahertz", "gigahertz"],
	ms: ["millisecond", "milliseconds"],
	µs: ["microsecond", "microseconds"],
	μs: ["microsecond", "microseconds"],
	ns: ["nanosecond", "nanoseconds"],
	km: ["kilometre", "kilometres"],
	cm: ["centimetre", "centimetres"],
	mm: ["millimetre", "millimetres"],
	kg: ["kilogram", "kilograms"],
	mg: ["milligram", "milligrams"],
	kW: ["kilowatt", "kilowatts"],
	MW: ["megawatt", "megawatts"],
	fps: ["frame per second", "frames per second"],
	FPS: ["frame per second", "frames per second"],
	FLOPS: ["flops", "flops"],
	TFLOPS: ["teraflops", "teraflops"],
	tok: ["token", "tokens"],
	"°C": ["degree Celsius", "degrees Celsius"],
	"°F": ["degree Fahrenheit", "degrees Fahrenheit"],
};

const UNIT_PATTERN = new RegExp(
	String.raw`(?<![\p{L}\d.])(\d[\d,]*(?:\.\d+)?)\s?(` +
		Object.keys(UNITS)
			.sort((a, b) => b.length - a.length)
			.map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|") +
		String.raw`)(?![\p{L}\d])`,
	"gu",
);

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
	[1e9, "billion"],
	[1e6, "million"],
	[1e3, "thousand"],
	[100, "hundred"],
];

/** Text as the synthesizer should hear it. */
export function normalizeForSpeech(text: string): string {
	let out = text.normalize("NFKC");

	// Reference noise from papers: "[12]", "[3, 7–9]".
	out = out.replace(/\s?\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "");
	// No \b: a footnote mark can sit right against the URL ("1https://...").
	out = out.replace(/(\d?)(?:https?:\/\/|www\.)[^\s)\]]+/g, (_m, mark: string) => (mark ? `${mark} link` : "link"));

	for (const [pattern, spoken] of ABBREVIATIONS) out = out.replace(pattern, spoken);

	// Ranges: "2–7" and "2-7" are "2 to 7"; "x86-64" stays a name.
	out = out.replace(/(?<![\p{L}\d.])(\d+(?:\.\d+)?)\s?[–—-]\s?(?=\d)/gu, "$1 to ");
	// Remaining dashes between words are pauses.
	out = out.replace(/\s*(?:—|--|\s–\s)\s*/g, ", ").replace(/–/g, " ");

	out = out.replace(/(\d)\s?%/g, "$1 percent");
	out = out.replace(
		/[$€£]\s?(\d[\d,]*(?:\.\d+)?)(\s?(?:billion|million|thousand|[BMK]\b))?/g,
		(match: string, amount: string, scale: string | undefined) => {
			const currency = match[0] === "$" ? "dollars" : match[0] === "€" ? "euros" : "pounds";
			const scales: Record<string, string> = { B: " billion", M: " million", K: " thousand" };
			const scaleWord = scale ? (scales[scale.trim()] ?? scale) : "";
			return `${amount}${scaleWord} ${currency}`;
		},
	);
	out = out.replace(UNIT_PATTERN, (_m, amount: string, unit: string) => {
		const [one, many] = UNITS[unit];
		return `${amount} ${amount === "1" ? one : many}`;
	});
	out = out.replace(/(\d)\s?[x×](?![\p{L}\d])/gu, "$1 times");
	out = out.replace(/(\d)\s?×\s?(?=\d)/g, "$1 by ");

	// Decades and ordinals, which the front end misreads.
	out = out.replace(/(?<![\p{L}\d])(\d{4}|\d0)'?s\b/gu, (_m, n: string) =>
		pluralWords(n.length === 4 ? yearWords(Number(n)) : numberWords(Number(n))),
	);
	out = out.replace(/(?<![\p{L}\d.,])(\d+)(st|nd|rd|th)\b/gu, (_m, n: string) => ordinalWords(Number(n)));

	// Versions and model names: "v3.2", "Qwen3-ASR-1.7B", "x86_64".
	out = out.replace(/\bv(?=\d)/g, "version ");
	out = out.replace(/(?<=[\p{L}\d])[_/](?=[\p{L}\d])/gu, " ");
	out = out.replace(/(?<=[\p{Lu}\d])-(?=[\p{L}\d])|(?<=[\p{L}\d])-(?=[\p{Lu}\d])/gu, " ");
	out = out.replace(/(?<=\p{L})(?=\d)|(?<=\d)(?=\p{L})/gu, " ");

	// Symbols. A "~" after "about" is already said.
	out = out
		.replace(/\b(about|around|approximately|roughly)\s*~/gi, "$1 ")
		.replace(/\s*&\s*/g, " and ")
		.replace(/±/g, " plus or minus ")
		.replace(/≈|~(?=\s?\d)/g, " about ")
		.replace(/≤/g, " at most ")
		.replace(/≥/g, " at least ")
		.replace(/(?<=\s)<(?=\s?\d)/g, " less than ")
		.replace(/(?<=\s)>(?=\s?\d)/g, " more than ")
		.replace(/(?<=\s)=(?=\s)/g, " equals ")
		.replace(/(?<=[\d\s])\+(?=[\s\d])/g, " plus ")
		.replace(/°/g, " degrees")
		.replace(/[→⇒]/g, " to ");

	// A heading in capitals reads as words, not as a string of acronyms.
	if (isCapitalsHeading(out)) out = out.replace(/\p{Lu}{2,}/gu, (word) => word.toLowerCase());
	out = out.replace(/(?<![\p{L}\d'’])(\p{Lu}{2,6})(s|'s)?(?![\p{L}\d])/gu, (_m, word: string, plural?: string) => {
		if (SAID_AS_WORD.has(word)) return word + (plural ?? "");
		if (word.length === 6) return word.toLowerCase() + (plural ?? "");
		const letters = [...word].map((letter) => LETTER[letter] ?? letter);
		return letters.join(" ") + (plural ? "'s" : "");
	});

	return out
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/,+(?=[,.;:!?])/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Rough syllable count of `word` once spoken, for timing the word highlight. */
export function spokenSyllables(word: string): number {
	let count = 0;
	for (const token of normalizeForSpeech(word).split(/\s+/)) {
		if (!token) continue;
		if (/^\p{Lu}$/u.test(token) || token === "Ae") {
			count += token === "W" ? 3 : 1;
		} else if (/^\d[\d,]*(\.\d+)?$/.test(token)) {
			const [whole, fraction = ""] = token.replace(/,/g, "").split(".");
			count += syllablesOf(numberWords(Number(whole))) + (fraction ? 1 + fraction.length : 0);
		} else {
			count += syllablesOf(token);
		}
	}
	return Math.max(1, count);
}

function syllablesOf(text: string): number {
	let count = 0;
	for (const word of text.toLowerCase().split(/[^a-z']+/)) {
		if (!word) continue;
		const groups = word.replace(/e$/, "").match(/[aeiouy]+/g)?.length ?? 0;
		count += Math.max(1, groups);
	}
	return count;
}

/**
 * A heading set in capitals: every word in capitals, and at least one long
 * enough to be a real word rather than an acronym. A sentence that merely has
 * several acronyms ("NASA's REST API returns JSON") keeps them.
 */
function isCapitalsHeading(text: string): boolean {
	const words = text.match(/\p{L}{2,}/gu) ?? [];
	if (words.length < 2) return false;
	return words.every((word) => word === word.toUpperCase()) && words.some((word) => word.length >= 7);
}

function numberWords(n: number): string {
	if (!Number.isFinite(n) || n < 0 || n >= 1e12) return String(n);
	if (n < 20) return ONES[n];
	if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
	for (const [scale, name] of SCALES) {
		if (n >= scale) {
			const rest = n % scale;
			return `${numberWords(Math.floor(n / scale))} ${name}` + (rest ? ` ${numberWords(rest)}` : "");
		}
	}
	return String(n);
}

/** Years as people say them: 1990 "nineteen ninety", 2005 "two thousand five". */
function yearWords(n: number): string {
	if (n >= 2000 && n < 2010) return numberWords(n);
	if (n >= 1100 && n < 2100 && n % 100 === 0) return `${numberWords(n / 100)} hundred`;
	if (n >= 1100 && n < 2100) {
		const low = n % 100;
		return `${numberWords(Math.floor(n / 100))} ${low < 10 ? `oh ${numberWords(low)}` : numberWords(low)}`;
	}
	return numberWords(n);
}

function pluralWords(words: string): string {
	return words.replace(/(\w+)$/, (last) => (last.endsWith("y") ? `${last.slice(0, -1)}ies` : `${last}s`));
}

function ordinalWords(n: number): string {
	const words = numberWords(n);
	const irregular: Record<string, string> = {
		one: "first",
		two: "second",
		three: "third",
		five: "fifth",
		eight: "eighth",
		nine: "ninth",
		twelve: "twelfth",
	};
	return words.replace(/(\w+)$/, (last) => {
		if (irregular[last]) return irregular[last];
		if (last.endsWith("y")) return `${last.slice(0, -1)}ieth`;
		return `${last}th`;
	});
}
