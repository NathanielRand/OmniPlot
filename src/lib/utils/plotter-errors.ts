// ─────────────────────────────────────────────
// OmniPlot — PLOTTER ERROR CATALOG
//
// Structured diagnostics for every known plotter connection failure.
// Each entry carries a user-friendly title, an explanatory message,
// ordered fix steps, and an `escalate` flag that signals whether
// the failure is likely an OmniPlot bug (true) vs. a user/env issue (false).
//
// Usage:
//   const diag = classifyError(rawErrorString, connectionType, httpStatus?);
//   // → PlotterDiagnostic ready to display + optionally log to admin
// ─────────────────────────────────────────────
import type { PlotterConnection } from "$lib/types";

// ─── Error codes ──────────────────────────────
export type PlotterErrorCode =
	// Network (TCP via SvelteKit proxy)
	| "NET_REFUSED"        // ECONNREFUSED — nothing listening on IP:port
	| "NET_TIMEOUT"        // ETIMEDOUT — IP unreachable or firewall dropping silently
	| "NET_NOT_FOUND"      // ENOTFOUND — hostname can't be resolved
	| "NET_HTTP"           // generic HTTP error from server proxy
	// Cut Agent
	| "AGENT_OFFLINE"      // agent process not running / not reachable
	| "AGENT_PORT_BUSY"    // serial port held by another process
	| "AGENT_PORT_MISSING" // serial port path not found on OS
	| "AGENT_HPGL_REJECT"  // agent/plotter rejected HPGL (potential OmniPlot bug)
	| "AGENT_ERROR"        // other 4xx/5xx from agent
	// USB-Serial (Web Serial API)
	| "SERIAL_BROWSER"     // not Chrome/Edge — Web Serial unavailable
	| "SERIAL_NO_PORT"     // user cancelled port selection dialog
	| "SERIAL_PERMISSION"  // OS denied serial port access
	| "SERIAL_BUSY"        // port already open by another application
	| "SERIAL_DISCONNECT"  // port closed mid-job (cable or power-cycle)
	// Protocol / Compatibility
	| "PROTO_GPGL"         // Silhouette proprietary GPGL, not standard HPGL
	| "COMPAT_WIDTH"       // material wider than plotter's max cutting width
	// Generic
	| "UNKNOWN";

// ─── Diagnostic object ────────────────────────
export interface PlotterDiagnostic {
	code: PlotterErrorCode;
	title: string;
	message: string;
	steps: string[];
	/** true = likely an OmniPlot bug — auto-report to admin. false = user/env issue. */
	escalate: boolean;
	/** Original raw error string, preserved for logging. */
	raw?: string;
}

// ─── Catalog ──────────────────────────────────
type CatalogEntry = Omit<PlotterDiagnostic, "code" | "raw">;
type Catalog = Record<Exclude<PlotterErrorCode, "UNKNOWN">, CatalogEntry>;

