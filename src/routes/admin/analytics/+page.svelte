<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";

	type Range = "7d" | "30d" | "90d" | "ytd";

	let range   = $state<Range>("30d");
	let loading = $state(true);
	let error   = $state<string | null>(null);

	let stats = $state<{
		users: {
			total: number;
			byTier: { free: number; lite: number; pro: number; admin: number };
			activeToday: number;
		};
		jobs: {
			today: number;
			recent: { id: string; userEmail: string; vehicleName: string; status: string; pieces: number; createdAt: string | null }[];
		};
	} | null>(null);

	onMount(async () => {
		try {
			const token = await auth.currentUser?.getIdToken();
			const res   = await fetch("/api/admin/stats", {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error("Failed to load analytics");
			stats = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load data";
		} finally {
			loading = false;
		}
	});

	const RANGE_LABELS: Record<Range, string> = {
		"7d":  "Last 7 days",
		"30d": "Last 30 days",
		"90d": "Last 90 days",
		"ytd": "Year to date",
	};

	// Tier distribution — computed from real data
	const tierRows = $derived(stats ? [
		{ label: "Free",  count: stats.users.byTier.free,  color: "var(--text-tertiary)" },
		{ label: "Lite",  count: stats.users.byTier.lite,  color: "#a78bfa" },
		{ label: "Pro",   count: stats.users.byTier.pro,   color: "#60a5ff" },
	] : []);

	const totalUsers = $derived(stats?.users.total ?? 0);

	function tierPct(count: number): number {
		return totalUsers ? Math.round((count / totalUsers) * 100) : 0;
	}

	// Donut segments (SVG stroke-dasharray on circumference ≈ 100)
	const donutSegments = $derived(tierRows.map((t, i) => {
		const pct    = tierPct(t.count);
		const offset = 25 - tierRows.slice(0, i).reduce((s, r) => s + tierPct(r.count), 0);
		return { ...t, pct, offset };
	}));

	const hasJobs = $derived((stats?.jobs.recent.length ?? 0) > 0);
</script>

<svelte:head><title>Analytics — Admin — OmniPlot</title></svelte:head>

<div class="analytics-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Analytics</h1>
			<p class="page-sub">Usage and growth metrics.</p>
		</div>
		<div class="range-tabs" role="group" aria-label="Date range">
			{#each (["7d", "30d", "90d", "ytd"] as Range[]) as r}
				<button class="range-tab" class:active={range === r} onclick={() => (range = r)}>
					{RANGE_LABELS[r]}
				</button>
			{/each}
		</div>
	</div>

	<!-- KPI row -->
	{#if loading}
		<div class="kpi-row">
			{#each { length: 4 } as _}
				<div class="kpi-card kpi-card--skeleton">
					<div class="skel skel--label"></div>
					<div class="skel skel--value"></div>
					<div class="skel skel--sub"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="load-error"><p>{error}</p><button class="retry-btn" onclick={() => location.reload()}>Retry</button></div>
	{:else if stats}
		<div class="kpi-row">
			{#each [
				{ label: "Total users",   value: stats.users.total.toLocaleString(),       note: "all accounts" },
				{ label: "Active today",  value: stats.users.activeToday.toLocaleString(), note: "updated in 24h" },
				{ label: "Cuts today",    value: stats.jobs.today.toLocaleString(),         note: "jobs processed" },
				{ label: "MRR",           value: "—",                                       note: "via Stripe Dashboard" },
			] as kpi}
				<div class="kpi-card">
					<div class="kpi-label">{kpi.label}</div>
					<div class="kpi-value">{kpi.value}</div>
					<div class="kpi-note">{kpi.note}</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Chart + tier breakdown -->
	<div class="chart-row">
		<!-- Jobs chart -->
		<div class="admin-panel chart-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Cut jobs — {RANGE_LABELS[range]}</h2>
				{#if hasJobs}
					<span class="chart-note">{stats?.jobs.recent.length ?? 0} recent jobs</span>
				{/if}
			</div>
			<div class="chart-body">
				{#if loading}
					<div class="chart-skeleton">
						<div class="skel" style="width:100%;height:80px;border-radius:8px;"></div>
					</div>
				{:else if !hasJobs}
					<div class="chart-empty">
						<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
						<p>No cut jobs recorded yet</p>
						<span>Job history will appear here once users start cutting.</span>
					</div>
				{:else}
					<div class="chart-note-banner">
						Historical time-series data is recorded as jobs are created. The chart will populate over time.
					</div>
					<div class="recent-bar-chart">
						{#each (stats?.jobs.recent ?? []).slice(0, 10).reverse() as j, i}
							<div class="bar-col" title="{j.vehicleName} — {j.status}">
								<div
									class="bar"
									class:bar--error={j.status === "error"}
									style="height: {20 + (i * 6)}%"
								></div>
							</div>
						{/each}
					</div>
					<div class="chart-labels">
						<span>Oldest</span>
						<span>Most recent</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Tier distribution -->
		<div class="admin-panel tier-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Tier distribution</h2>
				{#if stats}
					<span class="chart-note">{stats.users.total.toLocaleString()} total</span>
				{/if}
			</div>
			<div class="tier-body">
				{#if loading}
					{#each { length: 3 } as _}
						<div class="tier-row">
							<div class="skel" style="width:36px;height:12px"></div>
							<div class="skel" style="flex:1;height:6px;border-radius:3px"></div>
							<div class="skel" style="width:30px;height:10px"></div>
						</div>
					{/each}
				{:else if !totalUsers}
					<div class="chart-empty" style="padding:24px 0">
						<p>No users yet</p>
					</div>
				{:else}
					{#each tierRows as t}
						<div class="tier-row">
							<div class="tier-label">{t.label}</div>
							<div class="tier-bar-wrap">
								<div class="tier-bar" style="width: {tierPct(t.count)}%; background: {t.color}; opacity: 0.7"></div>
							</div>
							<div class="tier-count" style="color: {t.color}">{t.count}</div>
							<div class="tier-pct">{tierPct(t.count)}%</div>
						</div>
					{/each}
					{#if totalUsers > 0}
						<div class="tier-donut" aria-hidden="true">
							<svg viewBox="0 0 36 36" width="90" height="90">
								<circle cx="18" cy="18" r="15.9" fill="transparent" stroke="var(--bg-surface-3)" stroke-width="3.2"/>
								{#each donutSegments as seg}
									<circle
										cx="18" cy="18" r="15.9" fill="transparent"
										stroke={seg.color} stroke-width="3.2" stroke-opacity="0.75"
										stroke-dasharray="{seg.pct} {100 - seg.pct}"
										stroke-dashoffset={seg.offset}
										stroke-linecap="round"
									/>
								{/each}
							</svg>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- Bottom row: top vehicles + recent jobs -->
	<div class="bottom-row">
		<!-- Top vehicles (needs aggregate query — shows empty state until data exists) -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Top vehicles</h2>
				<span class="chart-note">by cut count</span>
			</div>
			{#if loading}
				<div style="padding:12px 16px;display:flex;flex-direction:column;gap:14px;">
					{#each { length: 5 } as _}
						<div style="display:flex;gap:10px;align-items:center;">
							<div class="skel" style="width:14px;height:10px"></div>
							<div class="skel" style="flex:1;height:10px;border-radius:4px"></div>
							<div class="skel" style="width:30px;height:10px"></div>
						</div>
					{/each}
				</div>
			{:else if !hasJobs}
				<div class="panel-empty">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
					<p>No jobs recorded yet</p>
					<span>Top vehicles appear once users start cutting.</span>
				</div>
			{:else}
				<div class="panel-empty">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
					<p>Aggregate ranking coming soon</p>
					<span>Requires a background aggregation job.</span>
				</div>
			{/if}
		</div>

		<!-- Recent jobs — live -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent cut jobs</h2>
			</div>
			{#if loading}
				<div style="padding:8px 0;">
					{#each { length: 5 } as _}
						<div style="padding:10px 14px;border-top:1px solid var(--border-subtle);display:flex;gap:10px;">
							<div class="skel" style="flex:1;height:10px"></div>
							<div class="skel" style="width:60px;height:10px"></div>
						</div>
					{/each}
				</div>
			{:else if !hasJobs}
				<div class="panel-empty">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/></svg>
					<p>No cut jobs yet</p>
				</div>
			{:else}
				<table class="mini-table" aria-label="Recent cut jobs">
					<thead>
						<tr><th>User</th><th>Vehicle</th><th>Pcs</th><th>Status</th></tr>
					</thead>
					<tbody>
						{#each (stats?.jobs.recent ?? []) as j}
							<tr>
								<td class="td-user">{j.userEmail.split("@")[0]}</td>
								<td class="td-vehicle">{j.vehicleName}</td>
								<td class="td-mono">{j.pieces}</td>
								<td>
									<Badge variant={j.status === "complete" || j.status === "completed" ? "success" : j.status === "error" ? "danger" : "default"} size="sm" dot>
										{j.status}
									</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</div>
</div>

<style>
	.analytics-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1200px;
	}

	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); }

	.range-tabs {
		display: flex; gap: 2px; background: var(--bg-surface);
		border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 3px;
	}
	.range-tab {
		padding: 5px 12px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body);
		background: transparent; border: none; border-radius: var(--radius-md);
		color: var(--text-tertiary); cursor: pointer; transition: all 0.12s;
	}
	.range-tab:hover  { color: var(--text-primary); }
	.range-tab.active { background: var(--bg-surface-3); color: var(--text-primary); }

	/* KPI */
	.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
	.kpi-card {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg); padding: 16px;
		display: flex; flex-direction: column; gap: 4px; transition: border-color 0.15s;
	}
	.kpi-card:hover { border-color: var(--border-default); }
	.kpi-card--skeleton { pointer-events: none; }

	.kpi-label { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono); }
	.kpi-value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; }
	.kpi-note  { font-size: 0.75rem; color: var(--text-tertiary); }

	/* Skeleton */
	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
	}
	.skel--label { height: 8px; width: 60%; }
	.skel--value { height: 28px; width: 50%; margin-top: 2px; }
	.skel--sub   { height: 8px; width: 70%; margin-top: 2px; }

	/* Error */
	.load-error { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; }
	.retry-btn  { margin-top: 8px; padding: 6px 14px; font-size: 0.8125rem; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; }
	.retry-btn:hover { background: var(--bg-surface-3); }

	/* Chart row */
	.chart-row { display: grid; grid-template-columns: 1fr 320px; gap: 16px; }
	.admin-panel { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; }
	.admin-panel__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); }
	.admin-panel__title  { font-size: 0.9375rem; font-weight: 600; }
	.chart-note          { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); }

	.chart-body { padding: 16px; }
	.chart-skeleton { padding: 4px 0; }
	.chart-note-banner {
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md); padding: 8px 12px; margin-bottom: 12px;
		font-size: 0.75rem; color: var(--text-tertiary); line-height: 1.5;
	}

	/* Mini bar chart from recent jobs */
	.recent-bar-chart {
		height: 60px; display: flex; align-items: flex-end; gap: 3px; margin-bottom: 8px;
	}
	.bar-col { flex: 1; display: flex; align-items: flex-end; }
	.bar {
		width: 100%; background: var(--color-brand-dim); opacity: 0.6;
		border-radius: 3px 3px 0 0; transition: opacity 0.12s; min-height: 4px;
	}
	.bar:hover  { opacity: 0.9; }
	.bar--error { background: var(--color-danger); }

	.chart-labels { display: flex; justify-content: space-between; font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); }

	/* Chart empty */
	.chart-empty {
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 32px 16px; color: var(--text-tertiary); text-align: center;
	}
	.chart-empty p    { margin: 0; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }
	.chart-empty span { font-size: 0.8125rem; }

	/* Tier panel */
	.tier-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; align-items: center; }
	.tier-row  { display: grid; grid-template-columns: 36px 1fr 44px 36px; align-items: center; gap: 8px; width: 100%; }
	.tier-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
	.tier-bar-wrap { height: 6px; background: var(--bg-surface-3); border-radius: 3px; overflow: hidden; }
	.tier-bar   { height: 100%; border-radius: 3px; transition: width 0.4s var(--ease-smooth); }
	.tier-count { font-family: var(--font-mono); font-size: 0.75rem; text-align: right; }
	.tier-pct   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); text-align: right; }
	.tier-donut { margin-top: 4px; }

	/* Bottom row */
	.bottom-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.panel-empty {
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 32px 16px; color: var(--text-tertiary); text-align: center;
	}
	.panel-empty p    { margin: 0; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }
	.panel-empty span { font-size: 0.8125rem; }

	/* Mini table */
	.mini-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.mini-table thead { background: var(--bg-surface-2); }
	.mini-table th {
		padding: 8px 14px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary); text-transform: uppercase;
		letter-spacing: 0.08em; border-bottom: 1px solid var(--border-subtle);
	}
	.mini-table tbody tr { border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.mini-table tbody tr:hover { background: var(--interactive-hover); }
	.mini-table td { padding: 9px 14px; vertical-align: middle; }
	.td-user    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary); }
	.td-vehicle { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; }

	@media (max-width: 1100px) { .chart-row { grid-template-columns: 1fr; } .bottom-row { grid-template-columns: 1fr; } }
	@media (max-width: 900px)  { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
</style>
