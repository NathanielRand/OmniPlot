<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import AdminPatternInspector, { INPUT_LABELS, STATUS_VARIANT, subjectLabel, type AdminPatternRow } from "./AdminPatternInspector.svelte";
	import { auth } from "$lib/firebase/client";
	import { categoryShortLabel } from "$lib/stores/patternStore.svelte";
	import { formatRelativeTime } from "$lib/utils";

	// One user's pattern library inside Admin → Users. Private patterns are
	// only fetched when an admin opens this (each open is audit-logged).
	interface Props { uid: string; count: number }
	let { uid, count }: Props = $props();

	type Filter = "all" | "private" | "community" | "flagged" | "never-cut";

	let patterns = $state<AdminPatternRow[] | null>(null);
	let loading  = $state(false);
	let error    = $state<string | null>(null);
	let filter   = $state<Filter>("all");
	let search   = $state("");
	let openId   = $state<string | null>(null);
	let total    = $state(0);

	// A different user in the drawer starts closed again.
	$effect(() => {
		void uid;
		patterns = null; error = null; openId = null; filter = "all"; search = "";
		total = count;
	});

	async function load() {
		loading = true;
		error = null;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch(`/api/admin/user-patterns?uid=${encodeURIComponent(uid)}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Could not load library");
			patterns = data.patterns;
			total = data.patterns.length;
		} catch (e) {
			error = e instanceof Error ? e.message : "Could not load library";
		} finally {
			loading = false;
		}
	}

	const counts = $derived.by(() => {
		const list = patterns ?? [];
		return {
			all:         list.length,
			private:     list.filter((p) => p.status === "private").length,
			community:   list.filter((p) => p.status !== "private").length,
			flagged:     list.filter((p) => p.moderation?.flagged).length,
			"never-cut": list.filter((p) => !p.usage.cuts).length,
		} satisfies Record<Filter, number>;
	});

	const shown = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return (patterns ?? []).filter((p) => {
			if (filter === "private" && p.status !== "private") return false;
			if (filter === "community" && p.status === "private") return false;
			if (filter === "flagged" && !p.moderation?.flagged) return false;
			if (filter === "never-cut" && p.usage.cuts) return false;
			if (!q) return true;
			return [p.name, subjectLabel(p), p.source?.fileName ?? "", p.id, ...p.customZoneLabels]
				.some((s) => s.toLowerCase().includes(q));
		});
	});

	const FILTERS: { id: Filter; label: string }[] = [
		{ id: "all", label: "All" }, { id: "private", label: "Private" }, { id: "community", label: "Community" },
		{ id: "flagged", label: "Flagged" }, { id: "never-cut", label: "Never cut" },
	];
</script>

<div class="aul">
	<div class="aul__head">
		<span class="aul__count">{total} pattern{total === 1 ? "" : "s"}</span>
		{#if patterns === null}
			<button class="aul__btn" onclick={load} disabled={loading || total === 0}>{loading ? "Loading…" : "View library"}</button>
		{:else}
			<button class="aul__btn" onclick={load} disabled={loading}>{loading ? "…" : "Refresh"}</button>
		{/if}
	</div>

	{#if patterns === null && total > 0}
		<p class="aul__hint">Includes private patterns. Opening the library is recorded in the admin audit log.</p>
	{/if}
	{#if error}<p class="aul__error">{error}</p>{/if}

	{#if patterns}
		<div class="aul__filters">
			{#each FILTERS as f (f.id)}
				<button class="aul__chip" class:aul__chip--on={filter === f.id} onclick={() => (filter = f.id)}>
					{f.label} <span class="aul__chip-n">{counts[f.id]}</span>
				</button>
			{/each}
		</div>
		<input class="aul__search" bind:value={search} placeholder="Search name, subject, file, custom zone…" aria-label="Search this library"/>

		{#if shown.length === 0}
			<p class="aul__hint">No patterns match.</p>
		{:else}
			<ul class="aul__list">
				{#each shown as p (p.id)}
					<li class="aul__item" class:aul__item--open={openId === p.id}>
						<button class="aul__row" onclick={() => (openId = openId === p.id ? null : p.id)} aria-expanded={openId === p.id}>
							<span class="aul__thumb"><PatternPreview svgPath={p.svgPath ?? ""} size="thumb"/></span>
							<span class="aul__main">
								<span class="aul__name">{p.name || "Untitled"}</span>
								<span class="aul__sub">{subjectLabel(p)} · {categoryShortLabel(p.category)}{p.source ? ` · ${INPUT_LABELS[p.source.input] ?? p.source.input}` : ""}</span>
							</span>
							<span class="aul__meta">
								<span class="aul__badges">
									{#if p.moderation?.flagged}<Badge variant="danger" size="sm" dot>flagged</Badge>{/if}
									<Badge variant={STATUS_VARIANT[p.status] ?? "default"} size="sm">{p.status}</Badge>
								</span>
								<span class="aul__stat">{p.usage.cuts ? `${p.usage.cuts} cut${p.usage.cuts === 1 ? "" : "s"}` : "never cut"} · {p.createdAt ? formatRelativeTime(new Date(p.createdAt)) : "—"}</span>
							</span>
						</button>
						{#if openId === p.id}
							<div class="aul__detail">
								<AdminPatternInspector
									pattern={p}
									onchange={(next) => { patterns = patterns!.map((x) => (x.id === next.id ? next : x)); }}
									ondelete={(id) => { patterns = patterns!.filter((x) => x.id !== id); total = patterns.length; openId = null; }}
								/>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.aul { display: flex; flex-direction: column; gap: 10px; font-size: 0.8125rem; }
	.aul__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.aul__count { font-family: var(--font-mono); color: var(--text-primary); }
	.aul__hint { margin: 0; font-size: 0.75rem; color: var(--text-tertiary); }
	.aul__error { margin: 0; font-size: 0.75rem; color: var(--text-danger); }
	.aul__btn {
		padding: 5px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-default);
		background: transparent; color: var(--text-secondary); font-size: 0.8125rem; font-weight: 500;
		font-family: var(--font-body); cursor: pointer;
	}
	.aul__btn:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }
	.aul__btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.aul__filters { display: flex; flex-wrap: wrap; gap: 4px; }
	.aul__chip {
		padding: 3px 9px; border-radius: 99px; border: 1px solid var(--border-subtle); background: transparent;
		font-size: 0.75rem; font-family: var(--font-body); color: var(--text-secondary); cursor: pointer;
	}
	.aul__chip--on { background: var(--bg-surface-3); border-color: var(--border-default); color: var(--text-primary); }
	.aul__chip-n { font-family: var(--font-mono); color: var(--text-tertiary); margin-left: 2px; }
	.aul__search {
		padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body);
	}

	.aul__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
	.aul__item + .aul__item { border-top: 1px solid var(--border-subtle); }
	.aul__row {
		width: 100%; display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 10px;
		padding: 8px 10px; background: transparent; border: none; text-align: left; cursor: pointer;
		font-family: var(--font-body); color: inherit;
	}
	.aul__row:hover, .aul__item--open .aul__row { background: var(--interactive-hover); }
	.aul__thumb { width: 40px; height: 40px; border-radius: var(--radius-sm); overflow: hidden; background: var(--bg-surface-2); display: block; }
	.aul__main { display: flex; flex-direction: column; min-width: 0; }
	.aul__name { font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.aul__sub  { font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.aul__meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
	.aul__badges { display: flex; gap: 4px; }
	.aul__stat { font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); white-space: nowrap; }
	.aul__detail { padding: 12px; background: var(--bg-surface-2); border-top: 1px solid var(--border-subtle); }

	@media (max-width: 480px) {
		.aul__row { grid-template-columns: 40px 1fr; }
		.aul__meta { grid-column: 2; align-items: flex-start; }
	}
</style>
