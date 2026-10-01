<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { formatRelativeTime } from "$lib/utils";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { supportStore } from "$lib/stores";
	import { auth } from "$lib/firebase/client";
	import { onMount } from "svelte";

	// ── Types ──────────────────────────────────────
	type Stats = {
		users: {
			total: number;
			byTier: { free: number; lite: number; pro: number; admin: number };
			activeToday: number;
			recentSignups: { uid: string; displayName: string; email: string; tier: string; createdAt: string | null }[];
		};
		shops: { total: number; byShopPlan: { starter: number; team: number; studio: number }; unpaid: number };
		plotters: { total: number };
		agent: { downloads: number };
		jobs: {
			today: number;
			total: number;
			recent: { id: string; userId: string; userLabel: string; vehicleName: string; status: string; pieces: number; patternsCompleted: number; reconstructed?: boolean; connection: string; presetName: string; createdAt: string | null }[];
		};
	};
	type Finance = {
		mrr: number;
		activeSubscribers: number;
		trialing: number;
		cancelling: number;
		atRiskMrr: number;
		totals: { net: number };
		months: { month: string; net: number }[];
		balance: { available: number; pending: number } | null;
	};
	type Day = { date: string; signups: number; jobs: number; pieces: number };
	type Attention = {
		errors: { open: number; critical: number } | null;
		reports: number | null;
		patterns: number | null;
	};

	// ── State ──────────────────────────────────────
	// Four independent loads: Stripe (slow), core stats, the daily series and
	// the attention counts. Each section renders as soon as its own data lands.
	let stats     = $state<Stats | null>(null);
	let finance   = $state<Finance | null>(null);
	let series    = $state<Day[] | null>(null);
	let attention = $state<Attention | null>(null);

	let statsError   = $state<string | null>(null);
	let financeError = $state<string | null>(null);
	let seriesError  = $state<string | null>(null);
	let attnError    = $state<string | null>(null);

	let range = $state<7 | 30>(7);
	let feedTab = $state<"all" | "signups" | "cuts">("all");
	let refreshing = $state(false);
	let updatedAt  = $state<Date | null>(null);

	async function load() {
		refreshing = true;
		const token = await auth.currentUser?.getIdToken();
		const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

		async function get<T>(url: string, fallback: string): Promise<T> {
			const res = await fetch(url, { headers });
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? fallback);
			return res.json();
		}
		const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

		await Promise.allSettled([
			get<Finance>("/api/admin/revenue", "Failed to load finance")
				.then((d) => { finance = d; financeError = null; })
				.catch((e) => { financeError = msg(e, "Could not load finance"); }),
			get<Stats>("/api/admin/stats", "Failed to load stats")
				.then((d) => { stats = d; statsError = null; })
				.catch((e) => { statsError = msg(e, "Could not load stats"); }),
			// 90d so a 30-day window still has a full prior period to compare to.
			get<{ series: Day[] }>("/api/admin/analytics?range=90d", "Failed to load trends")
				.then((d) => { series = d.series; seriesError = null; })
				.catch((e) => { seriesError = msg(e, "Could not load trends"); }),
			get<Attention>("/api/admin/attention", "Failed to load alerts")
				.then((d) => { attention = d; attnError = null; })
				.catch((e) => { attnError = msg(e, "Could not load alerts"); }),
		]);
		updatedAt = new Date();
		refreshing = false;
	}

	onMount(load);

	// ── Formatting ─────────────────────────────────
	function usd(cents: number) {
		return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
	}
	const n = (v: number | undefined | null) => (v ?? 0).toLocaleString();

	// ── Trends ─────────────────────────────────────
	const sum = (days: Day[], k: "signups" | "jobs") => days.reduce((a, d) => a + d[k], 0);
	const cur  = $derived(series ? series.slice(-range) : []);
	const prev = $derived(series ? series.slice(-range * 2, -range) : []);

	function delta(now: number, before: number): { text: string; dir: "up" | "down" | "flat" } | null {
		if (!prev.length) return null;
		if (before === 0) return now === 0 ? { text: "no change", dir: "flat" } : { text: "new activity", dir: "up" };
		const p = Math.round(((now - before) / before) * 100);
		return { text: `${p > 0 ? "+" : ""}${p}% vs prior ${range}d`, dir: p > 0 ? "up" : p < 0 ? "down" : "flat" };
	}

	const signupsNow = $derived(sum(cur, "signups"));
	const cutsNow    = $derived(sum(cur, "jobs"));
	const signupsDelta = $derived(delta(signupsNow, sum(prev, "signups")));
	const cutsDelta    = $derived(delta(cutsNow, sum(prev, "jobs")));

	// Bars for the charts. Heights are scaled to the window's own max.
	function bars(days: Day[], key: "signups" | "jobs") {
		const max = Math.max(1, ...days.map((d) => d[key]));
		return { max, items: days.map((d) => ({ date: d.date, v: d[key], h: (d[key] / max) * 100 })) };
	}
	const signupBars = $derived(bars(cur, "signups"));
	const cutBars    = $derived(bars(cur, "jobs"));

	function spark(values: number[], w = 84, h = 26): string {
		if (values.length < 2) return "";
		const max = Math.max(...values), min = Math.min(...values);
		const span = max - min || 1;
		return values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
	}
	const netSpark = $derived(finance ? spark(finance.months.slice(-8).map((m) => m.net)) : "");
	const cutSpark = $derived(spark(cur.map((d) => d.jobs)));
	const userSpark = $derived(spark(cur.map((d) => d.signups)));

	const monthNet = $derived.by(() => {
		if (!finance) return 0;
		const thisMonth = new Date().toISOString().slice(0, 7);
		return finance.months.find((m) => m.month === thisMonth)?.net ?? 0;
	});

	// ── Needs attention ────────────────────────────
	type Tile = { key: string; label: string; count: number | null; sub: string; href: string; tone: "danger" | "warn" | "info" };
	const tiles = $derived<Tile[]>([
		{
			key: "support", label: "Tickets to answer",
			count: supportStore.admin.needsReply,
			sub: supportStore.admin.urgent ? `${supportStore.admin.urgent} urgent` : supportStore.admin.new ? `${supportStore.admin.new} new` : "awaiting staff",
			href: "/admin/support", tone: supportStore.admin.urgent ? "danger" : "warn",
		},
		{
			key: "errors", label: "Open errors (24h)",
			count: attention ? (attention.errors?.open ?? null) : null,
			sub: attention?.errors?.critical ? `${attention.errors.critical} critical` : "unresolved groups",
			href: "/admin/errors", tone: attention?.errors?.critical ? "danger" : "warn",
		},
		{
			key: "reports", label: "Open reports",
			count: attention ? attention.reports : null,
			sub: "user-submitted", href: "/admin/reports", tone: "info",
		},
		{
			key: "patterns", label: "Pattern reviews",
			count: attention ? attention.patterns : null,
			sub: "submissions & changes pending", href: "/admin/patterns", tone: "info",
		},
	]);
	const attnLoading = $derived(!attention && !attnError);
	const allClear = $derived(!!attention && tiles.every((t) => !t.count));

	// ── Activity feed ──────────────────────────────
	type FeedItem = { key: string; kind: "signup" | "cut"; at: number; title: string; detail: string; href: string; badge?: { variant: string; text: string } };
	const feed = $derived.by<FeedItem[]>(() => {
		if (!stats) return [];
		const items: FeedItem[] = [];
		for (const u of stats.users.recentSignups) {
			if (!u.createdAt) continue;
			items.push({
				key: `u:${u.uid}`, kind: "signup", at: new Date(u.createdAt).getTime(),
				title: u.displayName || u.email || "New user",
				detail: "joined", href: `/admin/users?uid=${u.uid}`,
				badge: { variant: u.tier === "pro" ? "pro" : u.tier === "lite" ? "lite" : "free", text: u.tier },
			});
		}
		for (const j of stats.jobs.recent) {
			if (!j.createdAt) continue;
			const partial = j.status !== "complete" && !j.reconstructed && j.patternsCompleted < j.pieces;
			items.push({
				key: `j:${j.id}`, kind: "cut", at: new Date(j.createdAt).getTime(),
				title: j.vehicleName || "Cut job",
				detail: `${j.userLabel}${j.reconstructed ? "" : ` · ${partial ? `${j.patternsCompleted}/${j.pieces}` : j.pieces} pc`}`,
				href: j.userId ? `/admin/users?uid=${j.userId}` : "/admin/analytics",
				badge: { variant: j.status === "complete" ? "success" : j.status === "error" || j.status === "interrupted" ? "danger" : j.status === "cutting" ? "info" : "default", text: j.status },
			});
		}
		return items
			.filter((i) => feedTab === "all" || (feedTab === "signups" ? i.kind === "signup" : i.kind === "cut"))
			.sort((a, b) => b.at - a.at)
			.slice(0, 9);
	});

	// ── Account mix ────────────────────────────────
	const TIER_COLORS: Record<string, string> = {
		free: "var(--text-tertiary)", lite: "var(--color-success, #00D68F)", pro: "var(--color-brand)", admin: "#7b5ea7",
	};
	const mix = $derived(stats
		? (["free", "lite", "pro", "admin"] as const).map((t) => ({
			tier: t, count: stats!.users.byTier[t] ?? 0,
			pct: stats!.users.total ? ((stats!.users.byTier[t] ?? 0) / stats!.users.total) * 100 : 0,
		}))
		: []);

	const PATTERN_REQUESTS = $derived(
		patternStore.requests.filter((r) => r.status !== "done").slice(0, 4),
	);
