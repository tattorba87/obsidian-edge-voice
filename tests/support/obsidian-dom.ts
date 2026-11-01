/**
 * The few element helpers Obsidian adds to the DOM (createDiv, setText,
 * toggleClass…) that the plugin's own UI uses, for tests in a fake DOM
 * (happy-dom). Import it before the UI module under test.
 */
interface Info {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean>;
}

function create(parent: HTMLElement, tag: string, info?: string | Info): HTMLElement {
	const el = document.createElement(tag);
	const options: Info = typeof info === "string" ? { cls: info } : (info ?? {});
	if (options.cls) el.className = ([] as string[]).concat(options.cls).join(" ");
	if (options.text !== undefined) el.textContent = options.text;
	for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
	parent.appendChild(el);
	return el;
}

// Obsidian's types already declare these on HTMLElement; here they only need to exist.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, info?: string | Info) {
	return create(this, tag, info);
};
proto.createDiv = function (this: HTMLElement, info?: string | Info) {
	return create(this, "div", info);
};
proto.createSpan = function (this: HTMLElement, info?: string | Info) {
	return create(this, "span", info);
};
proto.setText = function (this: HTMLElement, text: string) {
	this.textContent = text;
};
proto.addClass = function (this: HTMLElement, ...names: string[]) {
	this.classList.add(...names);
};
proto.removeClass = function (this: HTMLElement, ...names: string[]) {
	this.classList.remove(...names);
};
proto.toggleClass = function (this: HTMLElement, name: string, on: boolean) {
	this.classList.toggle(name, on);
};
proto.toggle = function (this: HTMLElement, show: boolean) {
	this.style.display = show ? "" : "none";
};
