<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import { formatRelativeTime, canCut, cutLimitsFromPlans } from "$lib/utils";
	import {
		cutJobStore, userStore, shopStore, uiStore, plotterStatusStore, plotterStore, plotterHistoryStore,
		agentStore, platformStore, plansStore,
	} from "$lib/stores";
	import { patternStore, getVehicleName } from "$lib/stores/patternStore.svelte";
	import { usageInWindow } from "$lib/cuts";
	import { getUserPatterns } from "$lib/firebase/firestore";
	import { LATEST_VERSION } from "$lib/config";
	import type { JobStatus, ProjectType, UserPattern, VehicleEntry } from "$lib/types";

	const user    = $derived(userStore.user);
	const jobs    = $derived(cutJobStore.jobs);
	const jobsLoading = $derived(cutJobStore.loading);
	const plotter = $derived(plotterStatusStore.current);
	const firstName = $derived(user?.displayName?.split(" ")[0] || "");

	// A slow clock so "stuck" cutting jobs age out without a reload.
	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(t);
	});

	// ─── Account stats ───────────────────────────
	const usage = $derived(usageInWindow(user?.usage));
	const successRate = $derived.by(() => {
		const done = jobs.filter((j) => j.status === "complete" || j.status === "error");
		if (!done.length) return null;
		return Math.round((done.filter((j) => j.status === "complete").length / done.length) * 100);
	});
	const avgEff = $derived.by(() => {
		const withEff = jobs.filter((j) => j.status === "complete" && j.metrics?.materialEfficiency);
		if (!withEff.length) return null;
		return Math.round((withEff.reduce((s, j) => s + j.metrics.materialEfficiency, 0) / withEff.length) * 100);
	});

	// Cuts per month for the last 6 months (server-kept byMonth counters).
	const months = $derived.by(() => {
		const byMonth = user?.usage.byMonth ?? {};
		const out: { key: string; label: string; n: number }[] = [];
		const d = new Date();
		for (let i = 5; i >= 0; i--) {
			const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
			const key = m.toISOString().slice(0, 7);
			out.push({ key, label: m.toLocaleString("en", { month: "short", timeZone: "UTC" }), n: byMonth[key] ?? 0 });
		}
		return out;
	});
	const monthMax = $derived(Math.max(1, ...months.map((m) => m.n)));
	const hasActivity = $derived(months.some((m) => m.n > 0));

	// ─── Plan allowance ──────────────────────────
	const allowance = $derived.by(() => {
		if (!user) return null;
		const limits = cutLimitsFromPlans(plansStore.settings);
		const check = canCut(user, shopStore.isActive, limits);
		if (check.remaining === null) return { unlimited: true as const };
		const key = user.tier === "lite" || user.tier === "pro" ? user.tier : "free";
		const { cutsPerMonth, cutsPerDay } = limits[key];
		// Show the window that's actually the tightest.
		const monthLeft = cutsPerMonth !== null ? Math.max(0, cutsPerMonth - usage.month) : Infinity;
		const dayLeft   = cutsPerDay   !== null ? Math.max(0, cutsPerDay - usage.day)     : Infinity;
		const useDay = dayLeft < monthLeft;
		const cap = useDay ? cutsPerDay! : cutsPerMonth!;
		const used = useDay ? usage.day : usage.month;
		return { unlimited: false as const, cap, used, window: useDay ? "today" : "this month" };
	});
	const RING_R = 34;
	const RING_C = 2 * Math.PI * RING_R;

	// ─── Active cuts ─────────────────────────────
	// A job left "cutting" for 2h never reported back (tab closed) — the Jobs
	// page treats it as interrupted, so it isn't "active" here either.
	const STALE_MS = 2 * 60 * 60 * 1000;
	const activeJobs = $derived(
		jobs.filter((j) => {
			if (j.status !== "cutting") return false;
			const since = new Date(j.updatedAt ?? j.createdAt).getTime();
			return now - since < STALE_MS;
		}),
	);
	const recentJobs = $derived(jobs.filter((j) => j.status !== "cutting").slice(0, 10));

	const STATUS_VARIANT: Record<JobStatus, "success" | "danger" | "warning" | "info" | "default"> = {
		complete: "success", error: "danger", cutting: "info", ready: "warning", draft: "default", cancelled: "default",
	};
	const STATUS_LABEL: Record<JobStatus, string> = {
		complete: "Complete", error: "Error", cutting: "Cutting", ready: "Ready", draft: "Draft", cancelled: "Cancelled",
	};

	// ─── Cutter card ─────────────────────────────
	const connType = $derived(plotter.connType);
	const CONN_LABEL: Record<string, string> = {
		"usb-serial": "USB direct", "cut-agent": "Cut Agent", network: "Network", download: "File export",
	};
	const history = $derived([...plotterHistoryStore.entries].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt));
	const lastSeen = $derived(history[0]?.lastConnectedAt ?? null);
	const totalConnects = $derived(history.reduce((n, e) => n + e.connectCount, 0));
	const usingAgent = $derived(plotterStore.config.connection === "cut-agent" && platformStore.flags.cutAgent);

	// Nothing polls the agent outside Studio/Plotters, so the card would sit at
	// "Not checked yet" — probe it here while the Cut Agent is the connection.
	async function probeAgent() {
		try {
			const res = await fetch(`${agentStore.url}/api/status`, { signal: AbortSignal.timeout(3000) });
			if (!res.ok) { agentStore.setOffline(); return; }
			agentStore.setOnline((await res.json()).version ?? "");
			const st = await fetch(`${agentStore.url}/api/stats`, { signal: AbortSignal.timeout(3000) });
			if (st.ok) agentStore.setStats(await st.json());
		} catch {
			agentStore.setOffline();
		}
	}
	$effect(() => {
		if (!usingAgent) return;
		probeAgent();
		const t = setInterval(probeAgent, 20_000);
		return () => clearInterval(t);
	});

	// ─── Community library ───────────────────────
	// Same rule as /library: published subjects that have published patterns.
	// Every number here comes from that one list, so it matches what the user
	// finds after clicking through.
	const typeOf = (v: { projectType?: ProjectType }): ProjectType => v.projectType ?? "vehicle";
	const catalogLoading = $derived(patternStore.loading);
	const visible = $derived(
		patternStore.vehicles
			.filter((v) => v.status === "published")
			.map((v) => ({ v, pats: patternStore.getPatterns(v.id, undefined, true) }))
			.filter((x) => x.pats.length > 0),
	);

	const TYPES: { value: ProjectType; label: string; noun: string; plural: string; icon: string }[] = [
		{ value: "vehicle",     label: "Vehicle",     noun: "vehicle",  plural: "vehicles",   icon: "M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M3 16h18v3H3zM7 19v1.5M17 19v1.5" },
		{ value: "residential", label: "Residential", noun: "home",     plural: "homes",      icon: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6" },
		{ value: "commercial",  label: "Commercial",  noun: "property", plural: "properties", icon: "M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01" },
		{ value: "custom",      label: "Custom",      noun: "project",  plural: "projects",   icon: "M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2L6.7 19l1.4-6-4.6-4 6.1-.5z" },
	];
	const typeCounts = $derived(
		TYPES.map((t) => {
			const rows = visible.filter((x) => typeOf(x.v) === t.value);
			return { ...t, subjects: rows.length, patterns: rows.reduce((n, x) => n + x.pats.length, 0) };
		}),
	);
	const totalPatterns = $derived(typeCounts.reduce((n, t) => n + t.patterns, 0));
	const totalSubjects = $derived(typeCounts.reduce((n, t) => n + t.subjects, 0));
	const contributors = $derived(new Set(visible.map((x) => x.v.contributedBy).filter(Boolean)).size);
	const maxPatterns = $derived(Math.max(1, ...typeCounts.map((t) => t.patterns)));

	function subjectName(v: VehicleEntry): string {
		if (typeOf(v) !== "vehicle") return v.propertyLabel || v.model || v.address || "Untitled";
		return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
	}

	// "New" is only knowable as "last updated" — the catalog has no created-at
	// and no download counts, so the feed says what it can actually show:
	// recently added/updated, and the subjects staff have marked popular.
	type FeedTab = "recent" | "popular";
	let feedTab = $state<FeedTab>("recent");
	const feed = $derived.by(() => {
		const rows = feedTab === "popular"
			? visible.filter((x) => x.v.popular).sort((a, b) => b.pats.length - a.pats.length)
			: [...visible].sort((a, b) => (b.v.updatedAt ?? "").localeCompare(a.v.updatedAt ?? ""));
		return rows.slice(0, 4);
	});
	const typeLabel = (t: ProjectType) => TYPES.find((x) => x.value === t)?.label ?? "Vehicle";

	// Most-wanted requests (votes). Not shown until the catalog has loaded:
	// the store holds placeholder requests before that.
	const topRequests = $derived(
		catalogLoading
			? []
			: patternStore.requests.filter((r) => r.status !== "done").sort((a, b) => b.votes - a.votes).slice(0, 4),
	);

	// ─── My submissions ──────────────────────────
	let mine = $state<UserPattern[] | null>(null);
	$effect(() => {
		const uid = user?.uid;
		if (!uid) return;
		getUserPatterns(uid).then((r) => (mine = r)).catch(() => (mine = []));
	});
	function mineStatus(p: UserPattern): "published" | "pending" | "rejected" | "private" {
		if (p.isPublished) return "published";
		if (p.status === "pending") return "pending";
		if (p.status === "rejected") return "rejected";
		return "private";
	}
	const MINE_LABEL = { published: "Published", pending: "In review", rejected: "Not approved", private: "Private" } as const;
	const MINE_VARIANT = { published: "success", pending: "warning", rejected: "danger", private: "default" } as const;
	const mineCounts = $derived({
		published: mine?.filter((p) => mineStatus(p) === "published").length ?? 0,
		pending: mine?.filter((p) => mineStatus(p) === "pending").length ?? 0,
	});
	const mineLatest = $derived(
		[...(mine ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3),
	);

	// ─── Getting started ─────────────────────────
	const steps = $derived([
		{ id: "plotter", label: "Connect your cutter", done: history.length > 0, href: "/studio?panel=plotter" },
		{ id: "cut", label: "Run your first cut", done: (user?.usage.cutCount ?? 0) > 0, href: "/studio" },
		{ id: "upload", label: "Upload a pattern of your own", done: (mine?.length ?? 0) > 0, href: "/library/upload" },
		{ id: "share", label: "Share one with the community", done: (mine ?? []).some((p) => p.submitToCommunity), href: "/library/upload" },
	]);
	const stepsDone = $derived(steps.filter((s) => s.done).length);
	const showSteps = $derived(mine !== null && stepsDone < steps.length);
</script>

{#snippet connIcon(t: string | null, size: number)}
	{#if t === "usb-serial"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h9M4 15h9"/><path d="M13 6h4l3 3v6l-3 3h-4"/><path d="M9 6V4M9 20v-2"/></svg>
	{:else if t === "cut-agent"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M12 7.5h6M12 16.5h6"/></svg>
	{:else if t === "network"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16.5a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
	{:else if t === "download"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>
	{:else}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8V4h12v4M6 16v4h12v-4"/></svg>
	{/if}
{/snippet}

<svelte:head>
	<title>Overview — OmniPlot</title>
</svelte:head>

<div class="dash">
<div class="dash-body">

	<!-- ─── Hero ─── -->
	<header class="hero">
		<div class="hero__copy">
			<p class="hero__eyebrow">Overview</p>
			<h1 class="hero__title">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</h1>
			<p class="hero__sub">
				{#if activeJobs.length}
					{activeJobs.length === 1 ? "A cut is" : `${activeJobs.length} cuts are`} running right now.
				{:else if usage.month > 0}
					{usage.month.toLocaleString()} {usage.month === 1 ? "cut" : "cuts"} in the last 30 days. Ready for the next one?
				{:else}
					Pick a pattern, nest it, and send it to your cutter.
				{/if}
			</p>
			<div class="hero__cta">
				<Button variant="primary" size="md" href="/studio">Open Studio</Button>
				<Button variant="secondary" size="md" href="/library">Browse patterns</Button>
			</div>
		</div>

		{#if allowance}
			<div class="allow" aria-label="Plan usage">
				{#if allowance.unlimited}
					<div class="allow__ring allow__ring--inf" aria-hidden="true">∞</div>
					<div>
						<div class="allow__big">Unlimited</div>
						<div class="allow__sub">cuts on your {shopStore.isActive ? "team" : user?.tier} plan</div>
					</div>
				{:else}
					<svg class="allow__ring" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
						<circle cx="42" cy="42" r={RING_R} class="allow__track" />
						<circle cx="42" cy="42" r={RING_R} class="allow__fill" class:allow__fill--warn={allowance.used / allowance.cap >= 0.8}
							stroke-dasharray={RING_C} stroke-dashoffset={RING_C * (1 - Math.min(1, allowance.used / allowance.cap))}
							transform="rotate(-90 42 42)" />
					</svg>
					<div>
						<div class="allow__big">{Math.max(0, allowance.cap - allowance.used)} left</div>
						<div class="allow__sub">{allowance.used} of {allowance.cap} cuts used {allowance.window}</div>
						{#if user?.tier === "free" || user?.tier === "lite"}
							<button class="allow__link" onclick={uiStore.openPricing}>Upgrade for more</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</header>

	<!-- ─── Stats ─── -->
	<div class="stats">
		<div class="stat">
			<span class="stat__val">{(user?.usage.cutCount ?? 0).toLocaleString()}</span>
			<span class="stat__label">Cuts completed</span>
		</div>
		<div class="stat">
			<span class="stat__val">{usage.month.toLocaleString()}</span>
			<span class="stat__label">Last 30 days</span>
		</div>
		<div class="stat">
			<span class="stat__val" class:stat__val--ok={successRate !== null && successRate >= 90}>{jobsLoading ? "…" : successRate === null ? "—" : `${successRate}%`}</span>
			<span class="stat__label">Cut success rate</span>
		</div>
		<div class="stat">
			<span class="stat__val stat__val--brand">{jobsLoading ? "…" : avgEff === null ? "—" : `${avgEff}%`}</span>
			<span class="stat__label">Avg material efficiency</span>
		</div>
	</div>

	<!-- ─── Active cuts + cutter ─── -->
	<div class="row row--2">
		<section class="panel" aria-labelledby="active-h">
			<div class="panel__head">
				<h2 id="active-h" class="panel__title">Active cuts</h2>
				<a class="panel__link" href="/jobs">All jobs</a>
			</div>

			{#if activeJobs.length}
				<ul class="active-list">
					{#each activeJobs as job (job.id)}
						{@const total = job.metrics?.itemCount ?? 0}
						{@const done = job.metrics?.patternsCompleted ?? 0}
						<li class="active">
							<div class="active__top">
								<span class="active__pulse" aria-hidden="true"></span>
								<span class="active__name">{job.name}</span>
								<span class="active__when">{formatRelativeTime(job.createdAt)}</span>
							</div>
							<div class="active__meta">{job.subject || getVehicleName(job.vehicleId)} · {job.plotterConfig?.name || "Plotter"}</div>
							{#if total > 0}
								<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done}>
									<span class="bar__fill" style:width="{Math.min(100, (done / total) * 100)}%"></span>
								</div>
								<div class="active__count">{done} of {total} pieces sent</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<div class="idle">
					<svg class="idle__art" viewBox="0 0 320 170" role="img" aria-label="A cutting plotter idling above a sheet of vinyl">
						<rect x="14" y="128" width="292" height="22" rx="6" class="art-bed" />
						<rect x="34" y="104" width="252" height="30" rx="3" class="art-sheet" />
						<path d="M64 126 C70 112 92 108 112 108 L150 108 C168 108 176 98 192 98 L228 98 C244 98 252 108 258 120 L258 126 Z"
							class="art-cut" pathLength="100" />
						<rect x="22" y="40" width="276" height="9" rx="4.5" class="art-rail" />
						<g class="art-head">
							<rect x="-11" y="34" width="22" height="26" rx="5" class="art-carriage" />
							<path d="M0 60 V74" class="art-blade" />
							<circle cx="0" cy="76" r="2.5" class="art-tip" />
						</g>
						<g class="art-spark" aria-hidden="true">
							<circle cx="48" cy="22" r="2" /><circle cx="274" cy="30" r="1.6" /><circle cx="160" cy="14" r="1.4" />
						</g>
					</svg>
					<div class="idle__text">
						<h3 class="idle__title">Nothing cutting right now</h3>
						<p class="idle__sub">
							{#if user && user.usage.cutCount > 0}
								You've cut {user.usage.cutCount.toLocaleString()} {user.usage.cutCount === 1 ? "job" : "jobs"} so far. Keep the streak going.
							{:else}
								Your cutter is waiting. Start your first job in the Studio.
							{/if}
						</p>
						<div class="idle__cta">
							<Button variant="primary" size="sm" href="/studio">Start a cut job</Button>
							<Button variant="ghost" size="sm" href="/library">Find a pattern</Button>
						</div>
					</div>
				</div>
			{/if}
		</section>

		<section class="panel cutter psb-{plotter.tone}" aria-labelledby="cutter-h">
			<div class="panel__head">
				<h2 id="cutter-h" class="panel__title">Your cutter</h2>
				<a class="panel__link" href="/plotter">Manage</a>
			</div>

			<div class="cutter__main">
				<span class="medal">{@render connIcon(connType, 22)}</span>
				<div class="cutter__id">
					<div class="cutter__name">{plotter.name ?? "No cutter set up"}</div>
					<div class="cutter__status"><span class="dot" aria-hidden="true"></span>{plotter.detail}</div>
				</div>
				<span class="conn-chip">{connType ? CONN_LABEL[connType] : "Not connected"}</span>
			</div>

			<dl class="kv">
				<div><dt>Last connected</dt><dd>{lastSeen ? formatRelativeTime(new Date(lastSeen)) : "Never"}</dd></div>
				<div><dt>Connections</dt><dd>{totalConnects.toLocaleString()}</dd></div>
				<div><dt>Success rate</dt><dd>{jobsLoading ? "…" : successRate === null ? "—" : `${successRate}%`}</dd></div>
				<div><dt>Known cutters</dt><dd>{history.length}</dd></div>
				{#if usingAgent}
					<div>
						<dt>Agent</dt>
						<dd>
							{#if agentStore.status === "online"}
								v{agentStore.version}{#if agentStore.needsUpdate} · <span class="warn">update</span>{/if}
							{:else if agentStore.status === "offline"}<span class="bad">Offline</span>
							{:else}Checking…{/if}
						</dd>
					</div>
					{#if agentStore.status === "online" && agentStore.stats}
						<div><dt>Agent jobs today</dt><dd>{(agentStore.stats.jobsToday ?? 0).toLocaleString()}</dd></div>
						<div><dt>Agent jobs total</dt><dd>{(agentStore.stats.jobsTotal ?? 0).toLocaleString()}</dd></div>
						<div><dt>Agent errors</dt><dd class:bad={(agentStore.stats.errorsTotal ?? 0) > 0}>{(agentStore.stats.errorsTotal ?? 0).toLocaleString()}</dd></div>
					{/if}
				{/if}
			</dl>

			<div class="cutter__actions">
				{#if plotterStatusStore.isLive}
					<Button variant="primary" size="sm" href="/studio">Open Studio</Button>
				{:else}
					<Button variant="primary" size="sm" href="/studio?panel=plotter">Connect cutter</Button>
				{/if}
				<Button variant="ghost" size="sm" href="/plotter">Settings &amp; history</Button>
			</div>
		</section>
	</div>

	<!-- ─── Get set up + your contributions ─── -->
	<div class="row row--setup" class:row--solo={!showSteps}>
		{#if showSteps}
			<section class="panel" aria-labelledby="steps-h">
				<div class="panel__head">
					<h2 id="steps-h" class="panel__title">Get set up</h2>
					<span class="panel__sub">{stepsDone} of {steps.length}</span>
				</div>
				<div class="bar"><span class="bar__fill" style:width="{(stepsDone / steps.length) * 100}%"></span></div>
				<ul class="steps">
					{#each steps as s (s.id)}
						<li>
							<a class="step" class:step--done={s.done} href={s.href}>
								<span class="step__box" aria-hidden="true">
									{#if s.done}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>{/if}
								</span>
								{s.label}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="panel" aria-labelledby="mine-h">
			<div class="panel__head">
				<h2 id="mine-h" class="panel__title">Your contributions</h2>
				<a class="panel__link" href="/library?source=private">My patterns</a>
			</div>
			{#if mine === null}
				<p class="muted">Loading…</p>
			{:else if mine.length === 0}
				<p class="muted">Upload a pattern you've measured and share it with the community.</p>
				<div><Button variant="secondary" size="sm" href="/library/upload">Upload a pattern</Button></div>
			{:else}
				<div class="mini-stats">
					<div><b>{mine.length}</b><span>uploaded</span></div>
					<div><b>{mineCounts.pending}</b><span>in review</span></div>
					<div><b>{mineCounts.published}</b><span>published</span></div>
				</div>
				<ul class="mine">
					{#each mineLatest as p (p.id)}
						<li>
							<span class="mine__name">{p.propertyLabel || p.patternName || [p.make, ...(p.models ?? [])].filter(Boolean).join(" ") || p.name}</span>
							<Badge variant={MINE_VARIANT[mineStatus(p)]}>{MINE_LABEL[mineStatus(p)]}</Badge>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- ─── Community library ─── -->
	<section class="panel community" aria-labelledby="comm-h">
		<div class="panel__head">
			<div>
				<h2 id="comm-h" class="panel__title">Community pattern library</h2>
				<p class="panel__sub">
					{#if catalogLoading}Loading the library…
					{:else}<strong>{totalPatterns.toLocaleString()}</strong> patterns across <strong>{totalSubjects.toLocaleString()}</strong> {totalSubjects === 1 ? "subject" : "subjects"}{#if contributors > 0}, with {contributors} community {contributors === 1 ? "contributor" : "contributors"}{/if}. It grows every time someone shares a pattern.{/if}
				</p>
			</div>
			<a class="panel__link" href="/library">Open library</a>
		</div>

		<div class="types">
			{#each typeCounts as t (t.value)}
				<a class="type" href="/library?type={t.value}">
					<span class="type__icon" aria-hidden="true">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
					</span>
					<span class="type__label">{t.label}</span>
					<span class="type__num">{catalogLoading ? "…" : t.patterns.toLocaleString()}</span>
					<span class="type__sub">{catalogLoading ? "" : `${t.subjects.toLocaleString()} ${t.subjects === 1 ? t.noun : t.plural}`}</span>
					<span class="type__bar" aria-hidden="true"><span style:width="{catalogLoading ? 0 : Math.max(t.patterns ? 6 : 0, (t.patterns / maxPatterns) * 100)}%"></span></span>
				</a>
			{/each}
		</div>

		<div class="tabs" role="tablist" aria-label="Library feed">
			<button role="tab" class="tab" class:tab--on={feedTab === "recent"} aria-selected={feedTab === "recent"} onclick={() => (feedTab = "recent")}>Recently added or updated</button>
			<button role="tab" class="tab" class:tab--on={feedTab === "popular"} aria-selected={feedTab === "popular"} onclick={() => (feedTab = "popular")}>Popular</button>
		</div>

		{#if catalogLoading}
			<div class="feed">
				{#each Array(4) as _}<div class="card card--skel"></div>{/each}
			</div>
		{:else if feed.length === 0}
			<p class="muted">{feedTab === "popular" ? "No patterns have been marked popular yet." : "Nothing here yet."}</p>
		{:else}
			<ul class="feed">
				{#each feed as { v, pats } (v.id)}
					<li>
						<a class="card" href="/library?type={typeOf(v)}">
							<div class="card__thumb">
								<PatternPreview svgPath={pats[0].svgPath} widthInches={pats[0].widthInches} heightInches={pats[0].heightInches} size="thumb" />
							</div>
							<div class="card__body">
								<div class="card__name">{subjectName(v)}</div>
								<div class="card__meta">
									{pats.length} {pats.length === 1 ? "pattern" : "patterns"} · {formatRelativeTime(new Date(v.updatedAt))}
								</div>
								<div class="card__tags">
									<span class="chip">{typeLabel(typeOf(v))}</span>
									{#if v.contributedBy}<span class="chip chip--comm">Community</span>{/if}
									{#if v.popular}<span class="chip chip--pop">Popular</span>{/if}
								</div>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ─── Activity + side widgets ─── -->
	<div class="row row--main">
		<div class="col">
			<section class="panel" aria-labelledby="act-h">
				<div class="panel__head">
					<h2 id="act-h" class="panel__title">Cutting activity</h2>
					<span class="panel__sub">Last 6 months</span>
				</div>
				{#if hasActivity}
					<div class="chart" role="img" aria-label="Cuts per month: {months.map((m) => `${m.label} ${m.n}`).join(', ')}">
						{#each months as m (m.key)}
							<div class="chart__col">
								<span class="chart__n">{m.n || ""}</span>
								<div class="chart__track">
									<span class="chart__bar" class:chart__bar--zero={!m.n} style:height="{Math.max(m.n ? 6 : 2, (m.n / monthMax) * 100)}%"></span>
								</div>
								<span class="chart__lbl">{m.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="muted">Your monthly cut counts will chart here after your first cut.</p>
				{/if}
			</section>

			<section class="panel" aria-labelledby="recent-h">
				<div class="panel__head">
					<h2 id="recent-h" class="panel__title">Recent jobs</h2>
					<a class="panel__link" href="/jobs">View all</a>
				</div>
				{#if jobsLoading}
					<p class="muted">Loading…</p>
				{:else if recentJobs.length === 0}
					<p class="muted">No finished jobs yet.</p>
				{:else}
					<ul class="job-list">
						{#each recentJobs as job (job.id)}
							<li class="job">
								<div class="job__main">
									<span class="job__name">{job.name}</span>
									<span class="job__meta">{job.subject || getVehicleName(job.vehicleId)} · {formatRelativeTime(job.createdAt)}</span>
								</div>
								<Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="col col--side">
			{#if topRequests.length}
				<section class="panel" aria-labelledby="req-h">
					<div class="panel__head">
						<h2 id="req-h" class="panel__title">Most wanted</h2>
						<a class="panel__link" href="/library">Open library</a>
					</div>
					<ul class="reqs">
						{#each topRequests as r (r.id)}
							<li>
								<span class="reqs__votes"><b>{r.votes}</b><span>votes</span></span>
								<span class="reqs__name">{r.vehicle}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<a class="panel whatsnew" href="/changelog#v{LATEST_VERSION}">
				<span class="whatsnew__tag">v{LATEST_VERSION}</span>
				<span class="whatsnew__text">See what's new in OmniPlot</span>
				<span aria-hidden="true">→</span>
			</a>
		</div>
	</div>
</div>
</div>

<style>
	/* The shell's sidebar eats a lot of the viewport, so layout follows the
	   width of this content area (container queries), not the window. */
	.dash {
		container: dash / inline-size;
		width: 100%;
		min-width: 0;
		height: 100%;
		overflow-x: hidden;
		overflow-y: auto;
	}
	.dash-body {
		box-sizing: border-box;
		width: 100%;
		max-width: 1320px;
		margin-inline: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.muted { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
	.warn { color: var(--color-warning); }
	.bad { color: var(--color-danger); }

	/* ─── Hero ─── */
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 20px;
		align-items: center;
		padding: 24px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		background:
			radial-gradient(120% 140% at 100% 0%, var(--color-brand-muted), transparent 55%),
			var(--bg-surface);
	}
	.hero__eyebrow {
		margin: 0 0 4px;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-brand, var(--color-brand));
	}
	.hero__title { font-size: 1.75rem; margin: 0 0 6px; overflow-wrap: anywhere; letter-spacing: -0.03em; }
	.hero__sub { margin: 0 0 16px; color: var(--text-secondary); font-size: 0.9375rem; }
	.hero__cta { display: flex; flex-wrap: wrap; gap: 8px; }

	.allow {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 18px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		min-width: 0;
	}
	.allow__ring { flex-shrink: 0; }
	.allow__ring--inf {
		width: 84px; height: 84px; display: grid; place-items: center;
		font-size: 2rem; color: var(--color-brand);
		border: 6px solid var(--color-brand-muted); border-radius: 50%;
		box-sizing: border-box;
	}
	.allow__track { fill: none; stroke: var(--bg-surface-3); stroke-width: 8; }
	.allow__fill {
		fill: none; stroke: var(--color-brand); stroke-width: 8; stroke-linecap: round;
		transition: stroke-dashoffset 0.6s ease;
	}
	.allow__fill--warn { stroke: var(--color-warning); }
	.allow__big { font-family: var(--font-display); font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; }
	.allow__sub { font-size: 0.75rem; color: var(--text-tertiary); }
	.allow__link {
		margin-top: 4px; padding: 0; border: 0; background: none; cursor: pointer; font: inherit;
		font-size: 0.8125rem; color: var(--text-brand, var(--color-brand));
	}
	.allow__link:hover { text-decoration: underline; }

	/* ─── Stats ─── */
	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
	.stat {
		min-width: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.stat__val { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; }
	.stat__val--ok { color: var(--color-success); }
	.stat__val--brand { color: var(--text-brand, var(--color-brand)); }
	.stat__label { font-size: 0.75rem; color: var(--text-tertiary); }

	/* ─── Rows ─── */
	.row { display: grid; gap: 14px; align-items: start; }
	.row--2 { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: stretch; }
	.row--main { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: stretch; }
	.row--setup { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
	.row--setup.row--solo { grid-template-columns: minmax(0, 1fr); }
	.col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
	/* Side-by-side columns end on the same line: the last real panel of each takes the slack. */
	.col:not(.col--side) > .panel:last-child, .col--side > .panel:not(.whatsnew):nth-last-child(2), .col--side > .whatsnew:only-child { flex: 1; }

	.panel {
		min-width: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 18px;
		display: flex; flex-direction: column; gap: 14px;
	}
	.panel__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	.panel__title { font-size: 0.9375rem; font-weight: 700; margin: 0; }
	.panel__sub { font-size: 0.8125rem; color: var(--text-secondary); margin: 2px 0 0; }
	.panel__link { font-size: 0.8125rem; color: var(--text-brand, var(--color-brand)); text-decoration: none; white-space: nowrap; }
	.panel__link:hover { text-decoration: underline; }

	/* progress bar */
	.bar { height: 6px; border-radius: 99px; background: var(--bg-surface-3); overflow: hidden; }
	.bar__fill { display: block; height: 100%; border-radius: 99px; background: var(--color-brand); transition: width 0.4s ease; }

	/* ─── Active cuts ─── */
	.active-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
	.active { display: flex; flex-direction: column; gap: 6px; }
	.active__top { display: flex; align-items: center; gap: 8px; }
	.active__pulse {
		width: 9px; height: 9px; border-radius: 50%; background: var(--color-brand); flex-shrink: 0;
		animation: pulse 1.6s ease-out infinite;
	}
	.active__name { font-weight: 700; font-size: 0.9375rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.active__when { margin-left: auto; font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.active__meta, .active__count { font-size: 0.75rem; color: var(--text-tertiary); }
	@keyframes pulse {
		0% { box-shadow: 0 0 0 0 var(--color-brand-muted); }
		100% { box-shadow: 0 0 0 10px transparent; }
	}

	/* idle state */
	.idle { display: flex; align-items: center; gap: 20px; flex: 1; }
	.idle__art { width: min(260px, 46%); height: auto; flex-shrink: 0; }
	.idle__text { min-width: 0; }
	.idle__title { margin: 0 0 4px; font-size: 1.0625rem; }
	.idle__sub { margin: 0 0 12px; font-size: 0.875rem; color: var(--text-secondary); }
	.idle__cta { display: flex; flex-wrap: wrap; gap: 8px; }
	.art-bed { fill: var(--bg-surface-3); }
	.art-sheet { fill: var(--bg-base); stroke: var(--border-default); stroke-width: 1.5; }
	.art-cut {
		fill: var(--color-brand-muted); stroke: var(--color-brand); stroke-width: 2; stroke-linejoin: round;
		stroke-dasharray: 100; stroke-dashoffset: 100;
		animation: draw 5s ease-in-out infinite;
	}
	.art-rail { fill: var(--bg-surface-3); stroke: var(--border-default); }
	.art-carriage { fill: var(--color-brand); }
	.art-blade { stroke: var(--text-secondary); stroke-width: 2; stroke-linecap: round; }
	.art-tip { fill: var(--color-brand); }
	.art-head { animation: sweep 5s ease-in-out infinite; }
	.art-spark circle { fill: var(--color-brand); opacity: 0.5; animation: twinkle 3s ease-in-out infinite; }
	.art-spark circle:nth-child(2) { animation-delay: 1s; }
	.art-spark circle:nth-child(3) { animation-delay: 2s; }
	@keyframes draw {
		0%, 8% { stroke-dashoffset: 100; }
		70%, 88% { stroke-dashoffset: 0; }
		100% { stroke-dashoffset: -100; }
	}
	@keyframes sweep {
		0%, 8% { transform: translateX(70px); }
		70%, 88% { transform: translateX(258px); }
		100% { transform: translateX(70px); }
	}
	@keyframes twinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.7; } }
	@media (prefers-reduced-motion: reduce) {
		.art-cut { animation: none; stroke-dashoffset: 0; }
		.art-head { animation: none; transform: translateX(164px); }
		.art-spark circle, .active__pulse, .card--skel { animation: none; }
	}

	/* ─── Cutter card ─── */
	.cutter__main { display: flex; align-items: center; gap: 12px; }
	.cutter__id { min-width: 0; flex: 1; }
	.cutter__name { font-weight: 700; font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cutter__status { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--text-secondary); }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
	.psb-ok .dot, .psb-cutting .dot { background: var(--color-success); }
	.psb-warn .dot { background: var(--color-warning); }
	.psb-error .dot { background: var(--color-danger); }
	.medal {
		width: 46px; height: 46px; border-radius: var(--radius-lg); flex-shrink: 0;
		display: grid; place-items: center;
		background: var(--bg-surface-3); color: var(--text-secondary);
	}
	.psb-ok .medal, .psb-cutting .medal { background: var(--color-brand-muted); color: var(--text-brand, var(--color-brand)); }
	.psb-warn .medal { color: var(--color-warning); }
	.conn-chip {
		font-size: 0.6875rem; font-weight: 600; padding: 3px 8px; border-radius: 99px;
		background: var(--bg-surface-3); color: var(--text-secondary); white-space: nowrap;
	}
	.kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin: 0; }
	.kv > div { min-width: 0; padding-top: 10px; border-top: 1px solid var(--border-subtle); }
	.kv dt { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
	.kv dd { margin: 2px 0 0; font-size: 0.9375rem; font-weight: 600; overflow-wrap: anywhere; }
	.cutter__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }

	/* ─── Community ─── */
	.types { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
	.type {
		min-width: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 2px;
		align-items: center; padding: 14px; text-decoration: none; color: inherit;
		background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		transition: border-color 0.15s, transform 0.15s;
	}
	.type:hover { border-color: var(--color-brand); transform: translateY(-1px); }
	.type__icon {
		grid-row: span 2; width: 36px; height: 36px; border-radius: var(--radius-md);
		display: grid; place-items: center; background: var(--color-brand-muted); color: var(--text-brand, var(--color-brand));
	}
	.type__label { font-size: 0.75rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em; }
	.type__num { font-family: var(--font-display); font-size: 1.5rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
	.type__sub { grid-column: 1 / -1; font-size: 0.75rem; color: var(--text-secondary); margin-top: 6px; }
	.type__bar { grid-column: 1 / -1; height: 4px; border-radius: 99px; background: var(--bg-surface-3); overflow: hidden; margin-top: 4px; }
	.type__bar span { display: block; height: 100%; background: var(--color-brand); border-radius: 99px; transition: width 0.5s ease; }

	.tabs { display: inline-flex; align-self: flex-start; gap: 4px; padding: 3px; background: var(--bg-base); border-radius: var(--radius-md); max-width: 100%; flex-wrap: wrap; }
	.tab {
		border: 0; background: none; cursor: pointer; font: inherit; font-size: 0.8125rem; font-weight: 600;
		padding: 6px 12px; border-radius: var(--radius-sm); color: var(--text-secondary);
	}
	.tab--on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }

	.feed {
		list-style: none; margin: 0; padding: 0;
		display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
	}
	.card {
		display: flex; flex-direction: column; height: 100%; min-width: 0; text-decoration: none; color: inherit;
		background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		overflow: hidden; transition: border-color 0.15s, transform 0.15s;
	}
	.card:hover { border-color: var(--color-brand); transform: translateY(-1px); }
	.card--skel { min-height: 190px; background: var(--bg-surface-2); animation: twinkle 1.4s ease-in-out infinite; }
	.card__thumb { height: 110px; display: grid; place-items: center; padding: 10px; background: var(--bg-surface-2); }
	.card__body { padding: 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.card__name { font-weight: 700; font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.card__meta { font-size: 0.75rem; color: var(--text-tertiary); }
	.card__tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
	.chip { font-size: 0.6875rem; font-weight: 600; padding: 2px 7px; border-radius: 99px; background: var(--bg-surface-3); color: var(--text-secondary); }
	.chip--comm { background: var(--color-brand-muted); color: var(--text-brand, var(--color-brand)); }
	.chip--pop { color: var(--color-warning); }

	/* ─── Activity chart ─── */
	.chart { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; height: 160px; }
	.chart__col { height: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 0; }
	.chart__n { font-size: 0.6875rem; color: var(--text-secondary); min-height: 1em; }
	.chart__track { flex: 1; min-height: 0; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
	.chart__bar { width: 100%; max-width: 44px; border-radius: 5px 5px 2px 2px; background: var(--color-brand); }
	.chart__bar--zero { background: var(--bg-surface-3); }
	.chart__lbl { font-size: 0.6875rem; color: var(--text-tertiary); }

	/* ─── Recent jobs ─── */
	.job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.job { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border-subtle); }
	.job:first-child { border-top: 0; }
	.job:nth-child(n + 6) { display: none; }
	.job__main { display: flex; flex-direction: column; min-width: 0; }
	.job__name { display: block; min-width: 0; font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.job__meta { font-size: 0.75rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* ─── Side widgets ─── */
	.steps, .mine, .reqs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.step { display: flex; align-items: center; gap: 10px; padding: 7px 0; min-height: 34px; font-size: 0.875rem; color: var(--text-primary); text-decoration: none; }
	.step:hover { color: var(--text-brand, var(--color-brand)); }
	.step--done { color: var(--text-tertiary); text-decoration: line-through; }
	.step__box {
		width: 18px; height: 18px; border-radius: 5px; flex-shrink: 0; display: grid; place-items: center;
		border: 1.5px solid var(--border-default); color: var(--bg-base);
	}
	.step--done .step__box { background: var(--color-success); border-color: var(--color-success); }

	.mini-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
	.mini-stats > div { display: flex; flex-direction: column; padding: 10px; background: var(--bg-base); border-radius: var(--radius-md); }
	.mini-stats b { font-family: var(--font-display); font-size: 1.25rem; }
	.mini-stats span { font-size: 0.6875rem; color: var(--text-tertiary); }
	.mine li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
	.mine__name { font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

	.reqs li { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
	.reqs__votes { display: flex; flex-direction: column; align-items: center; min-width: 40px; padding: 4px 6px; background: var(--bg-base); border-radius: var(--radius-md); }
	.reqs__votes b { font-family: var(--font-display); font-size: 1rem; line-height: 1.1; }
	.reqs__votes span { font-size: 0.625rem; color: var(--text-tertiary); }
	.reqs__name { font-size: 0.8125rem; min-width: 0; overflow-wrap: anywhere; }

	.whatsnew { flex-direction: row; align-items: center; gap: 10px; text-decoration: none; color: inherit; padding: 14px 18px; }
	.whatsnew:hover { border-color: var(--color-brand); }
	.whatsnew__tag { font-size: 0.6875rem; font-weight: 700; padding: 3px 8px; border-radius: 99px; background: var(--color-brand-muted); color: var(--text-brand, var(--color-brand)); }
	.whatsnew__text { flex: 1; font-size: 0.875rem; font-weight: 600; min-width: 0; }

	/* ─── Responsive (by content width) ─── */
	@media (min-height: 900px) { .job:nth-child(-n + 7) { display: flex; } }
	@media (min-height: 1200px) { .job:nth-child(n + 6) { display: flex; } }

	@container dash (min-width: 1100px) {
		.dash-body { padding: 32px; gap: 20px; }
		.hero { padding: 32px; }
		.hero__title { font-size: 2.125rem; }
		.stat { padding: 20px; }
		.stat__val { font-size: 1.875rem; }
		.panel { padding: 22px; }
	}

	@container dash (max-width: 900px) {
		.row--2, .row--main { grid-template-columns: minmax(0, 1fr); }
		.col--side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
		/* the feed shows one row: as many cards as there are columns */
		.feed { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.feed > :nth-child(n + 4) { display: none; }
		.types { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}

	@container dash (max-width: 700px) {
		.hero { grid-template-columns: minmax(0, 1fr); padding: 20px; }
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.col--side { grid-template-columns: minmax(0, 1fr); }
		.row--setup { grid-template-columns: minmax(0, 1fr); }
		.feed { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.feed > :nth-child(n + 3) { display: none; }
	}

	@container dash (max-width: 520px) {
		.dash-body { padding: 16px 16px 24px; gap: 14px; }
		.hero { padding: 16px; }
		.hero__title { font-size: 1.375rem; }
		.hero__cta :global(a), .hero__cta :global(button) { flex: 1 1 auto; justify-content: center; }
		.stat { padding: 12px; }
		.stat__val { font-size: 1.25rem; }
		.panel { padding: 14px; }
		.idle { flex-direction: column; text-align: center; }
		.idle__art { width: min(240px, 80%); }
		.idle__cta { justify-content: center; }
		.types { gap: 8px; }
		.type { padding: 12px; }
		.feed { grid-template-columns: minmax(0, 1fr); }
		.feed > :nth-child(n + 3) { display: revert; }
		.card { flex-direction: row; }
		.card__thumb { width: 92px; height: auto; flex-shrink: 0; }
		.kv { grid-template-columns: minmax(0, 1fr); }
		.chart { gap: 6px; }
		.job { flex-wrap: wrap; row-gap: 4px; }
		.job__main { flex: 1 1 60%; }
	}
</style>
