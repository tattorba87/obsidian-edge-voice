import type { App } from "obsidian";

/** Isolate Obsidian's internal settings navigation; the public API exposes no opener. */
export function openSettingsSection(app: App, pluginId: string, selector: string): () => void {
	const controller = (
		app as unknown as {
			setting?: { open(): void; openTabById(id: string): { containerEl: HTMLElement } | undefined };
		}
	).setting;
	if (!controller?.open || !controller.openTabById) throw new Error("Settings navigation is unavailable");
	controller.open();
	const tab = controller.openTabById(pluginId);
	if (!tab) throw new Error("Plugin settings are unavailable");
	const container = tab.containerEl;
	const win = container.ownerDocument.defaultView ?? window;
	const reveal = () => {
		if (container.isConnected)
			container.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "instant" });
	};
	// Voice inventory can rerender the tab after opening; keep the requested section in view briefly.
	const observer = new win.MutationObserver(reveal);
	observer.observe(container, { childList: true, subtree: true });
	const cleanup = () => {
		observer.disconnect();
		win.cancelAnimationFrame(frame);
		win.clearTimeout(timer);
	};
	const timer = win.setTimeout(cleanup, 1500);
	const frame = win.requestAnimationFrame(reveal);
	return cleanup;
}
