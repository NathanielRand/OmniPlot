<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { formatRelativeTime } from "$lib/utils";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";

	// ── State ──────────────────────────────────────
	let loading = $state(true);
	let error   = $state<string | null>(null);

	let stats = $state<{
		users: {
			total: number;
			byTier: { free: number; lite: number; pro: number; admin: number };
			activeToday: number;
			recentSignups: { uid: string; displayName: string; email: string; tier: string; createdAt: string | null }[];
		};
		jobs: {
			today: number;
			recent: { id: string; userId: string; userEmail: string; vehicleName: string; status: string; pieces: number; createdAt: string | null }[];
		};
	} | null>(null);

	onMount(async () => {
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/admin/stats", {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			if (!res.ok) throw new Error("Failed to load stats");
			stats = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load stats";
		} finally {
			loading = false;
		}
	});

	// ── Derived metrics ─────────────────────────────
	const metrics = $derived(stats ? [
		{ label: "Total Users",       value: stats.users.total.toLocaleString(),          sub: "all accounts" },
		{ label: "Active Today",      value: stats.users.activeToday.toLocaleString(),    sub: "updated in 24h" },
		{ label: "Cuts Today",        value: stats.jobs.today.toLocaleString(),           sub: "jobs processed" },
		{ label: "MRR",               value: "—",                                         sub: "via Stripe" },
		{ label: "Free Users",        value: (stats.users.byTier.free  ?? 0).toLocaleString(), sub: pct(stats.users.byTier.free  ?? 0, stats.users.total) },
		{ label: "Lite Subscribers",  value: (stats.users.byTier.lite  ?? 0).toLocaleString(), sub: pct(stats.users.byTier.lite  ?? 0, stats.users.total) },
		{ label: "Pro Subscribers",   value: (stats.users.byTier.pro   ?? 0).toLocaleString(), sub: pct(stats.users.byTier.pro   ?? 0, stats.users.total) },
		{ label: "Admin Accounts",    value: (stats.users.byTier.admin ?? 0).toLocaleString(), sub: "platform staff" },
	] : []);

	function pct(n: number, total: number) {
		if (!total) return "0% of total";
		return `${Math.round((n / total) * 100)}% of total`;
	}

	const PATTERN_REQUESTS = $derived(
		patternStore.requests.filter((r) => r.status !== "done").slice(0, 4),
	);
</script>

<svelte:head><title>Admin — OmniPlot</title></svelte:head>

