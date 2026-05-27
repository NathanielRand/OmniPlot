// ─────────────────────────────────────────────
// OmniPlot — GLOBAL STORES (Svelte 5 Runes)
// ─────────────────────────────────────────────
import { uid } from "$lib/utils";
import type {
	Toast,
	UserProfile,
	CanvasState,
	PlotterConfig,
} from "$lib/types";
import {
	DEFAULT_MATERIALS,
	PLOTTER_PRESETS,
	DEFAULT_CANVAS_STATE,
} from "$lib/config";

// ─── Theme ────────────────────────────────────
function createThemeStore() {
	let theme = $state<"dark" | "light">("dark");

	function setTheme(t: "dark" | "light") {
		theme = t;
		if (typeof document !== "undefined") {
			document.documentElement.setAttribute("data-theme", t);
			localStorage.setItem("cc-theme", t);
		}
	}

	function toggle() {
		setTheme(theme === "dark" ? "light" : "dark");
	}

	function init() {
		if (typeof localStorage === "undefined") return;
		const saved = localStorage.getItem("cc-theme") as
			| "dark"
			| "light"
			| null;
		const system = window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
		setTheme(saved ?? system);
	}

	return {
		get current() {
			return theme;
		},
		set: setTheme,
		toggle,
		init,
	};
}

export const themeStore = createThemeStore();

// ─── Toast notifications ──────────────────────
function createToastStore() {
	let toasts = $state<Toast[]>([]);

	function add(toast: Omit<Toast, "id">): string {
		const id = uid("toast_");
		toasts = [...toasts, { ...toast, id }];
		const duration = toast.duration ?? 3500;
		if (duration > 0) {
			setTimeout(() => remove(id), duration);
		}
		return id;
	}

	function remove(id: string) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	function success(title: string, message?: string) {
		return add({ type: "success", title, message });
	}

	function error(title: string, message?: string) {
		return add({ type: "error", title, message, duration: 6000 });
	}

	function warning(title: string, message?: string) {
		return add({ type: "warning", title, message });
	}

	function info(title: string, message?: string) {
		return add({ type: "info", title, message });
	}

	return {
		get items() {
			return toasts;
		},
		add,
		remove,
		success,
		error,
		warning,
		info,
	};
}

export const toastStore = createToastStore();

// ─── Auth / User ──────────────────────────────
function createUserStore() {
	let user = $state<UserProfile | null>(null);
	let loading = $state(true);

	return {
		get user() {
			return user;
		},
		get loading() {
			return loading;
		},
		get isAuth() {
			return user !== null;
		},
		get isAdmin() {
			return user?.tier === "admin";
		},
		set(u: UserProfile | null) {
			user = u;
		},
		setLoading(v: boolean) {
			loading = v;
		},
	};
}

export const userStore = createUserStore();

// ─── Shop ─────────────────────────────────────
import type { Shop } from "$lib/types";

function createShopStore() {
	let shop = $state<Shop | null>(null);

	return {
		get shop() { return shop; },
		get isActive() {
			return shop?.subscriptionStatus === "active" ||
			       shop?.subscriptionStatus === "trialing";
		},
		set(s: Shop | null) { shop = s; },
	};
}

export const shopStore = createShopStore();

