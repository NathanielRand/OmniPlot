// ─────────────────────────────────────────────
// OmniPlot — PLOTTER HISTORY (pure logic)
//
// Every plotter this browser has connected to, most recent first. Used by:
//   • the reconnect engine — silently resumes the plotter you were last
//     connected to (the "auto target") when it becomes available again
//   • the user — one-click reconnect to any previous plotter from the
//     Studio Plotter tab (quick view) or the Plotters page (full history)
//
// Rules:
//   • Connecting (manually or automatically) makes that plotter the auto target.
//   • Disconnecting it yourself clears the auto target — OmniPlot never
//     reconnects a plotter you just chose to disconnect.
//   • Losing it (unplugged, agent stopped) keeps the auto target, so it comes
//     back on its own when it's plugged in again.
//   • A manual choice always wins over an automatic one in flight.
//
// History is per browser (like Web Serial permissions). The Firestore fleet
// (Plotters page → Registered Plotters) remains the account-wide list;
// history entries link to it by `fleetId`.
// ─────────────────────────────────────────────

export type HistoryConnection = "usb-serial" | "cut-agent" | "network";
export type HistoryEndReason = "user" | "lost" | "switched";

export interface PlotterHistoryEntry {
	key: string;
	connection: HistoryConnection;
	/** PLOTTER_PRESETS[].name remembered for this physical plotter. */
	presetName: string;
	/** User / fleet name, e.g. "Bay 1 Roland". */
	label?: string;
	vendorId?: number;
	productId?: number;
	/** Cut Agent serial path at last connect (COM7, /dev/ttyUSB0). */
	serialPort?: string;
	agentUrl?: string;
	ipAddress?: string;
	port?: number;
	baudRate?: number;
	/** Linked registered PlotterDevice (Firestore) id. */
	fleetId?: string;
	firstConnectedAt: number;
	lastConnectedAt: number;
	lastEndedAt?: number;
	lastEndReason?: HistoryEndReason;
	connectCount: number;
}

export interface PlotterHistoryState {
	version: 1;
	entries: PlotterHistoryEntry[];
	/** Plotter the reconnect engine should resume, or null. */
	autoTargetKey: string | null;
	autoReconnect: boolean;
}

/** A plotter currently visible to discovery (Studio / Plotters page scans). */
export interface LiveDevice {
	source: "agent" | "usb";
	vendorId?: number;
	productId?: number;
	portPath?: string;
}

export type ConnectInput = Omit<PlotterHistoryEntry,
	"key" | "firstConnectedAt" | "lastConnectedAt" | "lastEndedAt" | "lastEndReason" | "connectCount">;

export const HISTORY_LIMIT = 25;

export function emptyHistory(): PlotterHistoryState {
	return { version: 1, entries: [], autoTargetKey: null, autoReconnect: true };
}

const hex = (n: number | undefined) => n === undefined ? "????" : n.toString(16).toUpperCase().padStart(4, "0");

export function formatUsbId(vendorId?: number, productId?: number): string | null {
	return vendorId === undefined ? null : `${hex(vendorId)}:${hex(productId)}`;
}

/** Stable identity for a physical plotter on a given connection. */
export function historyKey(e: Pick<PlotterHistoryEntry, "connection" | "vendorId" | "productId" | "serialPort" | "ipAddress" | "port">): string {
	switch (e.connection) {
		case "usb-serial": return `usb:${hex(e.vendorId)}:${hex(e.productId)}`;
		case "cut-agent":  return `agent:${hex(e.vendorId)}:${hex(e.productId)}@${e.serialPort ?? "auto"}`;
		case "network":    return `net:${(e.ipAddress ?? "").trim()}:${e.port ?? 9100}`;
	}
}

