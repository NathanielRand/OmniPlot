// ─────────────────────────────────────────────────────────────────────────────
// OmniPlot — Plotter Detection
//
// Three detection paths:
//   1. USB (Web Serial): query previously-authorized ports, match by USB VID
//   2. Agent USB: ask the Cut Agent for all OS serial ports, match by name/VID
//   3. Agent network scan: ask the Cut Agent to probe the LAN for port 9100
//
// Post-connect: call matchPortToPreset() immediately after connectSerialPort()
// returns to surface detection results without a second "Detect" click.
// ─────────────────────────────────────────────────────────────────────────────

import { PLOTTER_PRESETS, type PlotterPreset } from "$lib/config";

// ─── USB Vendor ID registry ───────────────────
// Sources: USB-IF, manufacturer driver packages, community hardware reports.
// ─────────────────────────────────────────────
// Brand-name plotters
// ─────────────────────────────────────────────
const USB_VID_TO_MANUFACTURER: Record<number, string> = {
	0x09CA: "Roland",       // Roland DG Corporation
	0x0B4B: "Graphtec",     // Graphtec Corporation
	0x0B4D: "Silhouette",   // Silhouette America
	0x08F0: "Mimaki",       // Mimaki Engineering
	0x0CA6: "Summa",        // Summa NV (less universally confirmed)
	// ─────────────────────────────────────────
	// USB-serial bridge chips used by budget cutters
	// (USCutter, VEVOR, GCC, and many no-brand vinyl cutters)
	// ─────────────────────────────────────────
	0x1A86: "CH340",        // WCH CH340/CH341 — very common in budget cutters
	0x0403: "FTDI",         // FTDI FT232/FT2232 — older Roland/Summa, some industrials
	0x10C4: "CP210x",       // Silicon Labs CP2102/CP2104 — VEVOR and others
	0x067B: "PL2303",       // Prolific PL2303 — older budget vinyl cutters
	0x04B8: "Epson",        // Epson (some plotter/large-format variants)
};

// Descriptions shown in the UI for serial bridge chips.
// These chips tell us the physical interface but not the brand of cutter.
const SERIAL_BRIDGE_NOTES: Partial<Record<string, string>> = {
	"CH340":  "CH340 USB-serial bridge — likely a budget vinyl cutter (USCutter, VEVOR, or similar)",
	"FTDI":   "FTDI USB-serial bridge — could be Roland, Summa, GCC, or an industrial cutter",
	"CP210x": "CP210x USB-serial bridge — likely a budget vinyl cutter (VEVOR or similar)",
	"PL2303": "PL2303 USB-serial bridge — older budget vinyl cutter",
};

// ─── Types ────────────────────────────────────

export interface DetectedPlotter {
	preset: PlotterPreset;
	/** How confident we are in the match. */
	confidence: "exact-vid" | "manufacturer-name" | "generic";
	/** Where the detection signal came from. */
	source: "usb" | "agent-usb" | "agent-network";
	/** Human-readable description of the detected device. */
	detail: string;
	/** Serial port path from Cut Agent (e.g. /dev/ttyUSB0 or COM3) — agent-usb only. */
	portPath?: string;
}

export interface NetworkDevice {
	ip: string;
	port: number;
	responseMs: number;
}

// ─── USB detection (Web Serial) ───────────────
// Uses getPorts() — returns ONLY previously-authorized ports (no dialog).
// Call this silently on load; show the "Select USB Port…" dialog separately.
// After requestPort() completes, call matchPortToPreset() directly instead
// of re-running detectUsbPlotters() — the matched result is more immediate.
export async function detectUsbPlotters(): Promise<DetectedPlotter[]> {
	if (typeof navigator === "undefined" || !("serial" in navigator)) return [];
	try {
		const ports: any[] = await (navigator as any).serial.getPorts();
		const results: DetectedPlotter[] = [];
		for (const port of ports) {
			const info: { usbVendorId?: number; usbProductId?: number } =
				port.getInfo?.() ?? {};
			results.push(matchByUsbVid(info.usbVendorId, info.usbProductId));
		}
		return results;
	} catch {
		return [];
	}
}

// ─── Post-connect match ───────────────────────
// Call this immediately after connectSerialPort() returns so the VID/PID
// we already have is used for detection without needing a separate click.
// Returns null if neither vendorId nor productId is available.
export function matchPortToPreset(
	vendorId?: number,
	productId?: number,
): DetectedPlotter | null {
	if (vendorId === undefined && productId === undefined) return null;
	return matchByUsbVid(vendorId, productId);
}