// ─── Sidebar / Nav ────────────────────────────
function createUiStore() {
	let sidebarOpen = $state(true);
	let mobileMenuOpen = $state(false);
	let pricingModalOpen = $state(false);
	let exportModalOpen = $state(false);
	let commandPaletteOpen = $state(false);
	let reportModalOpen = $state(false);
	let tourOpen = $state(false);

	return {
		get sidebarOpen() {
			return sidebarOpen;
		},
		get mobileMenuOpen() {
			return mobileMenuOpen;
		},
		get pricingModalOpen() {
			return pricingModalOpen;
		},
		get exportModalOpen() {
			return exportModalOpen;
		},
		get commandPaletteOpen() {
			return commandPaletteOpen;
		},
		get reportModalOpen() {
			return reportModalOpen;
		},
		get tourOpen() {
			return tourOpen;
		},

		toggleSidebar() {
			sidebarOpen = !sidebarOpen;
		},
		toggleMobileMenu() {
			mobileMenuOpen = !mobileMenuOpen;
		},
		closeMobileMenu() {
			mobileMenuOpen = false;
		},
		openPricing() {
			pricingModalOpen = true;
		},
		closePricing() {
			pricingModalOpen = false;
		},
		openExport() {
			exportModalOpen = true;
		},
		closeExport() {
			exportModalOpen = false;
		},
		openCommandPalette() {
			commandPaletteOpen = true;
		},
		closeCommandPalette() {
			commandPaletteOpen = false;
		},
		openReport() {
			reportModalOpen = true;
		},
		closeReport() {
			reportModalOpen = false;
		},
		openTour() {
			tourOpen = true;
		},
		closeTour() {
			tourOpen = false;
		},
	};
}

export const uiStore = createUiStore();

// ─── Canvas / Editor state ────────────────────
function createCanvasStore() {
	let state = $state<CanvasState>({
		items: [],
		sheet: DEFAULT_MATERIALS[0],
		selectedIds: [],
		...DEFAULT_CANVAS_STATE,
	});

	let history = $state<CanvasState[]>([]);
	let historyIdx = $state(-1);

	function snapshot() {
		const snap = JSON.parse(JSON.stringify(state)) as CanvasState;
		// Trim redo history
		history = [...history.slice(0, historyIdx + 1), snap];
		historyIdx = history.length - 1;
		// Cap at 50 history entries
		if (history.length > 50) {
			history = history.slice(-50);
			historyIdx = history.length - 1;
		}
	}

	function undo() {
		if (historyIdx <= 0) return;
		historyIdx--;
		state = JSON.parse(JSON.stringify(history[historyIdx]));
	}

	function redo() {
		if (historyIdx >= history.length - 1) return;
		historyIdx++;
		state = JSON.parse(JSON.stringify(history[historyIdx]));
	}

	function setZoom(z: number) {
		state.zoom = Math.max(5, Math.min(100, z));
	}

	function select(id: string, additive = false) {
		if (additive) {
			state.selectedIds = state.selectedIds.includes(id)
				? state.selectedIds.filter((s) => s !== id)
				: [...state.selectedIds, id];
		} else {
			state.selectedIds = [id];
		}
	}

	function deselect() {
		state.selectedIds = [];
	}

	function moveItem(id: string, dx: number, dy: number) {
		state.items = state.items.map((item) =>
			item.id === id
				? {
						...item,
						x: Math.max(0, item.x + dx),
						y: Math.max(0, item.y + dy),
					}
				: item,
		);
	}

	function removeSelected() {
		snapshot();
		state.items = state.items.filter(
			(i) => !state.selectedIds.includes(i.id),
		);
		state.selectedIds = [];
	}

	function updateItem(id: string, patch: Partial<(typeof state.items)[0]>) {
		state.items = state.items.map((item) =>
			item.id === id ? { ...item, ...patch } : item,
		);
	}

	function setItems(items: typeof state.items) {
		snapshot();
		state.items = items;
	}

	function setSheet(sheet: typeof state.sheet) {
		state.sheet = sheet;
	}

	function clear() {
		snapshot();
		state.items = [];
		state.selectedIds = [];
	}

	return {
		get state() {
			return state;
		},
		get items() {
			return state.items;
		},
		get selected() {
			return state.selectedIds;
		},
		get sheet() {
			return state.sheet;
		},
		get zoom() {
			return state.zoom;
		},
		get tool() {
			return state.tool;
		},
		get canUndo() {
			return historyIdx > 0;
		},
		get canRedo() {
			return historyIdx < history.length - 1;
		},

		snapshot,
		undo,
		redo,
		setZoom,
		select,
		deselect,
		moveItem,
		removeSelected,
		updateItem,
		setItems,
		setSheet,
		clear,
		setTool(t: CanvasState["tool"]) {
			state.tool = t;
		},
		toggleGrid() {
			state.showGrid = !state.showGrid;
		},
		toggleRulers() {
			state.showRulers = !state.showRulers;
		},
		toggleSnap() {
			state.snapToGrid = !state.snapToGrid;
		},

		saveToStorage() {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem("cc-canvas-state", JSON.stringify(state));
			} catch {
				// quota exceeded — silently skip
			}
		},

		restoreFromStorage() {
			if (typeof localStorage === "undefined") return;
			// Never overwrite items already in memory (e.g. added from library)
			if (state.items.length > 0) return;
			const raw = localStorage.getItem("cc-canvas-state");
			if (!raw) return;
			try {
				const parsed = JSON.parse(raw) as CanvasState;
				// Patch individual properties so the $state proxy stays intact
				state.items = parsed.items.map((item) => ({
					...item,
					pattern: {
						...item.pattern,
						createdAt: new Date(item.pattern.createdAt),
						updatedAt: new Date(item.pattern.updatedAt),
					},
				}));
				if (parsed.sheet) state.sheet = parsed.sheet;
			} catch {
				localStorage.removeItem("cc-canvas-state");
			}
		},
	};
}

