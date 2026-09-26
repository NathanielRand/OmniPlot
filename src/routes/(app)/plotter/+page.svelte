<svelte:head>
	<title>Plotters — OmniPlot</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { userStore, toastStore, plotterStore, agentStore, cutJobStore, platformStore, plotterHistoryStore } from "$lib/stores";
	import { PLOTTER_PRESETS } from "$lib/config";
	import { tooltip } from "$lib/actions/tooltip";
	import {
		getUserPlotters,
		savePlotter,
		deletePlotter,
		logPlotterError,
	} from "$lib/firebase/firestore";
	import {
		detectUsbPlotters,
		detectAgentPorts,
		scanNetworkViaAgent,
		matchPortToPreset,
		listLiveDevices,
	} from "$lib/utils/plotter-detect";
	import {
		sendToPlotter, flushPlotter, connectSerialPort, openAuthorizedSerial,
		getOpenSerialPortInfo, disconnectSerialPort, releaseAgentPort,
	} from "$lib/utils/plotter-connection";
	import {
		findLiveFor, formatUsbId, timeAgo,
		type PlotterHistoryEntry, type LiveDevice, type ConnectInput,
	} from "$lib/utils/plotter-history";
	import type { PlotterDiagnostic } from "$lib/utils/plotter-errors";
	import PlotterDiagPanel from "$lib/components/ui/PlotterDiagPanel.svelte";
	import type { PlotterDevice, PlotterConnection, PlotterConfig, CutJob } from "$lib/types";
	import type { NetworkDevice } from "$lib/utils/plotter-detect";

	// ─── Core state ──────────────────────────────
	let plotters  = $state<PlotterDevice[]>([]);
	let loading   = $state(true);
	let loadError = $state("");

	// ─── Cut Agent — shared agentStore ───────────
	const agentStatus  = $derived(agentStore.status);
	const agentVersion = $derived(agentStore.version);
	const agentUrl     = $derived(agentStore.url);

	// ─── Live log (SSE) ──────────────────────────
	interface LogEntry { time: string; type: string; message: string }
	let logs    = $state<LogEntry[]>([]);
	let sseConn = $state<EventSource | null>(null);

	// ─── UI state ────────────────────────────────
	let addOpen         = $state(false);
	let detecting       = $state(false);
	let networkScanning = $state(false);
	let networkDevices  = $state<NetworkDevice[]>([]);
	let confirmDelete   = $state<string | null>(null);
	let addStep         = $state<"form" | "detect">("form");

	// ─── Diagnostic panel ────────────────────────
	let diagData        = $state<PlotterDiagnostic | null>(null);
	let diagReported    = $state(false);
	let diagPlotter     = $state<PlotterDevice | null>(null);

	// ─── Add plotter form ────────────────────────
	let form = $state({
		name:       "",
		presetName: PLOTTER_PRESETS[0].name,
		connection: (platformStore.flags.cutAgent ? "cut-agent" : "usb-serial") as PlotterConnection,
		ipAddress:  "",
		port:       9100,
		serialPort: "",
		baudRate:   9600,
		agentUrl:   "http://localhost:7878",
		vendorId:   undefined as number | undefined,
		productId:  undefined as number | undefined,
	});

	// ─── Derived ─────────────────────────────────
	const jobs       = $derived(cutJobStore.jobs);
	const activeJobs = $derived(jobs.filter(j => j.status === "cutting" || j.status === "ready"));
	const recentJobs = $derived(jobs.filter(j => j.status === "complete" || j.status === "error" || j.status === "cancelled").slice(0, 10));
	const failedJobs = $derived(jobs.filter(j => j.status === "error").slice(0, 5));

	// Completed cuts today (local day), by when they finished — not by the
	// last write, which a later status change would move.
	const jobsToday = $derived(jobs.filter(j => {
		if (j.status !== "complete" || !j.completedAt) return false;
		const d = new Date(j.completedAt);
		const n = new Date();
		return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
	}).length);

	// Of the runs that ended on their own, how many finished. A run the user
	// cancelled isn't a plotter failure.
	const successRate = $derived(() => {
		const done = jobs.filter(j => j.status === "complete" || j.status === "error");
		if (!done.length) return 100;
		return Math.round((done.filter(j => j.status === "complete").length / done.length) * 100);
	});

	// ─── Agent polling ────────────────────────────
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function pollAgent() {
		if (!platformStore.flags.cutAgent) { agentStore.setOffline(); return; }
		try {
			const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
			if (res.ok) {
				const data = await res.json();
				agentStore.setOnline(data.version ?? "");
			} else {
				agentStore.setOffline();
			}
		} catch {
			agentStore.setOffline();
		}

		if (agentStore.status === "online") {
			try {
				const res = await fetch(`${agentUrl}/api/stats`, { signal: AbortSignal.timeout(3000) });
				if (res.ok) agentStore.setStats(await res.json());
			} catch { /* non-fatal */ }
		}
	}

	// ─── SSE connection ───────────────────────────
	function connectSSE() {
		if (sseConn) { sseConn.close(); sseConn = null; }
		if (agentStore.status !== "online") return;
		if (typeof EventSource === "undefined") return;

		const src = new EventSource(`${agentStore.url}/api/events`);
		sseConn = src;

		src.onmessage = (e) => {
			let type = "info", message = e.data;
			try {
				const p = JSON.parse(e.data);
				type = p.type ?? "info";
				message = p.message ?? e.data;
			} catch { /* raw text */ }
			const time = new Date().toLocaleTimeString([], { hour12: false });
			logs = [{ time, type, message }, ...logs].slice(0, 300);
		};

		src.onerror = () => {
			agentStore.setOffline();
			src.close();
			sseConn = null;
		};
	}

	$effect(() => {
		if (agentStore.status === "online" && !sseConn) connectSSE();
	});

	// ─── Data loading ─────────────────────────────
	async function loadAll() {
		const uid = userStore.user?.uid;
		if (!uid) { loading = false; return; }
		loading   = true;
		loadError = "";
		try {
			plotters = await getUserPlotters(uid);
		} catch (e) {
			loadError = e instanceof Error ? e.message : "Failed to load data.";
		} finally {
			loading = false;
		}
	}

	// ─── Auto-detect ─────────────────────────────
	async function handleDetect() {
		detecting = true;
		const detected = [...await detectUsbPlotters()];
		if (agentStore.status === "online") detected.push(...await detectAgentPorts(agentStore.url));

		const best = detected.find(d => d.confidence === "exact-vid") ??
			detected.find(d => d.confidence === "manufacturer-name");

		if (best) {
			form = { ...form, name: best.preset.name ?? "", presetName: best.preset.name ?? form.presetName,
				connection: best.source === "agent-usb" ? "cut-agent" : "usb-serial",
				vendorId: best.vendorId, productId: best.productId };
			toastStore.success("Plotter detected", best.detail);
		} else {
			toastStore.info("No plotter detected", "Try selecting your device manually.");
		}
		detecting = false;
	}

	// getPorts() only returns ports the browser has already been granted access
	// to, so it can't discover a plotter on its own — requestPort() is what
	// actually shows the browser's device picker for a new/unauthorized device.
	async function handleRequestUsbDevice() {
		try {
			const info = await connectSerialPort(form.baudRate);
			const match = matchPortToPreset(info.vendorId, info.productId);
			form = { ...form,
				name: (match?.preset.name ?? form.name) || "USB Plotter",
				presetName: match?.preset.name ?? form.presetName,
				connection: "usb-serial",
				vendorId: info.vendorId, productId: info.productId,
			};
			toastStore.success(match ? "Plotter detected" : "Device selected", match?.detail ?? info.label);
		} catch (err) {
			if (err instanceof Error && err.name === "NotFoundError") return; // user dismissed the picker
			toastStore.error("USB selection failed", err instanceof Error ? err.message : "");
		}
	}

	async function handleNetworkScan() {
		if (agentStore.status !== "online") {
			toastStore.error("Agent offline", "Start the Cut Agent to scan the network.");
			return;
		}
		networkScanning = true;
		networkDevices  = await scanNetworkViaAgent(agentUrl);
		networkScanning = false;
		if (!networkDevices.length) toastStore.info("No network plotters found", "No devices responded on port 9100 or 5000.");
	}

	function pickNetworkDevice(d: NetworkDevice) {
		form = { ...form, connection: "network", ipAddress: d.ip, port: d.port };
		toastStore.success("Address filled", `${d.ip}:${d.port}`);
	}

	// ─── Add plotter ─────────────────────────────
	async function handleAddPlotter() {
		const uid = userStore.user?.uid;
		if (!uid || !form.name.trim()) return;

		const preset = PLOTTER_PRESETS.find(p => p.name === form.presetName) ?? PLOTTER_PRESETS[0];
		const device: PlotterDevice = {
			id: crypto.randomUUID(), userId: uid,
			name: form.name.trim(), presetName: preset.name,
			manufacturer: preset.manufacturer ?? "", model: preset.model ?? "",
			protocol: preset.protocol ?? "hpgl", connection: form.connection,
			maxMediaWidthMm: preset.maxMediaWidthMm,
			ipAddress:  form.connection === "network"    ? form.ipAddress  : undefined,
			port:       form.connection === "network"    ? form.port       : undefined,
			serialPort: form.connection === "usb-serial" ? form.serialPort : undefined,
			baudRate:   form.baudRate || preset.baudRate,
			agentUrl:   form.connection === "cut-agent"  ? form.agentUrl   : undefined,
			compatNote: preset.compatNote,
			vendorId:   form.connection === "usb-serial" ? form.vendorId  : undefined,
			productId:  form.connection === "usb-serial" ? form.productId : undefined,
			lastConnectedAt: null,
			createdAt: new Date(), updatedAt: new Date(),
		};

		try {
			await savePlotter(device);
			plotters = [...plotters, device];
			addOpen = false;
			resetForm();
			toastStore.success("Plotter added", device.name);
		} catch (err) {
			toastStore.error("Failed to save", err instanceof Error ? err.message : "");
		}
	}

	function resetForm() {
		form = { name: "", presetName: PLOTTER_PRESETS[0].name, connection: platformStore.flags.cutAgent ? "cut-agent" : "usb-serial",
			ipAddress: "", port: 9100, serialPort: "", baudRate: 9600, agentUrl: "http://localhost:7878",
			vendorId: undefined, productId: undefined };
		networkDevices = [];
		addStep = "form";
	}

	// ─── Plotter actions ─────────────────────────
	async function handleDelete(id: string) {
		try {
			await deletePlotter(id);
			plotters = plotters.filter(p => p.id !== id);
			confirmDelete = null;
			toastStore.success("Plotter removed");
		} catch (err) {
			toastStore.error("Delete failed", err instanceof Error ? err.message : "");
		}
	}

	async function markConnected(plotter: PlotterDevice) {
		const now = new Date();
		plotters = plotters.map(p => p.id === plotter.id ? { ...p, lastConnectedAt: now } : p);
		try {
			await savePlotter({ ...plotter, lastConnectedAt: now });
		} catch {
			// Best-effort — active state is already applied locally
		}
	}

	// ─── Connect (fleet "Set active" + history) ───
	// One path for both: applies the plotter's model and route, opens USB
	// without a dialog when the port is already authorized (falling back to the
	// picker filtered to this plotter), and records it in plotter history so
	// the Studio resumes it automatically.
	let connectingKey = $state<string | null>(null);

	async function connectTarget(t: ConnectInput, busyKey: string): Promise<boolean> {
		const preset = PLOTTER_PRESETS.find(p => p.name === t.presetName) ?? PLOTTER_PRESETS[0];
		plotterHistoryStore.beginManual();
		connectingKey = busyKey;
		try {
			const baud = t.baudRate ?? preset.baudRate ?? 9600;
			let usb: { vendorId?: number; productId?: number } | null = null;
			if (t.connection === "usb-serial") {
				if (plotterStore.config.connection === "cut-agent") await releaseAgentPort(plotterStore.config);
				const id = t.vendorId !== undefined ? { vendorId: t.vendorId, productId: t.productId } : undefined;
				const res = await openAuthorizedSerial(baud, id);
				if (res.ok) {
					usb = res.info;
				} else if (res.reason === "busy" || res.reason === "unsupported") {
					toastStore.error(res.reason === "busy" ? "Port in use" : "Not supported", res.message);
					return false;
				} else {
					try {
						usb = await connectSerialPort(baud, id);
					} catch (err) {
						if (!(err instanceof Error) || (err.name !== "NotFoundError" && err.name !== "NotAllowedError")) {
							toastStore.error("Connection failed", err instanceof Error ? err.message : "Could not open the serial port.");
						}
						return false;
					}
				}
			} else if (getOpenSerialPortInfo()) {
				disconnectSerialPort(); // don't hold a COM port the agent may need
			}

			plotterStore.applyPreset(preset);
			plotterStore.switchConnection(t.connection);
			plotterStore.update({ baudRate: baud });
			if (t.connection === "cut-agent") plotterStore.update({ serialPort: t.serialPort || "auto", ...(t.agentUrl ? { agentUrl: t.agentUrl } : {}) });
			if (t.connection === "network")   plotterStore.update({ ipAddress: t.ipAddress, port: t.port ?? 9100 });
			if (usb) plotterStore.update({ vendorId: usb.vendorId, productId: usb.productId });
			plotterStore.persistConnSettings();
			plotterHistoryStore.recordConnect({ ...t, presetName: preset.name, baudRate: baud, ...(usb ? { vendorId: usb.vendorId, productId: usb.productId } : {}) });
			return true;
		} finally {
			connectingKey = null;
		}
	}

	async function handleSetActive(plotter: PlotterDevice) {
		if (plotter.connection === "download") {
			plotterStore.applyPreset(PLOTTER_PRESETS.find(p => p.name === plotter.presetName) ?? PLOTTER_PRESETS[0]);
			plotterStore.switchConnection("download");
			toastStore.success("Active plotter set", `${plotter.name} is now active in Studio.`);
			await markConnected(plotter);
			return;
		}
		const ok = await connectTarget({
			connection: plotter.connection,
			presetName: plotter.presetName, label: plotter.name, fleetId: plotter.id,
			vendorId: plotter.vendorId, productId: plotter.productId, serialPort: plotter.serialPort,
			agentUrl: plotter.agentUrl, ipAddress: plotter.ipAddress, port: plotter.port, baudRate: plotter.baudRate,
		}, plotter.id);
		if (!ok) return;
		toastStore.success(plotter.connection === "usb-serial" ? "Connected" : "Active plotter set", `${plotter.name} is now active in Studio.`);
		await markConnected(plotter);
		scanLive();
	}

	// ─── Plotter history ─────────────────────────
	let liveDevices = $state<LiveDevice[]>([]);
	let renamingKey = $state<string | null>(null);
	let renameValue = $state("");
	let confirmClearHistory = $state(false);

	async function scanLive() {
		liveDevices = await listLiveDevices(agentStore.status === "online" ? agentStore.url : null);
	}

	type Availability = "connected" | "available" | "absent" | "network";
	function historyAvailability(e: PlotterHistoryEntry): Availability {
		const c = plotterStore.config;
		if (e.connection === "network") {
			return c.connection === "network" && c.ipAddress === e.ipAddress && (c.port ?? 9100) === (e.port ?? 9100) ? "connected" : "network";
		}
		if (e.connection === "usb-serial") {
			const open = getOpenSerialPortInfo();
			if (c.connection === "usb-serial" && open && open.vendorId === e.vendorId && open.productId === e.productId) return "connected";
		}
		const live = findLiveFor(e, liveDevices);
		if (e.connection === "cut-agent" && live && c.connection === "cut-agent" && agentStore.status === "online" &&
			(c.serialPort === live.portPath || !c.serialPort || c.serialPort === "auto")) return "connected";
		return live ? "available" : "absent";
	}

	function availabilityLabel(a: Availability, e: PlotterHistoryEntry): string {
		if (a === "connected") return "Connected";
		if (a === "available") return "Available";
		if (a === "network") return "Network";
		return e.connection === "cut-agent" && agentStore.status !== "online" ? "Agent offline" : "Not detected";
	}

	function endLabel(e: PlotterHistoryEntry): string | null {
		if (!e.lastEndReason || !e.lastEndedAt) return null;
		const when = timeAgo(e.lastEndedAt);
		if (e.lastEndReason === "user") return `you disconnected ${when}`;
		if (e.lastEndReason === "lost") return `connection lost ${when}`;
		return `switched away ${when}`;
	}

	function viaLabel(e: PlotterHistoryEntry): string {
		if (e.connection === "network") return `${e.ipAddress}:${e.port ?? 9100}`;
		const id = formatUsbId(e.vendorId, e.productId);
		if (e.connection === "cut-agent") return [e.serialPort && e.serialPort !== "auto" ? e.serialPort : null, id ? `VID ${id}` : null].filter(Boolean).join(" · ") || "auto port";
		return id ? `VID ${id}` : "USB";
	}

	function fleetFor(e: PlotterHistoryEntry): PlotterDevice | null {
		if (e.fleetId) {
			const byId = plotters.find(p => p.id === e.fleetId);
			if (byId) return byId;
		}
		return plotters.find(p => p.connection === e.connection && (
			(e.connection === "usb-serial" && p.vendorId !== undefined && p.vendorId === e.vendorId && p.productId === e.productId) ||
			(e.connection === "network" && p.ipAddress === e.ipAddress && (p.port ?? 9100) === (e.port ?? 9100)) ||
			(e.connection === "cut-agent" && !!p.serialPort && p.serialPort === e.serialPort)
		)) ?? null;
	}

	function toInput(e: PlotterHistoryEntry): ConnectInput {
		return {
			connection: e.connection, presetName: e.presetName, label: e.label, fleetId: e.fleetId,
			vendorId: e.vendorId, productId: e.productId, serialPort: e.serialPort, agentUrl: e.agentUrl,
			ipAddress: e.ipAddress, port: e.port, baudRate: e.baudRate,
		};
	}

	async function handleHistoryConnect(e: PlotterHistoryEntry) {
		if (e.connection === "cut-agent") {
			const live = findLiveFor(e, liveDevices);
			if (!live) {
				toastStore.info("Plotter not found", agentStore.status === "online" ? "It isn't plugged into the Cut Agent's computer." : "Start the Cut Agent, then try again.");
				return;
			}
			if (!(await connectTarget({ ...toInput(e), serialPort: live.portPath }, e.key))) return;
		} else if (!(await connectTarget(toInput(e), e.key))) {
			return;
		}
		toastStore.success("Connected", `${e.label ?? e.presetName} is now active in Studio.`);
		const fleet = fleetFor(e);
		if (fleet) await markConnected(fleet);
		scanLive();
	}

	function handleHistoryDisconnect(e: PlotterHistoryEntry) {
		plotterHistoryStore.beginManual();
		if (e.connection === "usb-serial") disconnectSerialPort();
		plotterStore.switchConnection("download");
		plotterHistoryStore.recordDisconnect(e.key, "user");
		toastStore.info("Disconnected", `${e.label ?? e.presetName} won't reconnect automatically until you connect it again.`);
	}

	function startRename(e: PlotterHistoryEntry) {
		renamingKey = e.key;
		renameValue = e.label ?? "";
	}
	function commitRename() {
		if (renamingKey) plotterHistoryStore.rename(renamingKey, renameValue);
		renamingKey = null;
	}

	async function handleSaveToFleet(e: PlotterHistoryEntry) {
		const uid = userStore.user?.uid;
		if (!uid) return;
		const preset = PLOTTER_PRESETS.find(p => p.name === e.presetName) ?? PLOTTER_PRESETS[0];
		const device: PlotterDevice = {
			id: crypto.randomUUID(), userId: uid,
			name: e.label ?? preset.name, presetName: preset.name,
			manufacturer: preset.manufacturer ?? "", model: preset.model ?? "",
			protocol: preset.protocol ?? "hpgl", connection: e.connection,
			maxMediaWidthMm: preset.maxMediaWidthMm,
			ipAddress: e.ipAddress, port: e.port, baudRate: e.baudRate ?? preset.baudRate,
			serialPort: e.connection === "cut-agent" ? e.serialPort : undefined,
			agentUrl: e.agentUrl, compatNote: preset.compatNote,
			vendorId: e.vendorId, productId: e.productId,
			lastConnectedAt: new Date(e.lastConnectedAt),
			createdAt: new Date(), updatedAt: new Date(),
		};
		try {
			await savePlotter(device);
			plotters = [...plotters, device];
			plotterHistoryStore.linkFleet(e.key, device.id, device.name);
			toastStore.success("Saved to fleet", device.name);
		} catch (err) {
			toastStore.error("Failed to save", err instanceof Error ? err.message : "");
		}
	}

	const TEST_HPGL = "IN;SP1;VS10;FS80;PU0,0;PD1016,0,1016,1016,0,1016,0,0;PU508,508;CI250;PU;SP0;"; // 1" × 1" box + circle

	function deviceToConfig(plotter: PlotterDevice): PlotterConfig {
		return {
			id:            plotter.id,
			name:          plotter.name,
			manufacturer:  plotter.manufacturer,
			model:         plotter.model,
			protocol:      plotter.protocol,
			connection:    plotter.connection,
			bladeForce:    80,
			cuttingSpeed:  10,
			passes:        1,
			overcut:       0.5,
			offsetBlade:   0.5,
			mediaWidthMm:  600,
			maxMediaWidthMm: plotter.maxMediaWidthMm,
			originX:       0,
			originY:       0,
			flipH:         false,
			flipV:         false,
			ipAddress:     plotter.ipAddress,
			port:          plotter.port,
			baudRate:      plotter.baudRate,
			serialPort:    plotter.serialPort,
			agentUrl:      plotter.agentUrl,
		};
	}

	async function handleTestCut(plotter: PlotterDevice) {
		const result = await sendToPlotter(TEST_HPGL, deviceToConfig(plotter));
		if (result.ok) {
			toastStore.success("Test cut sent", `1" × 1" box + circle → ${plotter.name}`);
		} else {
			diagPlotter  = plotter;
			diagData     = result.diagnostic;
			diagReported = result.diagnostic.escalate;
			if (result.diagnostic.escalate && userStore.user) {
				logPlotterError({
					userId:        userStore.user.uid,
					userEmail:     userStore.user.email ?? null,
					displayName:   userStore.user.displayName ?? null,
					plotterPreset: plotter.presetName,
					connection:    plotter.connection,
					protocol:      plotter.protocol,
					errorCode:     result.diagnostic.code,
					errorTitle:    result.diagnostic.title,
					errorRaw:      result.diagnostic.raw ?? "",
					agentVersion:  agentStore.version,
					userAgent:     navigator.userAgent,
					autoReported:  true,
				}).catch(() => {});
			}
		}
	}

	let flushing = $state<string | null>(null); // plotter id being flushed

	async function handleFlush(plotter: PlotterDevice) {
		flushing = plotter.id;
		const result = await flushPlotter(deviceToConfig(plotter));
		flushing = null;
		if (result.ok) {
			toastStore.success("Plotter flushed", `Buffer cleared → ${plotter.name}`);
		} else {
			toastStore.warning("Flush failed", result.diagnostic.message);
		}
	}

	async function diagReport() {
		if (!diagData || !diagPlotter || !userStore.user) return;
		await logPlotterError({
			userId:        userStore.user.uid,
			userEmail:     userStore.user.email ?? null,
			displayName:   userStore.user.displayName ?? null,
			plotterPreset: diagPlotter.presetName,
			connection:    diagPlotter.connection,
			protocol:      diagPlotter.protocol,
			errorCode:     diagData.code,
			errorTitle:    diagData.title,
			errorRaw:      diagData.raw ?? "",
			agentVersion:  agentStore.version,
			userAgent:     navigator.userAgent,
			autoReported:  false,
		}).catch(() => {});
		diagReported = true;
	}

	// ─── Helpers ─────────────────────────────────
	function plotterStatus(p: PlotterDevice): "cutting" | "idle" | "offline" {
		if (agentStore.status === "offline") return "offline";
		return activeJobs.find(j => j.plotterConfig?.name === p.presetName) ? "cutting" : "idle";
	}

	function connLabel(c: PlotterConnection): string {
		const m: Record<PlotterConnection, string> = {
			"cut-agent": "Agent", "usb-serial": "USB", "network": "Network", "download": "Download"
		};
		return m[c] ?? c;
	}

	// Full name shown under the connection medallion — connLabel stays short for
	// the log/trouble strings that already ship elsewhere in this file.
	function connFullLabel(c: PlotterConnection): string {
		const m: Record<PlotterConnection, string> = {
			"cut-agent": "Cut Agent", "usb-serial": "USB Direct", "network": "Network", "download": "Download"
		};
		return m[c] ?? c;
	}

	function lastConnectedLabel(d: Date | null | undefined): string | null {
		if (!d) return null;
		const secs = (Date.now() - new Date(d).getTime()) / 1000;
		if (secs < 60) return "just now";
		if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
		if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
		return `${Math.floor(secs / 86400)}d ago`;
	}

	function logClass(type: string) {
		if (type === "error") return "log--error";
		if (type === "warning") return "log--warn";
		if (type === "success") return "log--ok";
		return "";
	}

	function fmtSecs(s: number) {
		if (s < 60) return `${Math.round(s)}s`;
		return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
	}

	function troubleshootSteps(job: CutJob): string[] {
		const c = job.plotterConfig?.connection;
		const base = ["Confirm the plotter is powered on and not in an error state", "Retry the job from the Jobs page"];
		if (c === "network") return [
			`Ping ${job.plotterConfig?.ipAddress ?? "the plotter IP"} from your terminal`,
			"Ensure port 9100 is not blocked by a firewall",
			"Check the plotter's network interface settings", ...base,
		];
		if (c === "usb-serial" || c === "cut-agent") return [
			"Reseat the USB cable on both ends",
			"Try a different USB port or cable",
			"On Linux: confirm your user is in the `dialout` group",
			"Verify the Cut Agent is running at http://localhost:7878/api/status", ...base,
		];
		return base;
	}

	// ─── Lifecycle ───────────────────────────────
	const onSerialChange = () => scanLive();

	onMount(async () => {
		await loadAll();
		await pollAgent();
		await scanLive();
		pollTimer = setInterval(async () => { await pollAgent(); await scanLive(); }, 15_000);
		if ("serial" in navigator) {
			(navigator as any).serial.addEventListener("connect", onSerialChange);
			(navigator as any).serial.addEventListener("disconnect", onSerialChange);
		}
		if (location.hash === "#history") document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
	});

	onDestroy(() => {
		if (sseConn)   sseConn.close();
		if (pollTimer) clearInterval(pollTimer);
		if (typeof navigator !== "undefined" && "serial" in navigator) {
			(navigator as any).serial.removeEventListener("connect", onSerialChange);
			(navigator as any).serial.removeEventListener("disconnect", onSerialChange);
		}
	});
