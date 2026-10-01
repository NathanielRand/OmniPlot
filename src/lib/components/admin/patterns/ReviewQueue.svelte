<script lang="ts">
	// Review: one queue for everything that needs a decision — new community
	// submissions and change requests on patterns already published — with the
	// whole review (edit, see exactly what will be published, decide) in the
	// panel beside it.
	import Badge from "$lib/components/ui/Badge.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import { adminPatterns as ap } from "$lib/admin/adminPatterns.svelte";
	import { patternStore, categoryShortLabel, categoryLabel } from "$lib/stores/patternStore.svelte";
	import { deriveHeight, deriveWidth, sizeError } from "$lib/utils/patternSize";
	import { linkedPatterns } from "$lib/utils/publishPlan";
	import { formatMeasure } from "$lib/utils";
	import { subjectName, projectTypeMeta } from "$lib/admin/patternForms";
	import type { PatternAdjustmentRequest, PatternCoverage, UserPattern } from "$lib/types";

	interface Props {
		/** Jump to a subject (and optionally one of its patterns) in the Catalog. */
		onOpenCatalog: (subjectId: string, patternId?: string) => void;
	}
	let { onOpenCatalog }: Props = $props();

	// ─── The queue ───────────────────────────────
	type Item =
		| { key: string; kind: "new"; at: number; todo: boolean; sub: UserPattern }
		| { key: string; kind: "change"; at: number; todo: boolean; adj: PatternAdjustmentRequest };

	let view = $state<"todo" | "done">("todo");
	let kind = $state<"all" | "new" | "change">("all");
	let selectedKey = $state<string | null>(null);

	const items = $derived<Item[]>([
		...ap.submissions.filter((s) => ap.matchesUser(s.ownerId)).map((sub): Item => ({ key: `s:${sub.id}`, kind: "new", at: sub.createdAt.getTime(), todo: sub.status === "pending", sub })),
		...ap.adjustments.filter((a) => ap.matchesUser(a.requestedBy)).map((adj): Item => ({ key: `a:${adj.id}`, kind: "change", at: adj.createdAt.getTime(), todo: adj.status === "pending", adj })),
	].sort((a, b) => b.at - a.at));

	const todoCount = $derived(items.filter((i) => i.todo).length);
	const shown = $derived(items.filter((i) => (view === "todo" ? i.todo : !i.todo) && (kind === "all" || i.kind === kind)));
	const counts = $derived({
		new: items.filter((i) => i.kind === "new" && (view === "todo" ? i.todo : !i.todo)).length,
		change: items.filter((i) => i.kind === "change" && (view === "todo" ? i.todo : !i.todo)).length,
	});

	// Keep a valid selection: the first item whenever the current one leaves the list.
	$effect(() => {
		if (!shown.some((i) => i.key === selectedKey)) selectedKey = shown[0]?.key ?? null;
	});

	const selected = $derived(items.find((i) => i.key === selectedKey) ?? null);
	const loading = $derived(ap.queueLoading || ap.adjustmentsLoading);

	// ─── Labels ──────────────────────────────────
	const fmtDate = (d: Date) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

	function subjectLabel(sub: UserPattern): string {
		if ((sub.projectType ?? "vehicle") !== "vehicle") return sub.propertyLabel || sub.patternName || sub.name;
		return [sub.years.join("/"), sub.make, sub.models.join(", "), sub.trims?.join(" / ")].filter(Boolean).join(" ");
	}
	const zonesLabel = (sub: UserPattern) =>
		sub.zones.map((z, i) => ap.zoneLabel(sub.category, z, sub.customZoneLabels?.[i], sub.projectType)).join(", ");
	const statusVariant = (s: string) => (s === "approved" ? "success" : s === "rejected" ? "danger" : "warning");
	const submissionById = $derived(Object.fromEntries(ap.submissions.map((s) => [s.id, s])));

	// ─── The submission being reviewed ───────────
	const sub = $derived(selected?.kind === "new" ? selected.sub : null);
	const adj = $derived(selected?.kind === "change" ? selected.adj : null);

	const toList = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))];
	let form = $state({
		name: "", widthInches: 0, heightInches: 0, coverage: "full" as PatternCoverage, notes: "", adminNotes: "",
		make: "", models: "", years: "", trims: "", publishHidden: true, rejectReason: "",
	});
	let reply = $state("");

	let loadedFor = "";
	$effect(() => {
		const key = selectedKey ?? "";
		if (key === loadedFor) return;
		loadedFor = key;
		reply = "";
		const s = sub;
		if (s) {
			form = {
				name: s.name, widthInches: s.widthInches, heightInches: s.heightInches, coverage: s.coverage,
				notes: s.notes ?? "", adminNotes: s.adminNotes ?? "",
				make: s.make, models: s.models.join(", "), years: s.years.join(", "), trims: (s.trims ?? []).join(", "),
				publishHidden: true, rejectReason: "",
			};
		}
	});

	const edits = $derived({
		name: form.name, widthInches: Number(form.widthInches), heightInches: Number(form.heightInches), coverage: form.coverage,
		notes: form.notes, make: form.make, models: toList(form.models), years: toList(form.years), trims: toList(form.trims),
	});
	const plan = $derived(sub && sub.status === "pending" ? ap.planFor(sub, edits) : null);
	const sizeProblem = $derived(sub ? sizeError({ widthInches: Number(form.widthInches), heightInches: Number(form.heightInches) }, sub.svgPath) : null);
	const hiddenTargets = $derived(plan?.targets.filter((t) => t.hidden) ?? []);
	const newTargets = $derived(plan?.targets.filter((t) => t.isNew) ?? []);

	// PRECISION: entering one dimension derives the other from the outline.
	// Read the value from the event so it doesn't depend on binding order.
	function onWidth(e: Event) {
		form.widthInches = Number((e.currentTarget as HTMLInputElement).value);
		if (sub) deriveHeight(form, sub.svgPath);
	}
	function onHeight(e: Event) {
		form.heightInches = Number((e.currentTarget as HTMLInputElement).value);
		if (sub) deriveWidth(form, sub.svgPath);
	}

	// An approval made before every model/year/trim was published: offer the rest.
	const repairEdits = $derived(
		sub ? { name: sub.name, widthInches: sub.widthInches, heightInches: sub.heightInches, coverage: sub.coverage, notes: sub.notes ?? "", make: sub.make, models: sub.models, years: sub.years, trims: sub.trims ?? [] } : null,
	);
	const repair = $derived(sub && repairEdits && (sub.status === "approved" || sub.isPublished) ? ap.planFor(sub, repairEdits) : null);
	const missing = $derived(repair && !repair.error ? repair.patterns.length : 0);

	// What an approved submission turned into.
	const published = $derived(sub && (sub.status === "approved" || sub.isPublished) ? linkedPatterns(sub, ap.allCatalogPatterns()) : []);
	const subjectOf = (id: string) => patternStore.vehicles.find((v) => v.id === id);

	// A change request's target: the submission and where it is published.
	const adjSub = $derived(adj ? submissionById[adj.patternId] ?? null : null);
	const adjCopies = $derived(adjSub ? linkedPatterns(adjSub, ap.allCatalogPatterns()) : []);
	const changesFor = (id: string) => ap.adjustments.filter((a) => a.patternId === id);

	const busy = $derived(!!ap.busy);
	// Older approvals that only published part of what was submitted.
	const partial = $derived(ap.submissions.length ? ap.repairCount() : 0);
