<script lang="ts">
	// Requests: what customers asked to have added, most-voted first, with the
	// catalog subjects that may already cover each one and a one-click way to
	// create the missing subject.
	import Badge from "$lib/components/ui/Badge.svelte";
	import { adminPatterns as ap } from "$lib/admin/adminPatterns.svelte";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { makeKey, modelKey } from "$lib/utils/vehicleCatalog";
	import { PROJECT_TYPES, projectTypeMeta, subjectName, type SubjectForm } from "$lib/admin/patternForms";
	import type { PatternRequest, ProjectType, RequestStatus } from "$lib/types";

	interface Props {
		onOpenSubject: (subjectId: string) => void;
		onCreateSubject: (prefill: Partial<SubjectForm>) => void;
	}
	let { onOpenSubject, onCreateSubject }: Props = $props();

	let view = $state<"open" | "done" | "all">("open");
	let typeFilter = $state<"all" | ProjectType>("all");

	// The store holds placeholder requests until the catalog has loaded — never show those.
	const loading = $derived(patternStore.loading);
	const all = $derived(loading ? [] : patternStore.requests.filter((r) => ap.matchesUser(r.requestedBy)));
	const typeOf = (r: PatternRequest): ProjectType => r.projectType ?? "vehicle";

	const shown = $derived(
		all
			.filter((r) => (view === "all" || (view === "open" ? r.status !== "done" : r.status === "done")) && (typeFilter === "all" || typeOf(r) === typeFilter))
			.sort((a, b) => b.votes - a.votes || b.requestedAt.localeCompare(a.requestedAt)),
	);
	const counts = $derived({
		open: all.filter((r) => r.status !== "done").length,
		done: all.filter((r) => r.status === "done").length,
	});

	/** Catalog subjects that may already cover a request. */
	function matches(r: PatternRequest) {
		if (typeOf(r) !== "vehicle") {
			const label = r.model.trim().toLowerCase();
			return patternStore.vehicles.filter((v) => (v.projectType ?? "vehicle") === typeOf(r) && (v.propertyLabel ?? "").trim().toLowerCase() === label);
		}
		return patternStore.vehicles.filter(
			(v) => (v.projectType ?? "vehicle") === "vehicle" && makeKey(v.make) === makeKey(r.make) &&
				modelKey(v.model) === modelKey(r.model) && (!r.year || v.year === r.year),
		);
	}

	function create(r: PatternRequest) {
		onCreateSubject(
			typeOf(r) === "vehicle"
				? { projectType: "vehicle", make: r.make, model: r.model, year: r.year || new Date().getFullYear() }
				: { projectType: typeOf(r), propertyLabel: r.model },
		);
	}

	const NEXT: Record<RequestStatus, { to: RequestStatus; label: string }> = {
		queued: { to: "in-progress", label: "Start" },
		"in-progress": { to: "done", label: "Mark done" },
		done: { to: "queued", label: "Reopen" },
	};
	const statusVariant = (s: RequestStatus) => (s === "in-progress" ? "brand" : s === "done" ? "success" : "default");
</script>

