// ─── Plotter status (app-wide) ────────────────
// Drives the plotter badge in the app shell's top bar and sidebar. While the
// Studio is open it publishes its full status (detected devices, cutting
// progress, width compatibility); everywhere else the badge falls back to
// what's knowable globally — the saved plotter, the Cut Agent, and whether a
// USB port is still open in this tab (it survives navigating away).
import { browser } from "$app/environment";
import { plotterStore, agentStore } from "./stores.svelte";
import { isSerialConnected, onSerialPortChange } from "$lib/utils/plotter-connection";

export type PlotterConnType = "usb-serial" | "cut-agent" | "network" | "download";
export interface PlotterStatus {
	state: "cutting" | "connected" | "detected" | "scanning" | "none";
	name: string | null;
	connType: PlotterConnType | null;
	detail: string;
	tone: "ok" | "warn" | "error" | "missing" | "cutting";
}

function createPlotterStatusStore() {
	let studio     = $state<PlotterStatus | null>(null);
	let serialOpen = $state(browser ? isSerialConnected() : false);
	if (browser) onSerialPortChange((open) => { serialOpen = open; });

	const fallback = $derived.by((): PlotterStatus => {
		const cfg = plotterStore.config;
		const name = cfg.name || null;
		const connType = cfg.connection as PlotterConnType;
		if (connType === "usb-serial") {
			return serialOpen
				? { state: "connected", name, connType, detail: "Connected · ready to cut", tone: "ok" }
				: { state: "none", name, connType, detail: "Not connected", tone: "missing" };
		}
		if (connType === "cut-agent") {
			if (agentStore.status === "online") {
				return agentStore.needsUpdate
					? { state: "connected", name, connType, detail: "Agent update required", tone: "warn" }
					: { state: "connected", name, connType, detail: "Connected · ready to cut", tone: "ok" };
			}
			return { state: "none", name, connType, detail: agentStore.status === "unknown" ? "Not checked yet" : "Cut Agent offline", tone: "missing" };
		}
		if (connType === "download") {
			return { state: "none", name, connType, detail: "File export only", tone: "missing" };
		}
		return { state: "none", name, connType, detail: "Not connected", tone: "missing" };
	});

	return {
		/** What the badge shows right now. */
		get current(): PlotterStatus { return studio ?? fallback; },
		get isLive() { return this.current.state === "connected" || this.current.state === "cutting"; },
		/** Studio → shell: the Studio's own, richer status. Null when it unmounts. */
		publish(s: PlotterStatus | null) { studio = s; },
	};
}

export const plotterStatusStore = createPlotterStatusStore();
