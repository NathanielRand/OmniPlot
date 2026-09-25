<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";
	import { tooltip } from "$lib/actions/tooltip";

	type Range = "7d" | "30d" | "90d" | "ytd";

	// Mirrors GET /api/admin/analytics
	interface Analytics {
		range: Range;
		start: string;
		users: { total: number; byTier: Record<string, number>; shopMembers: number; newUsers: number; activeUsers: number };
		shops: { total: number; byShopPlan: Record<string, number> };
		jobs: { total: number; pieces: number; failed: number; cutters: number };
		series: { date: string; signups: number; jobs: number; pieces: number }[];
		topSubjects: { label: string; jobs: number; pieces: number }[];
		recentJobs: { id: string; user: string; subject: string; status: string; pieces: number; createdAt: string | null }[];
	}

	const RANGE_LABELS: Record<Range, string> = {
		"7d":  "Last 7 days",
		"30d": "Last 30 days",
		"90d": "Last 90 days",
		"ytd": "Year to date",
	};

	let range   = $state<Range>("30d");
	let loading = $state(true);
	let error   = $state<string | null>(null);
	let stats   = $state<Analytics | null>(null);

	// MRR comes from the revenue endpoint, which is reconciled against Stripe.
	// It's slower (walks the Stripe ledger), so it loads on its own.
	let mrr        = $state<number | null>(null);
	let mrrLoading = $state(true);
	let mrrError   = $state(false);
	let subscribers = $state<number | null>(null);

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	let requestSeq = 0;
	async function load(r: Range) {
		const seq = ++requestSeq;
		loading = true;
		error   = null;
		try {
			const res = await fetch(`/api/admin/analytics?range=${r}`, { headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load analytics");
			const data = await res.json();
			if (seq === requestSeq) stats = data; // ignore a slower, older range
		} catch (e) {
			if (seq === requestSeq) error = e instanceof Error ? e.message : "Could not load data";
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	async function loadMrr() {
		mrrLoading = true;
		mrrError   = false;
		try {
			const res = await fetch("/api/admin/revenue", { headers: await authHeaders() });
			if (!res.ok) throw new Error();
			const rev = await res.json();
			mrr = rev.mrr ?? null;
			subscribers = rev.activeSubscribers ?? null;
		} catch {
			mrrError = true;
		} finally {
			mrrLoading = false;
		}
	}

	onMount(() => { loadMrr(); });
	$effect(() => { load(range); });

	function setRange(r: Range) { range = r; }

	const fmtUsd = (cents: number) =>
		new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
	const fmtDay = (iso: string) =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

	// ── Daily charts ──
	// Weeks instead of days past ~45 buckets, so bars stay readable.
	const buckets = $derived.by(() => {
		const s = stats?.series ?? [];
		if (s.length <= 45) return s.map((d) => ({ ...d, label: fmtDay(d.date) }));
		const out: { date: string; label: string; signups: number; jobs: number; pieces: number }[] = [];
		for (let i = 0; i < s.length; i += 7) {
			const wk = s.slice(i, i + 7);
			out.push({
				date: wk[0].date,
				label: `Week of ${fmtDay(wk[0].date)}`,
				signups: wk.reduce((a, d) => a + d.signups, 0),
				jobs: wk.reduce((a, d) => a + d.jobs, 0),
				pieces: wk.reduce((a, d) => a + d.pieces, 0),
			});
		}
		return out;
	});
	const perWeek  = $derived((stats?.series.length ?? 0) > 45);
	const maxJobs    = $derived(Math.max(1, ...buckets.map((b) => b.jobs)));
	const maxSignups = $derived(Math.max(1, ...buckets.map((b) => b.signups)));

	// ── Breakdown rows ──
	const TIER_ORDER = ["free", "lite", "pro", "admin"];
	const tierRows = $derived.by(() => {
		const bt = stats?.users.byTier ?? {};
		const keys = [...new Set([...TIER_ORDER, ...Object.keys(bt)])].filter((k) => (bt[k] ?? 0) > 0);
		return keys.map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), count: bt[k] }));
	});
	const shopRows = $derived(
		Object.entries(stats?.shops.byShopPlan ?? {})
			.sort((a, b) => b[1] - a[1])
			.map(([k, count]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), count })),
	);
	const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
	const maxSubjectJobs = $derived(Math.max(1, ...(stats?.topSubjects ?? []).map((s) => s.jobs)));