<div class="rb">
	<div class="rb__bar">
		<div class="tabs" role="tablist" aria-label="Request status">
			<button class="tab" class:tab--on={view === "open"} role="tab" aria-selected={view === "open"} onclick={() => (view = "open")}>Open <span class="n">{counts.open}</span></button>
			<button class="tab" class:tab--on={view === "done"} role="tab" aria-selected={view === "done"} onclick={() => (view = "done")}>Done <span class="n">{counts.done}</span></button>
			<button class="tab" class:tab--on={view === "all"} role="tab" aria-selected={view === "all"} onclick={() => (view = "all")}>All</button>
		</div>
		<div class="chips" role="group" aria-label="Type">
			<button class="chip" class:chip--on={typeFilter === "all"} aria-pressed={typeFilter === "all"} onclick={() => (typeFilter = "all")}>Any type</button>
			{#each PROJECT_TYPES as t (t.value)}
				<button class="chip" class:chip--on={typeFilter === t.value} aria-pressed={typeFilter === t.value} onclick={() => (typeFilter = t.value)}>{t.label}</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<p class="empty">Loading requests…</p>
	{:else if shown.length === 0}
		<p class="empty">{view === "open" ? "No open requests." : view === "done" ? "Nothing marked done yet." : "No requests yet."}</p>
	{:else}
		<ul class="reqs">
			{#each shown as r (r.id)}
				{@const found = matches(r)}
				<li class="req" class:req--done={r.status === "done"}>
					<div class="req__votes" title="{r.votes} votes"><b>{r.votes}</b><span>vote{r.votes === 1 ? "" : "s"}</span></div>
					<div class="req__main">
						<div class="req__title">
							<span class="req__icon" title={projectTypeMeta(r.projectType).label} aria-hidden="true">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={projectTypeMeta(r.projectType).icon}/></svg>
							</span>
							{r.vehicle}
							<Badge variant={statusVariant(r.status)} size="sm" dot={r.status === "in-progress"}>{r.status}</Badge>
						</div>
						{#if r.notes}<p class="req__notes">{r.notes}</p>{/if}
						<div class="req__meta">
							{#if r.requestedBy}<button class="link" onclick={() => (ap.filterUser = r.requestedBy!)}>{ap.userLabel(r.requestedBy)}</button>{:else}<span>Unknown requester</span>{/if}
							· {r.requestedAt || "—"}
						</div>
						<div class="req__cover">
							{#if found.length}
								<span class="cover__k">Already in the catalog</span>
								{#each found.slice(0, 4) as v (v.id)}
									<button class="pill" onclick={() => onOpenSubject(v.id)}>
										{subjectName(v)}
										<span class="pill__s pill__s--{v.status}">{v.status}</span>
									</button>
								{/each}
							{:else if r.status !== "done"}
								<span class="cover__k cover__k--warn">Not in the catalog yet</span>
							{/if}
						</div>
					</div>
					<div class="req__actions">
						<button class="btn btn--sm" disabled={!!ap.busy} onclick={() => ap.setRequestStatus(r.id, NEXT[r.status].to)}>{NEXT[r.status].label}</button>
						{#if r.status !== "done" && !found.length}
							<button class="btn btn--sm btn--primary" onclick={() => create(r)}>Create subject</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.rb { display: flex; flex-direction: column; gap: 12px; }
	.rb__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
	.tabs, .chips { display: flex; flex-wrap: wrap; gap: 4px; }
	.tab { padding: 5px 12px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-tertiary); background: none; border: none; border-radius: var(--radius-md); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
	.tab:hover { color: var(--text-primary); }
	.tab--on { background: var(--bg-surface-3); color: var(--text-primary); }
	.n { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.chip { padding: 3px 10px; font: inherit; font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.chip--on { color: var(--text-primary); border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand) 10%, transparent); }
	.empty { margin: 0; padding: 48px 16px; text-align: center; color: var(--text-tertiary); background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); }
	.reqs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.req { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 14px; align-items: start; padding: 14px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.req--done { opacity: 0.7; }
	.req__votes { display: flex; flex-direction: column; align-items: center; padding: 6px 0; background: var(--bg-base); border-radius: var(--radius-md); }
	.req__votes b { font-family: var(--font-display); font-size: 1.125rem; line-height: 1.1; }
	.req__votes span { font-size: 0.625rem; color: var(--text-tertiary); }
	.req__main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
	.req__title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 600; font-size: 0.9375rem; overflow-wrap: anywhere; }
	.req__icon { color: var(--text-tertiary); display: grid; place-items: center; }
	.req__notes { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
	.req__meta { font-size: 0.75rem; color: var(--text-tertiary); }
	.req__cover { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; }
	.cover__k { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
	.cover__k--warn { color: var(--color-warning); }
	.pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; font: inherit; font-size: 0.75rem; color: var(--text-primary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.pill:hover { border-color: var(--color-brand-dim); }
	.pill__s { font-size: 0.625rem; color: var(--text-tertiary); }
	.pill__s--published { color: var(--color-success); }
	.pill__s--review { color: var(--color-warning); }
	.req__actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
	.link { background: none; border: none; padding: 0; font: inherit; color: var(--text-brand, var(--color-brand)); cursor: pointer; }
	.link:hover { text-decoration: underline; }
	.btn { padding: 8px 16px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; white-space: nowrap; }
	.btn--sm { padding: 5px 11px; font-size: 0.75rem; }
	.btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-3); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn--primary { color: #fff; background: var(--color-brand-dim); border-color: transparent; }
	.btn--primary:hover:not(:disabled) { color: #fff; background: var(--color-brand); }
	@media (max-width: 640px) {
		.req { grid-template-columns: 48px minmax(0, 1fr); }
		.req__actions { grid-column: 1 / -1; flex-direction: row; }
	}
</style>
