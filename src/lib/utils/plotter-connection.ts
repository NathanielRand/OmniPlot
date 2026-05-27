// ─────────────────────────────────────────────
// OmniPlot — PLOTTER CONNECTION
//
// Dispatches HPGL jobs to:
//   usb-serial  — Web Serial API (Chrome/Edge)
//   network     — TCP via SvelteKit server endpoint
//   cut-agent   — Local OmniPlot Cut Agent daemon
//   download    — not handled here; caller uses downloadHpgl()
//
// OmniPlot Cut Agent Protocol v1
//   POST {agentUrl}/api/cut
//   Body: { hpgl: string, config: { baudRate: number, serialPort: string } }
//   Response 200: { ok: true, bytesWritten: number }
//   Response 4xx/5xx: { error: string }
//   CORS: agent must include Access-Control-Allow-Origin: *
// ─────────────────────────────────────────────
import type { PlotterConfig } from "$lib/types";
import { classifyError, type PlotterDiagnostic } from "./plotter-errors";

export type SendResult = { ok: true } | { ok: false; diagnostic: PlotterDiagnostic };

// ─── Web Serial port cache ────────────────────
// Survives across handleCut calls in a session so the browser
// doesn't re-prompt for port selection on every job.
let _cachedPort: any | null = null;

export type SerialPortInfo = { label: string; vendorId?: number; productId?: number };