const CATALOG: Catalog = {
	// ── Network ────────────────────────────────────────────────────────────
	NET_REFUSED: {
		title: "Connection refused",
		message: "Nothing is accepting connections at the configured IP and port. The plotter's network interface may be off or misconfigured.",
		steps: [
			"Confirm the plotter is fully powered on and has completed its boot sequence.",
			"Open the plotter's Network / Interface menu and verify the displayed IP matches the address in OmniPlot.",
			"Make sure TCP/IP printing is enabled on the plotter — sometimes labeled 'JetDirect', 'RAW printing', or 'Port 9100'.",
			"From your terminal, run: ping <plotter-ip> — if that fails, the plotter isn't reachable at the network level.",
			"Check for a firewall rule blocking port 9100 between the OmniPlot server and the plotter.",
		],
		escalate: false,
	},
	NET_TIMEOUT: {
		title: "Connection timed out",
		message: "The plotter's IP address is not responding. It may be on a different network segment, powered off, or a firewall is silently dropping packets.",
		steps: [
			"Verify the plotter and your computer are on the same LAN or VLAN.",
			"Print a plotter status / network config sheet (on most Roland/Graphtec units: hold FORM FEED at power-on) to confirm the actual IP.",
			"If the plotter is on Wi-Fi, switch to a wired Ethernet connection for more reliable communication.",
			"Restart the plotter and wait 60 seconds for its network interface to fully initialize before retrying.",
			"Check your router or managed switch for VLAN isolation between devices.",
		],
		escalate: false,
	},
	NET_NOT_FOUND: {
		title: "Hostname not found",
		message: "The plotter hostname couldn't be resolved to an IP address. Use a numeric IP address instead.",
		steps: [
			"Replace the hostname with the plotter's numeric IP address (e.g., 192.168.1.50).",
			"To prevent IP changes on reboot, assign a DHCP reservation in your router using the plotter's MAC address.",
		],
		escalate: false,
	},
	NET_HTTP: {
		title: "Network send error",
		message: "The OmniPlot server returned an error while forwarding the job to the plotter.",
		steps: [
			"Check the plotter's front panel for any error indicator lights or messages.",
			"Confirm the plotter is not paused, out of media, or showing a media jam error.",
			"Retry the job — brief TCP errors on a busy network are common.",
		],
		escalate: true,
	},

	// ── Cut Agent ──────────────────────────────────────────────────────────
	AGENT_OFFLINE: {
		title: "Cut Agent not running",
		message: "OmniPlot can't reach the Cut Agent on your local machine. The agent must be running to send jobs over USB.",
		steps: [
			"Open the OmniPlot Cut Agent application on your computer — the system tray or menu bar icon should show 'Running'.",
			"If you closed it, relaunch it from your Applications folder or taskbar.",
			"Verify the Agent URL in Plotter Settings matches where the agent is listening (default: http://localhost:7878).",
			"If you're on a corporate network, confirm the browser isn't blocking localhost requests via a proxy or content security policy.",
		],
		escalate: false,
	},
	AGENT_PORT_BUSY: {
		title: "Serial port in use",
		message: "The configured serial port is already held open by another application.",
		steps: [
			"Close any other software that communicates with the plotter (e.g., Roland VersaWorks, Graphtec Studio, CutStudio, or a terminal emulator).",
			"macOS/Linux: run lsof | grep ttyUSB or lsof | grep ttyACM in Terminal to identify the process holding the port.",
			"Windows: open Device Manager → Ports, or use a tool like CurrPorts to find what has the COM port open.",
			"Restart the Cut Agent after freeing the port.",
		],
		escalate: false,
	},
	AGENT_PORT_MISSING: {
		title: "Serial port not found",
		message: "The configured serial port path doesn't exist on this machine.",
		steps: [
			"Unplug and re-plug the USB cable on both ends, then wait 5 seconds.",
			"On macOS the port is usually /dev/tty.usbserial-XXXXX — on Linux /dev/ttyUSB0 or /dev/ttyACM0 — on Windows COM3 or similar.",
			"Linux: add your user to the dialout group: sudo usermod -aG dialout $USER, then log out and back in.",
			"Use the 'Auto-detect' button on the Plotters page to rediscover the correct port path.",
		],
		escalate: false,
	},
	AGENT_HPGL_REJECT: {
		title: "Plotter rejected the job",
		message: "The plotter did not acknowledge the HPGL data, or the agent reported a protocol-level error.",
		steps: [
			"Check the plotter's control panel for an error code or status message.",
			"Confirm the blade force and cutting speed in your plotter settings are within the supported range for your model.",
			"Run the plotter's built-in self-test pattern (usually a button-hold at power-on) to confirm the plotter itself is operational.",
		],
		escalate: true,
	},
	AGENT_ERROR: {
		title: "Cut Agent error",
		message: "The Cut Agent returned an unexpected error while processing the job.",
		steps: [
			"Check the live agent log panel on the Plotters page for the specific error message.",
			"Restart the Cut Agent and retry.",
			"Ensure you're running the latest version of the OmniPlot Cut Agent.",
		],
		escalate: true,
	},

	// ── USB-Serial ─────────────────────────────────────────────────────────
	SERIAL_BROWSER: {
		title: "Browser not supported",
		message: "Web Serial (direct USB access) is only available in Google Chrome and Microsoft Edge.",
		steps: [
			"Switch to Google Chrome or Microsoft Edge and reload OmniPlot.",
			"Alternatively, install the OmniPlot Cut Agent — it handles USB connections from any browser.",
		],
		escalate: false,
	},
	SERIAL_NO_PORT: {
		title: "No port selected",
		message: "The USB port selection was cancelled. A port must be chosen to send via Web Serial.",
		steps: [
			"Click 'Cut' again and pick your plotter from the browser's port picker dialog.",
			"If your plotter doesn't appear, unplug and re-plug the USB cable and try again.",
		],
		escalate: false,
	},
	SERIAL_PERMISSION: {
		title: "Serial port access denied",
		message: "The operating system denied the browser's request to open the USB serial port.",
		steps: [
			"Linux: add your user to the dialout group: sudo usermod -aG dialout $USER, then log out and back in.",
			"macOS: check System Settings → Privacy & Security for USB or automation access.",
			"Windows: try running Chrome as Administrator as a temporary diagnostic step.",
		],
		escalate: false,
	},
	SERIAL_BUSY: {
		title: "Port already in use",
		message: "The USB port is locked by another application.",
		steps: [
			"Close any other software that communicates with the plotter.",
			"Disconnect and reconnect the USB cable to reset the port lock.",
			"Refresh the browser page and try again.",
		],
		escalate: false,
	},
	SERIAL_DISCONNECT: {
		title: "Connection lost mid-job",
		message: "The USB connection dropped while the job was being sent. The cut may be incomplete.",
		steps: [
			"Check the USB cable — try a different, shorter, or higher-quality cable.",
			"Plug directly into a USB port on the computer rather than a hub or dock.",
			"Check the plotter's panel — you may need to cancel the partial job before retrying.",
			"Send the job again once the connection is stable.",
		],
		escalate: false,
	},

	// ── Protocol / Compatibility ────────────────────────────────────────────
	PROTO_GPGL: {
		title: "Proprietary protocol",
		message: "This plotter uses Silhouette's proprietary GPGL protocol. Standard HPGL commands may not work correctly.",
		steps: [
			"Use Download mode to export a .plt file, then open it in Silhouette Studio.",
			"Alternatively, select the Cut Agent connection — it may support GPGL translation for your model.",
			"Double-check that the correct plotter preset is selected for your specific Silhouette model.",
		],
		escalate: true,
	},
	COMPAT_WIDTH: {
		title: "Material too wide",
		message: "The configured sheet width exceeds this plotter's maximum cutting area.",
		steps: [
			"Reduce the sheet width in Studio to fit within the plotter's maximum cutting width.",
			"Use a plotter with a wider cutting area, or split the layout across multiple narrower sheets.",
		],
		escalate: false,
	},
};