</script>

<svelte:head><title>Analytics — Admin — OmniPlot</title></svelte:head>

<div class="analytics-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Analytics</h1>
			<p class="page-sub">Usage and growth. Totals are all-time; everything else follows the range.</p>
		</div>
		<div class="range-tabs" role="group" aria-label="Date range">
			{#each (["7d", "30d", "90d", "ytd"] as Range[]) as r}
				<button class="range-tab" class:active={range === r} aria-pressed={range === r} onclick={() => setRange(r)}>
					{RANGE_LABELS[r]}
				</button>
			{/each}
		</div>
	</div>

	{#if error}
		<div class="load-error"><p>{error}</p><button class="retry-btn" onclick={() => load(range)}>Retry</button></div>
	{/if}

	<!-- KPI row -->
	<div class="kpi-row">
		{#if loading && !stats}
			{#each { length: 4 } as _}
				<div class="kpi-card">
					<div class="skel skel--label"></div>
					<div class="skel skel--value"></div>
					<div class="skel skel--sub"></div>
				</div>
			{/each}
		{:else if stats}
			<div class="kpi-card">
				<div class="kpi-label">Users</div>
				<div class="kpi-value">{stats.users.total.toLocaleString()}</div>
				<div class="kpi-note">+{stats.users.newUsers.toLocaleString()} new · {RANGE_LABELS[range].toLowerCase()}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Active users</div>
				<div class="kpi-value">{stats.users.activeUsers.toLocaleString()}</div>
				<div class="kpi-note">signed in · {RANGE_LABELS[range].toLowerCase()}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Cut jobs</div>
				<div class="kpi-value">{stats.jobs.total.toLocaleString()}</div>
				<div class="kpi-note">{stats.jobs.pieces.toLocaleString()} pieces · {stats.jobs.cutters} {stats.jobs.cutters === 1 ? "user" : "users"}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">MRR</div>
				{#if mrrLoading}
					<div class="skel skel--value"></div>
					<div class="skel skel--sub"></div>
				{:else if mrrError || mrr === null}
					<div class="kpi-value kpi-value--dim">—</div>
					<div class="kpi-note">Couldn't reach Stripe · <a href="/admin/revenue">Revenue</a></div>
				{:else}
					<div class="kpi-value">{fmtUsd(mrr)}</div>
					<div class="kpi-note">{subscribers ?? 0} paying · <a href="/admin/revenue">details</a></div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Daily charts -->
	<div class="chart-row">
		{#each [
			{ title: "Cut jobs", key: "jobs" as const, max: maxJobs, empty: "No cut jobs in this range" },
			{ title: "Sign-ups", key: "signups" as const, max: maxSignups, empty: "No sign-ups in this range" },
		] as chart (chart.key)}
			<div class="admin-panel">
				<div class="admin-panel__header">
					<h2 class="admin-panel__title">{chart.title} {perWeek ? "per week" : "per day"}</h2>
					{#if stats}<span class="chart-note">{RANGE_LABELS[range]}</span>{/if}
				</div>
				<div class="chart-body" class:chart-body--stale={loading && !!stats}>
					{#if !stats}
						<div class="skel" style="width:100%;height:140px;border-radius:8px;"></div>
					{:else if buckets.every((b) => b[chart.key] === 0)}
						<div class="chart-empty"><p>{chart.empty}</p></div>
					{:else}
						<div class="bars" role="img" aria-label="{chart.title} {perWeek ? 'per week' : 'per day'}, {RANGE_LABELS[range]}">
							<span class="bars__max">{chart.max}</span>
							{#each buckets as b (b.date)}
								<div class="bars__col" use:tooltip={`${b.label}: ${b[chart.key]} ${chart.key === "jobs" ? `job${b[chart.key] === 1 ? "" : "s"} · ${b.pieces} pcs` : `sign-up${b[chart.key] === 1 ? "" : "s"}`}`}>
									<div class="bars__bar" style="height: {(b[chart.key] / chart.max) * 100}%"></div>
								</div>
							{/each}
						</div>
						<div class="chart-labels">
							<span>{buckets[0]?.label.replace("Week of ", "")}</span>
							<span>{buckets[buckets.length - 1]?.label.replace("Week of ", "")}</span>
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Breakdown + top subjects -->
	<div class="bottom-row">
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Plans</h2>
				{#if stats}<span class="chart-note">all-time</span>{/if}
			</div>
			<div class="tier-body">
				{#if !stats}
					{#each { length: 4 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}
				{:else}
					<div class="tier-group-label">Accounts · {stats.users.total}</div>
					{#each tierRows as t (t.label)}
						<div class="tier-row">
							<div class="tier-label">{t.label}</div>
							<div class="tier-bar-wrap"><div class="tier-bar" style="width:{pct(t.count, stats.users.total)}%"></div></div>
							<div class="tier-count">{t.count}</div>
							<div class="tier-pct">{pct(t.count, stats.users.total)}%</div>
						</div>
					{/each}
					<div class="tier-foot">{stats.users.shopMembers} of these belong to a shop.</div>

					<div class="tier-group-label tier-group-label--spaced">Shops · {stats.shops.total}</div>
					{#each shopRows as t (t.label)}
						<div class="tier-row">
							<div class="tier-label">{t.label}</div>
							<div class="tier-bar-wrap"><div class="tier-bar" style="width:{pct(t.count, stats.shops.total)}%"></div></div>
							<div class="tier-count">{t.count}</div>
							<div class="tier-pct">{pct(t.count, stats.shops.total)}%</div>
						</div>
					{:else}
						<div class="tier-foot">No shops yet.</div>
					{/each}
				{/if}
			</div>
		</div>

		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Top subjects</h2>
				<span class="chart-note">by cut jobs</span>
			</div>
			{#if !stats}
				<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
			{:else if stats.topSubjects.length === 0}
				<div class="panel-empty"><p>No cut jobs in this range</p></div>
			{:else}
				<div class="table-scroll">
					<table class="mini-table" aria-label="Top subjects by cut jobs">
						<thead><tr><th>Subject</th><th>Jobs</th><th>Pcs</th></tr></thead>
						<tbody>
							{#each stats.topSubjects as s (s.label)}
								<tr>
									<td>
										<div class="subject-cell">
											<span class="td-vehicle">{s.label}</span>
											<span class="subject-bar" style="width:{(s.jobs / maxSubjectJobs) * 100}%" aria-hidden="true"></span>
										</div>
									</td>
									<td class="td-mono">{s.jobs}</td>
									<td class="td-mono">{s.pieces}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>

	<!-- Recent jobs -->
	<div class="admin-panel">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">Recent cut jobs</h2>
			{#if stats}<span class="chart-note">{stats.jobs.failed} failed · {RANGE_LABELS[range].toLowerCase()}</span>{/if}
		</div>
		{#if !stats}
			<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
		{:else if stats.recentJobs.length === 0}
			<div class="panel-empty"><p>No cut jobs in this range</p></div>
		{:else}
			<div class="table-scroll">
				<table class="mini-table" aria-label="Recent cut jobs">
					<thead><tr><th>When</th><th>User</th><th>Subject</th><th>Pcs</th><th>Status</th></tr></thead>
					<tbody>
						{#each stats.recentJobs as j (j.id)}
							<tr>
								<td class="td-mono">{j.createdAt ? new Date(j.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
								<td class="td-user">{j.user}</td>
								<td class="td-vehicle">{j.subject}</td>
								<td class="td-mono">{j.pieces}</td>
								<td>
									<Badge variant={j.status === "complete" || j.status === "completed" ? "success" : j.status === "error" || j.status === "failed" ? "danger" : "default"} size="sm" dot>
										{j.status}
									</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<style>
	.analytics-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1200px;
		margin: 0 auto;
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
	.kpi-label { font-size: 0.6875rem; font-weight: 600; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.kpi-value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; }
	.kpi-value--dim { color: var(--text-tertiary); }
	.kpi-note  { font-size: 0.75rem; color: var(--text-tertiary); }
	.kpi-note a { color: var(--text-brand); text-decoration: none; }
	.kpi-note a:hover { text-decoration: underline; }

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

	/* Panels */
	.chart-row  { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.bottom-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.admin-panel { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; }
	.admin-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); }
	.admin-panel__title  { font-size: 0.9375rem; font-weight: 600; }
	.chart-note          { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); }

	.chart-body { padding: 16px; transition: opacity 0.15s; }
	.chart-body--stale { opacity: 0.5; }

	/* Bar chart — single series, one hue, bars anchored to the baseline */
	.bars {
		position: relative;
		height: 140px;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		padding-top: 14px;
		border-bottom: 1px solid var(--border-default);
	}
	.bars__max {
		position: absolute; top: 0; left: 0;
		font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary);
	}
	.bars__col {
		flex: 1; min-width: 0; height: 100%;
		display: flex; align-items: flex-end;
		cursor: default;
	}
	.bars__bar {
		width: 100%;
		background: var(--text-brand);
		border-radius: 4px 4px 0 0;
		transition: opacity 0.12s;
	}
	.bars__col:hover .bars__bar { opacity: 0.75; }
	.bars__col:hover { background: var(--interactive-hover); border-radius: 4px 4px 0 0; }

	.chart-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); }

	.chart-empty, .panel-empty {
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 32px 16px; color: var(--text-tertiary); text-align: center;
	}
	.chart-empty p, .panel-empty p { margin: 0; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }

	/* Plans breakdown */
	.tier-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
	.tier-group-label {
		width: 100%; font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono);
		text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-tertiary);
		padding-bottom: 2px; border-bottom: 1px solid var(--border-subtle);
	}
	.tier-group-label--spaced { margin-top: 6px; }
	.tier-row  { display: grid; grid-template-columns: 56px 1fr 36px 34px; align-items: center; gap: 8px; width: 100%; }
	.tier-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
	.tier-bar-wrap { height: 6px; background: var(--bg-surface-3); border-radius: 3px; overflow: hidden; }
	.tier-bar   { height: 100%; border-radius: 3px; background: var(--text-brand); transition: width 0.4s var(--ease-smooth); }
	.tier-count { font-family: var(--font-mono); font-size: 0.75rem; text-align: right; color: var(--text-primary); }
	.tier-pct   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); text-align: right; }
	.tier-foot  { font-size: 0.75rem; color: var(--text-tertiary); }

	/* Tables */
	.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
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
	.td-user    { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-vehicle { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; white-space: nowrap; }

	.subject-cell { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }
	.subject-bar  { display: block; height: 4px; border-radius: 2px; background: var(--text-brand); opacity: 0.7; }

	@media (max-width: 1000px) { .chart-row, .bottom-row { grid-template-columns: 1fr; } }
	@media (max-width: 900px)  { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 480px) {
		.analytics-page { padding: 16px; }
		.kpi-row { grid-template-columns: 1fr; }
		.range-tabs { flex-wrap: wrap; }
		.range-tab { flex: 1 1 40%; text-align: center; }
		.tier-row { grid-template-columns: 48px 1fr 30px 30px; gap: 6px; }
	}
</style>
