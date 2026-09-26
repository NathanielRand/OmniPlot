<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import AdminPatternInspector, { FLOW_LABELS, INPUT_LABELS, STATUS_VARIANT, subjectLabel, type AdminPatternRow } from "$lib/components/admin/AdminPatternInspector.svelte";
	import { auth } from "$lib/firebase/client";
	import { categoryLabel, categoryShortLabel, zoneLabel } from "$lib/stores/patternStore.svelte";
	import { tooltip } from "$lib/actions/tooltip";
	import { onMount } from "svelte";
	import type { PatternCategory, PatternZone, ProjectType } from "$lib/types";

	type Range = "30d" | "90d" | "1y" | "all";
	const RANGE_LABELS: Record<Range, string> = { "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last year", "all": "All time" };

	interface LabelCount { label: string; count: number; users: number }
	// Mirrors GET /api/admin/user-patterns/stats
	interface Stats {
		range: Range;
		start: string | null;
		totals: {
			patterns: number; private: number; pending: number; published: number; rejected: number;
			uploaders: number; inRange: number; uploadersInRange: number; flagged: number;
			cutInRange: number; trackedInRange: number; editedInRange: number;
		};
		series: { week: string; uploads: number; users: number }[];
		breakdowns: Record<"category" | "projectType" | "coverage" | "status" | "input" | "flow" | "tier" | "size" | "complexity" | "fileType", Record<string, number>>;
		topZones: { zone: PatternZone; category: PatternCategory; projectType: ProjectType; count: number; users: number }[];
		customZoneLabels: LabelCount[];
		customZoneLabelCount: number;
		topMakes: LabelCount[];
		topModels: LabelCount[];
		topProjects: LabelCount[];
		topUploaders: { uid: string; name: string; email: string; tier: string; patterns: number; cuts: number }[];
		recent: AdminPatternRow[];
		recentTruncated: boolean;
	}

	let range   = $state<Range>("90d");
	let loading = $state(true);
	let error   = $state<string | null>(null);
	let stats   = $state<Stats | null>(null);

	let requestSeq = 0;
	async function load(r: Range) {
		const seq = ++requestSeq;
		loading = true;
		error = null;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch(`/api/admin/user-patterns/stats?range=${r}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Failed to load upload stats");
			if (seq === requestSeq) stats = data;
		} catch (e) {
			if (seq === requestSeq) error = e instanceof Error ? e.message : "Could not load data";
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}
	onMount(() => load(range));
	function setRange(r: Range) { range = r; load(r); }

	const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

	// ── Breakdown panels (labelled bars, sorted by count) ──
	const PROJECT_LABELS: Record<string, string> = { vehicle: "Vehicle", residential: "Residential", commercial: "Commercial", custom: "Custom" };
	const TIER_LABELS: Record<string, string> = { free: "Free", lite: "Lite", pro: "Pro", admin: "Admin", shop: "Shop seat" };
	const COVERAGE_LABELS: Record<string, string> = { full: "Full", partial: "Partial", "edge-only": "Edge only" };
	const inputLabel = (k: string) => k.endsWith(" (pdf)") ? `${INPUT_LABELS[k.slice(0, -6)] ?? k.slice(0, -6)} (PDF)` : INPUT_LABELS[k] ?? k;

	function rows(rec: Record<string, number> | undefined, label: (k: string) => string = (k) => k, keepOrder?: string[]) {
		const entries = Object.entries(rec ?? {});
		if (keepOrder) entries.sort((a, b) => keepOrder.indexOf(a[0]) - keepOrder.indexOf(b[0]));
		else entries.sort((a, b) => b[1] - a[1]);
		const total = entries.reduce((s, [, n]) => s + n, 0);
		return { total, rows: entries.map(([k, n]) => ({ key: k, label: label(k), count: n })) };
	}

	const panels = $derived(stats ? [
		{ title: "Category",       note: "what material", ...rows(stats.breakdowns.category, (k) => categoryLabel(k as PatternCategory)) },
		{ title: "Subject type",   note: "what it's for", ...rows(stats.breakdowns.projectType, (k) => PROJECT_LABELS[k] ?? k) },
		{ title: "Import method",  note: "tracked uploads", ...rows(stats.breakdowns.input, inputLabel) },
		{ title: "Upload flow",    note: "tracked uploads", ...rows(stats.breakdowns.flow, (k) => FLOW_LABELS[k] ?? k) },
		{ title: "Plan at upload", note: "tracked uploads", ...rows(stats.breakdowns.tier, (k) => TIER_LABELS[k] ?? k) },
		{ title: "Coverage",       note: "",                ...rows(stats.breakdowns.coverage, (k) => COVERAGE_LABELS[k] ?? k) },
		{ title: "Largest side",   note: "",                ...rows(stats.breakdowns.size, undefined, ["< 12 in", "12–24 in", "24–48 in", "48–72 in", "72+ in", "unknown"]) },
		{ title: "Path complexity", note: "drawing commands", ...rows(stats.breakdowns.complexity, undefined, ["< 50 cmds", "50–200", "200–1k", "1k+", "unknown"]) },
		{ title: "Status",         note: "",                ...rows(stats.breakdowns.status) },
	] : []);

	const maxWeek = $derived(Math.max(1, ...(stats?.series ?? []).map((w) => w.uploads)));
	const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

	// ── Browse ──
	let search         = $state("");
	let filterCategory = $state<string>("all");
	let filterProject  = $state<string>("all");
	let filterStatus   = $state<string>("all");
	let onlyFlagged    = $state(false);
	let selected       = $state<AdminPatternRow | null>(null);

	const browse = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return (stats?.recent ?? []).filter((p) => {
			if (filterCategory !== "all" && p.category !== filterCategory) return false;
			if (filterProject !== "all" && p.projectType !== filterProject) return false;
			if (filterStatus !== "all" && p.status !== filterStatus) return false;
			if (onlyFlagged && !p.moderation?.flagged) return false;
			if (!q) return true;
			return [p.name, subjectLabel(p), p.owner?.name ?? "", p.owner?.email ?? "", p.source?.fileName ?? "", p.id, ...p.customZoneLabels]
				.some((s) => s.toLowerCase().includes(q));
		});
	});
	let browseLimit = $state(100);
	$effect(() => { void search; void filterCategory; void filterProject; void filterStatus; void onlyFlagged; browseLimit = 100; });

	function updateRow(next: AdminPatternRow) {
		if (!stats) return;
		stats = { ...stats, recent: stats.recent.map((p) => (p.id === next.id ? { ...p, moderation: next.moderation } : p)) };
		selected = { ...next };
	}
	function removeRow(id: string) {
		if (!stats) return;
		stats = { ...stats, recent: stats.recent.filter((p) => p.id !== id) };
		selected = null;
	}

	function onKey(e: KeyboardEvent) { if (e.key === "Escape" && selected) selected = null; }
</script>

<svelte:head><title>Uploads — Admin — OmniPlot</title></svelte:head>
<svelte:window onkeydown={onKey}/>

<div class="uploads-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Uploads</h1>
			<p class="page-sub">What people put in their own libraries, private patterns included. Status totals are all-time; everything else follows the range.</p>
		</div>
		<div class="range-tabs" role="group" aria-label="Date range">
			{#each (["30d", "90d", "1y", "all"] as Range[]) as r}
				<button class="range-tab" class:active={range === r} aria-pressed={range === r} onclick={() => setRange(r)}>{RANGE_LABELS[r]}</button>
			{/each}
		</div>
	</div>

	{#if error}
		<div class="load-error"><p>{error}</p><button class="retry-btn" onclick={() => load(range)}>Retry</button></div>
	{/if}

	<!-- KPIs -->
	<div class="kpi-row">
		{#if !stats}
			{#each { length: 4 } as _}
				<div class="kpi-card"><div class="skel skel--label"></div><div class="skel skel--value"></div><div class="skel skel--sub"></div></div>
			{/each}
		{:else}
			<div class="kpi-card">
				<div class="kpi-label">Uploads</div>
				<div class="kpi-value">{stats.totals.inRange.toLocaleString()}</div>
				<div class="kpi-note">{stats.totals.uploadersInRange} {stats.totals.uploadersInRange === 1 ? "user" : "users"} · {RANGE_LABELS[range].toLowerCase()}</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Kept private</div>
				<div class="kpi-value">{pct(stats.totals.private, stats.totals.patterns)}%</div>
				<div class="kpi-note">{stats.totals.private.toLocaleString()} of {stats.totals.patterns.toLocaleString()} · {stats.totals.pending} pending · {stats.totals.published} approved</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Ever cut</div>
				<div class="kpi-value">{pct(stats.totals.cutInRange, stats.totals.inRange)}%</div>
				<div class="kpi-note">{stats.totals.cutInRange} of this range's uploads · {pct(stats.totals.editedInRange, stats.totals.inRange)}% edited after upload</div>
			</div>
			<div class="kpi-card">
				<div class="kpi-label">Flagged</div>
				<div class="kpi-value" class:kpi-value--dim={!stats.totals.flagged}>{stats.totals.flagged}</div>
				<div class="kpi-note">{#if stats.totals.flagged}<button class="link-btn" onclick={() => { onlyFlagged = true; document.getElementById("browse")?.scrollIntoView({ behavior: "smooth" }); }}>Show flagged</button>{:else}nothing needs review{/if}</div>
			</div>
		{/if}
	</div>

	{#if stats && stats.totals.inRange > 0 && stats.totals.trackedInRange < stats.totals.inRange}
		<p class="coverage-note">
			Import method, upload flow and plan are only known for {stats.totals.trackedInRange} of {stats.totals.inRange} uploads in this range — patterns saved before tracking started don't have them.
		</p>
	{/if}

	<!-- Weekly uploads -->
	<div class="admin-panel">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">Uploads per week</h2>
			{#if stats}<span class="chart-note">{RANGE_LABELS[range]}</span>{/if}
		</div>
		<div class="chart-body" class:chart-body--stale={loading && !!stats}>
			{#if !stats}
				<div class="skel" style="width:100%;height:140px;border-radius:8px;"></div>
			{:else if stats.series.every((w) => w.uploads === 0)}
				<div class="panel-empty"><p>No uploads in this range</p></div>
			{:else}
				<div class="bars" role="img" aria-label="Uploads per week, {RANGE_LABELS[range]}">
					<span class="bars__max">{maxWeek}</span>
					{#each stats.series as w (w.week)}
						<div class="bars__col" use:tooltip={`Week of ${weekLabel(w.week)}: ${w.uploads} upload${w.uploads === 1 ? "" : "s"} · ${w.users} user${w.users === 1 ? "" : "s"}`}>
							<div class="bars__bar" style="height: {(w.uploads / maxWeek) * 100}%"></div>
						</div>
					{/each}
				</div>
				<div class="chart-labels">
					<span>{weekLabel(stats.series[0].week)}</span>
					<span>{weekLabel(stats.series[stats.series.length - 1].week)}</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Breakdowns -->
	<div class="panel-grid">
		{#each panels as panel (panel.title)}
			<div class="admin-panel">
				<div class="admin-panel__header">
					<h2 class="admin-panel__title">{panel.title}</h2>
					{#if panel.note}<span class="chart-note">{panel.note}</span>{/if}
				</div>
				<div class="tier-body">
					{#if panel.rows.length === 0}
						<div class="tier-foot">No data in this range.</div>
					{:else}
						{#each panel.rows as r (r.key)}
							<div class="tier-row" use:tooltip={`${r.label}: ${r.count} (${pct(r.count, panel.total)}%)`}>
								<div class="tier-label" title={r.label}>{r.label}</div>
								<div class="tier-bar-wrap"><div class="tier-bar" style="width:{pct(r.count, panel.total)}%"></div></div>
								<div class="tier-count">{r.count}</div>
								<div class="tier-pct">{pct(r.count, panel.total)}%</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- What people name things -->
	<div class="bottom-row">
		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Zones</h2>
				<span class="chart-note">ranked by users</span>
			</div>
			{#if !stats}
				<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
			{:else if stats.topZones.length === 0}
				<div class="panel-empty"><p>No zones in this range</p></div>
			{:else}
				<div class="table-scroll">
					<table class="mini-table" aria-label="Most-used zones">
						<thead><tr><th>Zone</th><th>Category</th><th>Users</th><th>Uses</th></tr></thead>
						<tbody>
							{#each stats.topZones as z (`${z.projectType}|${z.category}|${z.zone}`)}
								<tr>
									<td class="td-name">{zoneLabel(z.zone, z.category, z.projectType)}</td>
									<td class="td-muted">{categoryShortLabel(z.category)}{z.projectType !== "vehicle" ? ` · ${PROJECT_LABELS[z.projectType] ?? z.projectType}` : ""}</td>
									<td class="td-mono">{z.users}</td>
									<td class="td-mono">{z.count}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Custom zone names</h2>
				<span class="chart-note">{stats ? `${stats.customZoneLabelCount} distinct` : ""}</span>
			</div>
			{#if !stats}
				<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
			{:else if stats.customZoneLabels.length === 0}
				<div class="panel-empty"><p>Nobody named a custom zone in this range</p></div>
			{:else}
				<p class="panel-hint">Zones people had to invent because our list didn't have them — candidates for new built-in zones.</p>
				<div class="table-scroll">
					<table class="mini-table" aria-label="Custom zone names">
						<thead><tr><th>Name</th><th>Users</th><th>Uses</th></tr></thead>
						<tbody>
							{#each stats.customZoneLabels as l (l.label)}
								<tr><td class="td-name">{l.label}</td><td class="td-mono">{l.users}</td><td class="td-mono">{l.count}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Vehicles</h2>
				<span class="chart-note">make · model</span>
			</div>
			{#if !stats}
				<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
			{:else if stats.topModels.length === 0}
				<div class="panel-empty"><p>No vehicle uploads in this range</p></div>
			{:else}
				<p class="panel-hint">Vehicles people pattern themselves — gaps in the community library.</p>
				<div class="table-scroll">
					<table class="mini-table" aria-label="Most-uploaded vehicles">
						<thead><tr><th>Vehicle</th><th>Users</th><th>Patterns</th></tr></thead>
						<tbody>
							{#each stats.topModels as m (m.label)}
								<tr><td class="td-name">{m.label}</td><td class="td-mono">{m.users}</td><td class="td-mono">{m.count}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="tier-foot tier-foot--pad">Top makes: {stats.topMakes.slice(0, 8).map((m) => `${m.label} (${m.users})`).join(" · ")}</div>
			{/if}
		</div>

		<div class="admin-panel">
			<div class="admin-panel__header">
				<h2 class="admin-panel__title">Other projects</h2>
				<span class="chart-note">custom · residential · commercial</span>
			</div>
			{#if !stats}
				<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
			{:else if stats.topProjects.length === 0}
				<div class="panel-empty"><p>No non-vehicle uploads in this range</p></div>
			{:else}
				<p class="panel-hint">Project and property names people use outside of vehicles.</p>
				<div class="table-scroll">
					<table class="mini-table" aria-label="Project names">
						<thead><tr><th>Name</th><th>Users</th><th>Patterns</th></tr></thead>
						<tbody>
							{#each stats.topProjects as m (m.label)}
								<tr><td class="td-name">{m.label}</td><td class="td-mono">{m.users}</td><td class="td-mono">{m.count}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>

	<!-- Top uploaders -->
	<div class="admin-panel">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">Top uploaders</h2>
			<span class="chart-note">{RANGE_LABELS[range].toLowerCase()}</span>
		</div>
		{#if !stats}
			<div class="tier-body">{#each { length: 5 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
		{:else if stats.topUploaders.length === 0}
			<div class="panel-empty"><p>No uploads in this range</p></div>
		{:else}
			<div class="table-scroll">
				<table class="mini-table" aria-label="Top uploaders">
					<thead><tr><th>User</th><th>Plan</th><th>Patterns</th><th>Cut jobs using them</th></tr></thead>
					<tbody>
						{#each stats.topUploaders as u (u.uid)}
							<tr>
								<td class="td-name"><a class="row-link" href="/admin/users?uid={u.uid}">{u.name}</a>{#if u.email && u.email !== u.name}<span class="td-muted"> · {u.email}</span>{/if}</td>
								<td class="td-muted">{TIER_LABELS[u.tier] ?? u.tier}</td>
								<td class="td-mono">{u.patterns}</td>
								<td class="td-mono">{u.cuts}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- Browse -->
	<div class="admin-panel" id="browse">
		<div class="admin-panel__header">
			<h2 class="admin-panel__title">All uploads</h2>
			{#if stats}<span class="chart-note">{browse.length.toLocaleString()} shown{stats.recentTruncated ? " · newest 1,000 in range" : ""}</span>{/if}
		</div>
		<div class="browse-filters">
			<input class="browse-input" bind:value={search} placeholder="Search name, subject, user, file, custom zone…" aria-label="Search uploads"/>
			<select class="browse-input" bind:value={filterCategory} aria-label="Category">
				<option value="all">All categories</option>
				{#each Object.keys(stats?.breakdowns.category ?? {}) as c}<option value={c}>{categoryLabel(c as PatternCategory)}</option>{/each}
			</select>
			<select class="browse-input" bind:value={filterProject} aria-label="Subject type">
				<option value="all">All subjects</option>
				{#each Object.keys(PROJECT_LABELS) as t}<option value={t}>{PROJECT_LABELS[t]}</option>{/each}
			</select>
			<select class="browse-input" bind:value={filterStatus} aria-label="Status">
				<option value="all">Any status</option>
				<option value="private">Private</option>
				<option value="pending">Pending</option>
				<option value="approved">Approved</option>
				<option value="rejected">Rejected</option>
			</select>
			<label class="browse-check"><input type="checkbox" bind:checked={onlyFlagged}/> Flagged only</label>
		</div>
		{#if !stats}
			<div class="tier-body">{#each { length: 6 } as _}<div class="skel" style="width:100%;height:12px"></div>{/each}</div>
		{:else if browse.length === 0}
			<div class="panel-empty"><p>No uploads match</p></div>
		{:else}
			<div class="table-scroll">
				<table class="mini-table mini-table--click" aria-label="Uploads">
					<thead><tr><th>Uploaded</th><th>Pattern</th><th>User</th><th>Category</th><th>Import</th><th>Cuts</th><th>Status</th></tr></thead>
					<tbody>
						{#each browse.slice(0, browseLimit) as p (p.id)}
							<tr class:row--selected={selected?.id === p.id} onclick={() => (selected = p)} onkeydown={(e) => { if (e.key === "Enter") selected = p; }} tabindex="0">
								<td class="td-mono">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"}</td>
								<td class="td-name">
									<div class="cell-main">{p.name || "Untitled"}</div>
									<div class="cell-sub">{subjectLabel(p)}</div>
								</td>
								<td class="td-muted">{p.owner?.name ?? p.ownerId}</td>
								<td class="td-muted">{categoryShortLabel(p.category)}</td>
								<td class="td-muted">{p.source ? inputLabel(p.source.fromPdf ? `${p.source.input} (pdf)` : p.source.input) : "—"}</td>
								<td class="td-mono">{p.usage.cuts || "—"}</td>
								<td>
									<span class="status-cell">
										{#if p.moderation?.flagged}<Badge variant="danger" size="sm" dot>flagged</Badge>{/if}
										<Badge variant={STATUS_VARIANT[p.status] ?? "default"} size="sm">{p.status}</Badge>
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if browse.length > browseLimit}
				<div class="more-row"><button class="retry-btn" onclick={() => (browseLimit += 100)}>Show more ({browse.length - browseLimit} left)</button></div>
			{/if}
		{/if}
	</div>
</div>

{#if selected}
	<div class="drawer-backdrop" onclick={() => (selected = null)} aria-hidden="true"></div>
	<aside class="drawer" aria-label="Upload details">
		<div class="drawer__head">
			<span class="drawer__title">Upload</span>
			<button class="drawer__close" onclick={() => (selected = null)} aria-label="Close">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>
		<div class="drawer__body">
			{#key selected.id}
				<AdminPatternInspector pattern={selected} showOwner onchange={updateRow} ondelete={removeRow}/>
			{/key}
		</div>
	</aside>
{/if}

<style>
	.uploads-page { padding: 24px; display: flex; flex-direction: column; gap: 20px; max-width: 1200px; margin: 0 auto; }

	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); max-width: 620px; }

	.range-tabs { display: flex; gap: 2px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 3px; }
	.range-tab {
		padding: 5px 12px; font-size: 0.75rem; font-weight: 500; font-family: var(--font-body);
		background: transparent; border: none; border-radius: var(--radius-md);
		color: var(--text-tertiary); cursor: pointer; transition: all 0.12s;
	}
	.range-tab:hover  { color: var(--text-primary); }
	.range-tab.active { background: var(--bg-surface-3); color: var(--text-primary); }

	.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
	.kpi-card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 4px; }
	.kpi-label { font-size: 0.6875rem; font-weight: 600; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.kpi-value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; }
	.kpi-value--dim { color: var(--text-tertiary); }
	.kpi-note  { font-size: 0.75rem; color: var(--text-tertiary); }
	.link-btn { padding: 0; border: none; background: none; color: var(--text-brand); font: inherit; cursor: pointer; }
	.link-btn:hover { text-decoration: underline; }
	.coverage-note { margin: -8px 0 0; font-size: 0.75rem; color: var(--text-tertiary); }

	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
	.skel { background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; }
	.skel--label { height: 8px; width: 60%; }
	.skel--value { height: 28px; width: 50%; margin-top: 2px; }
	.skel--sub   { height: 8px; width: 70%; margin-top: 2px; }

	.load-error { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; }
	.retry-btn  { margin-top: 8px; padding: 6px 14px; font-size: 0.8125rem; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; font-family: var(--font-body); }
	.retry-btn:hover { background: var(--bg-surface-3); }

	.admin-panel { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; min-width: 0; }
	.admin-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); }
	.admin-panel__title  { font-size: 0.9375rem; font-weight: 600; }
	.chart-note { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); }
	.panel-hint { margin: 0; padding: 10px 16px 4px; font-size: 0.75rem; color: var(--text-tertiary); }

	.chart-body { padding: 16px; transition: opacity 0.15s; }
	.chart-body--stale { opacity: 0.5; }
	.bars { position: relative; height: 140px; display: flex; align-items: flex-end; gap: 2px; padding-top: 14px; border-bottom: 1px solid var(--border-default); }
	.bars__max { position: absolute; top: 0; left: 0; font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); }
	.bars__col { flex: 1; min-width: 0; height: 100%; display: flex; align-items: flex-end; cursor: default; }
	.bars__bar { width: 100%; background: var(--text-brand); border-radius: 4px 4px 0 0; transition: opacity 0.12s; }
	.bars__col:hover .bars__bar { opacity: 0.75; }
	.bars__col:hover { background: var(--interactive-hover); border-radius: 4px 4px 0 0; }
	.chart-labels { display: flex; justify-content: space-between; margin-top: 6px; font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); }
	.panel-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 16px; text-align: center; }
	.panel-empty p { margin: 0; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); }

	.panel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
	.bottom-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	.tier-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
	.tier-row  { display: grid; grid-template-columns: minmax(0, 118px) 1fr 36px 34px; align-items: center; gap: 8px; width: 100%; }
	.tier-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tier-bar-wrap { height: 6px; background: var(--bg-surface-3); border-radius: 3px; overflow: hidden; }
	.tier-bar   { height: 100%; border-radius: 3px; background: var(--text-brand); transition: width 0.4s var(--ease-smooth); }
	.tier-count { font-family: var(--font-mono); font-size: 0.75rem; text-align: right; color: var(--text-primary); }
	.tier-pct   { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); text-align: right; }
	.tier-foot  { font-size: 0.75rem; color: var(--text-tertiary); }
	.tier-foot--pad { padding: 10px 16px 14px; border-top: 1px solid var(--border-subtle); }

	.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
	.mini-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.mini-table thead { background: var(--bg-surface-2); }
	.mini-table th { padding: 8px 14px; text-align: left; font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid var(--border-subtle); white-space: nowrap; }
	.mini-table tbody tr { border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.mini-table tbody tr:hover { background: var(--interactive-hover); }
	.mini-table--click tbody tr { cursor: pointer; }
	.mini-table tbody tr.row--selected { background: var(--interactive-hover); }
	.mini-table td { padding: 9px 14px; vertical-align: middle; }
	.td-name  { color: var(--text-primary); }
	.td-muted { color: var(--text-secondary); white-space: nowrap; }
	.td-mono  { font-family: var(--font-mono); font-size: 0.8125rem; white-space: nowrap; }
	.cell-main { font-weight: 500; }
	.cell-sub  { font-size: 0.75rem; color: var(--text-tertiary); }
	.status-cell { display: inline-flex; gap: 4px; }
	.row-link { color: var(--text-primary); text-decoration: none; }
	.row-link:hover { color: var(--text-brand); text-decoration: underline; }
	.more-row { display: flex; justify-content: center; padding: 4px 0 14px; }

	.browse-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); align-items: center; }
	.browse-input {
		padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body);
	}
	.browse-filters input.browse-input { flex: 1 1 240px; }
	.browse-check { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--text-secondary); }

	.drawer-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 90; }
	.drawer {
		position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 91;
		background: var(--bg-surface); border-left: 1px solid var(--border-default);
		display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0, 0, 0, 0.2);
	}
	.drawer__head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); }
	.drawer__title { font-weight: 600; }
	.drawer__close { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 4px; border-radius: var(--radius-sm); display: flex; }
	.drawer__close:hover { color: var(--text-primary); background: var(--interactive-hover); }
	.drawer__body { padding: 16px; overflow-y: auto; flex: 1; }

	@media (max-width: 1000px) { .panel-grid { grid-template-columns: 1fr 1fr; } .bottom-row { grid-template-columns: 1fr; } }
	@media (max-width: 900px)  { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 640px)  { .panel-grid { grid-template-columns: 1fr; } }
	@media (max-width: 480px) {
		.uploads-page { padding: 16px; }
		.kpi-row { grid-template-columns: 1fr; }
		.range-tabs { flex-wrap: wrap; }
		.range-tab { flex: 1 1 40%; text-align: center; }
	}
</style>
