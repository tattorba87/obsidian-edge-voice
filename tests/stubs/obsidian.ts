// The parts of Obsidian's API that modules under test import. Tests drive
// them through plain objects, so these only need to exist.
export class MarkdownView {}
export class FileView {}
export class Editor {}
export class Notice {}
export class Modal {}
export class Menu {}
export const loadPdfJs = (): Promise<never> => Promise.reject(new Error("loadPdfJs is not available in tests"));
export const requestUrl = (): Promise<never> => Promise.reject(new Error("requestUrl is not available in tests"));
export const setIcon = (): void => undefined;
