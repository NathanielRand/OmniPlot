<svelte:head>
	<title>Agent — OmniPlot</title>
</svelte:head>

<script lang="ts">
	import { onMount } from "svelte";
	import { plotterStore, agentStore } from "$lib/stores";

	// ─── Types ────────────────────────────────────

	interface AgentStatus {
		agent: string;
		version: string;
		ok: boolean;
	}

	interface AgentStatsData {
		jobsTotal: number;
		jobsToday: number;
		bytesTotal: number;
		errorsTotal: number;
		portsUsed: string[];
		portsCount: number;
		uptimeSeconds: number;
		startedAt: string;
	}

	interface AgentEvent {
		time: string;
		type: "cut" | "request" | "error" | "info";
		method?: string;
		path?: string;
		status?: number;
		durationMs?: number;
		bytes?: number;
		port?: string;
		message?: string;
	}

	interface PortInfo {
		name: string;
		isUSB: boolean;
		manufacturer?: string;
		product?: string;
	}

	// ─── Agent URL ────────────────────────────────

	const agentUrl = $derived(
		(plotterStore.config.agentUrl ?? "http://localhost:7878").replace(/\/$/, "")
	);

	// ─── Status ───────────────────────────────────

	let status = $state<AgentStatus | null>(null);
	let statusError = $state(false);

	async function pollStatus() {
		try {
			const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(3000) });
			if (!res.ok) throw new Error();
			status = await res.json();
			statusError = false;
			agentStore.setOnline(status?.version ?? "");
		} catch {
			status = null;
			statusError = true;
			agentStore.setOffline();
		}
	}

	// ─── Stats ────────────────────────────────────

	let stats = $state<AgentStatsData | null>(null);

	async function pollStats() {
		try {
			const res = await fetch(`${agentUrl}/api/stats`, { signal: AbortSignal.timeout(3000) });
			if (!res.ok) return;
			stats = await res.json();
			agentStore.setStats(stats);
		} catch { /* offline */ }
	}

	// ─── SSE log ──────────────────────────────────

	const MAX_EVENTS = 200;
	let events = $state<AgentEvent[]>([]);
	let paused = $state(false);
	let logEl = $state<HTMLDivElement | null>(null);
	let eventSource: EventSource | null = null;

	function connectSSE() {
		eventSource?.close();
		eventSource = new EventSource(`${agentUrl}/api/events`);
		eventSource.onmessage = (e) => {
			if (paused) return;
			try {
				const evt: AgentEvent = JSON.parse(e.data);
				events = [evt, ...events].slice(0, MAX_EVENTS);
			} catch { /* ignore malformed */ }
		};
		// EventSource reconnects automatically on error — no manual handling needed
	}

	// ─── Kill agent ───────────────────────────────

	let showKillConfirm = $state(false);
	let killing = $state(false);

	async function killAgent() {
		killing = true;
		try {
			await fetch(`${agentUrl}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
		} catch { /* expected — agent closes connection on shutdown */ }
		killing = false;
		showKillConfirm = false;
		// Status poll will pick up the offline state within 5s
		await pollStatus();
	}

	// ─── Manual test panel ────────────────────────

	let testPorts = $state<PortInfo[]>([]);
	let testPort = $state("auto");
	let testBaud = $state(9600);
	let testHPGL = $state("IN;SP1;PU0,0;PD500,0,500,500,0,500,0,0;PU;SP0;");
	let testLoading = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	async function fetchPorts() {
		try {
			const res = await fetch(`${agentUrl}/api/ports`, { signal: AbortSignal.timeout(3000) });
			if (res.ok) testPorts = await res.json();
		} catch { /* offline */ }
	}

	async function sendTest() {
		if (!testHPGL.trim() || testLoading) return;
		testLoading = true;
		testResult = null;
		try {
			const res = await fetch(`${agentUrl}/api/cut`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					hpgl: testHPGL,
					config: { baudRate: testBaud, serialPort: testPort },
				}),
				signal: AbortSignal.timeout(40000),
			});
			const body = await res.json();
			if (res.ok && body.ok) {
				testResult = { ok: true, message: `${body.bytesWritten} bytes → ${body.port}` };
			} else {
				testResult = { ok: false, message: body.error ?? `HTTP ${res.status}` };
			}
		} catch (err: any) {
			testResult = { ok: false, message: err?.message ?? "Send failed" };
		} finally {
			testLoading = false;
		}
	}

	// ─── Lifecycle ────────────────────────────────

	onMount(() => {
		pollStatus();
		pollStats();
		fetchPorts();
		connectSSE();

		const statusTimer = setInterval(pollStatus, 5000);
		const statsTimer  = setInterval(pollStats, 30000);
		const portsTimer  = setInterval(fetchPorts, 15000);

		return () => {
			clearInterval(statusTimer);
			clearInterval(statsTimer);
			clearInterval(portsTimer);
			eventSource?.close();
		};
	});

	// ─── Helpers ──────────────────────────────────

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
	}

	function fmtUptime(s: number): string {
		if (s < 60) return `${Math.floor(s)}s`;
		if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}h ${m}m`;
	}

	function fmtTime(iso: string): string {
		return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	}

	const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

	// ─── Guide ────────────────────────────────────

	const AGENT_VERSION = "1.0.1";
	const APP_URL = (import.meta.env.VITE_APP_URL ?? "https://omniplot.app").replace(/\/$/, "");

	function dlUrl(file: string, platform: string) {
		return `/api/agent/download?file=${encodeURIComponent(file)}&platform=${encodeURIComponent(platform)}&version=${AGENT_VERSION}`;
	}

	const DOWNLOADS = {
		linux:     { label: "Linux",               file: `omniplot-agent-linux-amd64` },
		windows:   { label: "Windows",             file: `omniplot-agent-windows-amd64.exe` },
		"mac-arm": { label: "macOS (Apple Silicon)", file: `omniplot-agent-darwin-arm64` },
		"mac-intel": { label: "macOS (Intel)",     file: `omniplot-agent-darwin-amd64` },
	} as const;

	type Platform = keyof typeof DOWNLOADS;

	let detectedPlatform = $state<Platform>("linux");

	$effect(() => {
		if (typeof navigator === "undefined") return;
		const ua  = navigator.userAgent;
		const plat = (navigator as any).userAgentData?.platform ?? navigator.platform ?? "";
		if (/Win/.test(plat) || /Windows/.test(ua)) {
			detectedPlatform = "windows";
		} else if (/Mac/.test(plat) || /Mac/.test(ua)) {
			const arm = (navigator as any).userAgentData?.architecture === "arm" ||
				(navigator.hardwareConcurrency >= 8 && /Mac OS X 1[1-9]/.test(ua));
			detectedPlatform = arm ? "mac-arm" : "mac-intel";
		} else {
			detectedPlatform = "linux";
		}
	});

	const TROUBLE = [
		{
			q: "Agent not detected / status shows offline",
			a: `Make sure the agent binary is running. Open a terminal, navigate to where you downloaded it, and run it directly. You should see a JSON startup message and a "listening on http://127.0.0.1:7878" line. If you get a port conflict, use --port 7879 and update the Agent URL in Settings → Plotter → Agent URL.`,
		},
		{
			q: "No serial ports listed in the test panel",
			a: `The cutter must be powered on and connected via USB before the agent starts. On Linux, your user may need to be in the dialout group: run sudo usermod -aG dialout $USER and log out/in. On macOS, the port appears as /dev/cu.usbserial-* or /dev/cu.usbmodem*. On Windows it shows as COM3, COM4, etc. — check Device Manager.`,
		},
		{
			q: "Cut job sends but cutter doesn't move",
			a: `Check the baud rate. Most vinyl cutters default to 9600, but Graphtec FC-series use 38400 and some Roland models use 38400 or 57600. Try increasing blade force and lowering speed in Plotter Settings. Also confirm the correct HPGL protocol is selected (HPGL vs HPGL/2 vs GPGL).`,
		},
		{
			q: `macOS: "cannot be opened because the developer cannot be verified"`,
			a: `Right-click (or Control-click) the binary in Finder → Open → click Open in the dialog. You only need to do this once. Alternatively: xattr -c omniplot-agent-darwin-arm64 in Terminal removes the quarantine flag.`,
		},
		{
			q: "Linux: Permission denied when opening serial port",
			a: `Run: sudo usermod -aG dialout $USER  then log out and back in. On some distros the group is uucp instead of dialout. You can verify with: ls -la /dev/ttyUSB0`,
		},
		{
			q: "Agent crashes or exits immediately",
			a: `Run with --verbose flag for full request logging: ./omniplot-agent --verbose. Check that port 7878 isn't already in use (lsof -i :7878 on Mac/Linux, netstat -ano | findstr 7878 on Windows). If another agent instance is running, stop it first.`,
		},
	];

	let openTrouble = $state<number | null>(null);
</script>

<div class="agent-page">

	<!-- ── Header ────────────────────────────────── -->
	<div class="agent-header">
		<div class="agent-header__left">
			<div class="status-dot" class:status-dot--online={!!status} aria-hidden="true"></div>
			<div class="agent-header__info">
				<h1 class="agent-header__title">
					{#if status}
						OmniPlot Cut Agent <span class="version">v{status.version}</span>
					{:else}
						OmniPlot Cut Agent
					{/if}
				</h1>
				<p class="agent-header__sub">
					{#if status && stats}
						Active for {fmtUptime(stats.uptimeSeconds)} &nbsp;·&nbsp; {agentUrl}
					{:else if statusError}
						Not reachable at {agentUrl} — is the agent running?
					{:else}
						Connecting…
					{/if}
				</p>
			</div>
		</div>

		<div class="agent-header__actions">
			{#if showKillConfirm}
				<span class="kill-confirm-text">Stop the agent?</span>
				<button class="btn btn--danger" onclick={killAgent} disabled={killing}>
					{killing ? "Stopping…" : "Confirm"}
				</button>
				<button class="btn btn--ghost" onclick={() => (showKillConfirm = false)}>Cancel</button>
			{:else if status}
				<button class="btn btn--danger-outline" onclick={() => (showKillConfirm = true)}>
					Stop Agent
				</button>
			{:else}
				<a href="/agent" class="btn btn--ghost">Download agent →</a>
			{/if}
		</div>
	</div>

	<!-- ── Stats row ─────────────────────────────── -->
	<div class="stats-row">
		<div class="stat-card">
			<span class="stat-card__value">{stats?.jobsToday ?? "—"}</span>
			<span class="stat-card__label">jobs today</span>
		</div>
		<div class="stat-card">
			<span class="stat-card__value">{stats ? fmtBytes(stats.bytesTotal) : "—"}</span>
			<span class="stat-card__label">total sent</span>
		</div>
		<div class="stat-card" class:stat-card--error={!!stats && stats.errorsTotal > 0}>
			<span class="stat-card__value">{stats?.errorsTotal ?? "—"}</span>
			<span class="stat-card__label">errors</span>
		</div>
		<div class="stat-card">
			<span class="stat-card__value">{stats?.portsCount ?? "—"}</span>
			<span class="stat-card__label">ports seen</span>
		</div>
		<div class="stat-card">
			<span class="stat-card__value">{stats?.jobsTotal ?? "—"}</span>
			<span class="stat-card__label">all-time jobs</span>
		</div>
	</div>

	<!-- ── Main panels ───────────────────────────── -->
	<div class="panels">

		<!-- Live log -->
		<div class="panel panel--log">
			<div class="panel__header">
				<h2 class="panel__title">Live Log</h2>
				<div class="panel__controls">
					<span class="log-count">{events.length}/{MAX_EVENTS}</span>
					<button class="btn-icon" onclick={() => (paused = !paused)} title={paused ? "Resume" : "Pause"}>
						{#if paused}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
						{/if}
					</button>
					<button class="btn-icon" onclick={() => (events = [])} title="Clear log">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
					</button>
				</div>
			</div>

			<div class="log" bind:this={logEl}>
				{#if events.length === 0}
					<div class="log__empty">
						{#if status}
							Waiting for activity…
						{:else}
							Agent offline — start the agent to see live events.
						{/if}
					</div>
				{/if}

				{#each events as evt (evt.time + Math.random())}
					<div class="log-row log-row--{evt.type}">
						<span class="log-row__time">{fmtTime(evt.time)}</span>
						<span class="log-row__badge log-badge--{evt.type}">
							{evt.type}
						</span>
						{#if evt.type === "cut"}
							<span class="log-row__path">{evt.port ?? "?"}</span>
							<span class="log-row__bytes">{evt.bytes != null ? fmtBytes(evt.bytes) : ""}</span>
							<span class="log-row__dur">{evt.durationMs != null ? `${evt.durationMs}ms` : ""}</span>
						{:else if evt.type === "info"}
							<span class="log-row__msg">{evt.message}</span>
						{:else}
							<span class="log-row__method">{evt.method ?? ""}</span>
							<span class="log-row__path">{evt.path ?? ""}</span>
							{#if evt.status}
								<span class="log-row__status" class:log-row__status--err={evt.status >= 400}>
									{evt.status}
								</span>
							{/if}
							{#if evt.durationMs != null}
								<span class="log-row__dur">{evt.durationMs}ms</span>
							{/if}
							{#if evt.message}
								<span class="log-row__msg">{evt.message}</span>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Manual test panel -->
		<div class="panel panel--test">
			<div class="panel__header">
				<h2 class="panel__title">Manual Test</h2>
				<button class="btn-icon" onclick={fetchPorts} title="Refresh ports">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
				</button>
			</div>

			<div class="test-fields">
				<div class="field">
					<label class="field__label" for="test-port">Port</label>
					<select class="field__select" id="test-port" bind:value={testPort}>
						<option value="auto">auto-detect</option>
						{#each testPorts as p}
							<option value={p.name}>{p.name}{p.product ? ` — ${p.product}` : ""}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label class="field__label" for="test-baud">Baud rate</label>
					<select class="field__select" id="test-baud" bind:value={testBaud}>
						{#each BAUD_RATES as rate}
							<option value={rate}>{rate.toLocaleString()}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="field">
				<label class="field__label" for="test-hpgl">HPGL payload</label>
				<textarea
					class="field__textarea"
					id="test-hpgl"
					bind:value={testHPGL}
					rows={6}
					placeholder="IN;SP1;PU0,0;PD100,0;PU;SP0;"
					spellcheck="false"
				></textarea>
			</div>

			<button
				class="btn btn--primary btn--full"
				onclick={sendTest}
				disabled={testLoading || !status}
			>
				{testLoading ? "Sending…" : "Send Test Job"}
			</button>

			{#if testResult}
				<div class="test-result" class:test-result--ok={testResult.ok} class:test-result--err={!testResult.ok}>
					<span class="test-result__icon">{testResult.ok ? "✓" : "✗"}</span>
					<span class="test-result__msg">{testResult.message}</span>
				</div>
			{/if}

			{#if !status}
				<p class="test-offline">Agent must be running to send test jobs.</p>
			{/if}

			<!-- Known ports summary -->
			{#if testPorts.length > 0}
				<div class="ports-list">
					<p class="ports-list__title">Detected ports</p>
					{#each testPorts as p}
						<div class="port-row">
							<span class="port-row__name">{p.name}</span>
							{#if p.isUSB}
								<span class="port-row__badge">USB</span>
							{/if}
							{#if p.product}
								<span class="port-row__desc">{p.product}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- ── Setup guide ───────────────────────────── -->
	<div class="guide">

		<!-- How it works -->
		<section class="guide-section">
			<p class="guide-eyebrow">Overview</p>
			<h2 class="guide-title">How the agent works</h2>
			<p class="guide-lead">
				The Cut Agent is a tiny background process that runs on your machine and acts as a bridge
				between the OmniPlot web app and your USB or serial cutter. Because browsers can't open
				serial ports directly in Firefox, Safari, or most non-Chrome browsers, the agent handles
				that layer for you.
			</p>

			<!-- Flow diagram -->
			<div class="flow">
				<div class="flow-node">
					<div class="flow-node__icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20M2 12h20"/></svg>
					</div>
					<div class="flow-node__body">
						<span class="flow-node__name">OmniPlot Studio</span>
						<span class="flow-node__sub">Your browser</span>
					</div>
				</div>
				<div class="flow-arrow" aria-hidden="true">
					<span class="flow-arrow__label">HPGL over HTTP</span>
					<svg width="40" height="12" viewBox="0 0 40 12" fill="none" aria-hidden="true"><path d="M0 6h36M30 1l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</div>
				<div class="flow-node flow-node--agent">
					<div class="flow-node__icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M6 8l3 3-3 3M11 14h4"/></svg>
					</div>
					<div class="flow-node__body">
						<span class="flow-node__name">Cut Agent</span>
						<span class="flow-node__sub">localhost:7878</span>
					</div>
				</div>
				<div class="flow-arrow" aria-hidden="true">
					<span class="flow-arrow__label">USB / Serial</span>
					<svg width="40" height="12" viewBox="0 0 40 12" fill="none" aria-hidden="true"><path d="M0 6h36M30 1l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</div>
				<div class="flow-node">
					<div class="flow-node__icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
					</div>
					<div class="flow-node__body">
						<span class="flow-node__name">Your Cutter</span>
						<span class="flow-node__sub">Roland, Graphtec, etc.</span>
					</div>
				</div>
			</div>

			<p class="guide-note">
				The agent only listens on <code>127.0.0.1</code> — it is not reachable from outside your
				machine. No data leaves your computer. No telemetry. No license check.
			</p>
		</section>

		<!-- Setup steps -->
		<section class="guide-section">
			<p class="guide-eyebrow">Quick setup</p>
			<h2 class="guide-title">Up and cutting in 4 steps</h2>

			<div class="steps">

				<!-- Step 1 -->
				<div class="step">
					<div class="step__num">1</div>
					<div class="step__body">
						<h3 class="step__title">Download the agent for your OS</h3>
						<p class="step__desc">
							Pick your platform below. Single binary — no installer, no runtime, no admin rights needed on Mac or Linux.
						</p>
						<div class="download-row">
							{#each Object.entries(DOWNLOADS) as [pid, d]}
								<a
									href={dlUrl(d.file, pid)}
									class="dl-btn"
									class:dl-btn--detected={pid === detectedPlatform}
								>
									{#if pid === detectedPlatform}
										<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
									{/if}
									{d.label}
								</a>
							{/each}
						</div>
					</div>
				</div>

				<!-- Step 2 -->
				<div class="step">
					<div class="step__num">2</div>
					<div class="step__body">
						<h3 class="step__title">Run the binary</h3>
						<p class="step__desc">
							No install required. Choose the method that suits you — the quick-click option works
							for most users, or use the terminal for full control.
						</p>

						<!-- Simple click-to-run -->
						<div class="run-simple">
							<p class="run-simple__label">Simple — no terminal needed</p>
							{#if detectedPlatform === "windows"}
								<ol class="run-simple__steps">
									<li>Find <code>omniplot-agent-windows-amd64.exe</code> in your Downloads folder</li>
									<li>Double-click it to run</li>
									<li>If Windows Defender appears, click <strong>More info</strong> → <strong>Run anyway</strong></li>
									<li>A black terminal window opens — that means it's running. Leave it open.</li>
								</ol>
							{:else if detectedPlatform === "mac-arm" || detectedPlatform === "mac-intel"}
								<ol class="run-simple__steps">
									<li>Find the downloaded file in Finder</li>
									<li><strong>Right-click</strong> (or Control-click) the file → <strong>Open</strong></li>
									<li>Click <strong>Open</strong> again in the security dialog — you only need to do this once</li>
									<li>A terminal window opens showing the agent is running. Leave it open.</li>
								</ol>
							{:else}
								<ol class="run-simple__steps">
									<li>Find the downloaded file in your file manager</li>
									<li>Right-click → <strong>Properties → Permissions</strong> → tick "Allow executing as program"</li>
									<li>Double-click to run, or right-click → <strong>Run as Program</strong></li>
									<li>A terminal window opens showing the agent is running. Leave it open.</li>
								</ol>
							{/if}
						</div>

						<!-- Terminal / advanced -->
						<div class="run-advanced">
							<p class="run-advanced__label">Advanced — terminal</p>
							<div class="code-tabs">
								<div class="code-tab" class:code-tab--active={detectedPlatform === "linux"}>
									<span class="code-tab__label">Linux</span>
									<pre class="code-block"><span class="c-dim">$</span> <span class="c-cmd">chmod +x omniplot-agent-linux-amd64</span>
<span class="c-dim">$</span> <span class="c-cmd">./omniplot-agent-linux-amd64</span>
<span class="c-out">{`{"agent":"omniplot-cut-agent","version":"${AGENT_VERSION}","port":7878}`}</span>
<span class="c-ok">OmniPlot Cut Agent v{AGENT_VERSION} listening on http://127.0.0.1:7878</span></pre>
								</div>
								<div class="code-tab" class:code-tab--active={detectedPlatform === "mac-arm" || detectedPlatform === "mac-intel"}>
									<span class="code-tab__label">macOS</span>
									<pre class="code-block"><span class="c-dim">$</span> <span class="c-cmd">xattr -c omniplot-agent-darwin-arm64   <span class="c-comment"># removes Gatekeeper quarantine</span></span>
<span class="c-dim">$</span> <span class="c-cmd">chmod +x omniplot-agent-darwin-arm64</span>
<span class="c-dim">$</span> <span class="c-cmd">./omniplot-agent-darwin-arm64</span>
<span class="c-out">{`{"agent":"omniplot-cut-agent","version":"${AGENT_VERSION}","port":7878}`}</span>
<span class="c-ok">OmniPlot Cut Agent v{AGENT_VERSION} listening on http://127.0.0.1:7878</span></pre>
								</div>
								<div class="code-tab" class:code-tab--active={detectedPlatform === "windows"}>
									<span class="code-tab__label">Windows</span>
									<pre class="code-block"><span class="c-dim">></span> <span class="c-cmd">omniplot-agent-windows-amd64.exe</span>
<span class="c-out">{`{"agent":"omniplot-cut-agent","version":"${AGENT_VERSION}","port":7878}`}</span>
<span class="c-ok">OmniPlot Cut Agent v{AGENT_VERSION} listening on http://127.0.0.1:7878</span></pre>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Step 3 -->
				<div class="step">
					<div class="step__num">3</div>
					<div class="step__body">
						<h3 class="step__title">Select "Cut Agent" in Plotter Settings</h3>
						<p class="step__desc">
							In the Studio, open <strong>Plotter Settings → Connection</strong> and choose <strong>Cut Agent</strong>.
							OmniPlot will ping <code>localhost:7878</code> and confirm it's reachable.
							The status dot at the top of this page turns green when the connection is live.
						</p>
						<div class="tip-box">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
							<span>If you use a custom port (<code>--port 7879</code>), update the Agent URL in Plotter Settings to match.</span>
						</div>
					</div>
				</div>

				<!-- Step 4 -->
				<div class="step">
					<div class="step__num">4</div>
					<div class="step__body">
						<h3 class="step__title">Send a test job</h3>
						<p class="step__desc">
							Use the <strong>Manual Test</strong> panel above to send a small HPGL payload before cutting real film.
							The default payload draws a 500-unit square — safe to run dry (no film loaded) to confirm
							the cutter receives commands. Watch the Live Log for the cut event and confirmed byte count.
						</p>
						<div class="tip-box">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
							<span>Leave port on <code>auto</code> — the agent picks the first USB-serial device. Set an explicit port only if you have multiple cutters attached.</span>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Troubleshooting -->
		<section class="guide-section">
			<p class="guide-eyebrow">Troubleshooting</p>
			<h2 class="guide-title">Common issues</h2>

			<div class="trouble-list">
				{#each TROUBLE as item, i}
					<div class="trouble-item" class:trouble-item--open={openTrouble === i}>
						<button
							class="trouble-q"
							onclick={() => openTrouble = openTrouble === i ? null : i}
							aria-expanded={openTrouble === i}
						>
							<span>{item.q}</span>
							<svg
								class="trouble-chevron"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							><polyline points="6 9 12 15 18 9"/></svg>
						</button>
						{#if openTrouble === i}
							<div class="trouble-a">
								<p>{item.a}</p>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>

	</div>
</div>

<style>
	.agent-page {
		padding: 32px;
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* ── Header ────────────────────────────────── */
	.agent-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 24px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		flex-wrap: wrap;
	}
	.agent-header__left {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-danger, #e74c3c);
		flex-shrink: 0;
		transition: background 0.3s;
	}
	.status-dot--online {
		background: #2ecc71;
		box-shadow: 0 0 0 3px rgba(46, 204, 113, 0.2);
	}
	.agent-header__title {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		line-height: 1.3;
	}
	.version {
		font-weight: 400;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.875em;
	}
	.agent-header__sub {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 2px 0 0;
		font-family: var(--font-mono);
	}
	.agent-header__actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.kill-confirm-text {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	/* ── Buttons ───────────────────────────────── */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
		text-decoration: none;
		transition: opacity 0.12s, background 0.12s;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn--primary {
		background: var(--color-brand-dim);
		color: #fff;
	}
	.btn--danger {
		background: var(--color-danger, #e74c3c);
		color: #fff;
	}
	.btn--danger-outline {
		background: transparent;
		border-color: var(--color-danger, #e74c3c);
		color: var(--color-danger, #e74c3c);
	}
	.btn--ghost {
		background: var(--bg-surface-2);
		border-color: var(--border-default);
		color: var(--text-secondary);
	}
	.btn--full { width: 100%; justify-content: center; }
	.btn:not(:disabled):hover { opacity: 0.85; }

	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.btn-icon:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	/* ── Stats row ─────────────────────────────── */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 12px;
	}
	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.stat-card--error {
		border-color: var(--color-danger, #e74c3c);
		background: color-mix(in srgb, var(--color-danger, #e74c3c) 6%, var(--bg-surface));
	}
	.stat-card__value {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1;
	}
	.stat-card--error .stat-card__value { color: var(--color-danger, #e74c3c); }
	.stat-card__label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* ── Panels ────────────────────────────────── */
	.panels {
		display: grid;
		grid-template-columns: 1fr 340px;
		gap: 16px;
		align-items: start;
	}
	.panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}
	.panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.panel__title {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}
	.panel__controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.log-count {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
	}

	/* ── Log ───────────────────────────────────── */
	.log {
		height: 480px;
		overflow-y: auto;
		display: flex;
		flex-direction: column-reverse; /* newest at bottom, auto-scroll */
		padding: 8px 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.log__empty {
		padding: 24px 18px;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}
	.log-row {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 18px;
		line-height: 1.5;
		transition: background 0.08s;
	}
	.log-row:hover { background: var(--bg-surface-2); }
	.log-row__time {
		color: var(--text-tertiary);
		flex-shrink: 0;
		width: 76px;
	}
	.log-badge--cut     { color: var(--color-brand); }
	.log-badge--request { color: var(--text-tertiary); }
	.log-badge--error   { color: var(--color-danger, #e74c3c); }
	.log-badge--info    { color: #f59e0b; }
	.log-row__badge {
		flex-shrink: 0;
		width: 52px;
		font-weight: 600;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.log-row__method {
		color: var(--text-tertiary);
		flex-shrink: 0;
		width: 36px;
	}
	.log-row__path {
		color: var(--text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-row__status { color: var(--text-tertiary); flex-shrink: 0; }
	.log-row__status--err { color: var(--color-danger, #e74c3c); }
	.log-row__dur   { color: var(--text-tertiary); flex-shrink: 0; min-width: 48px; text-align: right; }
	.log-row__bytes { color: var(--text-secondary); flex-shrink: 0; }
	.log-row__msg   { color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* ── Test panel ────────────────────────────── */
	.panel--test {
		display: flex;
		flex-direction: column;
	}
	.panel--test .panel__header { flex-shrink: 0; }
	.test-fields,
	.field,
	.btn--full,
	.test-result,
	.test-offline,
	.ports-list {
		padding-left: 18px;
		padding-right: 18px;
	}
	.test-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding-top: 16px;
		padding-bottom: 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding-top: 0;
		padding-bottom: 0;
	}
	.field__label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.field__select,
	.field__textarea {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		padding: 7px 10px;
		width: 100%;
		transition: border-color 0.12s;
	}
	.field__select:focus,
	.field__textarea:focus {
		outline: none;
		border-color: var(--color-brand-dim);
	}
	.field__textarea {
		resize: vertical;
		min-height: 80px;
	}
	.field--textarea {
		padding-bottom: 10px;
	}
	.btn--full {
		margin: 10px 18px;
		width: calc(100% - 36px);
	}
	.test-result {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding-top: 10px;
		padding-bottom: 4px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}
	.test-result--ok { color: #2ecc71; }
	.test-result--err { color: var(--color-danger, #e74c3c); }
	.test-result__icon { flex-shrink: 0; font-weight: 700; }
	.test-result__msg { word-break: break-all; }
	.test-offline {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		padding-top: 8px;
		padding-bottom: 4px;
		margin: 0;
	}

	/* ── Ports list ────────────────────────────── */
	.ports-list {
		padding-top: 16px;
		padding-bottom: 18px;
		border-top: 1px solid var(--border-subtle);
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ports-list__title {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin: 0 0 4px;
	}
	.port-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.port-row__name { color: var(--text-primary); }
	.port-row__badge {
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
		font-size: 0.625rem;
		font-weight: 600;
		padding: 1px 5px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.port-row__desc { color: var(--text-tertiary); }

	/* ── Responsive ────────────────────────────── */
	@media (max-width: 960px) {
		.stats-row { grid-template-columns: repeat(3, 1fr); }
		.panels { grid-template-columns: 1fr; }
		.panel--log .log { height: 320px; }
	}
	@media (max-width: 600px) {
		.agent-page { padding: 16px; }
		.stats-row { grid-template-columns: repeat(2, 1fr); }
		.agent-header { flex-direction: column; align-items: flex-start; }
	}

	/* ── Guide ─────────────────────────────────── */
	.guide {
		display: flex;
		flex-direction: column;
		gap: 0;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		background: var(--bg-surface);
		overflow: hidden;
	}
	.guide-section {
		padding: 40px 48px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.guide-section:last-child { border-bottom: none; }

	.guide-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-brand);
		margin: 0 0 10px;
	}
	.guide-title {
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 14px;
	}
	.guide-lead {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.7;
		max-width: 680px;
		margin: 0 0 32px;
	}
	.guide-note {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin: 24px 0 0;
	}
	.guide-note code {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--text-primary);
	}

	/* ── Architecture flow ─────────────────────── */
	.flow {
		display: flex;
		align-items: center;
		gap: 0;
		flex-wrap: wrap;
		row-gap: 16px;
	}
	.flow-node {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 14px 18px;
	}
	.flow-node--agent {
		border-color: var(--color-brand-dim);
		background: color-mix(in srgb, var(--color-brand-dim) 8%, var(--bg-surface-2));
	}
	.flow-node__icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.flow-node--agent .flow-node__icon {
		color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand-dim) 14%, var(--bg-surface-3));
		border-color: var(--color-brand-dim);
	}
	.flow-node__body {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.flow-node__name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.flow-node__sub {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
	}
	.flow-arrow {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}
	.flow-arrow__label {
		font-size: 0.6875rem;
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	/* ── Setup steps ───────────────────────────── */
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.step {
		display: grid;
		grid-template-columns: 48px 1fr;
		gap: 0 20px;
		padding: 28px 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	.step:last-child { border-bottom: none; padding-bottom: 0; }
	.step:first-child { padding-top: 0; }
	.step__num {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--color-brand-dim);
		color: #fff;
		font-size: 0.875rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.step__title {
		font-size: 0.9375rem;
		font-weight: 700;
		margin: 0 0 8px;
		line-height: 1.3;
	}
	.step__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.65;
		margin: 0 0 16px;
		max-width: 620px;
	}
	.step__desc strong { color: var(--text-primary); font-weight: 600; }
	.step__desc code {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--text-primary);
	}

	/* Download row */
	.download-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 4px;
	}
	.dl-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 600;
		text-decoration: none;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.dl-btn:hover {
		border-color: var(--color-brand-dim);
		color: var(--text-primary);
	}
	.dl-btn--detected {
		border-color: var(--color-brand-dim);
		background: color-mix(in srgb, var(--color-brand-dim) 8%, var(--bg-surface-2));
		color: var(--text-primary);
	}
	.dl-btn--detected svg { color: var(--color-brand); }

	/* Simple run block */
	.run-simple {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 14px 18px;
		margin-bottom: 12px;
		max-width: 560px;
	}
	.run-simple__label,
	.run-advanced__label {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin: 0 0 10px;
	}
	.run-simple__steps {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.run-simple__steps li {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.55;
	}
	.run-simple__steps strong { color: var(--text-primary); font-weight: 600; }
	.run-simple__steps code {
		font-family: var(--font-mono);
		font-size: 0.8125em;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--text-primary);
	}

	/* Advanced run block */
	.run-advanced__label {
		margin-bottom: 8px;
	}

	/* Code tabs */
	.code-tabs {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 620px;
	}
	.code-tab {
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		opacity: 0.5;
		transition: opacity 0.15s;
	}
	.code-tab--active {
		opacity: 1;
		border-color: var(--color-brand-dim);
	}
	.code-tab__label {
		display: block;
		padding: 6px 14px;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-default);
	}
	.code-tab--active .code-tab__label {
		color: var(--color-brand);
		border-bottom-color: var(--color-brand-dim);
	}
	.code-block {
		margin: 0;
		padding: 14px 16px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.8;
		background: #0d1117;
		color: rgba(255,255,255,0.8);
		white-space: pre-wrap;
		word-break: break-all;
		overflow-x: auto;
	}
	.c-dim     { color: rgba(255,255,255,0.25); }
	.c-cmd     { color: #79c0ff; }
	.c-out     { color: #a5d6ff; }
	.c-ok      { color: rgba(255,255,255,0.45); }
	.c-comment { color: rgba(255,255,255,0.25); font-style: italic; }
	.code-tab__note {
		padding: 8px 14px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		background: var(--bg-surface-2);
		border-top: 1px solid var(--border-default);
		margin: 0;
	}

	/* Tip box */
	.tip-box {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 14px;
		background: color-mix(in srgb, var(--color-brand-dim) 8%, var(--bg-surface-2));
		border: 1px solid var(--color-brand-dim);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.55;
		max-width: 560px;
	}
	.tip-box svg { color: var(--color-brand); flex-shrink: 0; margin-top: 1px; }
	.tip-box code {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--text-primary);
	}

	/* ── Troubleshooting ───────────────────────── */
	.trouble-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		overflow: hidden;
		max-width: 760px;
	}
	.trouble-item {
		border-bottom: 1px solid var(--border-subtle);
	}
	.trouble-item:last-child { border-bottom: none; }
	.trouble-q {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 14px 18px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 600;
		text-align: left;
		transition: background 0.1s;
	}
	.trouble-q:hover { background: var(--bg-surface-2); }
	.trouble-item--open .trouble-q { background: var(--bg-surface-2); }
	.trouble-chevron {
		flex-shrink: 0;
		color: var(--text-tertiary);
		transition: transform 0.18s;
	}
	.trouble-item--open .trouble-chevron { transform: rotate(180deg); }
	.trouble-a {
		padding: 4px 18px 16px;
		background: var(--bg-surface-2);
	}
	.trouble-a p {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.7;
		margin: 0;
		font-family: var(--font-mono);
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* ── Guide responsive ──────────────────────── */
	@media (max-width: 840px) {
		.guide-section { padding: 28px 24px; }
		.flow { flex-direction: column; align-items: flex-start; gap: 8px; }
		.flow-arrow { flex-direction: row; padding: 0; }
		.flow-arrow svg { transform: rotate(90deg); }
	}
	@media (max-width: 600px) {
		.guide-section { padding: 24px 16px; }
		.step { grid-template-columns: 40px 1fr; }
		.download-row { flex-direction: column; }
		.dl-btn { width: fit-content; }
	}
</style>