// 2 = exact, 1 = same hardware on a different port path (COM renumbered), 0 = no.
export function matchScore(entry: PlotterHistoryEntry, dev: LiveDevice): 0 | 1 | 2 {
	if (entry.connection === "usb-serial") {
		if (dev.source !== "usb" || entry.vendorId === undefined) return 0;
		return dev.vendorId === entry.vendorId && dev.productId === entry.productId ? 2 : 0;
	}
	if (entry.connection === "cut-agent") {
		if (dev.source !== "agent") return 0;
		const sameHw = entry.vendorId !== undefined && dev.vendorId === entry.vendorId && dev.productId === entry.productId;
		const samePort = !!entry.serialPort && entry.serialPort !== "auto" && dev.portPath === entry.serialPort;
		if (sameHw && samePort) return 2;
		if (samePort && entry.vendorId === undefined) return 2;
		if (sameHw) return 1;
		return 0;
	}
	return 0;
}

/** The live device that is this history entry, or null when absent or ambiguous. */
export function findLiveFor<D extends LiveDevice>(entry: PlotterHistoryEntry, devices: D[]): D | null {
	const exact = devices.filter((d) => matchScore(entry, d) === 2);
	if (exact.length) return exact[0];
	const weak = devices.filter((d) => matchScore(entry, d) === 1);
	// Two identical cutters on renumbered ports — never guess which is which.
	return weak.length === 1 ? weak[0] : null;
}

/** The history entry a live device belongs to (best match), or null. */
export function findEntryFor(state: PlotterHistoryState, dev: LiveDevice): PlotterHistoryEntry | null {
	let best: PlotterHistoryEntry | null = null;
	let bestScore = 0;
	for (const e of state.entries) {
		const s = matchScore(e, dev);
		if (s > bestScore) { best = e; bestScore = s; }
	}
	return best;
}

function sortAndCap(entries: PlotterHistoryEntry[]): PlotterHistoryEntry[] {
	return [...entries].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt).slice(0, HISTORY_LIMIT);
}

/**
 * Records a successful connection and makes it the auto target. An entry for
 * the same hardware on a renumbered agent port is updated rather than duplicated.
 */
export function recordConnect(state: PlotterHistoryState, input: ConnectInput, now: number): PlotterHistoryState {
	let key = historyKey(input);
	let existing = state.entries.find((e) => e.key === key);
	if (!existing && input.connection === "cut-agent" && input.vendorId !== undefined) {
		const sameHw = state.entries.filter((e) => e.connection === "cut-agent" && e.vendorId === input.vendorId && e.productId === input.productId);
		if (sameHw.length === 1) existing = sameHw[0];
	}

	let entries = state.entries;
	// The previous auto target was replaced by this one.
	if (state.autoTargetKey && state.autoTargetKey !== (existing?.key ?? key)) {
		entries = entries.map((e) => e.key === state.autoTargetKey && !e.lastEndReason
			? { ...e, lastEndedAt: now, lastEndReason: "switched" as const } : e);
	}

	const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as ConnectInput;
	let entry: PlotterHistoryEntry;
	if (existing) {
		entries = entries.filter((e) => e.key !== existing!.key);
		entry = {
			...existing,
			...clean,
			// Keep a label the user gave unless a new one was supplied.
			label: input.label ?? existing.label,
			fleetId: input.fleetId ?? existing.fleetId,
			key,
			lastConnectedAt: now,
			lastEndedAt: undefined,
			lastEndReason: undefined,
			connectCount: existing.connectCount + 1,
		};
		entries = entries.filter((e) => e.key !== key);
	} else {
		entry = { ...clean, key, firstConnectedAt: now, lastConnectedAt: now, connectCount: 1 };
	}
	key = entry.key;
	return { ...state, entries: sortAndCap([entry, ...entries]), autoTargetKey: key };
}

/**
 * Records the end of a connection. "user" clears the auto target so the engine
 * won't fight the user; "lost" keeps it so the plotter comes back by itself.
 */
