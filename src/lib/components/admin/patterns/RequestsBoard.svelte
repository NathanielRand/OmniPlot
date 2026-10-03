<script lang="ts">
	import Spinner from "$lib/components/ui/Spinner.svelte";
	// Requests: one row per make/model (or project) customers asked for or voted
	// on, most-wanted first — requests and votes are the same thing and are counted
	// once per person. Shows whether the catalog has it yet (a Coming soon
	// placeholder, or live patterns) and a one-click way to create the placeholders.
	import Badge from "$lib/components/ui/Badge.svelte";
	import { adminPatterns as ap } from "$lib/admin/adminPatterns.svelte";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { makeKey, generationsFor, groupYearLabels, generationOf } from "$lib/utils/vehicleCatalog";
	import { demandModelKey } from "$lib/utils/demand";
	import { previewDemandMerge, runDemandMerge, subscribeDemandPrivate, type DemandMergePreview } from "$lib/firebase/firestore";
	import { confirmStore, toastStore } from "$lib/stores";
	import type { VehiclePlanInput } from "$lib/admin/vehiclePlan";
	import { PROJECT_TYPES, projectTypeMeta, subjectName, type SubjectForm } from "$lib/admin/patternForms";
	import type { DemandRecord, ProjectType, RequestStatus } from "$lib/types";

	interface Props {
		onOpenSubject: (subjectId: string) => void;
		onCreateSubject: (prefill: Partial<SubjectForm>) => void;
		/** Vehicles: open the bulk "add vehicles" dialog for this make/model/years. */
		onCreateVehicles: (prefill: Partial<VehiclePlanInput>) => void;
	}
	let { onOpenSubject, onCreateSubject, onCreateVehicles }: Props = $props();

	let view = $state<"open" | "done" | "all">("open");
	let typeFilter = $state<"all" | ProjectType>("all");

	// The store holds placeholder requests until the catalog has loaded — never show those.
	const loading = $derived(patternStore.loading);
	// Who asked and what they wrote is admin-only (demandPrivate), not on the public record.
	let meta = $state<Record<string, { notes: string; requestedBy?: string }>>({});
	$effect(() => subscribeDemandPrivate((m) => { meta = m; }, () => {}));
	const all = $derived(loading ? [] : patternStore.requests.filter((r) => ap.matchesUser(meta[r.id]?.requestedBy)));
	const typeOf = (r: DemandRecord): ProjectType => r.projectType ?? "vehicle";

	const shown = $derived(
		all
			.filter((r) => (view === "all" || (view === "open" ? r.status !== "done" : r.status === "done")) && (typeFilter === "all" || typeOf(r) === typeFilter))
			.sort((a, b) => b.votes - a.votes || b.requestedAt.localeCompare(a.requestedAt)),
	);
	const counts = $derived({
		open: all.filter((r) => r.status !== "done").length,
		done: all.filter((r) => r.status === "done").length,
	});

	/** Catalog subjects under a request (every year/trim of that model). */
	function matches(r: DemandRecord) {
		if (typeOf(r) !== "vehicle") {
			const label = r.model.trim().toLowerCase();
			return patternStore.vehicles.filter((v) => (v.projectType ?? "vehicle") === typeOf(r) && (v.propertyLabel ?? "").trim().toLowerCase() === label);
		}
		return patternStore.vehicles.filter(
			(v) => (v.projectType ?? "vehicle") === "vehicle" && makeKey(v.make) === makeKey(r.make) && demandModelKey(v.make, v.model) === demandModelKey(r.make, r.model),
		);
	}
	/** Where a request stands in the catalog. */
	function coverage(found: ReturnType<typeof matches>) {
		const live = found.filter((v) => patternStore.getPatterns(v.id, undefined, true).length > 0).length;
		const soon = found.filter((v) => v.status === "published").length - live;
		return { live, soon, total: found.length };
	}
	const years = (r: DemandRecord) => Object.keys(r.yearVotes).map(Number).filter(Boolean).sort((a, b) => a - b);

	/** Year chips, with a model's generations folded into one chip (its most-wanted year's count). */
	function yearChips(r: DemandRecord) {
		const ys = years(r);
		const gens = typeOf(r) === "vehicle" ? generationsFor(patternStore.media, r.make, r.model) : [];
		const count = (y: number) => r.yearVotes[String(y)] + r.anyVotes;
		return groupYearLabels(ys, gens).map((g) => {
			const inGroup = g.isGen ? ys.filter((y) => generationOf(y, gens)?.label === g.label) : [Number(g.label)];
			return { label: g.label, n: Math.max(...inGroup.map(count)) };
		});
	}

	function create(r: DemandRecord) {
		if (typeOf(r) === "vehicle") {
			const ys = years(r), now = new Date().getFullYear();
			onCreateVehicles({ make: r.make, models: r.model, yearFrom: ys[0] ?? now, yearTo: ys.at(-1) ?? now });
		} else onCreateSubject({ projectType: typeOf(r), propertyLabel: r.model });
	}

	// ─── Old requests → one record per make/model ───
	let legacy = $state<DemandMergePreview | null>(null);
	let merging = $state(false);
	$effect(() => {
		previewDemandMerge().then((p) => { legacy = p; }).catch(() => { legacy = null; });
	});
	async function mergeLegacy() {
		if (!legacy) return;
		const requests = legacy.groups.reduce((n, g) => n + g.requests, 0);
		const ok = await confirmStore.ask({
			title: "Merge duplicate requests?",
			message: "Older requests were free text, so the same car appears several times. They're folded into one record per make/model with the votes added up. Nothing is deleted — the old requests are kept and marked as merged.",
			details: [
				{ label: "Old requests", value: String(requests) },
				{ label: "Become", value: `${legacy.groups.length} record${legacy.groups.length === 1 ? "" : "s"}` },
				...(legacy.unmergeable ? [{ label: "Left as they are (no make/model)", value: String(legacy.unmergeable) }] : []),
			],
			confirmLabel: "Merge",
		});
		if (!ok) return;
		merging = true;
		try {
			const r = await runDemandMerge();
			toastStore.success("Requests merged", `${r.merged} old request${r.merged === 1 ? "" : "s"} folded into ${r.groups} record${r.groups === 1 ? "" : "s"}.`);
			legacy = await previewDemandMerge();
		} catch (e) { toastStore.error("Merge failed", e instanceof Error ? e.message : "Please try again."); }
		finally { merging = false; }
	}

	const NEXT: Record<RequestStatus, { to: RequestStatus; label: string }> = {
		queued: { to: "in-progress", label: "Start" },
		"in-progress": { to: "done", label: "Mark done" },
		done: { to: "queued", label: "Reopen" },
	};
	const statusVariant = (s: RequestStatus) => (s === "in-progress" ? "brand" : s === "done" ? "success" : "default");
