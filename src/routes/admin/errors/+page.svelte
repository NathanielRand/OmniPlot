<svelte:head>
	<title>Errors — OmniPlot Admin</title>
</svelte:head>

<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import type { ErrorLogReport } from "$lib/types";

	let reports   = $state<ErrorLogReport[]>([]);
	let loading   = $state(true);
	let error     = $state("");
	let resolving = $state<Set<string>>(new Set());
	let expanded  = $state<Set<string>>(new Set());

	// ─── Filters ──────────────────────────────────
	let filterSource   = $state("all");
	let filterSeverity = $state("all");
	let filterStatus   = $state<"all" | "open" | "resolved">("all");

	onMount(loadReports);

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async function loadReports() {
		loading = true;
		error = "";
		try {
			const res = await fetch("/api/admin/errors?limit=200", { headers: await authHeader() });
			if (!res.ok) throw new Error(await res.text());
			const { reports: raw } = await res.json();
			reports = raw.map((r: ErrorLogReport & { firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null }) => ({
				...r,
				firstSeenAt: new Date(r.firstSeenAt),
				lastSeenAt:  new Date(r.lastSeenAt),
				resolvedAt:  r.resolvedAt ? new Date(r.resolvedAt) : null,
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to load error logs.";
		} finally {
			loading = false;
		}
	}

	async function handleResolve(id: string) {
		const next = new Set(resolving);
		next.add(id);
		resolving = next;
		try {
			const res = await fetch(`/api/admin/errors/${id}`, {
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

	function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id); else next.add(id);
		expanded = next;
	}

	// ─── Derived stats ────────────────────────────
	const totalCount   = $derived(reports.length);
	const openCount    = $derived(reports.filter((r) => !r.resolvedAt).length);
	const last24hCount = $derived(reports.filter((r) => Date.now() - r.lastSeenAt.getTime() < 86400000).length);
	const allSources   = $derived([...new Set(reports.map((r) => r.source))].sort());

	const topRoute = $derived(() => {
		const freq: Record<string, number> = {};
		for (const r of reports.filter((r) => !r.resolvedAt)) {
			freq[r.route] = (freq[r.route] ?? 0) + r.occurrenceCount;
		}
		const [route, count] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
		return { route, count };
	});

	const filtered = $derived(
		reports.filter((r) => {
			if (filterSource !== "all" && r.source !== filterSource) return false;
			if (filterSeverity !== "all" && r.severity !== filterSeverity) return false;
			if (filterStatus === "open" && r.resolvedAt) return false;
			if (filterStatus === "resolved" && !r.resolvedAt) return false;
			return true;
		}),
	);

	function fmtDate(d: Date) {
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
	}

	function timeAgo(d: Date): string {
		const s = Math.floor((Date.now() - d.getTime()) / 1000);
		if (s < 60)    return `${s}s ago`;
		if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	}

	const SOURCE_LABEL: Record<string, string> = {
		api:       "API",
		webhook:   "Webhook",
		unhandled: "Unhandled",
	};

	function severityBadge(s: string): "danger" | "warning" | "default" {
		return s === "error" ? "danger" : "warning";
	}
</script>

<div class="page">
	<!-- ─── Header ─────────────────────────────── -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Errors</h1>
			<p class="page-sub">Server-side failures from API routes, webhooks, and unhandled exceptions.</p>
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
			<span class="stat-label">Total fingerprints</span>
		</div>
		<div class="stat-card stat-card--warn">
			<span class="stat-value">{openCount}</span>
			<span class="stat-label">Unresolved</span>
		</div>
		<div class="stat-card stat-card--danger">
			<span class="stat-value">{last24hCount}</span>
			<span class="stat-label">Seen in last 24h</span>
		</div>
		<div class="stat-card">
			<span class="stat-value stat-value--sm">{topRoute().route}</span>
			<span class="stat-label">Top route ({topRoute().count} occurrences)</span>
		</div>
	</div>

	<!-- ─── Filters ─────────────────────────────── -->
	<div class="filters-bar">
		<select class="filter-select" bind:value={filterStatus} aria-label="Filter by status">
			<option value="all">All statuses</option>
			<option value="open">Open only</option>
			<option value="resolved">Resolved only</option>
		</select>

		<select class="filter-select" bind:value={filterSeverity} aria-label="Filter by severity">
			<option value="all">All severities</option>
			<option value="error">Error</option>
			<option value="warning">Warning</option>
		</select>

		<select class="filter-select" bind:value={filterSource} aria-label="Filter by source">
			<option value="all">All sources</option>
			{#each allSources as source}
				<option value={source}>{SOURCE_LABEL[source] ?? source}</option>
			{/each}
		</select>

		<span class="filter-count">{filtered.length} log{filtered.length !== 1 ? "s" : ""}</span>
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
				<p>{filterSource !== "all" || filterSeverity !== "all" || filterStatus !== "all" ? "No logs match these filters." : "No errors logged yet."}</p>
			</div>
		{:else}
			<table class="tbl">
				<thead>
					<tr>
						<th class="th">Error</th>
						<th class="th">Route</th>
						<th class="th th--center">Source</th>
						<th class="th th--center">Count</th>
						<th class="th">Last seen</th>
						<th class="th th--center">Status</th>
						<th class="th th--actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as report (report.id)}
						<tr class="tr" class:tr--resolved={!!report.resolvedAt}>
							<td class="td td--error" onclick={() => toggleExpand(report.id)}>
								<Badge variant={severityBadge(report.severity)} size="sm">{report.severity}</Badge>
								<span class="error-title">{report.message}</span>
								{#if expanded.has(report.id) && report.stack}
									<pre class="error-stack">{report.stack}</pre>
								{/if}
							</td>

							<td class="td">
								<span class="route-name">{report.route}</span>
							</td>

							<td class="td td--center">
								<span class="conn-chip">{SOURCE_LABEL[report.source] ?? report.source}</span>
							</td>

							<td class="td td--center">
								{report.occurrenceCount}
							</td>

							<td class="td td--time" title={fmtDate(report.lastSeenAt)}>
								{timeAgo(report.lastSeenAt)}
							</td>

							<td class="td td--center">
								{#if report.resolvedAt}
									<Badge variant="success" size="sm">Resolved</Badge>
								{:else}
									<Badge variant="warning" size="sm">Open</Badge>
								{/if}
							</td>

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

	.stat-card--warn   { border-color: rgba(255, 160, 40, 0.3); }
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

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

	.td--error {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 360px;
		cursor: pointer;
	}

	.error-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
		word-break: break-word;
	}

	.error-stack {
		font-size: 0.6875rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		white-space: pre-wrap;
		word-break: break-all;
		background: var(--bg-surface-3);
		border-radius: var(--radius-sm);
		padding: 8px;
		margin: 4px 0 0;
		max-height: 220px;
		overflow-y: auto;
	}

	.route-name {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.conn-chip {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		padding: 2px 7px;
		border-radius: var(--radius-full, 999px);
		white-space: nowrap;
	}

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