</script>

{#snippet connMedallionIcon(c: PlotterConnection)}
	{#if c === "usb-serial"}
		<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h9M4 15h9"/><path d="M13 6h4l3 3v6l-3 3h-4"/><circle cx="7" cy="9" r="0.5" fill="currentColor"/><circle cx="7" cy="15" r="0.5" fill="currentColor"/><path d="M9 6V4M9 20v-2"/></svg>
	{:else if c === "cut-agent"}
		<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M12 7.5h6M12 16.5h6"/></svg>
	{:else if c === "network"}
		<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16.5a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
	{:else}
		<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>
	{/if}
{/snippet}

<div class="page">

	<!-- ─── Header ─────────────────────────────── -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Plotters</h1>
			<p class="page-sub">Manage your cutting fleet, monitor jobs, and stream live logs.</p>
		</div>
		<button class="add-btn" onclick={() => { addOpen = true; addStep = "form"; }}>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			Add Plotter
		</button>
	</div>

	<!-- ─── Error fallback ───────────────────────── -->
	{#if loadError}
		<div class="error-banner">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
			{loadError}
			<button class="link-btn" onclick={loadAll}>Retry</button>
		</div>
	{/if}

	<!-- ─── Stats ────────────────────────────────── -->
	<div class="stats-row">
		{#each [
			["Registered", loading ? "…" : String(plotters.length), ""],
			["Agent", agentStatus === "online" ? "Online" : agentStatus === "offline" ? "Offline" : "…", agentStatus === "online" ? "success" : agentStatus === "offline" ? "danger" : ""],
			["Cuts Today", loading ? "…" : String(jobsToday), ""],
			["Success Rate", loading ? "…" : `${successRate()}%`, successRate() >= 90 ? "success" : successRate() >= 70 ? "warning" : "danger"],
		] as [label, val, cls]}
			<div class="stat-card" class:shimmer={loading && label !== "Agent"}>
				<span class="stat-val"
					class:text-success={cls === "success"}
					class:text-danger={cls === "danger"}
					class:text-warning={cls === "warning"}
				>{val}</span>
				<span class="stat-label">{label}</span>
			</div>
		{/each}
	</div>

	<!-- ─── Agent status strip ───────────────────── -->
	<div class="agent-strip" class:agent-strip--online={agentStatus === "online"} class:agent-strip--offline={agentStatus === "offline"}>
		<span class="agent-dot" aria-hidden="true"></span>
		{#if agentStatus === "unknown"}
			<span class="agent-text">Checking Cut Agent…</span>
		{:else if agentStatus === "online"}
			<span class="agent-text">Cut Agent {agentVersion ? `v${agentVersion}` : ""} · <code>{agentUrl}</code></span>
		{:else}
			<span class="agent-text">Cut Agent offline —</span>
			<a class="agent-link" href="/studio/agent">open Agent page</a>
			<span class="agent-text">or run <code>./omniplot-agent</code></span>
			<button class="agent-link agent-rescan" onclick={pollAgent} use:tooltip={"Check again for an already-running Cut Agent"}>Rescan</button>
		{/if}
	</div>

	<!-- ─── Main grid ────────────────────────────── -->
	<div class="grid">

		<!-- Plotters column -->
		<section class="col-plotters">
			<div class="col-header">
				<span class="col-label">Registered Plotters</span>
				{#if !loading && plotters.length > 0}
					<span class="col-count">{plotters.length}</span>
				{/if}
			</div>

			{#if loading}
				<div class="plotter-list">
					{#each { length: 2 } as _}
						<div class="plotter-card">
							<div class="skel-row">
								<div class="skel skel-circle"></div>
								<div style="flex:1; display:flex; flex-direction:column; gap:6px;">
									<div class="skel skel-name"></div>
									<div class="skel skel-sub"></div>
								</div>
								<div class="skel skel-badge"></div>
								<div class="skel skel-badge"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if plotters.length === 0}
				<div class="empty-state">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8V4h12v4M6 16v4h12v-4M9 12h.01M13 12h2"/></svg>
					<p class="empty-title">No plotters registered</p>
					<p class="empty-sub">Add your first cutting device to start managing your fleet.</p>
					<button class="add-btn add-btn--sm" onclick={() => { addOpen = true; addStep = "form"; }}>Add a plotter</button>
				</div>
			{:else}
				<div class="plotter-list">
					{#each plotters as plotter (plotter.id)}
						{@const status = plotterStatus(plotter)}
						<div class="plotter-card" class:plotter-card--cutting={status === "cutting"}>
							<div class="plotter-card__main">
								<div class="conn-medallion conn-medallion--{plotter.connection}" use:tooltip={connFullLabel(plotter.connection)} aria-label={connFullLabel(plotter.connection)}>
									{@render connMedallionIcon(plotter.connection)}
									<span class="conn-medallion__label">{connLabel(plotter.connection)}</span>
								</div>
								<span class="status-pip status-pip--{status}" use:tooltip={status}></span>
								<div class="plotter-card__info">
									<span class="plotter-name">{plotter.name}</span>
									<span class="plotter-model">{plotter.manufacturer} {plotter.model} · max {(plotter.maxMediaWidthMm / 25.4).toFixed(1)}"
										{#if plotter.ipAddress} · {plotter.ipAddress}:{plotter.port ?? 9100}{:else if plotter.serialPort} · {plotter.serialPort}{/if}
										{#if lastConnectedLabel(plotter.lastConnectedAt)} · last connected {lastConnectedLabel(plotter.lastConnectedAt)}{/if}
									</span>
								</div>
								<div class="plotter-card__badges">
									<span class="chip chip--proto">{plotter.protocol.toUpperCase()}</span>
								</div>
							</div>

							{#if plotter.compatNote}
								<p class="compat-note">{plotter.compatNote}</p>
							{/if}

							<div class="plotter-card__footer">
								<span class="status-label status-label--{status}">
									{#if status === "cutting"}● Cutting{:else if status === "offline"}● Agent offline{:else}● Ready{/if}
								</span>
								<div class="card-actions">
									<button class="card-btn" onclick={() => handleSetActive(plotter)} disabled={connectingKey !== null}>
										{connectingKey === plotter.id ? "Connecting…" : plotter.connection === "usb-serial" ? "Connect" : "Set active"}
									</button>
									<button class="card-btn" onclick={() => handleTestCut(plotter)}>Test cut</button>
									<button class="card-btn" onclick={() => handleFlush(plotter)} disabled={flushing === plotter.id}>
										{flushing === plotter.id ? "Flushing…" : "Flush"}
									</button>
									{#if confirmDelete === plotter.id}
										<button class="card-btn card-btn--danger" onclick={() => handleDelete(plotter.id)}>Confirm</button>
										<button class="card-btn" onclick={() => confirmDelete = null}>Cancel</button>
									{:else}
										<button class="card-btn card-btn--remove" onclick={() => confirmDelete = plotter.id}>Remove</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Log column -->
		<section class="col-log">
			<div class="col-header">
				<span class="col-label">Live Agent Log</span>
				{#if logs.length > 0}
					<button class="col-action" onclick={() => logs = []}>Clear</button>
				{/if}
			</div>
			<div class="log-feed">
				{#if agentStatus !== "online"}
					<div class="log-empty">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M6 8l3 3-3 3M11 14h4"/></svg>
						<span>Agent offline — no events</span>
					</div>
				{:else if logs.length === 0}
					<div class="log-empty">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
						<span>Waiting for events…</span>
					</div>
				{:else}
					{#each logs as entry (entry.time + entry.message)}
						<div class="log-line {logClass(entry.type)}">
							<span class="log-time">{entry.time}</span>
							<span class="log-msg">{entry.message}</span>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	</div>

	<!-- ─── Connection history ───────────────────── -->
	<section class="history-section" id="history">
		<div class="history-head">
			<div class="col-header" style="margin-bottom:0">
				<span class="col-label">Connection History</span>
				{#if plotterHistoryStore.entries.length > 0}
					<span class="col-count">{plotterHistoryStore.entries.length}</span>
				{/if}
			</div>
			<label class="auto-toggle">
				<input
					type="checkbox"
					checked={plotterHistoryStore.autoReconnect}
					onchange={(e) => plotterHistoryStore.setAutoReconnect((e.target as HTMLInputElement).checked)}
				/>
				<span class="auto-toggle__track" aria-hidden="true"><span class="auto-toggle__thumb"></span></span>
				<span class="auto-toggle__text">
					<strong>Auto-reconnect</strong>
					<span>{plotterHistoryStore.autoReconnect
						? "The Studio reconnects your last plotter whenever it's available."
						: "Off — connect plotters yourself from the Studio or this list."}</span>
				</span>
			</label>
		</div>
		<p class="history-note">
			Every plotter this browser has connected to. Connecting one — here, in the Studio, or automatically — makes it the one OmniPlot resumes;
			disconnecting it yourself stops that, so auto-reconnect never overrides your choice.
		</p>

		{#if plotterHistoryStore.entries.length === 0}
			<div class="empty-state empty-state--compact">
				<p class="empty-title">No connection history yet</p>
				<p class="empty-sub">Plotters appear here after you connect to them in the Studio or from your fleet above.</p>
			</div>
		{:else}
			<ul class="history-list">
				{#each plotterHistoryStore.entries as entry (entry.key)}
					{@const avail = historyAvailability(entry)}
					{@const fleet = fleetFor(entry)}
					<li class="history-row" class:history-row--connected={avail === "connected"}>
						<div class="conn-medallion conn-medallion--{entry.connection}" use:tooltip={connFullLabel(entry.connection)} aria-label={connFullLabel(entry.connection)}>
							{@render connMedallionIcon(entry.connection)}
							<span class="conn-medallion__label">{connLabel(entry.connection)}</span>
						</div>

						<div class="history-row__info">
							<div class="history-row__title">
								{#if renamingKey === entry.key}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="history-rename"
										bind:value={renameValue}
										placeholder={entry.presetName}
										aria-label="Plotter name"
										autofocus
										onkeydown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") renamingKey = null; }}
										onblur={commitRename}
									/>
								{:else}
									<button class="history-name" onclick={() => startRename(entry)} use:tooltip={"Rename"}>{entry.label ?? entry.presetName}</button>
								{/if}
								<span class="avail-badge avail-badge--{avail}">{availabilityLabel(avail, entry)}</span>
								{#if entry.key === plotterHistoryStore.autoTargetKey && plotterHistoryStore.autoReconnect}
									<span class="auto-chip" use:tooltip={"The Studio reconnects this plotter automatically"}>Auto</span>
								{/if}
								{#if fleet}
									<span class="fleet-chip" use:tooltip={`Registered in your fleet as “${fleet.name}”`}>In fleet</span>
								{/if}
							</div>
							<span class="history-row__meta">
								{viaLabel(entry)} · last connected {timeAgo(entry.lastConnectedAt)} · {entry.connectCount} {entry.connectCount === 1 ? "connection" : "connections"}
								{#if endLabel(entry)} · {endLabel(entry)}{/if}
							</span>
							<label class="history-model">
								<span>Model</span>
								<select
									aria-label="Plotter model"
									value={entry.presetName}
									onchange={(e) => plotterHistoryStore.setPreset(entry.key, (e.target as HTMLSelectElement).value)}
								>
									{#each PLOTTER_PRESETS as p}
										<option value={p.name}>{p.name}</option>
									{/each}
								</select>
							</label>
						</div>

						<div class="card-actions history-row__actions">
							{#if avail === "connected"}
								<button class="card-btn" onclick={() => handleHistoryDisconnect(entry)}>Disconnect</button>
							{:else}
								<button
									class="card-btn"
									class:card-btn--primary={avail === "available"}
									onclick={() => handleHistoryConnect(entry)}
									disabled={connectingKey !== null || (entry.connection === "cut-agent" && avail === "absent")}
									use:tooltip={avail === "absent" && entry.connection === "usb-serial" ? "Opens the USB picker filtered to this plotter" : undefined}
								>
									{connectingKey === entry.key ? "Connecting…" : avail === "absent" && entry.connection === "usb-serial" ? "Find & connect" : "Connect"}
								</button>
							{/if}
							{#if !fleet}
								<button class="card-btn" onclick={() => handleSaveToFleet(entry)} use:tooltip={"Register in your fleet (synced to your account)"}>Save to fleet</button>
							{/if}
							<button class="card-btn card-btn--remove" onclick={() => plotterHistoryStore.forget(entry.key)} use:tooltip={"Remove from history"}>Forget</button>
						</div>
					</li>
				{/each}
			</ul>
			<div class="history-foot">
				{#if confirmClearHistory}
					<span class="history-foot__text">Clear all connection history?</span>
					<button class="card-btn card-btn--danger" onclick={() => { plotterHistoryStore.clear(); confirmClearHistory = false; }}>Clear</button>
					<button class="card-btn" onclick={() => confirmClearHistory = false}>Cancel</button>
				{:else}
					<button class="link-btn" onclick={() => confirmClearHistory = true}>Clear history</button>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ─── Job queue ────────────────────────────── -->
	<section class="jobs-section">
		<div class="col-header">
			<span class="col-label">Job Queue</span>
			<span class="col-count-secondary">{activeJobs.length} active · {recentJobs.length} recent</span>
		</div>

		<div class="table-wrap">
			<table class="data-table">
				<thead>
					<tr>
						<th>Job</th>
						<th>Plotter</th>
						<th>Status</th>
						<th>Items</th>
						<th>ETA</th>
						<th>Efficiency</th>
					</tr>
				</thead>
				<tbody>
					{#if loading}
						{#each { length: 4 } as _}
							<tr>
								<td><div class="skel skel-name" style="margin-bottom:5px"></div><div class="skel skel-sub"></div></td>
								<td><div class="skel skel-md"></div></td>
								<td><div class="skel skel-sm"></div></td>
								<td><div class="skel skel-xs"></div></td>
								<td><div class="skel skel-xs"></div></td>
								<td><div class="skel skel-xs"></div></td>
							</tr>
						{/each}
					{:else if [...activeJobs, ...recentJobs].length === 0}
						<tr>
							<td colspan="6" class="td-empty">
								<div class="empty-state empty-state--inline">
									<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
									<p>No jobs yet — send a cut from the Studio.</p>
									<Button variant="ghost" size="sm" href="/studio">Open Studio</Button>
								</div>
							</td>
						</tr>
					{:else}
						{#each [...activeJobs, ...recentJobs] as job (job.id)}
							<tr>
								<td class="td-job">
									<span class="job-name">{job.name}</span>
									<span class="job-id">{job.id.slice(0, 8)}</span>
								</td>
								<td class="td-secondary">{job.plotterConfig?.name ?? "—"}</td>
								<td><span class="status-badge status-badge--{job.status}">{job.status}</span></td>
								<td class="td-mono">{job.metrics?.itemCount ?? "—"}</td>
								<td class="td-mono">{job.metrics?.estimatedCutSeconds ? fmtSecs(job.metrics.estimatedCutSeconds) : "—"}</td>
								<td class="td-mono">{job.metrics?.materialEfficiency != null ? `${Math.round(job.metrics.materialEfficiency * 100)}%` : "—"}</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ─── Failed job troubleshooting ──────────── -->
	{#if failedJobs.length > 0}
		<section class="trouble-section">
			<div class="col-header">
				<span class="col-label col-label--warn">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>
					Failed Jobs
				</span>
			</div>
			{#each failedJobs as job (job.id)}
				<div class="trouble-card">
					<div class="trouble-header">
						<code class="trouble-id">{job.id.slice(0, 8)}</code>
						<span class="trouble-name">{job.name}</span>
						<span class="trouble-conn">{connLabel(job.plotterConfig?.connection ?? "download")}</span>
					</div>
					<ol class="trouble-steps">
						{#each troubleshootSteps(job) as step}
							<li>{step}</li>
						{/each}
					</ol>
				</div>
			{/each}
		</section>
	{/if}

</div>

<!-- ─── Add Plotter Modal ───────────────────── -->
{#if addOpen}
	<button class="backdrop" onclick={() => { addOpen = false; resetForm(); }} aria-label="Close dialog"></button>
	<div class="modal" role="dialog" aria-modal="true" aria-label="Add plotter">
		<div class="modal-header">
			<h2 class="modal-title">Add Plotter</h2>
			<button class="modal-close" onclick={() => { addOpen = false; resetForm(); }} aria-label="Close">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<div class="modal-tabs">
			<button class="modal-tab" class:active={addStep === "form"}   onclick={() => addStep = "form"}>Manual</button>
			<button class="modal-tab" class:active={addStep === "detect"} onclick={() => addStep = "detect"}>Auto-Detect</button>
		</div>

		{#if addStep === "detect"}
			<div class="modal-detect">
				<p class="modal-hint">Scan for plotters connected via USB or visible on the local network.</p>
				<div class="detect-btns">
					<button class="detect-btn" onclick={handleDetect} disabled={detecting}>
						{detecting ? "Scanning USB…" : "Scan USB / Agent Ports"}
					</button>
					<button class="detect-btn" onclick={handleRequestUsbDevice}>
						Select USB Device…
					</button>
					<button class="detect-btn" onclick={handleNetworkScan} disabled={networkScanning}>
						{networkScanning ? "Scanning LAN…" : "Scan Local Network"}
					</button>
				</div>
				<p class="modal-hint">"Scan USB / Agent Ports" only finds devices already authorized in this browser — use "Select USB Device…" to grant access to a new one.</p>

				{#if networkDevices.length > 0}
					<div class="network-list">
						<p class="modal-hint">{networkDevices.length} device{networkDevices.length !== 1 ? "s" : ""} found — click to use:</p>
						{#each networkDevices as dev}
							<button class="network-device" onclick={() => pickNetworkDevice(dev)}>
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg>
								{dev.ip}:{dev.port}
								<span class="device-ms">{dev.responseMs}ms</span>
							</button>
						{/each}
					</div>
				{/if}

				{#if form.name || form.ipAddress}
					<div class="detect-result">
						<strong>Detected:</strong> {form.name || "—"} · {form.connection}{form.ipAddress ? ` · ${form.ipAddress}` : ""}
					</div>
				{/if}
			</div>
		{/if}

		<div class="modal-form">
			<div class="field">
				<label class="field-label" for="p-name">Plotter label</label>
				<input id="p-name" class="field-input" type="text" placeholder="e.g. Bay 1 Roland" bind:value={form.name} />
			</div>
			<div class="field">
				<label class="field-label" for="p-preset">Device preset</label>
				<select id="p-preset" class="field-select" bind:value={form.presetName}>
					{#each PLOTTER_PRESETS as p}
						<option value={p.name}>{p.name} — max {(p.maxMediaWidthMm / 25.4).toFixed(1)}"</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label class="field-label" for="p-conn">Connection type</label>
				<select id="p-conn" class="field-select" bind:value={form.connection}>
					{#if platformStore.flags.cutAgent}<option value="cut-agent">Cut Agent (recommended)</option>{/if}
					<option value="usb-serial">USB Serial (Web Serial API)</option>
					<option value="network">Network TCP/IP</option>
					<option value="download">Download PLT file</option>
				</select>
			</div>
			{#if form.connection === "network"}
				<div class="field-row">
					<div class="field">
						<label class="field-label" for="p-ip">IP address</label>
						<input id="p-ip" class="field-input" type="text" placeholder="192.168.1.100" bind:value={form.ipAddress} />
					</div>
					<div class="field field--narrow">
						<label class="field-label" for="p-port">Port</label>
						<input id="p-port" class="field-input" type="number" bind:value={form.port} />
					</div>
				</div>
			{:else if form.connection === "usb-serial"}
				<div class="field-row">
					<div class="field">
						<label class="field-label" for="p-serial">Serial port</label>
						<input id="p-serial" class="field-input" type="text" placeholder="/dev/ttyUSB0 or COM3" bind:value={form.serialPort} />
					</div>
					<div class="field field--narrow">
						<label class="field-label" for="p-baud">Baud rate</label>
						<input id="p-baud" class="field-input" type="number" bind:value={form.baudRate} />
					</div>
				</div>
			{:else if form.connection === "cut-agent"}
				<div class="field">
					<label class="field-label" for="p-agent">Agent URL</label>
					<input id="p-agent" class="field-input" type="text" bind:value={form.agentUrl} />
				</div>
			{/if}
		</div>

		<div class="modal-footer">
			<button class="btn-cancel" onclick={() => { addOpen = false; resetForm(); }}>Cancel</button>
			<Button variant="primary" size="sm" onclick={handleAddPlotter} disabled={!form.name.trim()}>
				Add Plotter
			</Button>
		</div>
	</div>
{/if}

<PlotterDiagPanel
	diagnostic={diagData}
	reported={diagReported}
	onClose={() => { diagData = null; diagReported = false; diagPlotter = null; }}
	onRetry={() => { const p = diagPlotter; diagData = null; diagReported = false; diagPlotter = null; if (p) handleTestCut(p); }}
	onReport={diagReport}
/>

<style>
	/* ─── Page shell ─── */
	.page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		height: 100%;
		overflow-y: auto;
		/* .plotter-list is a single flex column, not a reflowing grid — on an
		   ultrawide monitor an uncapped width stretches each plotter card
		   edge-to-edge instead of adding more columns, so cap and center it. */
		max-width: 1600px;
		margin: 0 auto;
		width: 100%;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}

	.page-title {
		font-size: 1.375rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 3px;
		letter-spacing: -0.01em;
	}

	.page-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
	}

	/* ─── Add button ─── */
	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 12px;
		background: var(--bg-surface-2, var(--bg-surface));
		border: 1px solid var(--border-default, var(--border-subtle));
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.12s;
	}

	.add-btn:hover {
		background: var(--bg-surface-3, var(--bg-hover));
		color: var(--text-primary);
		border-color: var(--color-brand-dim, var(--color-brand));
	}

	.add-btn--sm { margin-top: 8px; font-size: 0.75rem; }

	/* ─── Error banner ─── */
	.error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: rgba(255, 77, 109, 0.07);
		border: 1px solid rgba(255, 77, 109, 0.2);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-danger, #ef4444);
	}

	.link-btn {
		background: none; border: none;
		color: var(--text-brand, var(--color-brand));
		cursor: pointer; font-size: inherit; font-family: inherit;
		text-decoration: underline; margin-left: 4px;
	}

	/* ─── Stats row ─── */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-val {
		font-family: var(--font-display, var(--font-body));
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-tertiary, var(--text-muted));
	}

	.text-success { color: var(--color-success, #22c55e) !important; }
	.text-danger  { color: var(--color-danger, #ef4444) !important; }
	.text-warning { color: var(--color-warning, #f59e0b) !important; }

	/* ─── Agent strip ─── */
	.agent-strip {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 14px;
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		font-size: 0.78125rem;
		color: var(--text-secondary);
	}

	.agent-strip--online { border-color: rgba(34, 197, 94, 0.3); }
	.agent-strip--offline { border-color: rgba(239, 68, 68, 0.25); }

	.agent-dot {
		width: 7px; height: 7px;
		border-radius: 50%;
		background: var(--text-muted);
		flex-shrink: 0;
	}

	.agent-strip--online .agent-dot  { background: var(--color-success, #22c55e); }
	.agent-strip--offline .agent-dot { background: var(--color-danger, #ef4444); }

	.agent-text { color: var(--text-secondary); }
	.agent-text code { font-family: var(--font-mono, monospace); font-size: 0.72rem; color: var(--text-muted); }
	.agent-link { color: var(--text-brand, var(--color-brand)); text-decoration: none; }
	.agent-link:hover { text-decoration: underline; }
	.agent-rescan { background: none; border: none; padding: 0; font: inherit; cursor: pointer; }

	/* ─── Main grid ─── */
	.grid {
		display: grid;
		grid-template-columns: 1fr 360px;
		gap: 16px;
	}

	@media (max-width: 900px) {
		.stats-row { grid-template-columns: repeat(2, 1fr); }
		.grid { grid-template-columns: 1fr; }
	}

	/* ─── Column shared ─── */
	.col-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}

	.col-label {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-tertiary, var(--text-muted));
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.col-label--warn { color: var(--color-warning, #f59e0b); }

	.col-count {
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--bg-surface-2, var(--bg-surface));
		border: 1px solid var(--border-subtle);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-secondary);
		font-family: var(--font-mono, monospace);
	}

	.col-count-secondary { font-size: 0.75rem; color: var(--text-tertiary, var(--text-muted)); margin-left: auto; }

	.col-action {
		margin-left: auto;
		background: none; border: none; cursor: pointer;
		font-size: 0.75rem; color: var(--text-tertiary, var(--text-muted));
		padding: 0;
	}

	.col-action:hover { color: var(--text-primary); }

	/* ─── Plotter cards ─── */
	.col-plotters { display: flex; flex-direction: column; }
	.plotter-list { display: flex; flex-direction: column; gap: 8px; }

	.plotter-card {
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 10px;
		transition: border-color 0.15s;
	}

	.plotter-card--cutting {
		border-color: var(--color-brand);
		background: rgba(99, 102, 241, 0.03);
	}

	.plotter-card__main {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	/* ─── Connection medallion ───
	   Large icon+label badge so USB / Cut Agent / Network / Download are
	   distinguishable at a glance, without reading the model line. */
	.conn-medallion {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		padding: 5px 10px 5px 6px;
		border-radius: 999px;
		border: 1px solid transparent;
	}

	.conn-medallion svg { flex-shrink: 0; }

	.conn-medallion__label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.conn-medallion--usb-serial {
		background: rgba(96, 165, 250, 0.12);
		border-color: rgba(96, 165, 250, 0.25);
		color: #60a5fa;
	}
	.conn-medallion--cut-agent {
		background: rgba(52, 211, 153, 0.12);
		border-color: rgba(52, 211, 153, 0.25);
		color: #34d399;
	}
	.conn-medallion--network {
		background: rgba(251, 191, 36, 0.12);
		border-color: rgba(251, 191, 36, 0.25);
		color: #fbbf24;
	}
	.conn-medallion--download {
		background: rgba(148, 163, 184, 0.12);
		border-color: rgba(148, 163, 184, 0.25);
		color: #94a3b8;
	}

	.status-pip {
		width: 7px; height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-pip--idle    { background: var(--color-success, #22c55e); }
	.status-pip--cutting { background: var(--color-brand); box-shadow: 0 0 0 3px rgba(99,102,241,0.2); }
	.status-pip--offline { background: var(--text-tertiary, #6b7280); }

	.plotter-card__info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.plotter-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.plotter-model {
		font-size: 0.75rem;
		color: var(--text-tertiary, var(--text-muted));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.plotter-card__badges { display: flex; gap: 5px; flex-shrink: 0; }

	.chip {
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		font-family: var(--font-mono, monospace);
	}

	.chip--proto { background: rgba(139, 92, 246, 0.12); color: #a78bfa; }
	.chip--conn  { background: rgba(59, 130, 246, 0.1); color: #60a5fa; }

	.compat-note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-warning, #f59e0b);
		background: rgba(245, 158, 11, 0.07);
		border-left: 2px solid currentColor;
		padding: 5px 9px;
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.plotter-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.status-label {
		font-size: 0.72rem;
		font-weight: 500;
	}

	.status-label--idle    { color: var(--color-success, #22c55e); }
	.status-label--offline { color: var(--text-tertiary, #6b7280); }
	.status-label--cutting {
		color: var(--color-brand);
		animation: blink 1s step-end infinite;
	}

	@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

	.card-actions { display: flex; gap: 4px; }

	.card-btn {
		padding: 4px 10px;
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		border: 1px solid var(--border-default, var(--border-subtle));
		background: var(--bg-surface-2, var(--bg-elevated));
		color: var(--text-secondary);
		transition: all 0.12s;
	}

	.card-btn:hover {
		background: var(--bg-surface-3, var(--bg-hover));
		color: var(--text-primary);
	}

	.card-btn--danger {
		background: rgba(239, 68, 68, 0.1);
		border-color: rgba(239, 68, 68, 0.3);
		color: var(--color-danger, #ef4444);
	}

	.card-btn--danger:hover {
		background: rgba(239, 68, 68, 0.18);
	}

	.card-btn--remove {
		color: var(--text-tertiary, var(--text-muted));
		border-color: transparent;
		background: transparent;
	}

	.card-btn--remove:hover {
		color: var(--color-danger, #ef4444);
		background: rgba(239, 68, 68, 0.07);
		border-color: rgba(239, 68, 68, 0.2);
	}

	/* ─── Empty state ─── */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 40px 24px;
		color: var(--text-tertiary, var(--text-muted));
		gap: 6px;
	}

	.empty-title { font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); margin: 0; }
	.empty-sub   { font-size: 0.8125rem; color: var(--text-tertiary, var(--text-muted)); margin: 0; max-width: 260px; }

	.empty-state--inline { padding: 32px 16px; }

	/* ─── Log feed ─── */
	.col-log { display: flex; flex-direction: column; }

	.log-feed {
		flex: 1;
		min-height: 260px;
		max-height: 480px;
		overflow-y: auto;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 10px 12px;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.log-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--text-tertiary, var(--text-muted));
		font-family: var(--font-body);
		font-size: 0.78125rem;
		padding: 32px 0;
	}

	.log-line {
		display: flex;
		gap: 8px;
		line-height: 1.6;
	}

	.log-time { color: var(--text-tertiary, var(--text-muted)); flex-shrink: 0; }
	.log-msg  { color: var(--text-secondary); word-break: break-all; }

	.log--error .log-msg { color: var(--color-danger, #f87171); }
	.log--warn  .log-msg { color: var(--color-warning, #fbbf24); }
	.log--ok    .log-msg { color: var(--color-success, #4ade80); }

	/* ─── Jobs table ─── */
	.jobs-section  { display: flex; flex-direction: column; }
	.trouble-section { display: flex; flex-direction: column; gap: 8px; }

	.table-wrap {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl, var(--radius-lg));
		overflow: hidden;
		overflow-x: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.data-table thead {
		background: var(--bg-surface-2, var(--bg-surface));
		border-bottom: 1px solid var(--border-subtle);
	}

	.data-table th {
		padding: 9px 14px;
		text-align: left;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-mono, monospace);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-tertiary, var(--text-muted));
		white-space: nowrap;
	}

	.data-table td {
		padding: 11px 14px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
	}

	.data-table tbody tr:last-child td { border-bottom: none; }

	.data-table tbody tr:hover { background: var(--interactive-hover, var(--bg-hover)); }

	.td-job { display: flex; flex-direction: column; gap: 2px; }
	.job-name { font-weight: 500; color: var(--text-primary); }
	.job-id   { font-size: 0.6875rem; font-family: var(--font-mono, monospace); color: var(--text-tertiary, var(--text-muted)); }
	.td-secondary { font-size: 0.78125rem; color: var(--text-secondary); }
	.td-mono { font-family: var(--font-mono, monospace); color: var(--text-secondary); }

	.td-empty { text-align: center; padding: 0; }

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.status-badge--cutting  { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
	.status-badge--ready    { background: rgba(59, 130, 246, 0.13); color: #60a5fa; }
	.status-badge--complete { background: rgba(34, 197, 94, 0.13);  color: #4ade80; }
	.status-badge--error    { background: rgba(239, 68, 68, 0.13);  color: #f87171; }
	.status-badge--draft    { background: rgba(255, 255, 255, 0.05); color: var(--text-tertiary, #6b7280); }
	.status-badge--cancelled { background: rgba(255, 255, 255, 0.05); color: var(--text-tertiary, #6b7280); }

	/* ─── Troubleshoot ─── */
	.trouble-card {
		padding: 12px 16px;
		border-radius: var(--radius-lg);
		background: rgba(239, 68, 68, 0.04);
		border: 1px solid rgba(239, 68, 68, 0.2);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.trouble-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.trouble-id   { font-family: var(--font-mono, monospace); font-size: 0.6875rem; color: var(--text-tertiary, var(--text-muted)); }
	.trouble-name { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
	.trouble-conn { font-size: 0.72rem; color: var(--color-danger, #ef4444); background: rgba(239,68,68,0.1); padding: 2px 7px; border-radius: 999px; margin-left: auto; }

	.trouble-steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
	.trouble-steps li { font-size: 0.8125rem; color: var(--text-secondary); }

	/* ─── Shimmer skeletons ─── */
	@keyframes shimmer {
		from { background-position: -200% 0; }
		to   { background-position:  200% 0; }
	}

	.skel {
		border-radius: 4px;
		background: linear-gradient(90deg, var(--bg-surface-3, rgba(255,255,255,0.06)) 25%, var(--bg-surface-2, rgba(255,255,255,0.04)) 50%, var(--bg-surface-3, rgba(255,255,255,0.06)) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease infinite;
	}

	.skel-row { display: flex; align-items: center; gap: 10px; }
	.skel-circle { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.skel-name  { width: 140px; height: 13px; }
	.skel-sub   { width: 200px; height: 10px; }
	.skel-badge { width: 44px; height: 18px; border-radius: 3px; }
	.skel-md    { width: 110px; height: 13px; }
	.skel-sm    { width: 70px;  height: 13px; }
	.skel-xs    { width: 40px;  height: 13px; }

	.shimmer { animation: shimmer 1.4s ease infinite; }

	/* ─── Modal ─── */
	.backdrop {
		position: fixed; inset: 0; z-index: 900;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(3px);
		border: none; cursor: default; padding: 0;
	}

	.modal {
		position: fixed;
		top: 50%; left: 50%;
		transform: translate(-50%, -50%);
		z-index: 901;
		width: min(520px, calc(100vw - 32px));
		max-height: calc(100vh - 64px);
		max-height: calc(100dvh - 64px);
		overflow-y: auto;
		background: var(--bg-surface);
		border: 1px solid var(--border-default, var(--border-subtle));
		border-radius: var(--radius-xl, var(--radius-lg));
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
	}

	.modal-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.modal-title { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); margin: 0; }

	.modal-close {
		background: none; border: none; cursor: pointer;
		color: var(--text-tertiary, var(--text-muted));
		display: flex; align-items: center; padding: 4px;
		border-radius: var(--radius-sm);
		transition: all 0.12s;
	}

	.modal-close:hover { color: var(--text-primary); background: var(--bg-surface-2, var(--bg-hover)); }

	.modal-tabs {
		display: flex;
		border-bottom: 1px solid var(--border-subtle);
	}

	.modal-tab {
		flex: 1; padding: 10px 14px;
		font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body);
		background: none; border: none; cursor: pointer;
		color: var(--text-tertiary, var(--text-muted));
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: all 0.12s;
	}

	.modal-tab.active { color: var(--color-brand); border-bottom-color: var(--color-brand); }
	.modal-tab:hover:not(.active) { color: var(--text-secondary); }

	.modal-detect {
		padding: 16px 20px;
		border-bottom: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.modal-hint { font-size: 0.78125rem; color: var(--text-tertiary, var(--text-muted)); margin: 0; }

	.detect-btns { display: flex; gap: 8px; flex-wrap: wrap; }

	.detect-btn {
		padding: 6px 13px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-default, var(--border-subtle));
		color: var(--text-primary);
		font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body);
		cursor: pointer; transition: all 0.12s;
	}

	.detect-btn:hover:not(:disabled) { background: var(--bg-surface-3, var(--bg-hover)); }
	.detect-btn:disabled { opacity: 0.45; cursor: not-allowed; }

	.detect-result {
		padding: 8px 12px;
		background: var(--bg-surface-2, rgba(0,0,0,0.15));
		border-radius: var(--radius-sm);
		font-size: 0.78125rem;
		color: var(--text-secondary);
	}

	.network-list { display: flex; flex-direction: column; gap: 5px; }

	.network-device {
		display: flex; align-items: center; gap: 7px;
		padding: 6px 11px;
		background: var(--bg-surface-2, var(--bg-elevated));
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		font-family: var(--font-mono, monospace);
		color: var(--text-primary);
		cursor: pointer; text-align: left; width: 100%;
		transition: background 0.12s;
	}

	.network-device:hover { background: var(--bg-surface-3, var(--bg-hover)); }
	.device-ms { margin-left: auto; color: var(--text-tertiary, var(--text-muted)); font-size: 0.6875rem; }

	.modal-form {
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 13px;
	}

	.field { display: flex; flex-direction: column; gap: 5px; }
	.field--narrow { max-width: 110px; }
	.field-row { display: grid; grid-template-columns: 1fr 110px; gap: 10px; }

	.field-label { font-size: 0.78125rem; font-weight: 500; color: var(--text-secondary); }

	.field-input,
	.field-select {
		padding: 7px 10px;
		background: var(--bg-surface-2, var(--bg-base));
		border: 1px solid var(--border-default, var(--border-subtle));
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		width: 100%;
		box-sizing: border-box;
		transition: border-color 0.12s;
	}

	.field-input:focus,
	.field-select:focus {
		outline: none;
		border-color: var(--color-brand);
	}

	.modal-footer {
		display: flex; align-items: center; justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--border-subtle);
	}

	.btn-cancel {
		padding: 6px 13px;
		background: none;
		border: 1px solid var(--border-default, var(--border-subtle));
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all 0.12s;
	}

	.btn-cancel:hover { background: var(--bg-surface-2, var(--bg-hover)); color: var(--text-primary); }

	/* ─── Connection history ─── */
	.history-section { display: flex; flex-direction: column; gap: 10px; scroll-margin-top: 80px; }
	.history-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.history-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--text-tertiary, var(--text-muted));
		max-width: 720px;
	}
	.empty-state--compact { padding: 24px 16px; border: 1px dashed var(--border-default); border-radius: var(--radius-lg); }
	.empty-state--compact .empty-sub { max-width: 360px; }

	.auto-toggle {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		user-select: none;
	}
	.auto-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
	.auto-toggle__track {
		position: relative;
		width: 34px;
		height: 20px;
		border-radius: 999px;
		background: var(--text-disabled);
		transition: background 0.2s ease;
		flex-shrink: 0;
	}
	.auto-toggle__thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s ease;
	}
	.auto-toggle input:checked + .auto-toggle__track { background: var(--color-brand); }
	.auto-toggle input:checked + .auto-toggle__track .auto-toggle__thumb { transform: translateX(14px); }
	.auto-toggle input:focus-visible + .auto-toggle__track { outline: 2px solid var(--color-brand); outline-offset: 2px; }
	.auto-toggle__text { display: flex; flex-direction: column; line-height: 1.3; }
	.auto-toggle__text strong { font-size: 0.8125rem; color: var(--text-primary); font-weight: 600; }
	.auto-toggle__text span { font-size: 0.75rem; color: var(--text-tertiary, var(--text-muted)); }

	.history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.history-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.history-row--connected { border-color: color-mix(in srgb, var(--color-success) 40%, transparent); }
	.history-row__info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
	.history-row__title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.history-name {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		cursor: text;
		text-align: left;
	}
	.history-name:hover { text-decoration: underline dotted; }
	.history-rename {
		font: inherit;
		font-size: 0.875rem;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: var(--bg-surface-2);
		color: var(--text-primary);
		min-width: 0;
		width: 220px;
		max-width: 100%;
	}
	.history-row__meta { font-size: 0.75rem; color: var(--text-tertiary, var(--text-muted)); overflow-wrap: anywhere; }
	.history-model { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-tertiary, var(--text-muted)); }
	.history-model select {
		font: inherit;
		font-size: 0.75rem;
		padding: 2px 4px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		max-width: 220px;
	}
	.history-row__actions { flex-shrink: 0; }

	.avail-badge, .auto-chip, .fleet-chip {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.avail-badge--connected { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
	.avail-badge--available { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
	.avail-badge--network   { background: color-mix(in srgb, var(--color-brand) 14%, transparent); color: var(--text-brand, var(--color-brand)); }
	.avail-badge--absent    { background: var(--bg-surface-2); color: var(--text-tertiary, var(--text-muted)); }
	.auto-chip  { background: color-mix(in srgb, var(--color-brand) 14%, transparent); color: var(--text-brand, var(--color-brand)); }
	.fleet-chip { background: rgba(139, 92, 246, 0.12); color: #a78bfa; }

	.card-btn--primary {
		background: var(--color-brand);
		border-color: var(--color-brand);
		color: var(--text-inverse, #0a0a0a);
		font-weight: 600;
	}
	.card-btn--primary:hover:not(:disabled) { filter: brightness(0.92); }

	.history-foot { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
	.history-foot__text { font-size: 0.8125rem; color: var(--text-secondary); }

	@media (max-width: 640px) {
		.history-row { flex-wrap: wrap; align-items: flex-start; }
		.history-row__info { flex-basis: calc(100% - 64px); }
		.history-row__actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
	}
</style>