</script>

<svelte:head><title>Admin — OmniPlot</title></svelte:head>

<div class="admin-overview">
	<!-- Header -->
	<div class="overview-header">
		<div>
			<h1 class="overview-title">Overview</h1>
			<p class="overview-sub">
				What needs you, and how the platform is trending.
				{#if updatedAt}<span class="updated">Updated {formatRelativeTime(updatedAt)}</span>{/if}
			</p>
		</div>
		<div class="header-actions">
			<div class="seg" role="group" aria-label="Trend window">
				{#each [7, 30] as r}
					<button class="seg__btn" class:seg__btn--on={range === r} aria-pressed={range === r} onclick={() => (range = r as 7 | 30)}>{r}d</button>
				{/each}
			</div>
			<button class="icon-btn" onclick={load} disabled={refreshing} aria-label="Refresh" title="Refresh">
				<svg class:spin={refreshing} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg>
			</button>
		</div>
	</div>

	<!-- Needs attention -->
	<section class="section" aria-labelledby="attn-h">
		<div class="section__head">
			<h2 class="section__title" id="attn-h">Needs attention</h2>
			{#if allClear}<span class="clear-chip">✓ All clear</span>{/if}
		</div>
		{#if attnError}
			<div class="load-error"><p>{attnError}</p></div>
		{:else}
			<div class="attn-grid">
				{#each tiles as t (t.key)}
					{#if attnLoading && t.key !== "support"}
						<div class="attn-tile attn-tile--skeleton"><div class="skel skel--label"></div><div class="skel skel--value"></div></div>
					{:else}
						<a href={t.href} class="attn-tile" class:attn-tile--idle={!t.count} data-tone={t.count ? t.tone : "idle"}>
							<span class="attn-tile__label">{t.label}</span>
							<span class="attn-tile__count">{t.count === null ? "—" : n(t.count)}</span>
							<span class="attn-tile__sub">{t.count ? t.sub : "nothing waiting"}</span>
						</a>
					{/if}
				{/each}
			</div>
		{/if}
	</section>

	<!-- KPIs -->
	<section class="section" aria-labelledby="kpi-h">
		<div class="section__head">
			<h2 class="section__title" id="kpi-h">Key numbers</h2>
			<a href="/admin/revenue" class="link">Revenue →</a>
		</div>
		<div class="kpi-grid">
			{#if financeError}
				<div class="load-error kpi-span"><p>Finance: {financeError}</p></div>
			{:else if !finance}
				{#each { length: 3 } as _}
					<div class="kpi kpi--skeleton"><div class="skel skel--label"></div><div class="skel skel--value"></div><div class="skel skel--sub"></div></div>
				{/each}
			{:else}
				<a class="kpi" href="/admin/revenue">
					<span class="kpi__label">MRR</span>
					<span class="kpi__value">{usd(finance.mrr)}</span>
					<span class="kpi__sub">{finance.cancelling ? `${usd(finance.atRiskMrr)} cancelling` : "active subscriptions"}</span>
				</a>
				<a class="kpi" href="/admin/revenue">
					<span class="kpi__label">Paying subs</span>
					<span class="kpi__value">{n(finance.activeSubscribers)}</span>
					<span class="kpi__sub">{finance.trialing ? `+${finance.trialing} trialing` : "active + past due"}</span>
				</a>
				<a class="kpi" href="/admin/revenue">
					<span class="kpi__label">Net this month</span>
					<span class="kpi__value">{usd(monthNet)}</span>
					<span class="kpi__sub">{finance.balance ? `${usd(finance.balance.available)} in Stripe` : `${usd(finance.totals.net)} all time`}</span>
					{#if netSpark}<svg class="kpi__spark" viewBox="0 0 84 26" aria-hidden="true"><path d={netSpark} /></svg>{/if}
				</a>
			{/if}

			{#if statsError}
				<div class="load-error kpi-span"><p>Stats: {statsError}</p></div>
			{:else if !stats}
				{#each { length: 3 } as _}
					<div class="kpi kpi--skeleton"><div class="skel skel--label"></div><div class="skel skel--value"></div><div class="skel skel--sub"></div></div>
				{/each}
			{:else}
				<a class="kpi" href="/admin/users">
					<span class="kpi__label">Users</span>
					<span class="kpi__value">{n(stats.users.total)}</span>
					<span class="kpi__sub">
						{#if series}+{signupsNow} in {range}d
							{#if signupsDelta}<span class="delta delta--{signupsDelta.dir}">{signupsDelta.text}</span>{/if}
						{:else}all accounts{/if}
					</span>
					{#if userSpark}<svg class="kpi__spark" viewBox="0 0 84 26" aria-hidden="true"><path d={userSpark} /></svg>{/if}
				</a>
				<a class="kpi" href="/admin/analytics">
					<span class="kpi__label">Active (24h)</span>
					<span class="kpi__value">{n(stats.users.activeToday)}</span>
					<span class="kpi__sub">{stats.users.total ? Math.round((stats.users.activeToday / stats.users.total) * 100) : 0}% of users</span>
				</a>
				<a class="kpi" href="/admin/analytics">
					<span class="kpi__label">Cuts · {range}d</span>
					<span class="kpi__value">{series ? n(cutsNow) : n(stats.jobs.today)}</span>
					<span class="kpi__sub">
						{#if series}
							{#if cutsDelta}<span class="delta delta--{cutsDelta.dir}">{cutsDelta.text}</span>{/if}
						{:else}{n(stats.jobs.today)} in 24h{/if}
						· {n(stats.jobs.total)} all time
					</span>
					{#if cutSpark}<svg class="kpi__spark" viewBox="0 0 84 26" aria-hidden="true"><path d={cutSpark} /></svg>{/if}
				</a>
			{/if}
		</div>
	</section>

	<!-- Trends -->
	<section class="section" aria-labelledby="trend-h">
		<div class="section__head">
			<h2 class="section__title" id="trend-h">Trends · last {range} days</h2>
			<a href="/admin/analytics" class="link">Analytics →</a>
		</div>
		{#if seriesError}
			<div class="load-error"><p>{seriesError}</p></div>
		{:else}
			<div class="chart-row">
				{#each [
					{ title: "Signups", data: signupBars, total: signupsNow, d: signupsDelta, empty: "No signups in this window" },
					{ title: "Completed cuts", data: cutBars, total: cutsNow, d: cutsDelta, empty: "No completed cuts in this window" },
				] as chart (chart.title)}
					<div class="panel">
						<div class="panel__header">
							<h3 class="panel__title">{chart.title}</h3>
							{#if series}
								<span class="chart-total">{n(chart.total)}{#if chart.d}<span class="delta delta--{chart.d.dir}">{chart.d.text}</span>{/if}</span>
							{/if}
						</div>
						<div class="chart-body">
							{#if !series}
								<div class="skel chart-skel"></div>
							{:else if chart.total === 0}
								<div class="chart-empty">{chart.empty}</div>
							{:else}
								<div class="bars" role="img" aria-label="{chart.title} per day, last {range} days">
									<span class="bars__max">{chart.data.max}</span>
									{#each chart.data.items as b (b.date)}
										<span class="bars__col" title="{b.date}: {b.v}">
											<span class="bars__bar" style:height="{Math.max(b.v ? 4 : 0, b.h)}%"></span>
										</span>
									{/each}
								</div>
								<div class="bars__axis"><span>{cur[0]?.date.slice(5)}</span><span>{cur[cur.length - 1]?.date.slice(5)}</span></div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Feed + composition -->
	<div class="overview-cols">
		<div class="panel">
			<div class="panel__header">
				<h2 class="panel__title">Recent activity</h2>
				<div class="seg seg--sm" role="group" aria-label="Activity filter">
					{#each [["all", "All"], ["signups", "Signups"], ["cuts", "Cuts"]] as [k, label]}
						<button class="seg__btn" class:seg__btn--on={feedTab === k} aria-pressed={feedTab === k} onclick={() => (feedTab = k as typeof feedTab)}>{label}</button>
					{/each}
				</div>
			</div>
			{#if statsError}
				<div class="panel-empty"><p>{statsError}</p></div>
			{:else if !stats}
				<div class="panel-skeleton">
					{#each { length: 5 } as _}
						<div class="skel-row"><div class="skel skel--avatar"></div><div class="skel-lines"><div class="skel skel--name"></div><div class="skel skel--email"></div></div></div>
					{/each}
				</div>
			{:else if !feed.length}
				<div class="panel-empty"><p>Nothing yet</p></div>
			{:else}
				<ul class="feed">
					{#each feed as it (it.key)}
						<li>
							<a class="feed__row" href={it.href}>
								<span class="feed__icon feed__icon--{it.kind}" aria-hidden="true">
									{#if it.kind === "signup"}
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
									{:else}
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
									{/if}
								</span>
								<span class="feed__main">
									<span class="feed__title">{it.title}</span>
									<span class="feed__detail">{it.detail}</span>
								</span>
								{#if it.badge}<Badge variant={it.badge.variant as any} size="sm">{it.badge.text}</Badge>{/if}
								<span class="feed__time">{formatRelativeTime(new Date(it.at))}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="panel">
			<div class="panel__header">
				<h2 class="panel__title">Accounts</h2>
				<a href="/admin/users" class="link">Users →</a>
			</div>
			{#if !stats}
				<div class="panel-skeleton"><div class="skel skel--sub" style="height:12px;width:100%"></div><div class="skel skel--name"></div><div class="skel skel--name"></div></div>
			{:else}
				<div class="mix">
					<div class="mix__bar" role="img" aria-label="Account tiers">
						{#each mix as m (m.tier)}
							{#if m.count}<span style:width="{m.pct}%" style:background={TIER_COLORS[m.tier]} title="{m.tier}: {m.count}"></span>{/if}
						{/each}
					</div>
					<ul class="mix__legend">
						{#each mix as m (m.tier)}
							<li><i style:background={TIER_COLORS[m.tier]}></i><span class="mix__name">{m.tier}</span><span class="mix__n">{n(m.count)}</span><span class="mix__pct">{Math.round(m.pct)}%</span></li>
						{/each}
					</ul>
					<div class="mix__shops">
						<div class="mix__shops-title">Shops <span>{n(stats.shops.total)} total · {n(stats.shops.unpaid)} unsubscribed</span></div>
						<div class="chips">
							<span class="chip">Starter <b>{n(stats.shops.byShopPlan.starter)}</b></span>
							<span class="chip">Team <b>{n(stats.shops.byShopPlan.team)}</b></span>
							<span class="chip">Studio <b>{n(stats.shops.byShopPlan.studio)}</b></span>
						</div>
					</div>
					<div class="mix__shops">
						<div class="mix__shops-title">Platform</div>
						<div class="chips">
							<span class="chip">Plotters <b>{n(stats.plotters.total)}</b></span>
							<span class="chip">Agent downloads <b>{n(stats.agent.downloads)}</b></span>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Pattern requests -->
	{#if PATTERN_REQUESTS.length}
		<div class="panel">
			<div class="panel__header">
				<h2 class="panel__title">Pattern requests</h2>
				<a href="/admin/patterns" class="link">Manage →</a>
			</div>
			<div class="requests-list">
				{#each PATTERN_REQUESTS as r}
					<div class="request-row">
						<div class="request-vehicle">{r.vehicle}</div>
						<div class="request-votes">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"/></svg>
							{r.votes} votes
						</div>
						<Badge variant={r.status === "in-progress" ? "brand" : "default"} size="sm">{r.status}</Badge>
						<button class="request-action" onclick={() => patternStore.advanceRequest(r.id)}>
							{r.status === "in-progress" ? "Mark done" : "Start"}
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-overview {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 22px;
		max-width: 1200px;
		margin: 0 auto;
	}

	/* Header */
	.overview-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
	.overview-title { font-size: 1.375rem; margin-bottom: 3px; }
	.overview-sub   { font-size: 0.875rem; color: var(--text-secondary); }
	.updated        { margin-left: 6px; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.header-actions { display: flex; align-items: center; gap: 8px; }

	.seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.seg__btn {
		padding: 4px 11px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body);
		background: none; border: none; border-radius: calc(var(--radius-md) - 2px);
		color: var(--text-tertiary); cursor: pointer; transition: all 0.12s;
	}
	.seg__btn:hover { color: var(--text-primary); }
	.seg__btn--on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border-default); }
	.seg--sm .seg__btn { padding: 3px 9px; font-size: 0.6875rem; }
	.icon-btn {
		display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
		color: var(--text-secondary); cursor: pointer;
	}
	.icon-btn:hover:not(:disabled) { background: var(--bg-surface-3); color: var(--text-primary); }
	.icon-btn:disabled { opacity: 0.6; cursor: default; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.spin { animation: spin 0.8s linear infinite; }

	/* Sections */
	.section { display: flex; flex-direction: column; gap: 8px; }
	.section__head { display: flex; align-items: baseline; justify-content: space-between; }
	.section__title {
		font-size: 0.6875rem; font-weight: 600; font-family: var(--font-mono);
		text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-tertiary); padding-left: 2px;
	}
	.link { font-size: 0.8125rem; color: var(--text-brand); text-decoration: none; }
	.link:hover { text-decoration: underline; }
	.clear-chip {
		font-size: 0.6875rem; font-family: var(--font-mono); color: var(--color-success, #00D68F);
		background: color-mix(in srgb, var(--color-success, #00D68F) 10%, transparent);
		padding: 2px 8px; border-radius: 999px;
	}

	/* Needs attention */
	.attn-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
	.attn-tile {
		--tone: var(--color-brand);
		position: relative; display: flex; flex-direction: column; gap: 4px; padding: 14px 16px;
		background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		text-decoration: none; color: inherit; overflow: hidden; transition: border-color 0.15s, transform 0.15s;
	}
	.attn-tile::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--tone); }
	.attn-tile[data-tone="danger"] { --tone: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 5%, var(--bg-surface)); }
	.attn-tile[data-tone="warn"]   { --tone: var(--color-warning, #FFB347); }
	.attn-tile[data-tone="idle"]   { --tone: var(--border-default); }
	.attn-tile:hover { border-color: var(--tone); transform: translateY(-1px); }
	.attn-tile--idle .attn-tile__count { color: var(--text-tertiary); }
	.attn-tile--skeleton { pointer-events: none; }
	.attn-tile__label { font-size: 0.6875rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.attn-tile__count { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: var(--text-primary); }
	.attn-tile__sub   { font-size: 0.75rem; color: var(--text-tertiary); }

	/* KPIs */
	.kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
	.kpi-span { grid-column: 1 / -1; }
	.kpi {
		position: relative; display: flex; flex-direction: column; gap: 5px; padding: 16px;
		background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		text-decoration: none; color: inherit; transition: border-color 0.15s;
	}
	a.kpi:hover { border-color: var(--border-default); }
	.kpi--skeleton { pointer-events: none; }
	.kpi__label { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono); }
	.kpi__value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1; }
	.kpi__sub   { font-size: 0.75rem; color: var(--text-tertiary); display: flex; flex-wrap: wrap; gap: 2px 6px; padding-right: 92px; }
	.kpi__spark { position: absolute; right: 14px; bottom: 14px; width: 84px; height: 26px; fill: none; stroke: var(--color-brand); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }

	.delta { font-family: var(--font-mono); font-size: 0.6875rem; }
	.delta--up   { color: var(--color-success, #00D68F); }
	.delta--down { color: var(--color-danger); }
	.delta--flat { color: var(--text-tertiary); }

	/* Panels */
	.panel { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; min-width: 0; }
	.panel__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
	.panel__title { font-size: 0.9375rem; font-weight: 600; }
	.chart-total { display: flex; align-items: baseline; gap: 8px; font-family: var(--font-display); font-weight: 700; font-size: 1rem; }

	/* Charts */
	.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.chart-body { padding: 14px 16px 10px; }
	.chart-skel { height: 110px; }
	.chart-empty { height: 110px; display: flex; align-items: center; justify-content: center; font-size: 0.8125rem; color: var(--text-tertiary); }
	.bars { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 110px; padding-left: 0; border-bottom: 1px solid var(--border-subtle); }
	.bars__max { position: absolute; top: 0; right: 0; font-family: var(--font-mono); font-size: 0.625rem; color: var(--text-tertiary); }
	.bars__col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 0; }
	.bars__bar { width: 100%; background: var(--color-brand); border-radius: 2px 2px 0 0; opacity: 0.85; transition: opacity 0.1s; }
	.bars__col:hover .bars__bar { opacity: 1; }
	.bars__axis { display: flex; justify-content: space-between; margin-top: 4px; font-family: var(--font-mono); font-size: 0.625rem; color: var(--text-tertiary); }

	.overview-cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }

	/* Feed */
	.feed { list-style: none; margin: 0; padding: 0; }
	.feed li + li { border-top: 1px solid var(--border-subtle); }
	.feed__row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; text-decoration: none; color: inherit; transition: background 0.1s; }
	.feed__row:hover { background: var(--interactive-hover); }
	.feed__icon { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	.feed__icon--signup { background: color-mix(in srgb, var(--color-success, #00D68F) 14%, transparent); color: var(--color-success, #00D68F); }
	.feed__icon--cut    { background: color-mix(in srgb, var(--color-brand) 14%, transparent); color: var(--color-brand); }
	.feed__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.feed__title  { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.feed__detail { font-size: 0.6875rem; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.feed__time   { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); white-space: nowrap; min-width: 48px; text-align: right; }

	/* Account mix */
	.mix { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
	.mix__bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--bg-surface-2); gap: 2px; }
	.mix__bar span { display: block; min-width: 3px; }
	.mix__legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
	.mix__legend li { display: grid; grid-template-columns: 10px 1fr auto 44px; align-items: center; gap: 8px; font-size: 0.8125rem; }
	.mix__legend i { width: 8px; height: 8px; border-radius: 50%; }
	.mix__name { text-transform: capitalize; color: var(--text-secondary); }
	.mix__n    { font-family: var(--font-mono); color: var(--text-primary); }
	.mix__pct  { font-family: var(--font-mono); color: var(--text-tertiary); font-size: 0.75rem; text-align: right; }
	.mix__shops { padding-top: 12px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; }
	.mix__shops-title { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); }
	.mix__shops-title span { font-weight: 400; color: var(--text-tertiary); margin-left: 6px; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip { font-size: 0.75rem; padding: 3px 9px; border-radius: 999px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); color: var(--text-secondary); }
	.chip b { color: var(--text-primary); font-family: var(--font-mono); margin-left: 3px; }

	/* Skeleton */
	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
	}
	.skel--label  { height: 8px;  width: 60%; }
	.skel--value  { height: 28px; width: 50%; margin-top: 2px; }
	.skel--sub    { height: 8px;  width: 70%; margin-top: 2px; }
	.skel--avatar { width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; }
	.skel--name   { height: 10px; width: 80px; }
	.skel--email  { height: 8px;  width: 120px; margin-top: 4px; }
	.attn-tile--skeleton, .kpi--skeleton { gap: 6px; }
	.panel-skeleton { padding: 14px 16px 6px; display: flex; flex-direction: column; gap: 14px; }
	.skel-row { display: flex; align-items: center; gap: 10px; }
	.skel-lines { display: flex; flex-direction: column; flex: 1; }

	/* Error / empty */
	.load-error {
		background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		padding: 16px; text-align: center; color: var(--text-secondary); font-size: 0.875rem;
	}
	.load-error p { margin: 0; }
	.panel-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 16px; color: var(--text-tertiary); font-size: 0.8125rem; }
	.panel-empty p { margin: 0; }

	/* Pattern requests */
	.requests-list { padding: 4px 0; }
	.request-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.request-row:first-child { border-top: none; }
	.request-row:hover { background: var(--interactive-hover); }
	.request-vehicle { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); flex: 1; min-width: 0; }
	.request-votes { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.request-action {
		padding: 4px 10px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body);
		background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md);
		color: var(--text-secondary); cursor: pointer; transition: all 0.12s; white-space: nowrap;
	}
	.request-action:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	@media (max-width: 1024px) {
		.attn-grid { grid-template-columns: repeat(2, 1fr); }
		.kpi-grid  { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 768px) {
		.admin-overview { padding: 16px; }
		.overview-cols, .chart-row { grid-template-columns: 1fr; }
	}
	@media (max-width: 480px) {
		.attn-grid, .kpi-grid { grid-template-columns: 1fr; }
		.request-row { flex-wrap: wrap; }
		.request-vehicle { flex-basis: 100%; }
	}
</style>
