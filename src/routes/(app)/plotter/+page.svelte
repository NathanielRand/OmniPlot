<svelte:head>
	<title>Plotters — OmniPlot</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { userStore, toastStore, plotterStore, agentStore, cutJobStore } from "$lib/stores";
	import { PLOTTER_PRESETS } from "$lib/config";
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
	} from "$lib/utils/plotter-detect";
	import { sendToPlotter, flushPlotter, reconnectSerialPort } from "$lib/utils/plotter-connection";
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
		connection: "cut-agent" as PlotterConnection,
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
	const recentJobs = $derived(jobs.filter(j => j.status === "complete" || j.status === "error").slice(0, 10));
	const failedJobs = $derived(jobs.filter(j => j.status === "error").slice(0, 5));

	const jobsToday = $derived(jobs.filter(j => {
		const d = new Date(j.updatedAt);
		const n = new Date();
		return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
	}).length);

	const successRate = $derived(() => {
		const done = jobs.filter(j => j.status === "complete" || j.status === "error");
		if (!done.length) return 100;
		return Math.round((done.filter(j => j.status === "complete").length / done.length) * 100);
	});

	// ─── Agent polling ────────────────────────────
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function pollAgent() {
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
		form = { name: "", presetName: PLOTTER_PRESETS[0].name, connection: "cut-agent",
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

	let reconnecting = $state<string | null>(null); // plotter id currently reconnecting

	async function markConnected(plotter: PlotterDevice) {
		const now = new Date();
		plotters = plotters.map(p => p.id === plotter.id ? { ...p, lastConnectedAt: now } : p);
		try {
			await savePlotter({ ...plotter, lastConnectedAt: now });
		} catch {
			// Best-effort — active state is already applied locally
		}
	}

	async function handleSetActive(plotter: PlotterDevice) {
		const preset = PLOTTER_PRESETS.find(p => p.name === plotter.presetName);
		if (!preset) return;

		plotterStore.applyPreset(preset);
		plotterStore.switchConnection(plotter.connection);
		if (plotter.serialPort) plotterStore.update({ serialPort: plotter.serialPort });
		if (plotter.agentUrl)   plotterStore.update({ agentUrl: plotter.agentUrl });
		if (plotter.ipAddress)  plotterStore.update({ ipAddress: plotter.ipAddress });
		if (plotter.port)       plotterStore.update({ port: plotter.port });

		if (plotter.connection === "usb-serial" && plotter.vendorId !== undefined) {
			// Quick reconnect — matches the saved USB identity against already-authorized
			// ports (navigator.serial.getPorts()), so no browser picker dialog is shown.
			reconnecting = plotter.id;
			const info = await reconnectSerialPort(plotter.baudRate ?? preset.baudRate ?? 9600, {
				vendorId: plotter.vendorId, productId: plotter.productId,
			});
			reconnecting = null;
			if (info) {
				plotterStore.update({ vendorId: info.vendorId, productId: info.productId });
				plotterStore.persistConnSettings();
				toastStore.success("Reconnected", `${plotter.name} is now active in Studio.`);
				await markConnected(plotter);
				return;
			}
			toastStore.warning("Reconnect needed", `${plotter.name} isn't authorized in this browser — grant USB access from the Studio page.`);
			return;
		}

		toastStore.success("Active plotter set", `${plotter.name} is now active in Studio.`);
		await markConnected(plotter);
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
	onMount(async () => {
		await loadAll();
		await pollAgent();
		pollTimer = setInterval(pollAgent, 15_000);
	});

	onDestroy(() => {
		if (sseConn)   sseConn.close();
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

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
			["Jobs Today", loading ? "…" : String(jobsToday), ""],
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
								<span class="status-pip status-pip--{status}" title={status}></span>
								<div class="plotter-card__info">
									<span class="plotter-name">{plotter.name}</span>
									<span class="plotter-model">{plotter.manufacturer} {plotter.model} · max {(plotter.maxMediaWidthMm / 25.4).toFixed(1)}"
										{#if plotter.ipAddress} · {plotter.ipAddress}:{plotter.port ?? 9100}{:else if plotter.serialPort} · {plotter.serialPort}{/if}
										{#if lastConnectedLabel(plotter.lastConnectedAt)} · last connected {lastConnectedLabel(plotter.lastConnectedAt)}{/if}
									</span>
								</div>
								<div class="plotter-card__badges">
									<span class="chip chip--proto">{plotter.protocol.toUpperCase()}</span>
									<span class="chip chip--conn">{connLabel(plotter.connection)}</span>
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
									<button class="card-btn" onclick={() => handleSetActive(plotter)} disabled={reconnecting === plotter.id}>
										{reconnecting === plotter.id ? "Reconnecting…" : plotter.connection === "usb-serial" ? "Reconnect" : "Set active"}
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
					<button class="detect-btn" onclick={handleNetworkScan} disabled={networkScanning}>
						{networkScanning ? "Scanning LAN…" : "Scan Local Network"}
					</button>
				</div>

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
					<option value="cut-agent">Cut Agent (recommended)</option>
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
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
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
</style>