// Requests a port (shows browser dialog) and caches it.
// Returns the port info for display. Call from a user-gesture handler.
export async function connectSerialPort(baudRate: number): Promise<SerialPortInfo> {
    if (!("serial" in navigator)) {
        throw new Error("Web Serial is only available in Chrome or Edge.");
    }
    const serial = (navigator as any).serial;
    const port = await serial.requestPort();
    _cachedPort = port;

    if (!port.readable) {
        await port.open({
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "none",
        });
    }

    const info = port.getInfo?.() ?? {};
    return {
        label: info.usbVendorId
            ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`
            : "Serial port",
        vendorId: info.usbVendorId,
        productId: info.usbProductId,
    };
}

export function disconnectSerialPort(): void {
    try { _cachedPort?.close?.(); } catch { /* ignore */ }
    _cachedPort = null;
}

export function isSerialConnected(): boolean {
    return !!_cachedPort;
}

// ─── Settings-only HPGL ──────────────────────
// Builds a minimal HPGL string containing only speed + force commands.
// Does NOT include IN; (which would reset the plotter) or SP1;/PA;.
// Sent immediately when sliders change to update the plotter in real-time.
function buildSettingsHpgl(config: PlotterConfig): string {
    // Speed
    const speed = config.protocol === "hpgl"
        ? config.cuttingSpeed
        : Math.max(1, Math.round(config.cuttingSpeed / 10));
    const speedCmd = `VS${speed};`;

    // Force (protocol-dependent)
    let forceCmd = "";
    switch (config.protocol) {
        case "hpgl2": {
            const fc = Math.max(0, Math.min(38, Math.round((config.bladeForce - 10) / 15.8)));
            forceCmd = `FC${fc};`;
            break;
        }
        case "gpgl":
            break; // force is device-side only on Silhouette
        default:
            forceCmd = `FS${config.bladeForce};`;
    }

    return speedCmd + forceCmd;
}

// Sends only speed + force to the plotter without starting a full cut job.
// Call this (debounced) from slider oninput handlers.
// Failures are returned as SendResult — callers should log silently rather
// than showing the full diagnostic panel (this is a background operation).
export async function sendSettings(config: PlotterConfig): Promise<SendResult> {
    if (config.connection === "download") return { ok: true };
    const hpgl = buildSettingsHpgl(config);
    if (!hpgl) return { ok: true };
    return sendToPlotter(hpgl, config);
}

// ─── Main dispatch ────────────────────────────
export async function sendToPlotter(
    hpgl: string,
    config: PlotterConfig,
): Promise<SendResult> {
    switch (config.connection) {
        case "usb-serial": return sendViaSerial(hpgl, config);
        case "network":    return sendViaNetwork(hpgl, config);
        case "cut-agent":  return sendViaAgent(hpgl, config);
        default:
            return {
                ok: false,
                diagnostic: classifyError("Use Download to save a PLT file.", config.connection),
            };
    }
}

// ─── USB-Serial (Web Serial API) ─────────────
async function sendViaSerial(hpgl: string, config: PlotterConfig): Promise<SendResult> {
    if (!("serial" in navigator)) {
        return {
            ok: false,
            diagnostic: classifyError("Web Serial is only available in Chrome or Edge.", "usb-serial"),
        };
    }
    try {
        if (!_cachedPort) {
            const info = await connectSerialPort(config.baudRate ?? 9600);
            void info; // port is cached as side effect
        }
        const port = _cachedPort!;

        // Re-open if the port was closed (e.g. plotter was power-cycled)
        if (!port.readable || port.readable.locked === false && !port.writable) {
            await port.open({
                baudRate: config.baudRate ?? 9600,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                flowControl: "none",
            });
        }

        const writer = port.writable.getWriter();
        try {
            const bytes = new TextEncoder().encode(hpgl);
            // 4 KB chunks — conservative for plotter receive buffers
            const CHUNK = 4096;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                await writer.write(bytes.slice(i, i + CHUNK));
            }
        } finally {
            writer.releaseLock();
        }
        return { ok: true };
    } catch (err: any) {
        if (err?.name === "NetworkError" || err?.name === "InvalidStateError") {
            _cachedPort = null; // force re-selection next time
        }
        return {
            ok: false,
            diagnostic: classifyError(err?.message ?? "Serial send failed.", "usb-serial"),
        };
    }
}

// ─── Network / TCP ────────────────────────────
// Browsers can't open raw TCP sockets, so this posts to a SvelteKit
// server endpoint that proxies the HPGL data over TCP to the plotter.
// Most network plotters listen on port 9100 (HP JetDirect).
async function sendViaNetwork(hpgl: string, config: PlotterConfig): Promise<SendResult> {
    const host = config.ipAddress?.trim() || "192.168.1.100";
    const port = config.port ?? 9100;
    try {
        const res = await fetch("/api/plotter/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hpgl, host, port }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            return {
                ok: false,
                diagnostic: classifyError(body.error ?? `HTTP ${res.status}`, "network", res.status),
            };
        }
        return { ok: true };
    } catch (err: any) {
        return {
            ok: false,
            diagnostic: classifyError(err?.message ?? "Network send failed.", "network"),
        };
    }
}

// ─── Cut-Agent ────────────────────────────────
// Posts to a local OmniPlot Cut Agent daemon. The agent accepts HPGL
// over HTTP and forwards it to the plotter via USB/serial on the host OS,
// bypassing browser Web Serial limitations and avoiding needing Chrome.
async function sendViaAgent(hpgl: string, config: PlotterConfig): Promise<SendResult> {
    const base = (config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
    try {
        const res = await fetch(`${base}/api/cut`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                hpgl,
                config: {
                    baudRate: config.baudRate ?? 9600,
                    serialPort: config.serialPort ?? "auto",
                },
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `Agent error ${res.status}` }));
            return {
                ok: false,
                diagnostic: classifyError(
                    body.error ?? `Agent error ${res.status}`,
                    "cut-agent",
                    res.status,
                ),
            };
        }
        return { ok: true };
    } catch (err: any) {
        const isNetworkErr =
            err?.message?.includes("fetch") ||
            err?.name === "TypeError" ||
            err?.message?.includes("Failed to fetch");
        const msg = isNetworkErr
            ? `OmniPlot Cut Agent not reachable at ${base}. Is the agent running?`
            : (err?.message ?? "Agent send failed.");
        return {
            ok: false,
            diagnostic: classifyError(msg, "cut-agent"),
        };
    }
}
