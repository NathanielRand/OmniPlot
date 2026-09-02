<svelte:head>
	<title>Plotter Errors — OmniPlot Admin</title>
</svelte:head>

<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import type { PlotterErrorReport } from "$lib/types";

	let reports  = $state<PlotterErrorReport[]>([]);
	let loading  = $state(true);
	let error    = $state("");
	let resolving = $state<Set<string>>(new Set());

	// ─── Filters ──────────────────────────────────
	let filterCode    = $state("all");
	let filterConn    = $state("all");
	let filterStatus  = $state<"all" | "open" | "resolved">("all");

	onMount(loadReports);

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async function loadReports() {
		loading = true;
		error = "";
		try {
			const res = await fetch("/api/admin/plotters?limit=200", { headers: await authHeader() });
			if (!res.ok) throw new Error(await res.text());
			const { reports: raw } = await res.json();
			reports = raw.map((r: PlotterErrorReport & { createdAt: string; resolvedAt: string | null }) => ({
				...r,
				createdAt:  new Date(r.createdAt),
				resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to load error reports.";
		} finally {
			loading = false;
		}
	}

	async function handleResolve(id: string) {
		const next = new Set(resolving);
		next.add(id);
		resolving = next;
		try {
			const res = await fetch(`/api/admin/plotters/${id}`, {
				method: "PATCH",
				headers: await authHeader(),
			});
			if (!res.ok) throw new Error(await res.text());
			reports = reports.map((r) =>
				r.id === id ? { ...r, resolvedAt: new Date() } : r,
			);
		} finally {
			const s = new Set(resolving);
			s.delete(id);
			resolving = s;
		}
	}

	// ─── Derived stats ────────────────────────────
	const totalCount    = $derived(reports.length);
	const openCount     = $derived(reports.filter((r) => !r.resolvedAt).length);
	const autoCount     = $derived(reports.filter((r) => r.autoReported && !r.resolvedAt).length);
	const allCodes      = $derived([...new Set(reports.map((r) => r.errorCode))].sort());
	const allConns      = $derived([...new Set(reports.map((r) => r.connection))].sort());

	const topCode = $derived(() => {
		const freq: Record<string, number> = {};
		for (const r of reports.filter((r) => !r.resolvedAt)) {
			freq[r.errorCode] = (freq[r.errorCode] ?? 0) + 1;
		}
		const [code, count] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
		return { code, count };
	});

	const filtered = $derived(
		reports.filter((r) => {
			if (filterCode !== "all" && r.errorCode !== filterCode) return false;
			if (filterConn !== "all" && r.connection !== filterConn) return false;
			if (filterStatus === "open" && r.resolvedAt) return false;
			if (filterStatus === "resolved" && !r.resolvedAt) return false;
			return true;
		}),
	);

	// ─── Formatting ───────────────────────────────
	function fmtDate(d: Date) {
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
	}

	function timeAgo(d: Date): string {
		const s = Math.floor((Date.now() - d.getTime()) / 1000);
		if (s < 60)   return `${s}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	}

	const CONN_LABEL: Record<string, string> = {
		"cut-agent":  "Agent",
		"usb-serial": "USB",
		"network":    "Network",
		"download":   "Download",
	};

	function codeBadge(code: string): "danger" | "warning" | "default" {
		if (["AGENT_HPGL_REJECT", "AGENT_ERROR", "NET_HTTP", "PROTO_GPGL", "UNKNOWN"].includes(code)) return "danger";
		if (["NET_REFUSED", "NET_TIMEOUT", "AGENT_OFFLINE", "SERIAL_DISCONNECT"].includes(code)) return "warning";
		return "default";
	}
</script>

<div class="page">
	<!-- ─── Header ─────────────────────────────── -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Plotter Errors</h1>
			<p class="page-sub">Connection and compatibility failures reported from user sessions.</p>
		</div>
		<button class="refresh-btn" onclick={loadReports} disabled={loading} aria-label="Refresh">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class:spinning={loading} aria-hidden="true">
				<polyline points="23 4 23 10 17 10"/>
				<path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
			</svg>
			{loading ? "Loading…" : "Refresh"}
		</button>
	</div>

	<!-- ─── Error banner ────────────────────────── -->
	{#if error}
		<div class="error-banner">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
			{error}
			<button class="link-btn" onclick={loadReports}>Retry</button>
		</div>
	{/if}

	<!-- ─── Stats ───────────────────────────────── -->
	<div class="stats-row">
		<div class="stat-card">
			<span class="stat-value">{totalCount}</span>
			<span class="stat-label">Total reports</span>
		</div>
		<div class="stat-card stat-card--warn">
			<span class="stat-value">{openCount}</span>
			<span class="stat-label">Open</span>
		</div>
		<div class="stat-card stat-card--danger">
			<span class="stat-value">{autoCount}</span>
			<span class="stat-label">Auto-escalated</span>
		</div>
		<div class="stat-card">
			<span class="stat-value stat-value--sm">{topCode().code}</span>
			<span class="stat-label">Top error ({topCode().count} open)</span>
		</div>
	</div>

	<!-- ─── Filters ─────────────────────────────── -->
	<div class="filters-bar">
		<select class="filter-select" bind:value={filterStatus} aria-label="Filter by status">
			<option value="all">All statuses</option>
			<option value="open">Open only</option>
			<option value="resolved">Resolved only</option>
		</select>

		<select class="filter-select" bind:value={filterCode} aria-label="Filter by error code">
			<option value="all">All codes</option>
			{#each allCodes as code}
				<option value={code}>{code}</option>
			{/each}
		</select>

		<select class="filter-select" bind:value={filterConn} aria-label="Filter by connection">
			<option value="all">All connections</option>
			{#each allConns as conn}
				<option value={conn}>{CONN_LABEL[conn] ?? conn}</option>
			{/each}
		</select>

		<span class="filter-count">{filtered.length} report{filtered.length !== 1 ? "s" : ""}</span>
	</div>

	<!-- ─── Table ───────────────────────────────── -->
	<div class="table-wrap">
		{#if loading && !reports.length}
			<div class="table-loading">
				{#each { length: 8 } as _}
					<div class="skel-row">
						<div class="skel skel--w40"></div>
						<div class="skel skel--w20"></div>
						<div class="skel skel--w20"></div>
						<div class="skel skel--w10"></div>
					</div>
				{/each}
			</div>
		{:else if !filtered.length}
			<div class="table-empty">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3" aria-hidden="true">
					<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
					<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
				</svg>
				<p>{filterCode !== "all" || filterConn !== "all" || filterStatus !== "all" ? "No reports match these filters." : "No error reports yet."}</p>
			</div>
		{:else}
			<table class="tbl">
				<thead>
					<tr>
						<th class="th">Error</th>
						<th class="th">Plotter</th>
						<th class="th">User</th>
						<th class="th th--center">Connection</th>
						<th class="th th--center">Source</th>
						<th class="th">When</th>
						<th class="th th--center">Status</th>
						<th class="th th--actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as report (report.id)}
						<tr class="tr" class:tr--resolved={!!report.resolvedAt}>
							<!-- Error code + title -->
							<td class="td td--error">
								<Badge variant={codeBadge(report.errorCode)} size="sm">{report.errorCode}</Badge>
								<span class="error-title">{report.errorTitle}</span>
								{#if report.errorRaw}
									<span class="error-raw" title={report.errorRaw}>{report.errorRaw.slice(0, 80)}{report.errorRaw.length > 80 ? "…" : ""}</span>
								{/if}
							</td>

							<!-- Plotter preset -->
							<td class="td">
								<span class="preset-name">{report.plotterPreset || "—"}</span>
								{#if report.protocol}
									<span class="preset-proto">{report.protocol.toUpperCase()}</span>
								{/if}
							</td>

							<!-- User -->
							<td class="td td--user">
								<span class="user-name">{report.displayName || report.userEmail || "Unknown"}</span>
								{#if report.userEmail}
									<span class="user-email">{report.userEmail}</span>
								{/if}
							</td>

							<!-- Connection type -->
							<td class="td td--center">
								<span class="conn-chip">{CONN_LABEL[report.connection] ?? report.connection}</span>
							</td>

							<!-- Auto vs manual report -->
							<td class="td td--center">
								{#if report.autoReported}
									<Badge variant="danger" size="sm">Auto</Badge>
								{:else}
									<Badge variant="default" size="sm">Manual</Badge>
								{/if}
							</td>

							<!-- Timestamp -->
							<td class="td td--time" title={fmtDate(report.createdAt)}>
								{timeAgo(report.createdAt)}
							</td>

							<!-- Resolved status -->
							<td class="td td--center">
								{#if report.resolvedAt}
									<Badge variant="success" size="sm">Resolved</Badge>
								{:else}
									<Badge variant="warning" size="sm">Open</Badge>
								{/if}
							</td>

							<!-- Actions -->
							<td class="td td--actions">
								{#if !report.resolvedAt}
									<button
										class="resolve-btn"
										onclick={() => handleResolve(report.id)}
										disabled={resolving.has(report.id)}
										aria-label="Mark as resolved"
									>
										{resolving.has(report.id) ? "…" : "Resolve"}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

</div>

<style>
	.page {
		padding: 32px;
		max-width: 1400px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* ─── Header ─── */
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.page-title {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text-primary);
		margin: 0 0 4px;
		letter-spacing: -0.02em;
	}

	.page-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.refresh-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
		white-space: nowrap;
	}

	.refresh-btn:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }
	.refresh-btn:disabled { opacity: 0.5; cursor: default; }

	@keyframes spin { to { transform: rotate(360deg); } }
	:global(.spinning) { animation: spin 0.8s linear infinite; }

	/* ─── Error banner ─── */
	.error-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		background: rgba(255, 77, 109, 0.08);
		border: 1px solid rgba(255, 77, 109, 0.25);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--color-danger, #ff4d6d);
	}

	.link-btn {
		background: none;
		border: none;
		color: var(--color-brand);
		cursor: pointer;
		font-size: 0.875rem;
		text-decoration: underline;
		padding: 0;
	}

	/* ─── Stats ─── */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 12px;
	}

	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-card--warn  { border-color: rgba(255, 160, 40, 0.3); }
	.stat-card--danger { border-color: rgba(255, 77, 109, 0.3); }

	.stat-value {
		font-family: var(--font-display);
		font-size: 2rem;
		font-weight: 800;
		color: var(--text-primary);
		line-height: 1;
	}

	.stat-value--sm {
		font-size: 0.875rem;
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* ─── Filters ─── */
	.filters-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.filter-select {
		padding: 6px 10px;
		font-size: 0.8125rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}

	.filter-count {
		margin-left: auto;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	/* ─── Table ─── */
	.table-wrap {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.tbl {
		width: 100%;
		border-collapse: collapse;
	}

	.th {
		padding: 10px 14px;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
		text-align: left;
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
		white-space: nowrap;
	}

	.th--center { text-align: center; }
	.th--actions { width: 80px; }

	.tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}

	.tr:last-child { border-bottom: none; }
	.tr:hover { background: var(--interactive-hover); }
	.tr--resolved { opacity: 0.5; }

	.td {
		padding: 12px 14px;
		font-size: 0.8125rem;
		color: var(--text-primary);
		vertical-align: top;
	}

	.td--center { text-align: center; vertical-align: middle; }
	.td--actions { text-align: right; vertical-align: middle; }
	.td--time { white-space: nowrap; color: var(--text-tertiary); vertical-align: middle; }

	/* Error column */
	.td--error {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 280px;
	}

	.error-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.error-raw {
		font-size: 0.6875rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		word-break: break-all;
	}

	/* Plotter column */
	.preset-name { display: block; font-weight: 500; }

	.preset-proto {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		background: var(--bg-surface-3);
		padding: 1px 5px;
		border-radius: 3px;
	}

	/* User column */
	.td--user { max-width: 180px; }
	.user-name { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.user-email { display: block; font-size: 0.75rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Connection chip */
	.conn-chip {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		padding: 2px 7px;
		border-radius: var(--radius-full, 999px);
		white-space: nowrap;
	}

	/* Resolve button */
	.resolve-btn {
		padding: 4px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
		white-space: nowrap;
	}

	.resolve-btn:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }
	.resolve-btn:disabled { opacity: 0.4; cursor: default; }

	/* Loading skeletons */
	.table-loading { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
	.skel-row { display: flex; gap: 12px; align-items: center; padding: 8px 6px; }
	.skel { height: 14px; border-radius: 4px; background: var(--bg-surface-3); animation: shimmer 1.4s infinite; }
	.skel--w40 { flex: 4; }
	.skel--w20 { flex: 2; }
	.skel--w10 { flex: 1; }

	@keyframes shimmer {
		0%, 100% { opacity: 0.6; }
		50%       { opacity: 0.3; }
	}

	/* Empty state */
	.table-empty {
		padding: 56px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}


	@media (max-width: 900px) {
		.stats-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
