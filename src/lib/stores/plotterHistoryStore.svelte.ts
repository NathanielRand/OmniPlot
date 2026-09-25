// ─────────────────────────────────────────────
// OmniPlot — PLOTTER HISTORY STORE
// Reactive wrapper around $lib/utils/plotter-history: persists to
// localStorage, syncs across tabs, and carries the in-memory reconnect
// state shared by the Studio and the Plotters page.
// ─────────────────────────────────────────────
import {
	emptyHistory,
	sanitizeHistory,
	recordConnect,
	recordDisconnect,
	forgetEntry,
	patchEntry,
	pickAutoTarget,
	findEntryFor,
	findLiveFor,
	type PlotterHistoryState,
	type PlotterHistoryEntry,
	type ConnectInput,
	type HistoryEndReason,
	type LiveDevice,
} from "$lib/utils/plotter-history";

const STORAGE_KEY = "omniplot-plotter-history";

export type ReconnectPhase = "idle" | "waiting" | "connecting" | "failed";
export interface ReconnectStatus {
	phase: ReconnectPhase;
	key: string | null;
	attempt: number;
	/** Why the last automatic attempt failed (e.g. port in use). */
	message?: string;
}

function readStorage(): PlotterHistoryState {
	if (typeof localStorage === "undefined") return emptyHistory();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return sanitizeHistory(JSON.parse(raw));
		return migrateLegacy();
	} catch {
		return emptyHistory();
	}
}

// Before history existed, the last connection lived in omniplot-conn:* keys.
// Seed history from them once so existing users get auto-reconnect right away.
function migrateLegacy(): PlotterHistoryState {
	let state = emptyHistory();
	try {
		const active = localStorage.getItem("omniplot-conn:active");
		const settings = active ? JSON.parse(localStorage.getItem(`omniplot-conn:${active}`) ?? "{}") : {};
		const presetName = localStorage.getItem("omniplot-conn:preset") ?? "Generic HPGL Cutter";
		if (active === "usb-serial" && typeof settings.vendorId === "number") {
			state = recordConnect(state, { connection: "usb-serial", presetName, vendorId: settings.vendorId, productId: settings.productId, baudRate: settings.baudRate }, Date.now());
		} else if (active === "cut-agent") {
			state = recordConnect(state, { connection: "cut-agent", presetName, serialPort: settings.serialPort, agentUrl: settings.agentUrl, baudRate: settings.baudRate }, Date.now());
		} else if (active === "network" && settings.ipAddress) {
			state = recordConnect(state, { connection: "network", presetName, ipAddress: settings.ipAddress, port: settings.port }, Date.now());
		}
	} catch { /* nothing to migrate */ }
	return state;
}

function createPlotterHistoryStore() {
	let state = $state<PlotterHistoryState>(readStorage());
	let status = $state<ReconnectStatus>({ phase: "idle", key: null, attempt: 0 });
	// Paused for this page session by the user ("Stop trying") — not persisted.
	let pausedThisSession = $state(false);
	// Bumped on every manual connect/disconnect. An automatic attempt captures
	// it before awaiting and abandons its result if it changed — manual wins.
	let epoch = 0;

	function commit(next: PlotterHistoryState) {
		state = next;
		if (typeof localStorage === "undefined") return;
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage full/blocked */ }
	}

	if (typeof window !== "undefined") {
		window.addEventListener("storage", (e) => {
			if (e.key !== STORAGE_KEY) return;
			try { state = sanitizeHistory(e.newValue ? JSON.parse(e.newValue) : null); } catch { /* ignore */ }
		});
	}

	return {
		get entries() { return state.entries; },
		get autoReconnect() { return state.autoReconnect; },
		get autoTargetKey() { return state.autoTargetKey; },
		get autoTarget(): PlotterHistoryEntry | null {
			return state.entries.find((e) => e.key === state.autoTargetKey) ?? null;
		},
		get status() { return status; },
		get paused() { return pausedThisSession; },
		get epoch() { return epoch; },

		setAutoReconnect(on: boolean) {
			commit({ ...state, autoReconnect: on });
			if (on) pausedThisSession = false;
			else status = { phase: "idle", key: null, attempt: 0 };
		},
		/** "Stop trying" — pause automatic reconnect until the next manual connect or page load. */
		pause() {
			pausedThisSession = true;
			status = { phase: "idle", key: null, attempt: 0 };
		},
		/** Call at the start of every user-initiated connect/disconnect. */
		beginManual(): number {
			epoch += 1;
			pausedThisSession = false;
			return epoch;
		},
		isCurrent(e: number) { return e === epoch; },

		recordConnect(input: ConnectInput) {
			commit(recordConnect(state, input, Date.now()));
			status = { phase: "idle", key: null, attempt: 0 };
		},
		recordDisconnect(key: string | null, reason: HistoryEndReason) {
			commit(recordDisconnect(state, key, reason, Date.now()));
		},
		forget(key: string) { commit(forgetEntry(state, key)); },
		clear() { commit({ ...emptyHistory(), autoReconnect: state.autoReconnect }); },
		rename(key: string, label: string) { commit(patchEntry(state, key, { label: label.trim() || undefined })); },
		setPreset(key: string, presetName: string) { commit(patchEntry(state, key, { presetName })); },
		linkFleet(key: string, fleetId: string, label?: string) { commit(patchEntry(state, key, { fleetId, ...(label ? { label } : {}) })); },

		findEntryFor(dev: LiveDevice) { return findEntryFor(state, dev); },
		findLiveFor<D extends LiveDevice>(entry: PlotterHistoryEntry, devices: D[]) { return findLiveFor(entry, devices); },
		pickAutoTarget<D extends LiveDevice>(live: D[]) {
			return pausedThisSession ? null : pickAutoTarget(state, live);
		},
		setStatus(s: ReconnectStatus) { status = s; },
	};
}

export const plotterHistoryStore = createPlotterHistoryStore();