const UNKNOWN_ENTRY: CatalogEntry = {
	title: "Unexpected error",
	message: "An unrecognized error occurred while sending the job.",
	steps: [
		"Check the Cut Agent log panel on the Plotters page for more detail.",
		"Confirm the plotter is powered on and not showing an error state.",
		"Retry the job. If the problem persists, use the Report button — our team will investigate.",
	],
	escalate: true,
};

// ─── Classifier ───────────────────────────────
/**
 * Maps a raw error string + connection context to a structured PlotterDiagnostic.
 * Pass the HTTP status when available for more accurate network error classification.
 */
export function classifyError(
	rawError: string,
	connection: PlotterConnection,
	httpStatus?: number,
): PlotterDiagnostic {
	const e = rawError.toLowerCase();

	if (connection === "network") {
		if (e.includes("econnrefused") || httpStatus === 502) return make("NET_REFUSED", rawError);
		if (e.includes("etimedout") || e.includes("timed out") || httpStatus === 504) return make("NET_TIMEOUT", rawError);
		if (e.includes("enotfound") || e.includes("getaddrinfo")) return make("NET_NOT_FOUND", rawError);
		if (httpStatus && httpStatus >= 400) return make("NET_HTTP", rawError);
	}

	if (connection === "cut-agent") {
		if (
			e.includes("not reachable") ||
			e.includes("failed to fetch") ||
			e.includes("networkerror") ||
			e.includes("econnrefused") ||
			(e.includes("fetch") && e.includes("error"))
		) return make("AGENT_OFFLINE", rawError);
		if (e.includes("busy") || e.includes("in use")) return make("AGENT_PORT_BUSY", rawError);
		if (
			(e.includes("port") || e.includes("tty") || e.includes("com")) &&
			(e.includes("not found") || e.includes("no such file"))
		) return make("AGENT_PORT_MISSING", rawError);
		if (e.includes("hpgl") || e.includes("invalid command") || e.includes("parse error")) return make("AGENT_HPGL_REJECT", rawError);
		if (httpStatus && httpStatus >= 400) return make("AGENT_ERROR", rawError);
	}

	if (connection === "usb-serial") {
		if (e.includes("web serial") || (e.includes("chrome") && e.includes("edge"))) return make("SERIAL_BROWSER", rawError);
		if (e.includes("aborted") || e.includes("cancelled") || e.includes("canceled")) return make("SERIAL_NO_PORT", rawError);
		if (e.includes("permission") || e.includes("denied") || e.includes("access")) return make("SERIAL_PERMISSION", rawError);
		if (e.includes("busy") || e.includes("in use") || e.includes("locked")) return make("SERIAL_BUSY", rawError);
		if (e.includes("networkerror") || e.includes("invalidstateerror") || e.includes("disconnected")) return make("SERIAL_DISCONNECT", rawError);
	}

	if (e.includes("gpgl") || e.includes("silhouette")) return make("PROTO_GPGL", rawError);

	return { code: "UNKNOWN", ...UNKNOWN_ENTRY, raw: rawError };
}

function make(code: Exclude<PlotterErrorCode, "UNKNOWN">, raw: string): PlotterDiagnostic {
	return { code, ...CATALOG[code], raw };
}