export function recordDisconnect(state: PlotterHistoryState, key: string | null, reason: HistoryEndReason, now: number): PlotterHistoryState {
	if (!key) return state;
	return {
		...state,
		entries: state.entries.map((e) => e.key === key ? { ...e, lastEndedAt: now, lastEndReason: reason } : e),
		autoTargetKey: reason === "user" && state.autoTargetKey === key ? null : state.autoTargetKey,
	};
}

export function forgetEntry(state: PlotterHistoryState, key: string): PlotterHistoryState {
	return {
		...state,
		entries: state.entries.filter((e) => e.key !== key),
		autoTargetKey: state.autoTargetKey === key ? null : state.autoTargetKey,
	};
}

export function patchEntry(state: PlotterHistoryState, key: string, patch: Partial<Pick<PlotterHistoryEntry, "label" | "presetName" | "fleetId" | "baudRate">>): PlotterHistoryState {
	return { ...state, entries: state.entries.map((e) => e.key === key ? { ...e, ...patch } : e) };
}

/**
 * What the reconnect engine should do right now. Network plotters can't be
 * probed from the browser, so a network auto target is always "available".
 */
export function pickAutoTarget<D extends LiveDevice>(state: PlotterHistoryState, live: D[]): { entry: PlotterHistoryEntry; device: D | null } | null {
	if (!state.autoReconnect || !state.autoTargetKey) return null;
	const entry = state.entries.find((e) => e.key === state.autoTargetKey);
	if (!entry) return null;
	if (entry.connection === "network") return { entry, device: null };
	const device = findLiveFor(entry, live);
	return device ? { entry, device } : null;
}

/** Retry cadence while waiting for the auto target: fast at first, then easing off. */
const RETRY_STEPS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];
export function retryDelayMs(attempt: number): number {
	return RETRY_STEPS_MS[Math.min(Math.max(attempt, 0), RETRY_STEPS_MS.length - 1)];
}

export function timeAgo(ms: number | undefined, now = Date.now()): string {
	if (!ms) return "never";
	const s = Math.max(0, (now - ms) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

/** Validates persisted history; anything malformed is dropped rather than trusted. */
export function sanitizeHistory(raw: unknown): PlotterHistoryState {
	const base = emptyHistory();
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;
	const conns: HistoryConnection[] = ["usb-serial", "cut-agent", "network"];
	const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
	const str = (v: unknown) => typeof v === "string" && v ? v : undefined;
	const entries: PlotterHistoryEntry[] = [];
	for (const e of Array.isArray(r.entries) ? r.entries : []) {
		if (!e || typeof e !== "object") continue;
		const x = e as Record<string, unknown>;
		if (!conns.includes(x.connection as HistoryConnection) || !str(x.presetName)) continue;
		const entry: PlotterHistoryEntry = {
			key: "",
			connection: x.connection as HistoryConnection,
			presetName: x.presetName as string,
			label: str(x.label),
			vendorId: num(x.vendorId),
			productId: num(x.productId),
			serialPort: str(x.serialPort),
			agentUrl: str(x.agentUrl),
			ipAddress: str(x.ipAddress),
			port: num(x.port),
			baudRate: num(x.baudRate),
			fleetId: str(x.fleetId),
			firstConnectedAt: num(x.firstConnectedAt) ?? 0,
			lastConnectedAt: num(x.lastConnectedAt) ?? 0,
			lastEndedAt: num(x.lastEndedAt),
			lastEndReason: (["user", "lost", "switched"] as const).find((v) => v === x.lastEndReason),
			connectCount: num(x.connectCount) ?? 1,
		};
		entry.key = historyKey(entry);
		if (!entries.some((y) => y.key === entry.key)) entries.push(entry);
	}
	const sorted = sortAndCap(entries);
	const target = typeof r.autoTargetKey === "string" && sorted.some((e) => e.key === r.autoTargetKey) ? r.autoTargetKey : null;
	return { version: 1, entries: sorted, autoTargetKey: target, autoReconnect: r.autoReconnect !== false };
}