export const canvasStore = createCanvasStore();

// ─── Plotter config ───────────────────────────

// Settings that are user-customizable per plotter preset and should survive page reloads.
const PRESET_PERSIST_KEYS = ["bladeForce", "cuttingSpeed", "passes", "overcut", "baudRate"] as const;
type PresetPersistKey = (typeof PRESET_PERSIST_KEYS)[number];

function _presetStorageKey(name: string) {
	return `omniplot-preset:${name}`;
}

// Per-connection-type settings — restored when switching back to a connection type.
const CONNECTION_PERSIST: Partial<Record<string, Array<keyof PlotterConfig>>> = {
	"usb-serial": ["baudRate"],
	"network":    ["ipAddress", "port"],
	"cut-agent":  ["agentUrl", "baudRate", "serialPort"],
	"download":   [],
};

function _connStorageKey(type: string) { return `omniplot-conn:${type}`; }

function _saveConnSettings(type: string, config: PlotterConfig) {
	if (typeof localStorage === "undefined") return;
	const keys = CONNECTION_PERSIST[type] ?? [];
	const data: Partial<PlotterConfig> = {};
	for (const k of keys) if (config[k] !== undefined) (data as any)[k] = config[k];
	if (Object.keys(data).length) localStorage.setItem(_connStorageKey(type), JSON.stringify(data));
}

function _loadConnSettings(type: string): Partial<PlotterConfig> {
	if (typeof localStorage === "undefined") return {};
	try {
		const raw = localStorage.getItem(_connStorageKey(type));
		return raw ? JSON.parse(raw) : {};
	} catch { return {}; }
}

function _savePresetSettings(name: string, config: PlotterConfig) {
	if (typeof localStorage === "undefined") return;
	const data: Partial<Record<PresetPersistKey, number>> = {};
	for (const k of PRESET_PERSIST_KEYS) data[k] = config[k] as number;
	localStorage.setItem(_presetStorageKey(name), JSON.stringify(data));
}