</script>

<div class="rb">
	{#if legacy && legacy.groups.length}
		<div class="merge">
			<span><b>{legacy.groups.reduce((n, g) => n + g.requests, 0)}</b> older requests aren't merged yet — they'd become <b>{legacy.groups.length}</b> {legacy.groups.length === 1 ? "record" : "records"}, so votes for the same car add up.</span>
			<button class="btn btn--sm btn--primary" disabled={merging} onclick={mergeLegacy}>{#if merging}<Spinner />{/if}{merging ? "Merging…" : "Merge duplicates"}</button>
		</div>
	{/if}
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
					<div class="req__votes" title="{r.votes} {r.votes === 1 ? "person" : "people"}{r.legacyVotes ? ` (${r.legacyVotes} from before votes were tracked per person)` : ""}"><b>{r.votes}</b><span>want{r.votes === 1 ? "s" : ""}</span></div>
					<div class="req__main">
						<div class="req__title">
							<span class="req__icon" title={projectTypeMeta(r.projectType).label} aria-hidden="true">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={projectTypeMeta(r.projectType).icon}/></svg>
							</span>
							{r.vehicle}
							<Badge variant={statusVariant(r.status)} size="sm" dot={r.status === "in-progress"}>{r.status}</Badge>
						</div>
						{#if years(r).length}<div class="req__years">{#each yearChips(r) as c (c.label)}<span class="yr">{c.label} <b>{c.n}</b></span>{/each}{#if r.anyVotes}<span class="yr yr--any">any year <b>{r.anyVotes}</b></span>{/if}</div>{/if}
						{#if meta[r.id]?.notes}<p class="req__notes">{meta[r.id].notes}</p>{/if}
						<div class="req__meta">
							{#if meta[r.id]?.requestedBy}<button class="link" onclick={() => (ap.filterUser = meta[r.id].requestedBy!)}>{ap.userLabel(meta[r.id].requestedBy!)}</button>{:else}<span>Unknown requester</span>{/if}
							· {r.requestedAt || "—"}
						</div>
						<div class="req__cover">
							{#if found.length}
								{@const c = coverage(found)}
								<span class="cover__k">{c.live ? `${c.live} with patterns` : "Coming soon placeholder"}{#if c.live && c.soon} · {c.soon} coming soon{/if}</span>
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
								<button class="btn btn--sm btn--primary" onclick={() => create(r)}>{typeOf(r) === "vehicle" ? "Add placeholders" : "Create subject"}</button>
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
	.merge { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; font-size: 0.8125rem; color: var(--text-secondary); background: color-mix(in srgb, var(--color-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); border-radius: var(--radius-md); }
	.req__years { display: flex; flex-wrap: wrap; gap: 4px; }
	.yr { padding: 1px 8px; font-size: 0.6875rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; }
	.yr b { font-family: var(--font-mono); color: var(--text-primary); }
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
