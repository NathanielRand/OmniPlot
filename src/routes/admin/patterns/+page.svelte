<script lang="ts">
	// Admin → Patterns. Three jobs, three tabs (kept in the URL so links and
	// Back work): Review decisions, manage the Catalog, and answer Requests.
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import ReviewQueue from "$lib/components/admin/patterns/ReviewQueue.svelte";
	import CatalogManager from "$lib/components/admin/patterns/CatalogManager.svelte";
	import MediaCoverage from "$lib/components/admin/patterns/MediaCoverage.svelte";
	import RequestsBoard from "$lib/components/admin/patterns/RequestsBoard.svelte";
	import { adminPatterns as ap } from "$lib/admin/adminPatterns.svelte";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import type { SubjectForm } from "$lib/admin/patternForms";

	type Tab = "review" | "catalog" | "media" | "requests";
	const TABS: Tab[] = ["review", "catalog", "media", "requests"];
	const tab = $derived<Tab>(TABS.find((t) => t === page.url.searchParams.get("tab")) ?? "review");

	function setTab(t: Tab) {
		const url = new URL(page.url);
		if (t === "review") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	// Cross-tab jumps: Review/Requests → a subject in the Catalog.
	let focus = $state<{ subjectId: string; patternId?: string } | null>(null);
	let prefill = $state<Partial<SubjectForm> | null>(null);
	function openCatalog(subjectId: string, patternId?: string) {
		focus = { subjectId, patternId };
		setTab("catalog");
	}
	function createSubject(pre: Partial<SubjectForm>) {
		prefill = pre;
		setTab("catalog");
	}

	onMount(() => { ap.loadAll(); });

	// ─── Numbers up top ──────────────────────────
	const pendingNew = $derived(ap.submissions.filter((s) => s.status === "pending").length);
	const pendingChange = $derived(ap.adjustments.filter((a) => a.status === "pending").length);
	const toReview = $derived(pendingNew + pendingChange);
	const openRequests = $derived(patternStore.loading ? 0 : patternStore.requests.filter((r) => r.status !== "done").length);
	const totals = $derived({
		subjects: patternStore.vehicles.length,
		patterns: patternStore.vehicles.reduce((n, v) => n + patternStore.getPatterns(v.id).length, 0),
		live: patternStore.vehicles.reduce((n, v) => n + patternStore.getPatterns(v.id).filter((p) => p.isPublished).length, 0),
	});

	// Everyone with any pattern activity, for the contributor filter.
	const activeUsers = $derived.by(() => {
		const ids = new Set<string>();
		for (const s of ap.submissions) if (s.ownerId) ids.add(s.ownerId);
		for (const a of ap.adjustments) if (a.requestedBy) ids.add(a.requestedBy);
		for (const r of patternStore.requests) if (r.requestedBy) ids.add(r.requestedBy);
		for (const v of patternStore.vehicles) if (v.contributedBy) ids.add(v.contributedBy);
		return [...ids].sort((a, b) => ap.userLabel(a).localeCompare(ap.userLabel(b)));
	});
</script>

<svelte:head><title>Patterns — Admin — OmniPlot</title></svelte:head>

<div class="ap">
	<div class="head">
		<div>
			<h1 class="title">Patterns</h1>
			<p class="sub">Review what the community submits, manage the public catalog and its images, and answer pattern requests.</p>
		</div>
	</div>

	{#if patternStore.usingSeed && !patternStore.loading}
		<div class="banner" role="status">
			{#if patternStore.catalogError}
				<strong>Couldn't load the catalog from Firestore.</strong>
				You're seeing the built-in catalog instead, and changes can't be saved until it loads. Refresh to try again.
			{:else if ap.seeding}
				<strong>Copying the catalog into Firestore…</strong>
			{:else}
				<strong>The catalog isn't in Firestore yet.</strong>
				What's below is the built-in catalog that ships with the app. Your first change copies it into Firestore (you'll be asked to confirm) — from then on everything here is saved to Firestore.
			{/if}
		</div>
	{/if}

	<div class="stats">
		<button class="stat" class:stat--hot={toReview > 0} onclick={() => setTab("review")}>
			<span class="stat__v">{toReview}</span>
			<span class="stat__l">awaiting review</span>
			<span class="stat__s">{pendingNew} new · {pendingChange} change{pendingChange === 1 ? "" : "s"}</span>
		</button>
		<button class="stat" onclick={() => setTab("catalog")}>
			<span class="stat__v">{totals.subjects}</span>
			<span class="stat__l">subjects</span>
			<span class="stat__s">in the catalog</span>
		</button>
		<button class="stat" onclick={() => setTab("catalog")}>
			<span class="stat__v">{totals.live}<span class="stat__of"> / {totals.patterns}</span></span>
			<span class="stat__l">patterns live</span>
			<span class="stat__s">{totals.patterns - totals.live} draft</span>
		</button>
		<button class="stat" onclick={() => setTab("requests")}>
			<span class="stat__v">{openRequests}</span>
			<span class="stat__l">open requests</span>
			<span class="stat__s">from customers</span>
		</button>
	</div>

	<div class="nav">
		<div class="tabs" role="tablist" aria-label="Sections">
			<button class="tab" class:tab--on={tab === "review"} role="tab" aria-selected={tab === "review"} onclick={() => setTab("review")}>
				Review {#if toReview}<span class="badge badge--hot">{toReview}</span>{/if}
			</button>
			<button class="tab" class:tab--on={tab === "catalog"} role="tab" aria-selected={tab === "catalog"} onclick={() => setTab("catalog")}>
				Catalog <span class="badge">{totals.subjects}</span>
			</button>
			<button class="tab" class:tab--on={tab === "media"} role="tab" aria-selected={tab === "media"} onclick={() => setTab("media")}>
				Images
			</button>
			<button class="tab" class:tab--on={tab === "requests"} role="tab" aria-selected={tab === "requests"} onclick={() => setTab("requests")}>
				Requests {#if openRequests}<span class="badge">{openRequests}</span>{/if}
			</button>
		</div>

		<div class="who">
			<label for="pf-user">Contributor</label>
			<select id="pf-user" class="in" bind:value={ap.filterUser}>
				<option value={null}>Everyone ({activeUsers.length})</option>
				{#each activeUsers as u (u)}
					<option value={u}>{ap.userLabel(u)}{ap.usersById[u]?.displayName && ap.usersById[u]?.email ? ` · ${ap.usersById[u].email}` : ""}</option>
				{/each}
			</select>
			{#if ap.filterUser}
				<a class="link" href="/admin/users?uid={ap.filterUser}">Open account</a>
				<button class="link" onclick={() => (ap.filterUser = null)}>Clear</button>
			{/if}
		</div>
	</div>

	<div class="body">
		{#if tab === "review"}
			<ReviewQueue onOpenCatalog={openCatalog} />
		{:else if tab === "catalog"}
			<CatalogManager {focus} onFocusUsed={() => (focus = null)} {prefill} onPrefillUsed={() => (prefill = null)} />
		{:else if tab === "media"}
			<MediaCoverage onOpen={(id) => openCatalog(id)} />
		{:else}
			<RequestsBoard onOpenSubject={(id) => openCatalog(id)} onCreateSubject={createSubject} />
		{/if}
	</div>
</div>

<style>
	.ap { padding: 24px; display: flex; flex-direction: column; gap: 16px; max-width: 1500px; margin-inline: auto; box-sizing: border-box; }
	.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.title { font-size: 1.375rem; margin: 0 0 3px; }
	.sub { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }

	.banner { padding: 12px 16px; font-size: 0.8125rem; line-height: 1.5; color: var(--text-secondary); background: color-mix(in srgb, var(--color-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); border-radius: var(--radius-md); }
	.banner strong { color: var(--text-primary); }

	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
	.stat { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; text-align: left; font: inherit; color: inherit; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); cursor: pointer; min-width: 0; }
	.stat:hover { border-color: var(--border-strong, var(--border-default)); }
	.stat--hot { border-color: color-mix(in srgb, var(--color-brand) 55%, transparent); background: color-mix(in srgb, var(--color-brand) 6%, var(--bg-surface)); }
	.stat__v { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; }
	.stat__of { font-size: 1rem; font-weight: 600; color: var(--text-tertiary); }
	.stat__l { font-size: 0.8125rem; font-weight: 600; }
	.stat__s { font-size: 0.75rem; color: var(--text-tertiary); }

	.nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border-subtle); }
	.tabs { display: flex; gap: 2px; }
	.tab { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; font: inherit; font-size: 0.9375rem; font-weight: 600; color: var(--text-tertiary); background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
	.tab:hover { color: var(--text-primary); }
	.tab--on { color: var(--text-primary); border-bottom-color: var(--color-brand); }
	.badge { font-family: var(--font-mono); font-size: 0.6875rem; padding: 1px 7px; border-radius: 99px; background: var(--bg-surface-3); color: var(--text-secondary); }
	.badge--hot { background: var(--color-brand); color: #0a0a0a; }

	.who { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; font-size: 0.8125rem; color: var(--text-secondary); flex-wrap: wrap; }
	.in { padding: 5px 8px; font: inherit; font-size: 0.75rem; color: var(--text-primary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); max-width: 260px; }
	.link { background: none; border: none; padding: 0; font: inherit; font-size: 0.8125rem; color: var(--text-brand, var(--color-brand)); cursor: pointer; text-decoration: none; }
	.link:hover { text-decoration: underline; }

	.body { min-width: 0; }

	@media (max-width: 800px) {
		.ap { padding: 16px; }
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.tab { padding: 10px 12px; font-size: 0.875rem; }
	}
</style>