function _loadPresetSettings(name: string): Partial<Record<PresetPersistKey, number>> | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(_presetStorageKey(name));
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function createPlotterStore() {
	const defaultPreset = PLOTTER_PRESETS[0];

	// Start from preset defaults, then layer in any saved user customisations
	const _savedDefaults = _loadPresetSettings(defaultPreset.name!) ?? {};

	let config = $state<PlotterConfig>({
		id: "default",
		name: defaultPreset.name!,
		manufacturer: defaultPreset.manufacturer!,
		model: defaultPreset.model!,
		protocol: defaultPreset.protocol!,
		connection: "download",
		bladeForce: _savedDefaults.bladeForce ?? defaultPreset.bladeForce!,
		cuttingSpeed: _savedDefaults.cuttingSpeed ?? defaultPreset.cuttingSpeed!,
		passes: _savedDefaults.passes ?? defaultPreset.passes!,
		overcut: _savedDefaults.overcut ?? 0.5,
		offsetBlade: 0.25,
		mediaWidthMm: defaultPreset.maxMediaWidthMm,
		maxMediaWidthMm: defaultPreset.maxMediaWidthMm,
		originX: 0,
		originY: 0,
		flipH: false,
		flipV: false,
		agentUrl: "http://localhost:7878",
		baudRate: _savedDefaults.baudRate ?? defaultPreset.baudRate ?? 9600,
		ipAddress: "192.168.1.100",
		port: 9100,
	});

	return {
		get config() {
			return config;
		},
		update(patch: Partial<PlotterConfig>) {
			config = { ...config, ...patch };
			// Persist cut settings whenever they change so the next session/reconnect inherits them
			if (PRESET_PERSIST_KEYS.some((k) => k in patch)) {
				_savePresetSettings(config.name, config);
			}
		},
		applyPreset(preset: Partial<PlotterConfig> & { maxMediaWidthMm?: number; compatNote?: string }) {
			// Restore any previously saved customisations for this specific preset
			const saved = _loadPresetSettings(preset.name ?? "") ?? {};
			config = {
				...config,
				...preset,
				// User-saved values override preset defaults, but hardware limits come from the preset
				...saved,
				id: config.id,
				mediaWidthMm: preset.maxMediaWidthMm ?? config.mediaWidthMm,
				// Clamp saved values to the preset's plausible range
				bladeForce: Math.max(10, Math.min(500, saved.bladeForce ?? (preset.bladeForce as number) ?? config.bladeForce)),
				cuttingSpeed: Math.max(10, Math.min(1200, saved.cuttingSpeed ?? (preset.cuttingSpeed as number) ?? config.cuttingSpeed)),
			};
		},
		// Saves the current connection's specific settings, then restores the saved
		// settings for the new connection type before switching. This ensures IP
		// addresses, agent URLs, and baud rates are remembered per connection type.
		switchConnection(newType: PlotterConfig["connection"]) {
			_saveConnSettings(config.connection, config);
			const saved = _loadConnSettings(newType);
			config = { ...config, ...saved, connection: newType };
		},
	};
}

export const plotterStore = createPlotterStore();

// ─── Cut Agent shared state ───────────────────
// Single source of truth for agent connectivity so any page can read
// current status without independently polling.
function createAgentStore() {
	let status  = $state<"unknown" | "online" | "offline">("unknown");
	let version = $state<string | null>(null);
	// Imported inline to avoid circular imports through the config barrel
	const REQUIRED_VERSION = "1.0.1";
	let stats   = $state<{
		jobsTotal?: number;
		jobsToday?: number;
		bytesTotal?: number;
		errorsTotal?: number;
		portsUsed?: string[];
		uptimeSeconds?: number;
	} | null>(null);

	return {
		get status()           { return status;  },
		get version()          { return version; },
		get stats()            { return stats;   },
		/** True when agent is running but reports a version older than REQUIRED_VERSION. */
		get needsUpdate()      { return status === "online" && version !== null && version !== REQUIRED_VERSION; },
		/** True when agent is running and is the expected version. */
		get isCurrentVersion() { return status === "online" && version === REQUIRED_VERSION; },
		get requiredVersion()  { return REQUIRED_VERSION; },
		setOnline(v: string) {
			status  = "online";
			version = v;
		},
		setOffline() {
			status  = "offline";
			version = null;
		},
		setStats(s: typeof stats) {
			stats = s;
		},
		get url() {
			return (plotterStore.config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
		},
	};
}

export const agentStore = createAgentStore();
