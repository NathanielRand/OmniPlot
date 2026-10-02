<script lang="ts">
	import Spinner from "$lib/components/ui/Spinner.svelte";
	// Catalog: the public library as admins manage it. Pick a subject on the
	// left; its patterns (grouped by category, with publish toggles and the
	// community submission each came from) are on the right.
	import Badge from "$lib/components/ui/Badge.svelte";
	import SubjectMedia from "./SubjectMedia.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import { adminPatterns as ap } from "$lib/admin/adminPatterns.svelte";
	import { patternStore, PATTERN_CATEGORIES, zonesFor, categoryShortLabel } from "$lib/stores/patternStore.svelte";
	import { deriveHeight, deriveWidth, relinkSize, sizeError } from "$lib/utils/patternSize";
	import { formatMeasure } from "$lib/utils";
	import {
		PROJECT_TYPES, projectTypeMeta, subjectName, blankSubject, formFromSubject, blankPattern, formFromPattern,
		type SubjectForm, type PatternForm,
	} from "$lib/admin/patternForms";
	import type { Pattern, PatternCategory, ProjectType, VehicleEntry } from "$lib/types";
	import type { PatternStatus } from "$lib/stores/patternStore.svelte";
	import { demandId, demandModelKey, votesForYear } from "$lib/utils/demand";
	import { makeKey } from "$lib/utils/vehicleCatalog";
	import { splitList, type VehiclePlanInput } from "$lib/admin/vehiclePlan";

	interface Props {
		/** Select this subject (and flash one of its patterns) — set when jumping in from Review. */
		focus?: { subjectId: string; patternId?: string } | null;
		onFocusUsed?: () => void;
		/** Open the "add subject" dialog pre-filled — set when creating from a request. */
		prefill?: Partial<SubjectForm> | null;
		onPrefillUsed?: () => void;
		/** Open the "add vehicles" dialog pre-filled — set when creating placeholders from a request. */
		bulkPrefill?: Partial<VehiclePlanInput> | null;
		onBulkPrefillUsed?: () => void;
	}
	let { focus = null, onFocusUsed, prefill = null, onPrefillUsed, bulkPrefill = null, onBulkPrefillUsed }: Props = $props();

	// ─── List ────────────────────────────────────
	let search = $state("");
	let typeFilter = $state<"all" | ProjectType>("all");
	// "soon" = published but no live pattern yet — what customers see as "Coming soon".
	let statusFilter = $state<"all" | PatternStatus | "soon">("all");
	let selectedId = $state<string | null>(null);
	let category = $state<"all" | PatternCategory>("all");

	const typeOf = (v: VehicleEntry): ProjectType => v.projectType ?? "vehicle";
	const submissionById = $derived(Object.fromEntries(ap.submissions.map((s) => [s.id, s])));

	// Everyone behind a subject: whoever created it, plus the owner of each
	// community submission one of its patterns was published from.
	function contributors(v: VehicleEntry): string[] {
		const ids = new Set<string>();
		if (v.contributedBy) ids.add(v.contributedBy);
		for (const p of patternStore.getPatterns(v.id)) {
			const owner = p.sourcePatternId ? submissionById[p.sourcePatternId]?.ownerId : undefined;
			if (owner) ids.add(owner);
		}
		for (const s of ap.submissions) if (s.status === "approved" && s.vehicleId === v.id && s.ownerId) ids.add(s.ownerId);
		return [...ids];
	}

	// People who want this subject's make/model (and year), from the one demand record.
	const demandIndex = $derived(new Map(patternStore.requests.map((r) => [r.id, r])));
	const wantOf = (v: VehicleEntry) =>
		typeOf(v) === "vehicle" && v.make && v.model ? votesForYear(demandIndex.get(demandId({ projectType: "vehicle", make: v.make, model: v.model })), v.year) : 0;
	const isSoon = (v: VehicleEntry, live: number) => v.status === "published" && live === 0;

	const rows = $derived(
		patternStore.vehicles
			.map((v) => {
				const pats = patternStore.getPatterns(v.id);
				const live = pats.filter((p) => p.isPublished).length;
				return { v, total: pats.length, live, soon: isSoon(v, live), want: wantOf(v) };
			})
			.filter(({ v, soon }) => {
				const q = search.trim().toLowerCase();
				const text = `${v.make ?? ""} ${v.model ?? ""} ${v.trim ?? ""} ${v.year ?? ""} ${v.propertyLabel ?? ""} ${v.address ?? ""} ${(v.tags ?? []).join(" ")}`.toLowerCase();
				return (!q || text.includes(q))
					&& (typeFilter === "all" || typeOf(v) === typeFilter)
					&& (statusFilter === "all" || (statusFilter === "soon" ? soon : v.status === statusFilter))
					&& (!ap.filterUser || contributors(v).includes(ap.filterUser));
			})
			.sort((a, b) => (statusFilter === "soon" ? b.want - a.want : 0) || subjectName(a.v).localeCompare(subjectName(b.v), undefined, { numeric: true, sensitivity: "base" })),
	);

	// Vehicles fold into make → model → years so the list stays short; every
	// other subject type stays a flat row beneath them.
	type Row = (typeof rows)[number];
	const grouped = $derived.by(() => {
		const makes = new Map<string, { key: string; name: string; models: Map<string, { key: string; name: string; rows: Row[] }> }>();
		const other: Row[] = [];
		for (const r of rows) {
			const { v } = r;
			if (typeOf(v) !== "vehicle" || !v.make || !v.model) { other.push(r); continue; }
			const mk = makeKey(v.make);
			const make = makes.get(mk) ?? { key: mk, name: v.make, models: new Map() };
			makes.set(mk, make);
			const dk = `${mk}|${demandModelKey(v.make, v.model)}`;
			const model = make.models.get(dk) ?? { key: dk, name: v.model, rows: [] };
			make.models.set(dk, model);
			model.rows.push(r);
		}
		const sum = (rs: Row[]) => ({
			total: rs.reduce((n, r) => n + r.total, 0),
			live: rs.reduce((n, r) => n + r.live, 0),
			soon: rs.filter((r) => r.soon).length,
			want: rs.reduce((n, r) => Math.max(n, r.want), 0),
		});
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
		const list = [...makes.values()].map((m) => {
			const models = [...m.models.values()].map((md) => {
				const rs = md.rows.slice().sort((a, b) => (b.v.year ?? 0) - (a.v.year ?? 0) || (a.v.trim ?? "").localeCompare(b.v.trim ?? ""));
				const yrs = rs.map((r) => r.v.year).filter((y): y is number => !!y);
				const lo = Math.min(...yrs), hi = Math.max(...yrs);
				const range = yrs.length ? (lo === hi ? `${lo}` : `${lo}–${hi}`) : "";
				return { ...md, rows: rs, range, ...sum(rs) };
			}).sort(byName);
			return { ...m, models, ...sum(models.flatMap((md) => md.rows)) };
		}).sort(byName);
		return { makes: list, other };
	});

	// Open/closed state for the tree. A search forces every branch open so
	// nothing hides behind a collapsed row.
	let openKeys = $state(new Set<string>());
	const searching = $derived(search.trim().length > 0);
	const selectedKeys = $derived.by(() => {
		const v = patternStore.vehicles.find((x) => x.id === selectedId);
		if (!v || typeOf(v) !== "vehicle" || !v.make || !v.model) return [] as string[];
		const mk = makeKey(v.make);
		return [mk, `${mk}|${demandModelKey(v.make, v.model)}`];
	});
	const isOpen = (k: string) => searching || openKeys.has(k);
	function toggle(k: string) {
		const next = new Set(openKeys);
		if (next.has(k)) next.delete(k); else next.add(k);
		openKeys = next;
	}
	// Reveal the branch of whatever just became selected (jump-ins, new subjects).
	$effect(() => {
		const need = selectedKeys.filter((k) => !openKeys.has(k));
		if (need.length) openKeys = new Set([...openKeys, ...need]);
	});
	const yearLabel = (v: VehicleEntry) => `${v.year ?? "—"}${v.trim ? ` ${v.trim}` : ""}`;

	const typeCounts = $derived(
		patternStore.vehicles.reduce((acc, v) => { acc[typeOf(v)] = (acc[typeOf(v)] ?? 0) + 1; return acc; }, {} as Record<string, number>),
	);
	const statusCounts = $derived(
		patternStore.vehicles
			.filter((v) => typeFilter === "all" || typeOf(v) === typeFilter)
			.reduce((acc, v) => { acc[v.status] = (acc[v.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
	);
	const soonCount = $derived(
		patternStore.vehicles.filter((v) => (typeFilter === "all" || typeOf(v) === typeFilter) && isSoon(v, patternStore.getPatterns(v.id).filter((p) => p.isPublished).length)).length,
	);
	const totals = $derived({
		subjects: patternStore.vehicles.length,
		patterns: patternStore.vehicles.reduce((n, v) => n + patternStore.getPatterns(v.id).length, 0),
		live: patternStore.vehicles.reduce((n, v) => n + patternStore.getPatterns(v.id).filter((p) => p.isPublished).length, 0),
	});

	// A subject we just created arrives via the live snapshot a moment later.
	let wantId = $state<string | null>(null);
	// Keep a valid selection.
	$effect(() => {
		if (wantId && rows.some((r) => r.v.id === wantId)) { selectedId = wantId; wantId = null; return; }
		if (wantId) return;
		if (!rows.some((r) => r.v.id === selectedId)) selectedId = rows[0]?.v.id ?? null;
	});

	// ─── The chosen subject ──────────────────────
	const subject = $derived(patternStore.vehicles.find((v) => v.id === selectedId) ?? null);
	const subjectPatterns = $derived(subject ? patternStore.getPatterns(subject.id) : []);
	const catsPresent = $derived(PATTERN_CATEGORIES.filter((c) => subjectPatterns.some((p) => p.category === c.value)));
	$effect(() => { subject?.id; category = "all"; });
	const shownPatterns = $derived(subjectPatterns.filter((p) => category === "all" || p.category === category));
	const groups = $derived(
		PATTERN_CATEGORIES
			.map((c) => ({ c, pats: shownPatterns.filter((p) => p.category === c.value) }))
			.filter((g) => g.pats.length > 0),
	);
	const liveCount = $derived(subjectPatterns.filter((p) => p.isPublished).length);
	const invisible = $derived(!!subject && subject.status === "published" && liveCount === 0);
	const subjectWant = $derived(subject ? wantOf(subject) : 0);

	// Jumping in from Review / Requests.
	let flash = $state<string | null>(null);
	$effect(() => {
		if (!focus) return;
		typeFilter = "all"; statusFilter = "all"; search = "";
		selectedId = focus.subjectId;
		flash = focus.patternId ?? null;
		onFocusUsed?.();
		if (flash) setTimeout(() => (flash = null), 2500);
	});

	// ─── Subject dialog ──────────────────────────
	let subjectDlg = $state<{ target: VehicleEntry | null } | null>(null);
	let subjectForm = $state<SubjectForm>(blankSubject());

	function openAddSubject(pre?: Partial<SubjectForm>) {
		subjectForm = { ...blankSubject(), ...pre };
		subjectDlg = { target: null };
	}
	function openEditSubject(v: VehicleEntry) {
		subjectForm = formFromSubject(v);
		subjectDlg = { target: v };
	}
	$effect(() => {
		if (!prefill) return;
		openAddSubject(prefill);
		onPrefillUsed?.();
	});

	$effect(() => {
		if (!bulkPrefill) return;
		openBulk(bulkPrefill);
		onBulkPrefillUsed?.();
	});

	async function submitSubject() {
		if (!subjectDlg) return;
		const saved = await ap.saveSubject(subjectForm, subjectDlg.target);
		if (!saved) return;
		subjectDlg = null;
		if (!rows.some((r) => r.v.id === saved.id)) { typeFilter = "all"; statusFilter = "all"; search = ""; }
		wantId = saved.id;
		setTimeout(() => (wantId = null), 4000);
	}
	async function removeSubject(v: VehicleEntry) {
		if (await ap.deleteSubject(v)) selectedId = null;
	}

	const focusOnMount = (n: HTMLElement) => { n.focus(); };

	// ─── Bulk add vehicles ───────────────────────
	const blankBulk = (): VehiclePlanInput => ({
		make: "", models: "", yearFrom: new Date().getFullYear(), yearTo: new Date().getFullYear(), trims: "",
		status: "published", tags: [], popular: false,
	});
	let bulkDlg = $state(false);
	let bulk = $state<VehiclePlanInput>(blankBulk());
	let bulkTags = $state("advertised");
	const bulkInput = $derived<VehiclePlanInput>({ ...bulk, tags: splitList(bulkTags).map((t) => t.toLowerCase()) });
	const bulkPlan = $derived(bulkDlg ? ap.planBulk(bulkInput) : null);
	const bulkMakes = $derived([...new Set(patternStore.vehicles.map((v) => v.make).filter(Boolean) as string[])].sort());
	function openBulk(pre?: Partial<VehiclePlanInput>) {
		bulk = { ...blankBulk(), ...pre };
		bulkTags = "advertised";
		bulkDlg = true;
	}
	async function submitBulk() {
		const created = await ap.addVehicles(bulkInput);
		if (!created) return;
		bulkDlg = false;
		typeFilter = "all"; search = ""; statusFilter = created[0].status === "published" ? "soon" : "all";
		wantId = created[0].id;
		setTimeout(() => (wantId = null), 4000);
	}

	// ─── Pattern dialog ──────────────────────────
	let patternDlg = $state<{ target: Pattern | null; category: PatternCategory } | null>(null);
	let patternForm = $state<PatternForm>(blankPattern());
	const zoneOptions = $derived(patternDlg ? zonesFor(patternDlg.category, subject?.projectType) : []);

	function openAddPattern() {
		const cat = (category === "all" ? catsPresent[0]?.value : category) ?? "window-tint";
		patternDlg = { target: null, category: cat };
		patternForm = blankPattern(zonesFor(cat, subject?.projectType)[0]?.value ?? "custom");
	}
	function openEditPattern(p: Pattern) {
		patternDlg = { target: p, category: p.category };
		patternForm = formFromPattern(p);
	}
	function changeCategory(c: PatternCategory) {
		if (!patternDlg) return;
		patternDlg.category = c;
		const opts = zonesFor(c, subject?.projectType);
		if (!opts.some((o) => o.value === patternForm.zone)) patternForm.zone = opts[0]?.value ?? "custom";
	}

	// PRECISION: one dimension is typed, the other follows the outline.
	function onWidth(e: Event) { patternForm.widthInches = Number((e.currentTarget as HTMLInputElement).value); deriveHeight(patternForm, patternForm.svgPath); }
	function onHeight(e: Event) { patternForm.heightInches = Number((e.currentTarget as HTMLInputElement).value); deriveWidth(patternForm, patternForm.svgPath); }
	function onPath() { relinkSize(patternForm, patternForm.svgPath); }
	const sizeProblem = $derived(
		patternForm.svgPath.trim()
			? sizeError({ widthInches: Number(patternForm.widthInches), heightInches: Number(patternForm.heightInches) }, patternForm.svgPath.trim())
			: null,
	);

	async function submitPattern() {
		if (!patternDlg || !subject) return;
		if (await ap.savePattern(subject, patternDlg.category, patternForm, patternDlg.target)) patternDlg = null;
	}

	const busy = $derived(!!ap.busy || ap.seeding);
	const statusVariant = (s: string) => (s === "published" ? "success" : s === "review" ? "warning" : "default");
	const fmtDate = (s: string) => s || "—";
</script>

<div class="cm">
	<!-- ─── Subjects ─── -->
	<aside class="cm__list" aria-label="Subjects">
		<div class="cm__tools">
			<div class="search">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
				<input type="search" placeholder="Search subjects, tags…" bind:value={search} aria-label="Search subjects" />
			</div>
			<button class="btn btn--primary btn--sm" disabled={busy} onclick={() => openBulk()}>+ Add vehicles</button>
			<button class="btn btn--sm" disabled={busy} onclick={() => openAddSubject()} title="One subject — a residential, commercial or custom project, or a single vehicle">+ Subject</button>
		</div>

		<div class="cm__types" role="tablist" aria-label="Subject type">
			<button class="tab" class:tab--on={typeFilter === "all"} role="tab" aria-selected={typeFilter === "all"} onclick={() => (typeFilter = "all")}>All <span class="n">{totals.subjects}</span></button>
			{#each PROJECT_TYPES as t (t.value)}
				<button class="tab" class:tab--on={typeFilter === t.value} role="tab" aria-selected={typeFilter === t.value} onclick={() => (typeFilter = t.value)}>{t.label} <span class="n">{typeCounts[t.value] ?? 0}</span></button>
			{/each}
		</div>
		<div class="cm__status" role="group" aria-label="Status">
			{#each (["all", "published", "review", "draft", "soon"] as const) as s}
				<button class="chip" class:chip--on={statusFilter === s} aria-pressed={statusFilter === s} onclick={() => (statusFilter = s)} title={s === "soon" ? "Published, no live pattern yet — shown to customers as Coming soon. Most wanted first." : undefined}>
					{s === "all" ? "Any status" : s === "soon" ? "Needs patterns" : s[0].toUpperCase() + s.slice(1)}{#if s !== "all"} <span class="n">{s === "soon" ? soonCount : statusCounts[s] ?? 0}</span>{/if}
				</button>
			{/each}
		</div>

		<ul class="subjects">
			{#if patternStore.loading}
				<li class="empty">Loading the catalog…</li>
			{:else if rows.length === 0}
				<li class="empty">No subjects match.</li>
			{/if}
			{#each grouped.makes as mk (mk.key)}
				<li class="grp">
					<button class="row row--make" aria-expanded={isOpen(mk.key)} onclick={() => toggle(mk.key)}>
						<svg class="caret" class:caret--open={isOpen(mk.key)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
						<span class="row__name">{mk.name}</span>
						<span class="row__sub">{mk.models.length} {mk.models.length === 1 ? "model" : "models"}</span>
						{#if mk.soon}<span class="subj__soon" title="{mk.soon} without a live pattern yet">{mk.soon} need</span>{/if}
						<span class="subj__count" title="{mk.live} live of {mk.total} patterns">{mk.live}/{mk.total}</span>
					</button>
					{#if isOpen(mk.key)}
						<ul class="sub">
							{#each mk.models as md (md.key)}
								<li>
									<button class="row row--model" aria-expanded={isOpen(md.key)} onclick={() => toggle(md.key)}>
										<svg class="caret" class:caret--open={isOpen(md.key)} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
										<span class="row__name">{md.name}</span>
										<span class="row__sub mono">{md.range}</span>
										{#if md.soon}<span class="subj__soon" title="{md.soon} without a live pattern yet — up to {md.want} want it">{md.soon} need</span>{/if}
										<span class="subj__count" title="{md.live} live of {md.total} patterns">{md.live}/{md.total}</span>
									</button>
									{#if isOpen(md.key)}
										<div class="years">
											{#each md.rows as { v, total, live, soon, want } (v.id)}
												<button class="yr" class:yr--on={selectedId === v.id} onclick={() => (selectedId = v.id)} title="{subjectName(v)} · {v.status} · {soon ? `${want} want it, no live pattern` : `${live} live of ${total}`}">
													<span class="dot dot--{v.status}"></span>{yearLabel(v)}{#if soon}<span class="yr__soon">•</span>{/if}
												</button>
											{/each}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
			{#each grouped.other as { v, total, live, soon, want } (v.id)}
				<li>
					<button class="subj" class:subj--on={selectedId === v.id} onclick={() => (selectedId = v.id)}>
						<span class="subj__icon" aria-hidden="true">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={projectTypeMeta(v.projectType).icon}/></svg>
						</span>
						<span class="subj__name">{subjectName(v)}</span>
						{#if soon}<span class="subj__soon" title="{want} {want === 1 ? "person wants" : "people want"} this — no live pattern yet">{want} want</span>{:else}<span class="subj__count" title="{live} live of {total}">{live}/{total}</span>{/if}
						<span class="dot dot--{v.status}" title={v.status}></span>
					</button>
				</li>
			{/each}
		</ul>
		<div class="cm__foot">{totals.subjects} subjects · {totals.patterns} patterns · {totals.live} live</div>
	</aside>

	<!-- ─── Subject ─── -->
	<section class="cm__main">
		{#if !subject}
			<div class="blank"><p>{patternStore.loading ? "Loading…" : "Select a subject to manage its patterns."}</p></div>
		{:else}
			<header class="sh">
				<div class="sh__id">
					<span class="sh__icon" aria-hidden="true">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={projectTypeMeta(subject.projectType).icon}/></svg>
					</span>
					<div>
						<h2 class="sh__title">{subjectName(subject)}</h2>
						<p class="sh__sub">
							{projectTypeMeta(subject.projectType).label}{#if subject.address} · {subject.address}{/if} · updated {fmtDate(subject.updatedAt)}
						</p>
					</div>
				</div>
				<div class="sh__actions">
					<Badge variant={statusVariant(subject.status)} dot={subject.status === "published"}>{subject.status}</Badge>
					{#if subject.popular}<Badge variant="brand">popular</Badge>{/if}
					<button class="btn btn--sm" disabled={busy} onclick={() => openEditSubject(subject)}>Edit details</button>
					<button class="btn btn--sm btn--danger" disabled={busy} onclick={() => removeSubject(subject)}>Delete</button>
				</div>
			</header>

			{#if invisible}
				<p class="callout callout--info">No live patterns yet, so customers see this as <b>Coming soon</b>{subjectWant ? ` — ${subjectWant} ${subjectWant === 1 ? "person wants" : "people want"} it` : ""}. It goes live by itself when its first pattern is published.</p>
			{:else if subject.status !== "published" && liveCount > 0}
				<p class="callout">{liveCount} pattern{liveCount === 1 ? " is" : "s are"} live but the subject is “{subject.status}”, so customers can't see {liveCount === 1 ? "it" : "them"}. Publish the subject from Edit details.</p>
			{/if}

			<div class="meta">
				<div>
					<span class="meta__k">Contributors</span>
					{#each contributors(subject) as u (u)}
						<button class="link" onclick={() => (ap.filterUser = u)} title="Show only this user's activity">{ap.userLabel(u)}</button>
					{:else}
						<span class="muted">Added by an admin</span>
					{/each}
				</div>
				{#if subject.tags?.length}
					<div><span class="meta__k">Tags</span> {#each subject.tags as t (t)}<span class="tag">{t}</span>{/each}</div>
				{/if}
			</div>

			<SubjectMedia {subject} />

			<div class="pbar">
				<div class="tabs" role="tablist" aria-label="Category">
					<button class="tab" class:tab--on={category === "all"} role="tab" aria-selected={category === "all"} onclick={() => (category = "all")}>All <span class="n">{subjectPatterns.length}</span></button>
					{#each catsPresent as c (c.value)}
						<button class="tab" class:tab--on={category === c.value} role="tab" aria-selected={category === c.value} onclick={() => (category = c.value)}>
							{c.shortLabel} <span class="n">{subjectPatterns.filter((p) => p.category === c.value).length}</span>
						</button>
					{/each}
				</div>
				<button class="btn btn--primary btn--sm" disabled={busy} onclick={openAddPattern}>+ Add pattern</button>
			</div>

			{#if groups.length === 0}
				<div class="blank"><p>No patterns on this subject yet.</p><button class="btn btn--sm" disabled={busy} onclick={openAddPattern}>Add the first one</button></div>
			{/if}

			{#each groups as { c, pats } (c.value)}
				{#if category === "all" && groups.length > 1}<h3 class="gtitle" style="--cat-accent: {c.accent}">{c.label}</h3>{/if}
				<ul class="pgrid">
					{#each pats as p (p.id)}
						{@const src = p.sourcePatternId ? submissionById[p.sourcePatternId] : null}
						<li class="pcard" class:pcard--flash={flash === p.id} class:pcard--off={!p.isPublished}>
							<div class="pcard__prev"><PatternPreview svgPath={p.svgPath} widthInches={p.widthInches} heightInches={p.heightInches} size="thumb" label="Outline of {p.name}" /></div>
							<div class="pcard__body">
								<div class="pcard__name" title={p.name}>{p.name}</div>
								<div class="pcard__meta">{ap.zoneLabel(p.category, p.zone, p.customZoneLabel, p.projectType)}</div>
								<div class="pcard__meta mono">{formatMeasure(p.widthInches)}" × {formatMeasure(p.heightInches)}" · {p.coverage === "edge-only" ? "edge only" : p.coverage}</div>
								{#if src}
									<div class="pcard__meta">From <button class="link" onclick={() => (ap.filterUser = src.ownerId)}>{ap.userLabel(src.ownerId)}</button></div>
								{:else if p.sourcePatternId}
									<div class="pcard__meta">From a community submission</div>
								{/if}
							</div>
							<div class="pcard__foot">
								<button class="switch" role="switch" aria-checked={p.isPublished} disabled={busy} onclick={() => ap.togglePublished(p)} title={p.isPublished ? "Live — click to unpublish" : "Not live — click to publish"}>
									<span class="switch__track"></span>
									<span class="switch__lbl">{p.isPublished ? "Live" : "Draft"}</span>
								</button>
								<span class="pcard__btns">
									<button class="icon" disabled={busy} onclick={() => openEditPattern(p)} aria-label="Edit {p.name}" title="Edit">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="icon icon--danger" disabled={busy} onclick={() => ap.deletePattern(p)} aria-label="Delete {p.name}" title="Delete">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
									</button>
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/each}
		{/if}
	</section>
</div>

<svelte:window onkeydown={(e) => { if (e.key === "Escape" && bulkDlg) bulkDlg = false; }} />
<!-- ─── Add vehicles (bulk) ─── -->
{#if bulkDlg}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (bulkDlg = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg" role="dialog" aria-modal="true" aria-label="Add vehicles" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="dlg__title">Add vehicles</h2>
			<div class="dlg__body">
				<p class="muted bulk__intro">List a make and its models ahead of the patterns. Published vehicles show to customers as <b>Coming soon</b> and collect votes, then go live by themselves when you add a pattern.</p>
				<label class="fld"><span>Make</span><input class="in" bind:value={bulk.make} list="bulk-makes" autocomplete="off" use:focusOnMount placeholder="e.g. Toyota" /></label>
				<datalist id="bulk-makes">{#each bulkMakes as m}<option value={m}></option>{/each}</datalist>
				<label class="fld"><span>Models <em>comma or one per line</em></span><textarea class="in" rows="3" bind:value={bulk.models} placeholder="GR86, GR Supra, Tacoma"></textarea></label>
				<div class="grid2">
					<label class="fld"><span>First year</span><input class="in" type="number" bind:value={bulk.yearFrom} /></label>
					<label class="fld"><span>Last year</span><input class="in" type="number" bind:value={bulk.yearTo} /></label>
				</div>
				<label class="fld"><span>Trims <em>optional — blank adds the base subject only</em></span><input class="in" bind:value={bulk.trims} placeholder="SR5, TRD Pro" /></label>
				<label class="fld"><span>Status</span>
					<select class="in" bind:value={bulk.status}><option value="published">Published — Coming soon</option><option value="draft">Draft — hidden</option></select>
				</label>
				<label class="fld"><span>Tags <em>comma-separated</em></span><input class="in" bind:value={bulkTags} /></label>
				<label class="check"><input type="checkbox" bind:checked={bulk.popular} /> <span>Mark as popular</span></label>
				<p class="bulk__sum" class:warn={!!bulkPlan?.error}>
					{#if bulkPlan?.error}{bulk.make.trim() || bulk.models.trim() ? bulkPlan.error : ""}
					{:else if bulkPlan}Creates <b>{bulkPlan.create.length}</b> subject{bulkPlan.create.length === 1 ? "" : "s"}{#if bulkPlan.skipped} · skips {bulkPlan.skipped} already in the catalog{/if}.{/if}
				</p>
				{#if bulkPlan && !bulkPlan.error && bulkPlan.create.length}
					<ul class="bulk__preview" aria-label="Preview">
						{#each bulkPlan.create.slice(0, 6) as v (v.id)}<li>{subjectName(v)}</li>{/each}
						{#if bulkPlan.create.length > 6}<li class="more">+ {bulkPlan.create.length - 6} more</li>{/if}
					</ul>
				{/if}
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (bulkDlg = false)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy || !bulkPlan || !!bulkPlan.error || !bulkPlan.create.length} onclick={submitBulk}>{#if busy}<Spinner />{/if}{bulkPlan?.create.length ? `Add ${bulkPlan.create.length} ${bulkPlan.create.length === 1 ? "vehicle" : "vehicles"}` : "Add vehicles"}</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Subject dialog ─── -->
{#if subjectDlg}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (subjectDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg" role="dialog" aria-modal="true" aria-label={subjectDlg.target ? "Edit subject" : "Add subject"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="dlg__title">{subjectDlg.target ? "Edit subject" : "Add subject"}</h2>
			<div class="dlg__body">
				<label class="fld"><span>Type</span>
					<select class="in" bind:value={subjectForm.projectType} disabled={!!subjectDlg.target}>
						{#each PROJECT_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
					</select>
				</label>
				{#if subjectForm.projectType === "vehicle"}
					<div class="grid2">
						<label class="fld"><span>Year</span><input class="in" type="number" bind:value={subjectForm.year} /></label>
						<label class="fld"><span>Make</span><input class="in" bind:value={subjectForm.make} /></label>
						<label class="fld"><span>Model</span><input class="in" bind:value={subjectForm.model} /></label>
						<label class="fld"><span>Trim <em>optional</em></span><input class="in" bind:value={subjectForm.trim} /></label>
						<label class="fld"><span>Body style</span>
							<select class="in" bind:value={subjectForm.bodyStyle}>
								{#each ["sedan", "coupe", "suv", "truck", "convertible", "wagon", "hatchback"] as b}<option value={b}>{b}</option>{/each}
							</select>
						</label>
					</div>
				{:else}
					<label class="fld"><span>{subjectForm.projectType === "custom" ? "Project name" : "Property label"}</span><input class="in" bind:value={subjectForm.propertyLabel} /></label>
					<label class="fld"><span>Address <em>optional</em></span><input class="in" bind:value={subjectForm.address} /></label>
				{/if}
				<div class="grid2">
					<label class="fld"><span>Status</span>
						<select class="in" bind:value={subjectForm.status}><option value="draft">Draft</option><option value="review">In review</option><option value="published">Published</option></select>
					</label>
					<label class="fld"><span>Tags <em>comma-separated</em></span><input class="in" bind:value={subjectForm.tags} /></label>
				</div>
				<label class="check"><input type="checkbox" bind:checked={subjectForm.popular} /> <span>Mark as popular</span></label>
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (subjectDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy} onclick={submitSubject}>{#if busy}<Spinner />{/if}{subjectDlg.target ? "Save changes" : "Add subject"}</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Pattern dialog ─── -->
{#if patternDlg && subject}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (patternDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg dlg--wide" role="dialog" aria-modal="true" aria-label={patternDlg.target ? "Edit pattern" : "Add pattern"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="dlg__title">{patternDlg.target ? "Edit pattern" : "Add pattern"} <span class="muted">· {subjectName(subject)}</span></h2>
			<div class="dlg__body dlg__body--split">
				<div class="dlg__form">
					<div class="grid2">
						<label class="fld"><span>Category</span>
							<select class="in" value={patternDlg.category} disabled={!!patternDlg.target} onchange={(e) => changeCategory((e.currentTarget as HTMLSelectElement).value as PatternCategory)}>
								{#each PATTERN_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
							</select>
						</label>
						<label class="fld"><span>Zone</span>
							<select class="in" bind:value={patternForm.zone}>{#each zoneOptions as z (z.value)}<option value={z.value}>{z.label}</option>{/each}</select>
						</label>
						{#if patternForm.zone === "custom"}
							<label class="fld fld--wide"><span>Custom zone name</span><input class="in" bind:value={patternForm.customZoneLabel} /></label>
						{/if}
						<label class="fld fld--wide"><span>Name</span><input class="in" bind:value={patternForm.name} /></label>
						<label class="fld"><span>Width (in)</span><input class="in" type="number" step="any" min="0" value={patternForm.widthInches} oninput={onWidth} /></label>
						<label class="fld"><span>Height (in)</span><input class="in" type="number" step="any" min="0" value={patternForm.heightInches} oninput={onHeight} /></label>
						<label class="fld"><span>Coverage</span>
							<select class="in" bind:value={patternForm.coverage}><option value="full">Full</option><option value="partial">Partial</option><option value="edge-only">Edge only</option></select>
						</label>
						<label class="fld"><span>Revision</span><input class="in" bind:value={patternForm.revision} placeholder="e.g. 2026-10" /></label>
						<label class="fld fld--wide"><span>SVG path <em>the cut outline</em></span>
							<textarea class="in mono" rows="5" bind:value={patternForm.svgPath} oninput={onPath} placeholder="M0 0 L…"></textarea>
						</label>
						<label class="fld fld--wide"><span>SVG file URL <em>optional</em></span><input class="in" bind:value={patternForm.svgUrl} /></label>
						<label class="fld fld--wide"><span>Notes shown to customers <em>optional</em></span><textarea class="in" rows="2" bind:value={patternForm.notes}></textarea></label>
					</div>
					<label class="check"><input type="checkbox" bind:checked={patternForm.isPublished} /> <span>Published — customers can cut it</span></label>
					{#if sizeProblem}<p class="warn">{sizeProblem}</p>{/if}
				</div>
				<div class="dlg__prev">
					{#if patternForm.svgPath.trim()}
						<PatternPreview svgPath={patternForm.svgPath.trim()} widthInches={Number(patternForm.widthInches) || undefined} heightInches={Number(patternForm.heightInches) || undefined} label="Preview" />
					{:else}
						<p class="muted">Paste an outline to preview it.</p>
					{/if}
				</div>
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (patternDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy} onclick={submitPattern}>{#if busy}<Spinner />{/if}{patternDlg.target ? "Save changes" : "Add pattern"}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cm { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
	.muted { color: var(--text-tertiary); }
	.mono { font-family: var(--font-mono); }
	.n { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.link { background: none; border: none; padding: 0; font: inherit; color: var(--text-brand, var(--color-brand)); cursor: pointer; }
	.link:hover { text-decoration: underline; }

	/* ── list ── */
	.cm__list { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; min-width: 0; position: sticky; top: 0; max-height: calc(100dvh - 190px); }
	.cm__tools { display: flex; gap: 8px; padding: 10px; }
	.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 10px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-tertiary); }
	.search input { flex: 1; min-width: 0; padding: 7px 0; background: none; border: none; outline: none; font: inherit; font-size: 0.8125rem; color: var(--text-primary); }
	.cm__types, .tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 10px; }
	.tab { padding: 5px 10px; font: inherit; font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); background: none; border: none; border-radius: var(--radius-md); cursor: pointer; display: inline-flex; gap: 5px; align-items: center; }
	.tab:hover { color: var(--text-primary); }
	.tab--on { background: var(--bg-surface-3); color: var(--text-primary); }
	.cm__status { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 10px; border-bottom: 1px solid var(--border-subtle); }
	.chip { padding: 2px 9px; font: inherit; font-size: 0.6875rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; display: inline-flex; gap: 5px; align-items: center; }
	.chip--on { color: var(--text-primary); border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand) 10%, transparent); }
	.subjects { list-style: none; margin: 0; padding: 6px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
	.empty { padding: 28px 14px; text-align: center; font-size: 0.8125rem; color: var(--text-tertiary); }
	.subj { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 8px; text-align: left; font: inherit; color: inherit; background: none; border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
	.subj:hover { background: var(--bg-surface-2); }
	.subj--on { background: var(--bg-surface-2); border-color: var(--color-brand-dim); }
	.subj__icon { color: var(--text-tertiary); display: grid; place-items: center; }
	.subj__name { flex: 1; min-width: 0; font-size: 0.8125rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.subj__soon { font-size: 0.6875rem; font-weight: 600; color: var(--color-warning); white-space: nowrap; }
	.bulk__intro { margin: 0; font-size: 0.8125rem; }
	.bulk__preview { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.bulk__preview li { padding: 2px 9px; font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: 99px; }
	.bulk__preview .more { color: var(--text-tertiary); border-style: dashed; }
	.bulk__sum { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); min-height: 1.2em; }
	.callout--info { color: var(--text-secondary); background: var(--bg-surface-2); border-color: var(--border-default); }
	.grp { display: flex; flex-direction: column; }
	.row { width: 100%; display: flex; align-items: center; gap: 7px; padding: 6px 8px; text-align: left; font: inherit; color: inherit; background: none; border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
	.row:hover { background: var(--bg-surface-2); }
	.row--make .row__name { font-weight: 600; }
	.row__name { flex: 1; min-width: 0; font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.row__sub { font-size: 0.6875rem; color: var(--text-tertiary); white-space: nowrap; }
	.caret { color: var(--text-tertiary); flex-shrink: 0; transition: transform 0.12s; }
	.caret--open { transform: rotate(90deg); }
	.sub { list-style: none; margin: 0 0 4px 10px; padding: 0 0 0 6px; border-left: 1px solid var(--border-subtle); }
	.years { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 6px 8px 24px; }
	.yr { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.yr:hover { color: var(--text-primary); }
	.yr--on { color: var(--text-primary); border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand) 12%, transparent); }
	.yr .dot { width: 6px; height: 6px; }
	.yr__soon { color: var(--color-warning); }
	.subj__count { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
	.dot--published { background: var(--color-success); }
	.dot--review { background: var(--color-warning); }
	.cm__foot { padding: 8px 12px; border-top: 1px solid var(--border-subtle); font-size: 0.6875rem; color: var(--text-tertiary); }

	/* ── subject ── */
	.cm__main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
	.blank { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 20px; color: var(--text-tertiary); background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); }
	.blank p { margin: 0; }
	.sh { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
	.sh__id { display: flex; gap: 12px; align-items: center; min-width: 0; }
	.sh__icon { width: 40px; height: 40px; border-radius: var(--radius-lg); display: grid; place-items: center; background: var(--color-brand-muted); color: var(--text-brand, var(--color-brand)); flex-shrink: 0; }
	.sh__title { margin: 0; font-size: 1.25rem; overflow-wrap: anywhere; }
	.sh__sub { margin: 2px 0 0; font-size: 0.8125rem; color: var(--text-secondary); }
	.sh__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.callout { margin: 0; padding: 10px 14px; font-size: 0.8125rem; color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); border-radius: var(--radius-md); }
	.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 0.8125rem; }
	.meta > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
	.meta__k { color: var(--text-tertiary); font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; }
	.tag { padding: 1px 8px; font-size: 0.6875rem; border-radius: 99px; background: var(--bg-surface-3); color: var(--text-secondary); }
	.pbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px; }
	.pbar .tabs { padding: 0; }
	.gtitle { margin: 6px 0 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
	.pgrid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
	.pcard { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; min-width: 0; overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
	.pcard--off .pcard__prev { opacity: 0.55; }
	.pcard--flash { border-color: var(--color-brand); box-shadow: 0 0 0 3px var(--color-brand-muted); }
	.pcard__prev { height: 120px; display: grid; place-items: center; padding: 8px; background: var(--bg-surface-2); }
	.pcard__body { padding: 10px 12px 4px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.pcard__name { font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.pcard__meta { font-size: 0.75rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.pcard__foot { margin-top: auto; padding: 8px 12px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.pcard__btns { display: inline-flex; gap: 4px; }
	.icon { width: 26px; height: 26px; display: grid; place-items: center; background: var(--bg-surface); color: var(--text-secondary); border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }
	.icon:hover:not(:disabled) { color: var(--text-primary); border-color: var(--color-brand-dim); }
	.icon--danger:hover:not(:disabled) { color: var(--color-danger); border-color: var(--color-danger); }
	.icon:disabled { opacity: 0.5; cursor: not-allowed; }

	.switch { display: inline-flex; align-items: center; gap: 7px; padding: 0; cursor: pointer; font: inherit; font-size: 0.75rem; color: var(--text-secondary); background: none; border: none; }
	.switch:disabled { opacity: 0.5; cursor: not-allowed; }
	.switch__track { position: relative; width: 28px; height: 16px; border-radius: 99px; background: var(--bg-surface-3); transition: background 0.15s; }
	.switch__track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-tertiary); transition: transform 0.15s, background 0.15s; }
	.switch[aria-checked="true"] .switch__track { background: color-mix(in srgb, var(--color-success) 35%, transparent); }
	.switch[aria-checked="true"] .switch__track::after { transform: translateX(12px); background: var(--color-success); }
	.switch:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 3px; border-radius: 4px; }

	/* buttons / form */
	.btn { padding: 8px 16px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; white-space: nowrap; }
	.btn--sm { padding: 5px 11px; font-size: 0.75rem; }
	.btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-3); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn--primary { color: #fff; background: var(--color-brand-dim); border-color: transparent; }
	.btn--primary:hover:not(:disabled) { color: #fff; background: var(--color-brand); }
	.btn--danger { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 45%, transparent); }
	.btn--danger:hover:not(:disabled) { color: #fff; background: var(--color-danger); }
	.fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.fld--wide { grid-column: 1 / -1; }
	.fld > span { font-size: 0.75rem; color: var(--text-secondary); }
	.fld em { font-style: normal; color: var(--text-tertiary); }
	.in { width: 100%; box-sizing: border-box; padding: 7px 10px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); font: inherit; font-size: 0.8125rem; color: var(--text-primary); outline: none; }
	.in:focus { border-color: var(--color-brand-dim); }
	.in:disabled { opacity: 0.6; }
	textarea.in { resize: vertical; }
	.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
	.check { display: flex; gap: 8px; align-items: center; font-size: 0.8125rem; color: var(--text-secondary); }
	.warn { margin: 0; font-size: 0.8125rem; color: var(--color-danger); }

	/* dialogs */
	.overlay { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.55); }
	.dlg { width: 480px; max-width: 100%; max-height: calc(100dvh - 40px); display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-xl); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); }
	.dlg--wide { width: 860px; }
	.dlg__title { margin: 0; padding: 18px 20px 8px; font-size: 1.0625rem; }
	.dlg__body { padding: 8px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
	.dlg__body--split { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 18px; }
	.dlg__form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
	.dlg__prev { align-self: start; position: sticky; top: 0; padding: 10px; display: grid; place-items: center; min-height: 160px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.dlg__foot { padding: 12px 20px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-subtle); }

	@media (max-width: 960px) {
		.cm { grid-template-columns: minmax(0, 1fr); }
		.cm__list { position: static; max-height: 380px; }
		.dlg__body--split { grid-template-columns: minmax(0, 1fr); }
		.dlg__prev { position: static; }
	}
	@media (max-width: 520px) {
		.grid2 { grid-template-columns: minmax(0, 1fr); }
	}
</style>