<div class="admin-overview">
	<div class="overview-header">
		<div>
			<h1 class="overview-title">Overview</h1>
			<p class="overview-sub">Platform health and key metrics at a glance.</p>
		</div>
		<Badge variant="success" dot>All systems operational</Badge>
	</div>

	<!-- Metrics grid -->
	{#if loading}
		<div class="metrics-grid">
			{#each { length: 8 } as _}
				<div class="metric-card metric-card--skeleton">
					<div class="skel skel--label"></div>
					<div class="skel skel--value"></div>
					<div class="skel skel--sub"></div>
				</div>
			{/each}
		</div>
	{:else if error}
		<div class="load-error">
			<p>{error}</p>
			<button class="retry-btn" onclick={() => location.reload()}>Retry</button>
		</div>
	{:else}
		<div class="metrics-grid">
			{#each metrics as m}
				<div class="metric-card">
					<div class="metric-card__label">{m.label}</div>
					<div class="metric-card__value">{m.value}</div>
					<div class="metric-card__sub">{m.sub}</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Two-column panels -->
	<div class="overview-cols">
		<!-- Recent signups -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent Signups</h2>
				<a href="/admin/users" class="admin-panel__link">View all →</a>
			</div>
			{#if loading}
				<div class="panel-skeleton">
					{#each { length: 4 } as _}
						<div class="skel-row">
							<div class="skel skel--avatar"></div>
							<div class="skel-lines">
								<div class="skel skel--name"></div>
								<div class="skel skel--email"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if !stats?.users.recentSignups.length}
				<div class="panel-empty">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
					<p>No users yet</p>
				</div>
			{:else}
				<table class="mini-table" aria-label="Recent signups">
					<thead>
						<tr><th>User</th><th>Tier</th><th>Joined</th></tr>
					</thead>
					<tbody>
						{#each stats.users.recentSignups as u}
							<tr>
								<td>
									<div class="user-cell">
										<div class="user-avatar" aria-hidden="true">{(u.displayName || u.email)[0]?.toUpperCase()}</div>
										<div>
											<div class="user-name">{u.displayName || "—"}</div>
											<div class="user-email">{u.email}</div>
										</div>
									</div>
								</td>
								<td>
									<Badge variant={u.tier === "pro" ? "pro" : u.tier === "lite" ? "lite" : "free"} size="sm">
										{u.tier}
									</Badge>
								</td>
								<td class="td-time">{u.createdAt ? formatRelativeTime(new Date(u.createdAt)) : "—"}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		<!-- Recent jobs -->
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Recent Cut Jobs</h2>
				<a href="/admin/analytics" class="admin-panel__link">View all →</a>
			</div>
			{#if loading}
				<div class="panel-skeleton">
					{#each { length: 4 } as _}
						<div class="skel-row">
							<div class="skel skel--name"></div>
							<div class="skel skel--email"></div>
						</div>
					{/each}
				</div>
			{:else if !stats?.jobs.recent.length}
				<div class="panel-empty">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/></svg>
					<p>No cut jobs yet</p>
				</div>
			{:else}
				<table class="mini-table" aria-label="Recent cut jobs">
					<thead>
						<tr><th>User</th><th>Vehicle</th><th>Status</th></tr>
					</thead>
					<tbody>
						{#each stats.jobs.recent.slice(0, 5) as j}
							<tr>
								<td class="td-email">{j.userEmail.split("@")[0]}</td>
								<td class="td-vehicle">{j.vehicleName}</td>
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

	<!-- Pattern requests -->
	<div class="admin-panel">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">Pattern Requests</h2>
			<a href="/admin/patterns" class="admin-panel__link">Manage →</a>
		</div>
		{#if PATTERN_REQUESTS.length === 0}
			<div class="panel-empty">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
				<p>No pending pattern requests</p>
			</div>
		{:else}
			<div class="requests-list">
				{#each PATTERN_REQUESTS as r}
					<div class="request-row">
						<div class="request-vehicle">{r.vehicle}</div>
						<div class="request-votes">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"/></svg>
							{r.votes} votes
						</div>
						<Badge variant={r.status === "in-progress" ? "brand" : "default"} size="sm">
							{r.status}
						</Badge>
						<button class="request-action" onclick={() => patternStore.advanceRequest(r.id)}>
							{r.status === "in-progress" ? "Mark done" : "Start"}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.admin-overview {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1200px;
	}

	.overview-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.overview-title { font-size: 1.375rem; margin-bottom: 3px; }
	.overview-sub   { font-size: 0.875rem; color: var(--text-secondary); }

	/* Metrics */
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.metric-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 5px;
		transition: border-color 0.15s;
	}
	.metric-card:hover { border-color: var(--border-default); }

	.metric-card__label {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-mono);
	}
	.metric-card__value {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1;
	}
	.metric-card__sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* Skeleton */
	.metric-card--skeleton {
		pointer-events: none;
	}
	@keyframes shimmer {
		0%   { background-position: -200% 0; }
		100% { background-position: 200% 0; }
	}
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		border-radius: 4px;
	}
	.skel--label  { height: 8px;  width: 60%;  }
	.skel--value  { height: 28px; width: 50%; margin-top: 2px; }
	.skel--sub    { height: 8px;  width: 70%; margin-top: 2px; }
	.skel--avatar { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; }
	.skel--name   { height: 10px; width: 80px; }
	.skel--email  { height: 8px;  width: 120px; margin-top: 4px; }

	.panel-skeleton {
		padding: 8px 16px 4px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.skel-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.skel-lines { display: flex; flex-direction: column; gap: 0; flex: 1; }

	/* Error */
	.load-error {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 20px;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
	.retry-btn {
		margin-top: 8px;
		padding: 6px 14px;
		font-size: 0.8125rem;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
	}
	.retry-btn:hover { background: var(--bg-surface-3); }

	/* Two-col */
	.overview-cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	/* Panels */
	.admin-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}
	.admin-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.admin-panel__title { font-size: 0.9375rem; font-weight: 600; }
	.admin-panel__link  { font-size: 0.8125rem; color: var(--text-brand); text-decoration: none; }
	.admin-panel__link:hover { text-decoration: underline; }

	/* Empty state */
	.panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 16px;
		color: var(--text-tertiary);
		font-size: 0.8125rem;
	}
	.panel-empty p { margin: 0; }

	/* Mini table */
	.mini-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}
	.mini-table thead { background: var(--bg-surface-2); }
	.mini-table th {
		padding: 8px 16px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.mini-table tbody tr { border-top: 1px solid var(--border-subtle); }
	.mini-table tbody tr:hover { background: var(--interactive-hover); }
	.mini-table td { padding: 10px 16px; vertical-align: middle; }

	.user-cell  { display: flex; align-items: center; gap: 8px; }
	.user-avatar {
		width: 26px; height: 26px; border-radius: 50%;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex; align-items: center; justify-content: center;
		font-family: var(--font-display); font-size: 0.625rem; font-weight: 700;
		color: #fff; flex-shrink: 0;
	}
	.user-name  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.user-email { font-size: 0.6875rem; color: var(--text-tertiary); }
	.td-time    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.td-email   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary); }
	.td-vehicle { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }

	/* Pattern requests */
	.requests-list { padding: 4px 0; }
	.request-row {
		display: flex; align-items: center; gap: 12px;
		padding: 12px 16px;
		border-top: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.request-row:first-child { border-top: none; }
	.request-row:hover { background: var(--interactive-hover); }
	.request-vehicle { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); flex: 1; }
	.request-votes {
		display: flex; align-items: center; gap: 4px;
		font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap;
	}
	.request-action {
		padding: 4px 10px; font-size: 0.75rem; font-weight: 500;
		font-family: var(--font-body); background: var(--bg-surface-2);
		border: 1px solid var(--border-default); border-radius: var(--radius-md);
		color: var(--text-secondary); cursor: pointer; transition: all 0.12s; white-space: nowrap;
	}
	.request-action:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	@media (max-width: 1024px) { .metrics-grid { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 768px)  {
		.admin-overview { padding: 16px; }
		.overview-cols  { grid-template-columns: 1fr; }
	}
</style>