</script>

{#if partial > 0}
	<div class="repair" role="status">
		<div>
			<strong>{partial} older approval{partial === 1 ? " is" : "s are"} only partly published.</strong>
			Customers see just the first year, model or trim of what was submitted.
		</div>
		<button class="btn btn--primary" disabled={busy} onclick={ap.repairAll}>Publish the missing ones</button>
	</div>
{/if}

<div class="rq">
	<!-- ─── Queue ─── -->
	<aside class="rq__list" aria-label="Review queue">
		<div class="rq__tabs" role="tablist">
			<button class="seg" class:seg--on={view === "todo"} role="tab" aria-selected={view === "todo"} onclick={() => (view = "todo")}>
				Needs review {#if todoCount}<span class="seg__n seg__n--hot">{todoCount}</span>{/if}
			</button>
			<button class="seg" class:seg--on={view === "done"} role="tab" aria-selected={view === "done"} onclick={() => (view = "done")}>History</button>
			<button class="rq__refresh" onclick={ap.loadAll} aria-label="Refresh" title="Refresh">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
			</button>
		</div>
		<div class="rq__kinds" role="group" aria-label="Type">
			<button class="chip" class:chip--on={kind === "all"} aria-pressed={kind === "all"} onclick={() => (kind = "all")}>All</button>
			<button class="chip" class:chip--on={kind === "new"} aria-pressed={kind === "new"} onclick={() => (kind = "new")}>New patterns <span class="chip__n">{counts.new}</span></button>
			<button class="chip" class:chip--on={kind === "change"} aria-pressed={kind === "change"} onclick={() => (kind = "change")}>Change requests <span class="chip__n">{counts.change}</span></button>
		</div>

		<ul class="rq__items">
			{#if loading && !items.length}
				<li class="empty">Loading…</li>
			{:else if ap.queueError && !items.length}
				<li class="empty">Couldn't load the queue. <button class="link" onclick={ap.loadAll}>Try again</button></li>
			{:else if shown.length === 0}
				<li class="empty">
					{#if view === "todo"}Nothing waiting. {ap.filterUser ? "This user has nothing to review." : "You're all caught up."}
					{:else}No decided items yet.{/if}
				</li>
			{/if}
			{#each shown as it (it.key)}
				<li>
					<button class="item" class:item--on={selectedKey === it.key} onclick={() => (selectedKey = it.key)}>
						{#if it.kind === "new"}
							<span class="item__thumb"><PatternPreview svgPath={it.sub.svgPath} widthInches={it.sub.widthInches} heightInches={it.sub.heightInches} size="thumb" /></span>
							<span class="item__body">
								<span class="item__title">{it.sub.name}</span>
								<span class="item__meta">{subjectLabel(it.sub)}</span>
								<span class="item__meta">{ap.userLabel(it.sub.ownerId)} · {fmtDate(it.sub.createdAt)}</span>
							</span>
							<Badge variant={statusVariant(it.sub.status)} size="sm" dot={it.todo}>{it.sub.status}</Badge>
						{:else}
							<span class="item__thumb item__thumb--change" aria-hidden="true">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
							</span>
							<span class="item__body">
								<span class="item__title">Change request</span>
								<span class="item__meta">{submissionById[it.adj.patternId]?.name ?? "Unknown pattern"}</span>
								<span class="item__meta">{ap.userLabel(it.adj.requestedBy)} · {fmtDate(it.adj.createdAt)}</span>
							</span>
							<Badge variant={statusVariant(it.adj.status)} size="sm" dot={it.todo}>{it.adj.status === "approved" ? "done" : it.adj.status === "rejected" ? "declined" : "pending"}</Badge>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</aside>

	<!-- ─── Review panel ─── -->
	<section class="rq__panel" aria-live="polite">
		{#if !selected}
			<div class="blank">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
				<p>{view === "todo" ? "Nothing to review right now." : "Select an item to see how it was decided."}</p>
			</div>

		{:else if sub}
			<!-- ── New submission ── -->
			<header class="ph">
				<div>
					<h2 class="ph__title">{sub.name}</h2>
					<p class="ph__sub">{subjectLabel(sub)}</p>
				</div>
				<Badge variant={statusVariant(sub.status)} dot={sub.status === "pending"}>{sub.status}</Badge>
			</header>

			<div class="who">
				<span>Submitted by</span>
				<button class="link" onclick={() => (ap.filterUser = sub.ownerId)} title="Show only this user's activity">{ap.userLabel(sub.ownerId)}</button>
				{#if ap.usersById[sub.ownerId]?.email}<span class="muted">{ap.usersById[sub.ownerId].email}</span>{/if}
				<span class="muted">· {fmtDate(sub.createdAt)}</span>
				<a class="link" href="/admin/users?uid={sub.ownerId}">Open account</a>
			</div>

			<div class="split">
				<div class="preview">
					<PatternPreview svgPath={sub.svgPath} widthInches={Number(form.widthInches) || sub.widthInches} heightInches={Number(form.heightInches) || sub.heightInches} label="Outline of {sub.name}" />
				</div>
				<dl class="facts">
					<div><dt>Library</dt><dd>{projectTypeMeta(sub.projectType).label}</dd></div>
					<div><dt>Category</dt><dd>{categoryLabel(sub.category)}</dd></div>
					<div><dt>Zones</dt><dd>{zonesLabel(sub) || "—"}</dd></div>
					<div><dt>Size</dt><dd>{formatMeasure(sub.widthInches)}" × {formatMeasure(sub.heightInches)}"</dd></div>
					{#if sub.source}<div><dt>Made with</dt><dd>{sub.source}</dd></div>{/if}
					{#if sub.tierAtUpload}<div><dt>Plan at upload</dt><dd>{sub.tierAtUpload}</dd></div>{/if}
				</dl>
			</div>

			{#if sub.status === "pending"}
				<section class="card">
					<h3 class="card__title">Review before publishing</h3>
					<p class="card__hint">Fix typos or wrong sizes here. This is what gets published; the submitter's own copy isn't changed.</p>
					<div class="grid2">
						<label class="fld fld--wide"><span>Pattern name</span><input class="in" bind:value={form.name} /></label>
						<label class="fld"><span>Width (in)</span><input class="in" type="number" step="any" min="0" value={form.widthInches} oninput={onWidth} /></label>
						<label class="fld"><span>Height (in)</span><input class="in" type="number" step="any" min="0" value={form.heightInches} oninput={onHeight} /></label>
						<label class="fld"><span>Coverage</span>
							<select class="in" bind:value={form.coverage}><option value="full">Full</option><option value="partial">Partial</option><option value="edge-only">Edge only</option></select>
						</label>
						{#if (sub.projectType ?? "vehicle") === "vehicle"}
							<label class="fld"><span>Make</span><input class="in" bind:value={form.make} /></label>
							<label class="fld fld--wide"><span>Models <em>comma-separated</em></span><input class="in" bind:value={form.models} /></label>
							<label class="fld"><span>Years <em>e.g. 2020-2024</em></span><input class="in" bind:value={form.years} /></label>
							<label class="fld"><span>Trims <em>optional</em></span><input class="in" bind:value={form.trims} /></label>
						{/if}
						<label class="fld fld--wide"><span>Notes shown to customers</span><textarea class="in" rows="2" bind:value={form.notes}></textarea></label>
					</div>
					{#if sizeProblem}<p class="warn">{sizeProblem}</p>{/if}
				</section>

				<section class="card" class:card--bad={plan?.error}>
					<h3 class="card__title">What will be published</h3>
					{#if plan?.error}
						<p class="warn">{plan.error}</p>
					{:else if plan}
						<p class="plan__line">
							<strong>{plan.patterns.length}</strong> pattern{plan.patterns.length === 1 ? "" : "s"} on
							<strong>{plan.targets.length}</strong> subject{plan.targets.length === 1 ? "" : "s"}
							<span class="muted">({newTargets.length} new, {plan.targets.length - newTargets.length} existing)</span>
						</p>
						<ul class="targets">
							{#each plan.targets.slice(0, 6) as t (t.subject.id)}
								<li>
									<span>{subjectName(t.subject)}</span>
									<span class="tags">
										<Badge variant={t.isNew ? "brand" : "default"} size="sm">{t.isNew ? "new" : "existing"}</Badge>
										{#if t.hidden}<Badge variant="warning" size="sm">{t.subject.status}</Badge>{/if}
									</span>
								</li>
							{/each}
							{#if plan.targets.length > 6}<li class="muted">+ {plan.targets.length - 6} more</li>{/if}
						</ul>
						{#if plan.pairedZones.length}<p class="note">A left/right pair is published once; customers get both sides with “Add both sides”.</p>{/if}
						{#if plan.alreadyPublished}<p class="note">{plan.alreadyPublished} already published from this submission — skipped.</p>{/if}
						{#each plan.warnings as w}<p class="note note--warn">{w}</p>{/each}
						{#if hiddenTargets.length}
							<label class="check">
								<input type="checkbox" bind:checked={form.publishHidden} />
								<span>{hiddenTargets.length} existing subject{hiddenTargets.length === 1 ? " is" : "s are"} not published, so customers wouldn't see this pattern. Publish {hiddenTargets.length === 1 ? "it" : "them"} too.</span>
							</label>
						{/if}
					{/if}
				</section>

				<div class="actions">
					<button class="btn btn--primary" disabled={busy || !!plan?.error || !!sizeProblem} onclick={() => ap.approve(sub, edits, form.publishHidden)}>
						{busy ? "Working…" : "Approve & publish"}
					</button>
					<button class="btn" disabled={busy} onclick={() => ap.saveSubmissionEdit(sub, { ...form, widthInches: Number(form.widthInches), heightInches: Number(form.heightInches) })}>Save notes only</button>
				</div>

				<section class="card card--quiet">
					<h3 class="card__title">Not approving?</h3>
					<label class="fld"><span>Reason shown to the submitter <em>optional</em></span>
						<textarea class="in" rows="2" bind:value={form.rejectReason} placeholder="e.g. Outline looks traced from a photo — please re-measure."></textarea>
					</label>
					<div class="actions"><button class="btn btn--danger" disabled={busy} onclick={() => ap.reject(sub, form.rejectReason)}>Don't approve</button></div>
				</section>

			{:else if sub.status === "approved" || sub.isPublished}
				<section class="card">
					<h3 class="card__title">Published</h3>
					{#if published.length}
						<ul class="targets">
							{#each published.slice(0, 8) as p (p.id)}
								{@const v = subjectOf(p.vehicleId)}
								<li>
									<span>{v ? subjectName(v) : "Deleted subject"} · {ap.zoneLabel(p.category, p.zone, p.customZoneLabel, p.projectType)}</span>
									<span class="tags">
										<Badge variant={p.isPublished ? "success" : "default"} size="sm">{p.isPublished ? "live" : "unpublished"}</Badge>
										{#if v}<button class="link" onclick={() => onOpenCatalog(v.id, p.id)}>Open</button>{/if}
									</span>
								</li>
							{/each}
							{#if published.length > 8}<li class="muted">+ {published.length - 8} more</li>{/if}
						</ul>
					{:else}
						<p class="note note--warn">Marked approved, but no published copy was found in the catalog. Revoke to return it to the submitter, or reopen the review.</p>
					{/if}
					{#if changesFor(sub.id).length}
						<p class="note">{changesFor(sub.id).length} change request{changesFor(sub.id).length === 1 ? "" : "s"} on this pattern — see the queue.</p>
					{/if}
				</section>
				{#if missing > 0 && repairEdits}
					<section class="card card--bad">
						<h3 class="card__title">Not everything was published</h3>
						<p class="card__hint">
							This submission covers more models, years or trims than are live — {missing} more pattern{missing === 1 ? "" : "s"} on {repair?.targets.length} subject{repair?.targets.length === 1 ? "" : "s"} would be added. Customers browsing by year or trim won't find them until then.
						</p>
						<div class="actions"><button class="btn btn--primary" disabled={busy} onclick={() => ap.approve(sub, repairEdits, true, true)}>Publish the rest</button></div>
					</section>
				{/if}
				<div class="actions">
					<button class="btn btn--danger" disabled={busy} onclick={() => ap.revoke(sub)}>Remove from public library</button>
				</div>

			{:else if sub.status === "rejected"}
				<section class="card">
					<h3 class="card__title">Not approved</h3>
					<p>{sub.rejectionReason ? `“${sub.rejectionReason}”` : "No reason was given."}</p>
					<p class="muted">It went back to the submitter as a private pattern.</p>
				</section>
				<div class="actions"><button class="btn" disabled={busy} onclick={() => ap.reopen(sub)}>Reopen review</button></div>
			{/if}

			<footer class="foot">
				<button class="link link--danger" disabled={busy} onclick={() => ap.deleteSubmission(sub)}>Delete this submission…</button>
			</footer>

		{:else if adj}
			<!-- ── Change request ── -->
			<header class="ph">
				<div>
					<h2 class="ph__title">Change request</h2>
					<p class="ph__sub">{adjSub ? `${adjSub.name} · ${subjectLabel(adjSub)}` : "The original pattern is no longer in the queue."}</p>
				</div>
				<Badge variant={statusVariant(adj.status)} dot={adj.status === "pending"}>{adj.status === "approved" ? "done" : adj.status === "rejected" ? "declined" : "pending"}</Badge>
			</header>

			<div class="who">
				<span>Requested by</span>
				<button class="link" onclick={() => (ap.filterUser = adj.requestedBy)}>{ap.userLabel(adj.requestedBy)}</button>
				{#if ap.usersById[adj.requestedBy]?.email}<span class="muted">{ap.usersById[adj.requestedBy].email}</span>{/if}
				<span class="muted">· {fmtDate(adj.createdAt)}</span>
			</div>

			<section class="card">
				<h3 class="card__title">What they asked for</h3>
				<blockquote class="quote">{adj.notes}</blockquote>
			</section>

			{#if adjSub}
				<div class="split">
					<div class="preview"><PatternPreview svgPath={adjSub.svgPath} widthInches={adjSub.widthInches} heightInches={adjSub.heightInches} size="large" label="Outline of {adjSub.name}" /></div>
					<dl class="facts">
						<div><dt>Pattern</dt><dd>{adjSub.name}</dd></div>
						<div><dt>Size</dt><dd>{formatMeasure(adjSub.widthInches)}" × {formatMeasure(adjSub.heightInches)}"</dd></div>
						<div><dt>Zones</dt><dd>{zonesLabel(adjSub) || "—"}</dd></div>
					</dl>
				</div>
			{/if}

			<section class="card">
				<h3 class="card__title">Where it's published</h3>
				{#if adjCopies.length}
					<ul class="targets">
						{#each adjCopies.slice(0, 8) as p (p.id)}
							{@const v = subjectOf(p.vehicleId)}
							<li>
								<span>{v ? subjectName(v) : "Deleted subject"} · {ap.zoneLabel(p.category, p.zone, p.customZoneLabel, p.projectType)}</span>
								{#if v}<button class="link" onclick={() => onOpenCatalog(v.id, p.id)}>Edit in Catalog</button>{/if}
							</li>
						{/each}
					</ul>
					<p class="note">Approving a change doesn't edit anything by itself — make the edit in the Catalog, then mark this done.</p>
				{:else}
					<p class="muted">No published copy found for this pattern.</p>
				{/if}
			</section>

			{#if adj.status === "pending"}
				<section class="card">
					<label class="fld"><span>Reply to the requester <em>optional</em></span>
						<textarea class="in" rows="3" bind:value={reply} placeholder="What you changed, or why you didn't."></textarea>
					</label>
					<div class="actions">
						<button class="btn btn--primary" disabled={busy} onclick={() => ap.resolveChange(adj, "approved", reply)}>Mark done</button>
						<button class="btn btn--danger" disabled={busy} onclick={() => ap.resolveChange(adj, "rejected", reply)}>Decline</button>
					</div>
				</section>
			{:else}
				<section class="card">
					<h3 class="card__title">Your reply</h3>
					<p>{adj.adminResponse || "No reply was written."}</p>
				</section>
			{/if}
		{/if}
	</section>
</div>

<style>
	.repair { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; padding: 12px 16px; font-size: 0.8125rem; color: var(--text-secondary); background: color-mix(in srgb, var(--color-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); border-radius: var(--radius-md); }
	.repair strong { color: var(--text-primary); }
	.rq { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 16px; align-items: start; }

	/* ── list ── */
	.rq__list { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; min-width: 0; position: sticky; top: 0; max-height: calc(100dvh - 190px); }
	.rq__tabs { display: flex; align-items: center; gap: 4px; padding: 10px 10px 0; }
	.seg { padding: 6px 12px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-tertiary); background: none; border: none; border-radius: var(--radius-md); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
	.seg:hover { color: var(--text-primary); }
	.seg--on { background: var(--bg-surface-3); color: var(--text-primary); }
	.seg__n { font-family: var(--font-mono); font-size: 0.6875rem; padding: 0 6px; border-radius: 99px; background: var(--bg-base); }
	.seg__n--hot { background: var(--color-brand); color: #0a0a0a; }
	.rq__refresh { margin-left: auto; width: 28px; height: 28px; display: grid; place-items: center; border: none; background: none; color: var(--text-tertiary); border-radius: var(--radius-md); cursor: pointer; }
	.rq__refresh:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.rq__kinds { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; border-bottom: 1px solid var(--border-subtle); }
	.chip { padding: 3px 10px; font: inherit; font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
	.chip--on { color: var(--text-primary); border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand) 10%, transparent); }
	.chip__n { font-family: var(--font-mono); color: var(--text-tertiary); }
	.rq__items { list-style: none; margin: 0; padding: 6px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
	.empty { padding: 28px 14px; text-align: center; font-size: 0.8125rem; color: var(--text-tertiary); }
	.item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; text-align: left; font: inherit; color: inherit; background: none; border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
	.item:hover { background: var(--bg-surface-2); }
	.item--on { background: var(--bg-surface-2); border-color: var(--color-brand-dim); }
	.item__thumb { width: 48px; height: 48px; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-base); }
	.item__thumb--change { color: var(--text-tertiary); }
	.item__body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.item__title { font-size: 0.8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item__meta { font-size: 0.6875rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* ── panel ── */
	.rq__panel { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
	.blank { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 80px 20px; color: var(--text-tertiary); background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); }
	.ph { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
	.ph__title { font-size: 1.25rem; margin: 0 0 2px; overflow-wrap: anywhere; }
	.ph__sub { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
	.who { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 0.8125rem; color: var(--text-secondary); }
	.muted { color: var(--text-tertiary); }
	.link { background: none; border: none; padding: 0; font: inherit; color: var(--text-brand, var(--color-brand)); cursor: pointer; text-decoration: none; }
	.link:hover { text-decoration: underline; }
	.link--danger { color: var(--color-danger); }
	.link:disabled { opacity: 0.5; cursor: not-allowed; }

	.split { display: grid; grid-template-columns: minmax(180px, 280px) minmax(0, 1fr); gap: 16px; align-items: start; }
	.preview { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 12px; display: grid; place-items: center; min-height: 180px; }
	.facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; align-content: start; }
	.facts dt { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
	.facts dd { margin: 2px 0 0; font-size: 0.875rem; overflow-wrap: anywhere; }

	.card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
	.card--bad { border-color: color-mix(in srgb, var(--color-danger) 40%, transparent); }
	.card--quiet { background: transparent; }
	.card__title { margin: 0; font-size: 0.9375rem; }
	.card__hint { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); }
	.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
	.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.fld--wide { grid-column: 1 / -1; }
	.fld > span { font-size: 0.75rem; color: var(--text-secondary); }
	.fld em { font-style: normal; color: var(--text-tertiary); }
	.in { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); font: inherit; font-size: 0.8125rem; color: var(--text-primary); outline: none; }
	.in:focus { border-color: var(--color-brand-dim); }
	textarea.in { resize: vertical; }

	.plan__line { margin: 0; font-size: 0.875rem; }
	.targets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.targets li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid var(--border-subtle); font-size: 0.8125rem; }
	.targets li:first-child { border-top: 0; }
	.tags { display: inline-flex; gap: 6px; align-items: center; flex-shrink: 0; }
	.note { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); }
	.note--warn, .warn { color: var(--color-warning); }
	.warn { margin: 0; font-size: 0.8125rem; color: var(--color-danger); }
	.check { display: flex; gap: 8px; align-items: flex-start; font-size: 0.8125rem; color: var(--text-secondary); }
	.check input { margin-top: 2px; }
	.quote { margin: 0; padding: 10px 14px; border-left: 3px solid var(--color-brand); background: var(--bg-base); border-radius: 0 var(--radius-md) var(--radius-md) 0; font-size: 0.875rem; white-space: pre-wrap; overflow-wrap: anywhere; }

	.actions { display: flex; flex-wrap: wrap; gap: 8px; }
	.btn { padding: 8px 16px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }
	.btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-3); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn--primary { color: #fff; background: var(--color-brand-dim); border-color: transparent; }
	.btn--primary:hover:not(:disabled) { color: #fff; background: var(--color-brand); }
	.btn--danger { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 45%, transparent); }
	.btn--danger:hover:not(:disabled) { color: #fff; background: var(--color-danger); }
	.foot { padding-top: 4px; font-size: 0.8125rem; }

	@media (max-width: 960px) {
		.rq { grid-template-columns: minmax(0, 1fr); }
		.rq__list { position: static; max-height: 360px; }
		.split { grid-template-columns: minmax(0, 1fr); }
	}
	@media (max-width: 520px) {
		.grid2, .facts { grid-template-columns: minmax(0, 1fr); }
	}
</style>
