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
import type { PlotterConfig, CanvasState } from "$lib/types";
import { classifyError, type PlotterDiagnostic } from "./plotter-errors";
import { generateHpglSegments } from "./hpgl";

export type SendResult = { ok: true } | { ok: false; diagnostic: PlotterDiagnostic };

// Progress reported after each pattern segment is sent to the plotter.
export interface CutProgress {
    sent: number;              // patterns successfully flushed to plotter
    total: number;             // total patterns in the job
    label: string;             // name of the pattern just sent
    lastCompletedIndex: number; // 0-based index of the last pattern confirmed sent (-1 = none)
}
export type ProgressCallback = (p: CutProgress) => void;

// Segmented send for USB-serial: sends preamble + each pattern individually.
// Correctly avoids splitting HPGL commands across write boundaries.
// onProgress is called after each pattern is flushed so the caller can checkpoint.
// Returns { completedCount } so the caller knows exactly where to resume on failure.
export async function sendToPlotterSegmented(
    state: CanvasState,
    config: PlotterConfig,
    onProgress?: ProgressCallback,
): Promise<SendResult & { completedCount: number }> {
    // Flush any leftover state from a previous or interrupted job before starting.
    // Best-effort: don't block the new job if the plotter isn't responding yet.
    if (config.connection !== "download") {
        await sendToPlotter(ABORT_HPGL, config).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
    }

    if (config.connection !== "usb-serial") {
        // Non-USB connections don't support streaming — fall back to monolithic send
        const { generateHpgl } = await import("./hpgl");
        const hpgl = generateHpgl(state, config);
        const result = await sendToPlotter(hpgl, config);
        const total = state.items.filter((i) => !i.outOfBounds).length;
        return { ...result, completedCount: result.ok ? total : 0 };
    }
    return _sendViaSerialSegmented(state, config, onProgress);
}

// ─── Web Serial port cache ────────────────────
// Survives across handleCut calls in a session so the browser
// doesn't re-prompt for port selection on every job.
let _cachedPort: any | null = null;

export type SerialPortInfo = { label: string; vendorId?: number; productId?: number };

// Silently reconnects to the first previously-authorized port without showing
// the browser selection dialog. Called on page mount to restore a USB connection
// that was active before navigation. Returns null if no port is available.
export async function reconnectSerialPort(baudRate: number): Promise<SerialPortInfo | null> {
    if (!("serial" in navigator)) return null;
    try {
        const serial = (navigator as any).serial;
        const ports: any[] = await serial.getPorts();
        if (!ports.length) return null;
        const port = ports[0];
        _cachedPort = port;
        await _ensurePortOpen(port, baudRate);
        const info = port.getInfo?.() ?? {};
        return {
            label: info.usbVendorId
                ? `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`
                : "Serial port",
            vendorId: info.usbVendorId,
            productId: info.usbProductId,
        };
    } catch {
        _cachedPort = null;
        return null;
    }
}

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
// Does NOT include IN; (which resets position) or SP1;/PA;.
// Sent immediately when sliders change to update the plotter in real-time.
//
// Speed units:
//   "roland"  → VS in mm/s (Roland CAMM-1 firmware extension)
//   all others → VS in cm/s (standard HPGL spec; applies to VEVOR, USCutter, GCC, Graphtec, etc.)
//
// Force units:
//   "hpgl2"  → FC 0–38 (Graphtec/Summa units, ~15.8 g/unit)
//   "gpgl"   → no command (Silhouette — force is front-panel only)
//   all others → FS in grams (hpgl, roland)
//
// Note: passes and overcut are job-time parameters embedded in the cut paths.
// X/Y origin offset is applied via IP command in the full job preamble.
// Neither can be sent as a standalone live plotter command.
function buildSettingsHpgl(config: PlotterConfig): string {
    const speed = config.protocol === "roland"
        ? config.cuttingSpeed                              // mm/s — Roland extension
        : Math.max(1, Math.round(config.cuttingSpeed / 10)); // mm/s → cm/s standard HPGL
    const speedCmd = `VS${speed};`;

    let forceCmd = "";
    switch (config.protocol) {
        case "hpgl2": {
            const fc = Math.max(0, Math.min(38, Math.round((config.bladeForce - 10) / 15.8)));
            forceCmd = `FC${fc};`;
            break;
        }
        case "gpgl":
            break;
        default: // hpgl, roland
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

// ─── Abort / flush ────────────────────────────
// CAN (\x18) clears the plotter's pending input buffer; IN; re-initializes.
// Sent before every new job via sendToPlotterSegmented, and available as a
// standalone call from the Plotter page's "Flush" button.
const ABORT_HPGL = "\x18IN;\n";

export async function flushPlotter(config: PlotterConfig): Promise<SendResult> {
    if (config.connection === "download") return { ok: true };
    return sendToPlotter(ABORT_HPGL, config);
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
// Monolithic send — used for settings-only sends (force/speed) where segmentation
// is unnecessary. Individual HPGL commands are short so no split-command risk.
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
            void info;
        }
        const port = _cachedPort!;
        await _ensurePortOpen(port, config.baudRate ?? 9600);
        await _writeString(port.writable, hpgl);
        return { ok: true };
    } catch (err: any) {
        if (err?.name === "NetworkError" || err?.name === "InvalidStateError") {
            _cachedPort = null;
        }
        return {
            ok: false,
            diagnostic: classifyError(err?.message ?? "Serial send failed.", "usb-serial"),
        };
    }
}

