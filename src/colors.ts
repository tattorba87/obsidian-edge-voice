/** A highlight colour option: the sentence tint and the spoken word's deeper shade. */
export interface HighlightTheme {
	id: string;
	name: string;
	/** "r, g, b" channels; the stylesheet adds per-theme transparency. */
	sentence: string;
	word: string;
}

export const HIGHLIGHT_THEMES: HighlightTheme[] = [
	{ id: "amber", name: "Amber", sentence: "255, 214, 10", word: "255, 128, 0" },
	{ id: "blue", name: "Blue", sentence: "90, 170, 255", word: "20, 100, 230" },
	{ id: "green", name: "Green", sentence: "80, 210, 120", word: "20, 150, 70" },
	{ id: "pink", name: "Pink", sentence: "255, 120, 190", word: "225, 40, 140" },
	{ id: "purple", name: "Purple", sentence: "175, 130, 255", word: "120, 60, 220" },
	{ id: "red", name: "Red", sentence: "255, 110, 100", word: "215, 35, 35" },
	{ id: "grey", name: "Grey", sentence: "160, 160, 160", word: "95, 95, 95" },
];

export const DEFAULT_HIGHLIGHT_THEME = "purple";
/** The default before 0.2.2, kept for anyone whose saved settings predate the choice. */
export const FORMER_HIGHLIGHT_THEME = "amber";

export function highlightTheme(id: string): HighlightTheme {
	return (
		HIGHLIGHT_THEMES.find((theme) => theme.id === id) ??
		HIGHLIGHT_THEMES.find((theme) => theme.id === DEFAULT_HIGHLIGHT_THEME)!
	);
}