function matchByUsbVid(
	vid?: number,
	pid?: number,
): DetectedPlotter {
	const vidHex = vid !== undefined
		? vid.toString(16).toUpperCase().padStart(4, "0")
		: "????";
	const pidHex = pid !== undefined
		? pid.toString(16).toUpperCase().padStart(4, "0")
		: "????";
	const rawId = `VID ${vidHex}:PID ${pidHex}`;

	if (vid !== undefined) {
		const mfr = USB_VID_TO_MANUFACTURER[vid];

		if (mfr) {
			// Try to find a brand-name preset for this manufacturer
			const preset = PLOTTER_PRESETS.find(
				(p) => p.manufacturer?.toLowerCase() === mfr.toLowerCase(),
			);

			if (preset) {
				// Exact VID match to a known brand preset
				return {
					preset,
					confidence: "exact-vid",
					source: "usb",
					detail: `${mfr} ${preset.model} — ${rawId}`,
				};
			}

			// Known serial bridge chip — descriptive note, fall back to generic preset
			const chipNote = SERIAL_BRIDGE_NOTES[mfr] ?? `${mfr} USB-serial adapter`;
			return {
				preset: PLOTTER_PRESETS[0],
				confidence: "generic",
				source: "usb",
				detail: `${chipNote} — ${rawId}`,
			};
		}
	}

	// Completely unrecognised VID — still surface whatever we have
	return {
		preset: PLOTTER_PRESETS[0],
		confidence: "generic",
		source: "usb",
		detail: vid !== undefined
			? `Unrecognized USB device — ${rawId}`
			: "USB device — no vendor ID available",
	};
}

// ─── Agent USB detection ──────────────────────
// The Cut Agent enumerates all OS serial ports and returns richer metadata
// (manufacturer string, product name) than Web Serial exposes.
export async function detectAgentPorts(
	agentUrl: string,
): Promise<DetectedPlotter[]> {
	try {
		const res = await fetch(
			`${agentUrl.replace(/\/$/, "")}/api/ports`,
			{ signal: AbortSignal.timeout(3000) },
		);
		if (!res.ok) return [];

		const ports: Array<{
			name: string;
			isUSB: boolean;
			vendorId?: string;
			productId?: string;
			product?: string;
			manufacturer?: string;
		}> = await res.json();

		const results: DetectedPlotter[] = [];
		for (const port of ports) {
			// Only consider USB ports — RS-232 adapters are not plotters
			if (!port.isUSB) continue;

			const detected = matchByAgentPort(port);
			if (detected) results.push({ ...detected, portPath: port.name });
		}
		return results;
	} catch {
		return [];
	}
}

function matchByAgentPort(port: {
	name: string;
	vendorId?: string;
	productId?: string;
	product?: string;
	manufacturer?: string;
}): DetectedPlotter | null {
	// 1. Try USB VID from the agent's hex string ("09CA")
	if (port.vendorId) {
		const vid = parseInt(port.vendorId, 16);
		const mfr = USB_VID_TO_MANUFACTURER[vid];
		if (mfr) {
			const preset = PLOTTER_PRESETS.find(
				(p) => p.manufacturer?.toLowerCase() === mfr.toLowerCase(),
			);
			if (preset) {
				return {
					preset,
					confidence: "exact-vid",
					source: "agent-usb",
					detail: `${preset.name} — ${port.name}`,
				};
			}
			// Bridge chip — show chip name + port path
			const chipNote = SERIAL_BRIDGE_NOTES[mfr] ?? `${mfr} USB-serial`;
			return {
				preset: PLOTTER_PRESETS[0],
				confidence: "generic",
				source: "agent-usb",
				detail: `${chipNote} — ${port.name}`,
			};
		}
	}

	// 2. Try manufacturer/product string matching
	const combined = `${port.manufacturer ?? ""} ${port.product ?? ""}`.toLowerCase().trim();
	if (combined) {
		for (const preset of PLOTTER_PRESETS) {
			if (!preset.manufacturer || preset.manufacturer === "Generic") continue;
			if (combined.includes(preset.manufacturer.toLowerCase())) {
				return {
					preset,
					confidence: "manufacturer-name",
					source: "agent-usb",
					detail: `${port.manufacturer ?? "Unknown"} ${port.product ?? ""} — ${port.name}`.trim(),
				};
			}
		}
	}

	// 3. Generic USB device — show it but mark unknown
	return {
		preset: PLOTTER_PRESETS[0],
		confidence: "generic",
		source: "agent-usb",
		detail: `USB device — ${port.name}${port.manufacturer ? ` (${port.manufacturer})` : ""}`,
	};
}

// ─── Agent network scan ───────────────────────
// Asks the Cut Agent to probe the local LAN for devices on port 9100 (HP JetDirect)
// and port 5000 (some Roland/Graphtec network models).
// Returns discovered IPs — user selects one for TCP/IP direct connection.
export async function scanNetworkViaAgent(
	agentUrl: string,
): Promise<NetworkDevice[]> {
	try {
		const res = await fetch(
			`${agentUrl.replace(/\/$/, "")}/api/network-scan`,
			{ signal: AbortSignal.timeout(20_000) }, // scan can take up to ~10s
		);
		if (!res.ok) return [];
		return res.json();
	} catch {
		return [];
	}
}

// ─── Compatibility check ──────────────────────

export type CompatibilityStatus = "ok" | "tight" | "overflow";

/**
 * Returns whether the material roll fits within the plotter's cutting zone.
 * "tight" = within 5% of the limit (close but technically fits).
 * "overflow" = material is wider than the plotter can cut.
 */
export function getCompatibilityStatus(
	maxMediaWidthMm: number,
	materialWidthInches: number,
): CompatibilityStatus {
	const materialMm = materialWidthInches * 25.4;
	if (materialMm > maxMediaWidthMm) return "overflow";
	if (materialMm > maxMediaWidthMm * 0.95) return "tight";
	return "ok";
}

export function compatLabel(status: CompatibilityStatus): string {
	if (status === "ok") return "Compatible";
	if (status === "tight") return "Near limit";
	return "Too wide";
}