// Segmented serial send — one pattern at a time with a 60ms inter-pattern pause.
// Prevents HPGL command splitting and plotter buffer overflow.
async function _sendViaSerialSegmented(
    state: CanvasState,
    config: PlotterConfig,
    onProgress?: ProgressCallback,
): Promise<SendResult & { completedCount: number }> {
    if (!("serial" in navigator)) {
        return {
            ok: false,
            diagnostic: classifyError("Web Serial is only available in Chrome or Edge.", "usb-serial"),
            completedCount: 0,
        };
    }
    try {
        if (!_cachedPort) {
            await connectSerialPort(config.baudRate ?? 9600);
        }
        const port = _cachedPort!;
        await _ensurePortOpen(port, config.baudRate ?? 9600);

        const stream = generateHpglSegments(state, config);
        const total = stream.segments.length;
        let completedCount = 0;

        // Send preamble (setup commands: IN, VS, FS/FC, SP1, PA, [IP])
        await _writeString(port.writable, stream.preamble + "\n");

        for (let i = 0; i < stream.segments.length; i++) {
            const seg = stream.segments[i];
            // Each segment is a complete HPGL sequence for one pattern — no command splits
            await _writeString(port.writable, `\n; --- ${seg.label} ---\n${seg.hpgl}\n`);
            completedCount = i + 1;
            onProgress?.({
                sent: completedCount,
                total,
                label: seg.label,
                lastCompletedIndex: i,
            });
            // 60ms pause lets the plotter finish buffering before the next pattern arrives.
            // This prevents buffer overflow on plotters without hardware flow control.
            if (i < stream.segments.length - 1) {
                await new Promise((r) => setTimeout(r, 60));
            }
        }

        await _writeString(port.writable, "\n" + stream.epilogue + "\n");
        return { ok: true, completedCount };
    } catch (err: any) {
        if (err?.name === "NetworkError" || err?.name === "InvalidStateError") {
            _cachedPort = null;
        }
        return {
            ok: false,
            diagnostic: classifyError(err?.message ?? "Serial send failed.", "usb-serial"),
            completedCount: 0,
        };
    }
}

async function _ensurePortOpen(port: any, baudRate: number): Promise<void> {
    if (!port.readable || (!port.readable.locked && !port.writable)) {
        await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    }
}

async function _writeString(writable: WritableStream<Uint8Array>, str: string): Promise<void> {
    const writer = writable.getWriter();
    try {
        await writer.write(new TextEncoder().encode(str));
    } finally {
        writer.releaseLock();
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

// ─── Agent bidirectional query ────────────────
// Sends a raw HPGL command to the plotter via the Cut Agent and reads back
// the response. Used for calibration queries such as OA (Output Actual Position).
// Only works when connection === "cut-agent".
export interface QueryResult {
    ok: boolean;
    response?: string;
    port?: string;
    error?: string;
}

export async function queryPlotter(
    command: string,
    config: PlotterConfig,
    timeoutMs = 3000,
): Promise<QueryResult> {
    const base = (config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "");
    try {
        const res = await fetch(`${base}/api/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                command,
                serialPort: config.serialPort ?? "auto",
                baudRate:   config.baudRate   ?? 9600,
                timeoutMs,
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `Agent error ${res.status}` }));
            return { ok: false, error: body.error ?? `Agent error ${res.status}` };
        }
        const data = await res.json();
        return { ok: true, response: data.response ?? "", port: data.port };
    } catch (err: any) {
        return { ok: false, error: err?.message ?? "Agent not reachable" };
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
