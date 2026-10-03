<script lang="ts">
	import { untrack } from "svelte";
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
	import { makeKey, trimKey, generationsFor, groupByGeneration, generationOf, generationKey, genSpan, generationError, uncategorizedSpan } from "$lib/utils/vehicleCatalog";
	import { splitList, type VehiclePlanInput } from "$lib/admin/vehiclePlan";
	import { subjectDuplicate, subjectFormError, parseTags } from "$lib/admin/patternForms";
	import { planLayerEdit, scopeOf, type LayerRef, type GenerationRow } from "$lib/admin/layerPlan";

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

	// Vehicles fold into make → model → trim → generation → years so the list stays
	// short. Each trim has its own generations; a model with only the base (no trim)
	// entries skips the trim level. Years in no generation stay directly under their
	// trim. Every other subject type stays a flat row beneath them.
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
				const make = rs[0].v.make ?? m.name, model = rs[0].v.model ?? md.name;
				const byTrim = new Map<string, { tk: string; trim?: string; rows: Row[] }>();
				for (const r of rs) {
					const tk = trimKey(r.v.trim);
					(byTrim.get(tk) ?? byTrim.set(tk, { tk, trim: r.v.trim?.trim() || undefined, rows: [] }).get(tk)!).rows.push(r);
				}
				const trims = [...byTrim.values()]
					.sort((x, y) => (x.tk === "" ? -1 : y.tk === "" ? 1 : (x.trim ?? "").localeCompare(y.trim ?? "", undefined, { numeric: true, sensitivity: "base" })))
					.map((t) => {
						const key = `${md.key}|t:${t.tk}`;
						const { groups, loose } = groupByGeneration(t.rows, generationsFor(patternStore.media, make, model, t.trim));
						return {
							key, make, model, name: t.trim ?? "No trim", trim: t.trim, rows: t.rows, loose, uncat: sum(loose), ...sum(t.rows),
							groups: groups.map((g) => ({ key: `${key}|g:${generationKey(g.gen)}`, gen: g.gen, rows: g.rows, ...sum(g.rows) })),
						};
					});
				return { ...md, rows: rs, range, make, model, trims, multi: trims.length > 1 || trims[0]?.trim !== undefined, ...sum(rs) };
			}).sort(byName);
			return { ...m, models, ...sum(models.flatMap((md) => md.rows)) };
		}).sort(byName);
		return { makes: list, other };
	});

	type TrimGroup = (typeof grouped)["makes"][number]["models"][number]["trims"][number];

	// Open/closed state for the tree. A search forces every branch open so
	// nothing hides behind a collapsed row.
	let openKeys = $state(new Set<string>());
	const searching = $derived(search.trim().length > 0);
	const selectedKeys = $derived.by(() => {
		const v = patternStore.vehicles.find((x) => x.id === selectedId);
		if (!v || typeOf(v) !== "vehicle" || !v.make || !v.model) return [] as string[];
		const mk = makeKey(v.make);
		const dk = `${mk}|${demandModelKey(v.make, v.model)}`;
		const tk = `${dk}|t:${trimKey(v.trim)}`;
		const g = generationOf(v.year, generationsFor(patternStore.media, v.make, v.model, v.trim));
		return g ? [mk, dk, tk, `${tk}|g:${generationKey(g)}`] : [mk, dk, tk, `${tk}|u`];
	});
	const isOpen = (k: string) => searching || openKeys.has(k);
	function toggle(k: string) {
		const next = new Set(openKeys);
		if (next.has(k)) next.delete(k); else next.add(k);
		openKeys = next;
	}
	// Reveal the branch of whatever just became selected (jump-ins, new subjects).
	// Only when the selection moves: the branch holding it can then be collapsed
	// again by hand without this reopening it.
	let revealed = "";
	$effect(() => {
		const sig = `${selectedId}|${selectedKeys.join(",")}`;
		if (sig === revealed) return;
		revealed = sig;
		const need = selectedKeys.filter((k) => !untrack(() => openKeys).has(k));
		if (need.length) openKeys = new Set([...untrack(() => openKeys), ...need]);
	});
	// The trim is already a level in the tree above, so a year badge is just the year.
	const yearLabel = (v: VehicleEntry) => `${v.year ?? "—"}`;

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
	// The admin-set generation this model year falls in, if any.
	const subjectGen = $derived(
		subject && typeOf(subject) === "vehicle" && subject.make && subject.model
			? generationOf(subject.year, generationsFor(patternStore.media, subject.make, subject.model, subject.trim))
			: undefined,
	);

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
		tagDraft = "";
		subjectForm = { ...blankSubject(), ...pre };
		subjectDlg = { target: null };
	}
	function openEditSubject(v: VehicleEntry) {
		tagDraft = "";
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
		if (tagDraft.trim()) addTags();
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

	// What the subject dialog knows about the catalog, so it can suggest, place and warn.
	const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	const sameMake = $derived(patternStore.vehicles.filter((v) => typeOf(v) === "vehicle" && makeKey(v.make) === makeKey(subjectForm.make)));
	const modelSuggest = $derived(uniq(sameMake.map((v) => v.model)));
	const trimSuggest = $derived(uniq(sameMake.filter((v) => demandModelKey(v.make, v.model) === demandModelKey(subjectForm.make, subjectForm.model)).map((v) => v.trim)));
	const formIsVehicle = $derived(subjectForm.projectType === "vehicle");
	const formGens = $derived(
		subjectDlg && formIsVehicle && subjectForm.make.trim() && subjectForm.model.trim()
			? generationsFor(patternStore.media, subjectForm.make.trim(), subjectForm.model.trim(), subjectForm.trim.trim() || undefined)
			: [],
	);
	const formGen = $derived(generationOf(Number(subjectForm.year), formGens));
	const formDup = $derived(subjectDlg ? subjectDuplicate(subjectForm, patternStore.vehicles, subjectDlg.target?.id) : null);
	const formProblem = $derived(subjectDlg ? subjectFormError(subjectForm) : null);
	// Where this subject lands in the tree, as the library will show it.
	const formPath = $derived(
		formIsVehicle
			? [subjectForm.make.trim() || "Make", subjectForm.model.trim() || "Model", subjectForm.trim.trim() || "No trim",
				...(formGens.length ? [formGen?.label ?? "Uncategorized"] : []), String(subjectForm.year || "Year")]
			: [projectTypeMeta(subjectForm.projectType).label, subjectForm.propertyLabel.trim() || "Untitled"],
	);
	const formTags = $derived(parseTags(subjectForm.tags));
	let tagDraft = $state("");
	function addTags() {
		const next = parseTags([...formTags, ...tagDraft.split(",")].join(","));
		subjectForm.tags = next.join(", ");
		tagDraft = "";
	}
	function dropTag(t: string) { subjectForm.tags = formTags.filter((x) => x !== t).join(", "); }
	const STATUSES = [
		{ value: "draft", label: "Draft", note: "Hidden from customers" },
		{ value: "review", label: "In review", note: "Hidden while you check it" },
		{ value: "published", label: "Published", note: "Visible — “Coming soon” until it has a live pattern" },
	] as const;
	const BODY_STYLES = ["sedan", "coupe", "suv", "truck", "convertible", "wagon", "hatchback"] as const;
	const targetPatterns = $derived(subjectDlg?.target ? patternStore.getPatterns(subjectDlg.target.id).length : 0);

	// The two cards run from where they start to the bottom of the admin pane, so
	// there is no dead space under them and the lists get all the room there is.
	function fillPane(node: HTMLElement) {
		const scroller = (() => {
			for (let e = node.parentElement; e; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > 0) return e;
			return null;
		})();
		const fit = () => {
			if (window.matchMedia("(max-width: 960px)").matches) { node.style.height = ""; return; }
			const top = node.getBoundingClientRect().top;
			const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
			node.style.height = `${Math.max(480, Math.floor(bottom - top - 24))}px`;
		};
		fit();
		const ro = new ResizeObserver(fit);
		for (const el of [scroller, document.body, node.closest(".ap")]) if (el) ro.observe(el);
		window.addEventListener("resize", fit);
		const t = setTimeout(fit, 300); // after the header above settles
		return { destroy() { ro.disconnect(); window.removeEventListener("resize", fit); clearTimeout(t); } };
	}

	// ─── Generations (a model's years, grouped) ──
	let genDlg = $state<{ make: string; model: string; trim?: string; list: GenerationRow[] } | null>(null);
	const genProblem = $derived(genDlg ? generationError(genDlg.list.filter((g) => g.label.trim() || g.from || g.to)) : null);
	function openGenerations(make: string, model: string, trim?: string, suggest?: { from: number; to: number } | null) {
		const have = generationsFor(patternStore.media, make, model, trim);
		// Oldest first reads like a model's history; a fresh model starts with one blank row.
		const list: GenerationRow[] = have.map((g) => ({ ...g, orig: g.label })).sort((a, b) => a.from - b.from);
		// "Group into a generation" arrives with the leftover years' range filled in; only a name is missing.
		const fresh: GenerationRow = { label: "", from: suggest?.from ?? 0, to: suggest?.to ?? 0 };
		genDlg = { make, model, trim: trim || undefined, list: suggest ? [...list, fresh] : list.length ? list : [fresh] };
	}
	/** Remove one generation from a trim (its years go back to Uncategorized). Confirms first. */
	async function dropGeneration(make: string, model: string, trim: string | undefined, label: string) {
		const rows: GenerationRow[] = generationsFor(patternStore.media, make, model, trim).filter((g) => g.label !== label).map((g) => ({ ...g, orig: g.label }));
		await ap.saveGenerations(make, model, trim, rows);
	}
	async function submitGenerations() {
		if (!genDlg || genProblem) return;
		// Untouched blank rows aren't generations.
		const list = genDlg.list.filter((g) => g.label.trim() || g.from || g.to);
		if (await ap.saveGenerations(genDlg.make, genDlg.model, genDlg.trim, list)) genDlg = null;
	}

	// ─── A trim's uncategorized years ────────────
	const uncatLabel = (t: TrimGroup) => [t.make, t.model, t.trim, "uncategorized"].filter(Boolean).join(" ");
	function groupUncat(t: TrimGroup) {
		const gens = generationsFor(patternStore.media, t.make, t.model, t.trim);
		openGenerations(t.make, t.model, t.trim, uncategorizedSpan(t.loose.map((r) => r.v.year).filter((y): y is number => !!y), gens));
	}
	let statusDlg = $state<{ t: TrimGroup; status: VehicleEntry["status"] } | null>(null);
	async function submitStatus() {
		if (!statusDlg) return;
		if (await ap.setStatusFor(statusDlg.t.loose.map((r) => r.v), statusDlg.status, uncatLabel(statusDlg.t))) statusDlg = null;
	}

	// ─── Whole layers: make / model / trim ───────
	type StatusPick = "" | VehicleEntry["status"];
	let layerDlg = $state<{ ref: LayerRef; name: string; bodyStyle: "" | NonNullable<VehicleEntry["bodyStyle"]>; status: StatusPick } | null>(null);
	const layerOwn = (r: LayerRef) => (r.level === "make" ? r.make : r.level === "model" ? r.model : r.trim);
	const layerIsBase = $derived(!!layerDlg && layerDlg.ref.level === "trim" && layerDlg.ref.trim === "");
	const layerScope = $derived(layerDlg ? scopeOf(layerDlg.ref, patternStore.vehicles) : []);
	const layerPatterns = $derived(layerScope.reduce((n, v) => n + patternStore.getPatterns(v.id).length, 0));
	const layerPlanNow = $derived(
		layerDlg
			? planLayerEdit({
				ref: layerDlg.ref,
				name: !layerIsBase && layerDlg.name !== layerOwn(layerDlg.ref) ? layerDlg.name : undefined,
				bodyStyle: layerDlg.bodyStyle || undefined,
				status: layerDlg.status || undefined,
				vehicles: patternStore.vehicles, media: patternStore.media,
			})
			: null,
	);
	const layerCanSave = $derived(!!layerPlanNow && !layerPlanNow.error && (layerPlanNow.patches.length > 0 || layerPlanNow.moves.some((m) => m.from !== m.to)));
	const layerTitle = (r: LayerRef) => (r.level === "make" ? "make" : r.level === "model" ? "model" : r.trim ? "trim" : "base entries");
	function openLayerEdit(ref: LayerRef) {
		layerDlg = { ref, name: layerOwn(ref), bodyStyle: "", status: "" };
	}
	async function submitLayer() {
		if (!layerDlg || !layerCanSave) return;
		const { ref } = layerDlg;
		const name = !layerIsBase && layerDlg.name !== layerOwn(ref) ? layerDlg.name : undefined;
		if (await ap.editLayer(ref, { name, bodyStyle: layerDlg.bodyStyle || undefined, status: layerDlg.status || undefined })) layerDlg = null;
	}
	/** "+" on a layer: the bulk-add dialog, filled in down to that layer. */
	function addUnder(ref: LayerRef) {
		openBulk(
			ref.level === "make" ? { make: ref.make }
			: ref.level === "model" ? { make: ref.make, models: ref.model }
			: { make: ref.make, models: ref.model, trims: ref.trim },
		);
	}

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

<div class="cm" use:fillPane>
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
					<div class="mrow">
						<button class="row row--make" aria-expanded={isOpen(mk.key)} onclick={() => toggle(mk.key)}>
							<svg class="caret" class:caret--open={isOpen(mk.key)} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
							<span class="row__name">{mk.name}</span>
							<span class="row__sub">{mk.models.length} {mk.models.length === 1 ? "model" : "models"}</span>
							{#if mk.soon}<span class="subj__soon" title="{mk.soon} without a live pattern yet">{mk.soon} need</span>{/if}
							<span class="subj__count" title="{mk.live} live of {mk.total} patterns">{mk.live}/{mk.total}</span>
						</button>
						{@render layerBtns({ level: "make", make: mk.name }, mk.name)}
					</div>
					{#if isOpen(mk.key)}
						<ul class="sub">
							{#each mk.models as md (md.key)}
								<li>
									<div class="mrow">
										<button class="row row--model" aria-expanded={isOpen(md.key)} onclick={() => toggle(md.key)}>
											<svg class="caret" class:caret--open={isOpen(md.key)} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
											<span class="row__name">{md.name}</span>
											<span class="row__sub mono">{md.range}</span>
											{#if md.soon}<span class="subj__soon" title="{md.soon} without a live pattern yet — up to {md.want} want it">{md.soon} need</span>{/if}
											<span class="subj__count" title="{md.live} live of {md.total} patterns">{md.live}/{md.total}</span>
										</button>
										{#if !md.multi}{@render genButton(md.make, md.model, md.trims[0]?.trim, md.name)}{/if}
										{@render layerBtns({ level: "model", make: md.make, model: md.model }, md.name)}
									</div>
									{#if isOpen(md.key)}
										{#if md.multi}
											{#each md.trims as t (t.key)}
												<div class="mrow mrow--trim">
													<button class="row row--trim" aria-expanded={isOpen(t.key)} onclick={() => toggle(t.key)}>
														<svg class="caret" class:caret--open={isOpen(t.key)} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
														<span class="row__name">{t.name}</span>
														{#if t.soon}<span class="subj__soon" title="{t.soon} without a live pattern yet">{t.soon} need</span>{/if}
														<span class="subj__count" title="{t.live} live of {t.total} patterns">{t.live}/{t.total}</span>
													</button>
													{@render genButton(md.make, md.model, t.trim, t.name)}
													{@render layerBtns({ level: "trim", make: md.make, model: md.model, trim: t.trim ?? "" }, t.name)}
												</div>
												{#if isOpen(t.key)}{@render trimBody(t, 14)}{/if}
											{/each}
										{:else if md.trims[0]}
											{@render trimBody(md.trims[0], 0)}
										{/if}
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
							{projectTypeMeta(subject.projectType).label}{#if subjectGen} · {subjectGen.label} ({genSpan(subjectGen)}){/if}{#if subject.address} · {subject.address}{/if} · updated {fmtDate(subject.updatedAt)}
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
				{#if subjectGen}
					<div>
						<span class="meta__k">Generation</span>
						<span class="tag tag--gen">{subjectGen.label} <span class="mono">{genSpan(subjectGen)}</span></span>
						<button class="link" disabled={busy} onclick={() => openGenerations(subject.make ?? "", subject.model ?? "", subject.trim)}>Edit</button>
					</div>
				{/if}
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

{#snippet yearPills(list: Row[], indent: number)}
	<div class="years" style="padding-left: {indent}px">
		{#each list as { v, total, live, soon, want } (v.id)}
			<button class="yr" class:yr--on={selectedId === v.id} onclick={() => (selectedId = v.id)} title="{subjectName(v)} · {v.status} · {soon ? `${want} want it, no live pattern` : `${live} live of ${total}`}">
				<span class="dot dot--{v.status}"></span>{yearLabel(v)}{#if soon}<span class="yr__soon">•</span>{/if}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet layerBtns(ref: LayerRef, label: string)}
	<span class="lbtns">
		<button class="icon icon--sm" disabled={busy} onclick={() => openLayerEdit(ref)} aria-label="Edit {label}" title="Edit {label}">
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
		</button>
		<button class="icon icon--sm" disabled={busy} onclick={() => addUnder(ref)} aria-label="Add under {label}" title="Add models, trims or years under {label}">
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
		</button>
		<button class="icon icon--sm icon--danger" disabled={busy} onclick={() => ap.deleteLayer(ref)} aria-label="Delete {label}" title="Delete {label} and everything under it">
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
		</button>
	</span>
{/snippet}

{#snippet genButton(make: string, model: string, trim: string | undefined, name: string)}
	<button class="icon icon--sm" disabled={busy} onclick={() => openGenerations(make, model, trim)} aria-label="Group {name} years into generations" title="Group years into generations">
		<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M3 12h12M3 18h7"/></svg>
	</button>
{/snippet}

<!-- One trim's generations (each opens to its years), then the years in none. -->
{#snippet trimBody(t: TrimGroup, indent: number)}
	{#each t.groups as g (g.key)}
		<div class="mrow" style="margin-left: {indent}px">
			<button class="row row--gen" aria-expanded={isOpen(g.key)} onclick={() => toggle(g.key)}>
				<svg class="caret" class:caret--open={isOpen(g.key)} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
				<span class="row__name">{g.gen.label}</span>
				<span class="row__sub mono">{genSpan(g.gen)}</span>
				{#if g.soon}<span class="subj__soon" title="{g.soon} without a live pattern yet">{g.soon} need</span>{/if}
				<span class="subj__count" title="{g.live} live of {g.total} patterns">{g.live}/{g.total}</span>
			</button>
			<span class="lbtns">
				<button class="icon icon--sm" disabled={busy} onclick={() => openGenerations(t.make, t.model, t.trim)} aria-label="Edit generations" title="Edit generations">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
				</button>
				<button class="icon icon--sm icon--danger" disabled={busy} onclick={() => dropGeneration(t.make, t.model, t.trim, g.gen.label)} aria-label="Remove {g.gen.label}" title="Remove this generation (its years become Uncategorized)">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
				</button>
			</span>
		</div>
		{#if isOpen(g.key)}
			{@render yearPills(g.rows, 36 + indent)}
		{/if}
	{/each}
	{#if t.loose.length && t.groups.length}
		{@const uk = `${t.key}|u`}
		<div class="mrow" style="margin-left: {indent}px">
			<button class="row row--gen row--uncat" aria-expanded={isOpen(uk)} onclick={() => toggle(uk)}>
				<svg class="caret" class:caret--open={isOpen(uk)} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
				<span class="row__name">Uncategorized</span>
				<span class="row__sub mono">{t.loose.length} {t.loose.length === 1 ? "year" : "years"}</span>
				{#if t.uncat.soon}<span class="subj__soon" title="{t.uncat.soon} without a live pattern yet">{t.uncat.soon} need</span>{/if}
				<span class="subj__count" title="{t.uncat.live} live of {t.uncat.total} patterns">{t.uncat.live}/{t.uncat.total}</span>
			</button>
			<span class="lbtns">
				<button class="icon icon--sm" disabled={busy} onclick={() => groupUncat(t)} aria-label="Group these years into a generation" title="Group these years into a generation">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h12M3 18h7"/></svg>
				</button>
				<button class="icon icon--sm" disabled={busy} onclick={() => (statusDlg = { t, status: "published" })} aria-label="Set visibility for these years" title="Set visibility for these years">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
				</button>
				<button class="icon icon--sm icon--danger" disabled={busy} onclick={() => ap.deleteEntries(t.loose.map((r) => r.v), uncatLabel(t))} aria-label="Delete these {t.loose.length} years" title="Delete these {t.loose.length} years">
					<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
				</button>
			</span>
		</div>
		{#if isOpen(uk)}{@render yearPills(t.loose, 36 + indent)}{/if}
	{:else if t.loose.length}
		{@render yearPills(t.loose, 24 + indent)}
	{/if}
{/snippet}

<svelte:window onkeydown={(e) => { if (e.key === "Escape") { if (genDlg) genDlg = null; else if (statusDlg) statusDlg = null; else if (layerDlg) layerDlg = null; else if (bulkDlg) bulkDlg = false; } }} />
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

<!-- ─── Generations dialog ─── -->
{#if genDlg}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay overlay--top" onclick={() => (genDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg" role="dialog" aria-modal="true" aria-label="Generations" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="dlg__title">Generations <span class="muted">· {[genDlg.make, genDlg.model, genDlg.trim].filter(Boolean).join(" ")}</span></h2>
			<div class="dlg__body">
				<p class="muted bulk__intro">Group {genDlg.trim ? `the ${genDlg.trim} trim's` : "this model's base (no trim)"} years by generation. Each trim has its own set. The catalog and the customer library show each generation instead of its individual years, including years added later. A year in no generation stays on its own.</p>
				<div class="gens">
					{#each genDlg.list as g, i (i)}
						<div class="gen">
							<input class="in" bind:value={g.label} placeholder="e.g. Gen 3" aria-label="Generation name" />
							<input class="in" type="number" bind:value={g.from} placeholder="From" aria-label="First year" />
							<input class="in" type="number" bind:value={g.to} placeholder="To" aria-label="Last year" />
							<button class="icon" onclick={() => genDlg && (genDlg.list = genDlg.list.filter((_, j) => j !== i))} aria-label="Remove generation" title="Remove">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
							</button>
						</div>
					{/each}
				</div>
				<div><button class="btn btn--sm" onclick={() => genDlg && (genDlg.list = [...genDlg.list, { label: "", from: 0, to: 0 }])}>+ Add generation</button></div>
				<p class="warn gen__err">{genProblem ?? ""}</p>
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (genDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy || !!genProblem} onclick={submitGenerations}>{#if busy}<Spinner />{/if}Save generations</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Visibility for a trim's uncategorized years ─── -->
{#if statusDlg}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (statusDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg" role="dialog" aria-modal="true" aria-label="Set visibility" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sd__head">
				<h2 class="dlg__title">Set visibility</h2>
				<p class="sd__sub">{[statusDlg.t.make, statusDlg.t.model, statusDlg.t.trim].filter(Boolean).join(" ")} · {statusDlg.t.loose.length} uncategorized {statusDlg.t.loose.length === 1 ? "year" : "years"}</p>
			</div>
			<div class="dlg__body sd">
				<div class="seg seg--stack" role="radiogroup" aria-label="Status">
					{#each STATUSES as st (st.value)}
						<button type="button" class="seg__btn seg__btn--col" class:seg__btn--on={statusDlg.status === st.value} role="radio" aria-checked={statusDlg.status === st.value} onclick={() => statusDlg && (statusDlg.status = st.value)}>
							<span class="dot dot--{st.value}"></span>
							<span><b>{st.label}</b><small>{st.note}</small></span>
						</button>
					{/each}
				</div>
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (statusDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy} onclick={submitStatus}>{#if busy}<Spinner />{/if}Review changes</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Layer dialog (make / model / trim) ─── -->
{#if layerDlg}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (layerDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg" role="dialog" aria-modal="true" aria-label="Edit {layerTitle(layerDlg.ref)}" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sd__head">
				<h2 class="dlg__title">Edit {layerTitle(layerDlg.ref)}</h2>
				<p class="sd__sub">{[layerDlg.ref.make, layerDlg.ref.level !== "make" ? layerDlg.ref.model : "", layerDlg.ref.level === "trim" ? (layerDlg.ref.trim || "No trim") : ""].filter(Boolean).join(" › ")} · {layerScope.length} {layerScope.length === 1 ? "subject" : "subjects"} · {layerPatterns} {layerPatterns === 1 ? "pattern" : "patterns"}</p>
			</div>
			<div class="dlg__body sd">
				{#if !layerIsBase}
					<label class="fld"><span>Name <em>renames it on every year under it</em></span><input class="in" bind:value={layerDlg.name} use:focusOnMount /></label>
				{:else}
					<p class="muted bulk__intro">These are the entries with no trim, so there's no name to change. Use <b>+</b> to add a named trim, or set the options below.</p>
				{/if}
				{#if layerDlg.ref.level === "model"}
					<label class="fld"><span>Body style <em>applies to every year</em></span>
						<select class="in" bind:value={layerDlg.bodyStyle}>
							<option value="">Keep each as it is</option>
							{#each BODY_STYLES as b}<option value={b}>{b[0].toUpperCase() + b.slice(1)}</option>{/each}
						</select>
					</label>
				{/if}
				<div class="fld">
					<span>Visibility <em>for all {layerScope.length} {layerScope.length === 1 ? "subject" : "subjects"}</em></span>
					<div class="seg" role="radiogroup" aria-label="Visibility">
						{#each [{ value: "", label: "Keep" }, ...STATUSES] as st (st.value)}
							<button type="button" class="seg__btn" class:seg__btn--on={layerDlg.status === st.value} role="radio" aria-checked={layerDlg.status === st.value} onclick={() => layerDlg && (layerDlg.status = st.value as StatusPick)}>{st.label}</button>
						{/each}
					</div>
				</div>
				{#if layerPlanNow?.error}
					<p class="warn">{layerPlanNow.error}</p>
				{:else if layerCanSave && layerPlanNow}
					<p class="muted bulk__intro">
						Updates <b>{layerPlanNow.patches.length}</b> {layerPlanNow.patches.length === 1 ? "subject" : "subjects"}{#if layerPlanNow.moves.some((m) => m.from !== m.to)}, and moves <b>{layerPlanNow.moves.filter((m) => m.from !== m.to).length}</b> image / generation {layerPlanNow.moves.filter((m) => m.from !== m.to).length === 1 ? "record" : "records"} with it{/if}. You'll confirm before anything is saved.
					</p>
				{/if}
			</div>
			<div class="dlg__foot">
				<button class="btn" onclick={() => (layerDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy || !layerCanSave} onclick={submitLayer}>{#if busy}<Spinner />{/if}Review changes</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Subject dialog ─── -->
{#if subjectDlg}
	{@const editing = !!subjectDlg.target}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (subjectDlg = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="dlg dlg--subject" role="dialog" aria-modal="true" aria-label={editing ? "Edit subject" : "Add subject"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sd__head">
				<h2 class="dlg__title">{editing ? "Edit subject" : "Add subject"}</h2>
				{#if editing && subjectDlg.target}
					<p class="sd__sub">{subjectName(subjectDlg.target)} · {targetPatterns} {targetPatterns === 1 ? "pattern" : "patterns"} attached</p>
				{:else}
					<p class="sd__sub">One vehicle model year, or a residential, commercial or custom project. To add many years or models at once, use <b>Add vehicles</b>.</p>
				{/if}
			</div>

			<div class="dlg__body sd">
				{#if !editing}
					<div class="seg" role="radiogroup" aria-label="Type">
						{#each PROJECT_TYPES as t (t.value)}
							<button type="button" class="seg__btn" class:seg__btn--on={subjectForm.projectType === t.value} role="radio" aria-checked={subjectForm.projectType === t.value} onclick={() => (subjectForm.projectType = t.value)}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={t.icon}/></svg>
								{t.label}
							</button>
						{/each}
					</div>
				{/if}

				{#if formIsVehicle}
					<section class="sd__sec">
						<h3 class="sd__h">Vehicle</h3>
						<div class="grid2">
							<label class="fld"><span>Make</span><input class="in" bind:value={subjectForm.make} list="sd-makes" autocomplete="off" use:focusOnMount placeholder="e.g. Toyota" /></label>
							<label class="fld"><span>Model</span><input class="in" bind:value={subjectForm.model} list="sd-models" autocomplete="off" placeholder="e.g. Camry" /></label>
							<label class="fld"><span>Trim <em>optional — blank is the base / all trims</em></span><input class="in" bind:value={subjectForm.trim} list="sd-trims" autocomplete="off" placeholder="e.g. SE" /></label>
							<label class="fld"><span>Model year</span><input class="in" type="number" bind:value={subjectForm.year} min="1950" /></label>
							<label class="fld fld--wide"><span>Body style</span>
								<select class="in" bind:value={subjectForm.bodyStyle}>{#each BODY_STYLES as b}<option value={b}>{b[0].toUpperCase() + b.slice(1)}</option>{/each}</select>
							</label>
						</div>
						<datalist id="sd-makes">{#each bulkMakes as m}<option value={m}></option>{/each}</datalist>
						<datalist id="sd-models">{#each modelSuggest as m}<option value={m}></option>{/each}</datalist>
						<datalist id="sd-trims">{#each trimSuggest as t}<option value={t}></option>{/each}</datalist>
					</section>
				{:else}
					<section class="sd__sec">
						<h3 class="sd__h">{subjectForm.projectType === "custom" ? "Project" : "Property"}</h3>
						<label class="fld"><span>{subjectForm.projectType === "custom" ? "Project name" : "Property label"}</span><input class="in" bind:value={subjectForm.propertyLabel} use:focusOnMount placeholder={subjectForm.projectType === "custom" ? "e.g. Boat windows" : "e.g. Smith Residence"} /></label>
						<label class="fld"><span>Address <em>optional</em></span><input class="in" bind:value={subjectForm.address} /></label>
					</section>
				{/if}

				<div class="where" class:where--bad={!!formDup}>
					<div class="where__k">Lands in the library at</div>
					<div class="where__path">
						{#each formPath as part, i}{#if i}<span class="where__sep" aria-hidden="true">›</span>{/if}<span class="where__part" class:where__part--dim={part === "No trim" || part === "Uncategorized"}>{part}</span>{/each}
					</div>
					{#if formDup}
						<p class="where__note where__note--bad">Already in the catalog as {subjectName(formDup)} ({formDup.status}). Edit that one instead.</p>
					{:else if formIsVehicle && subjectForm.make.trim() && subjectForm.model.trim()}
						<p class="where__note">
							{#if formGen}In <b>{formGen.label}</b> ({genSpan(formGen)}) for {subjectForm.trim.trim() || "the base"} entries.
							{:else if formGens.length}Not in any generation of {subjectForm.trim.trim() || "the base"} entries, so it sits under <b>Uncategorized</b>.
							{:else}No generations set for {subjectForm.trim.trim() || "the base"} entries yet — years show individually.{/if}
							<button type="button" class="link" onclick={() => openGenerations(subjectForm.make.trim(), subjectForm.model.trim(), subjectForm.trim.trim() || undefined)}>{formGens.length ? "Edit generations" : "Set up generations"}</button>
						</p>
					{/if}
				</div>

				<section class="sd__sec">
					<h3 class="sd__h">Visibility</h3>
					<div class="seg seg--stack" role="radiogroup" aria-label="Status">
						{#each STATUSES as st (st.value)}
							<button type="button" class="seg__btn seg__btn--col" class:seg__btn--on={subjectForm.status === st.value} role="radio" aria-checked={subjectForm.status === st.value} onclick={() => (subjectForm.status = st.value)}>
								<span class="dot dot--{st.value}"></span>
								<span><b>{st.label}</b><small>{st.note}</small></span>
							</button>
						{/each}
					</div>
					<label class="check"><input type="checkbox" bind:checked={subjectForm.popular} /> <span>Mark as popular <em class="muted">— featured in the library</em></span></label>
					<div class="fld">
						<span>Tags <em>press Enter or comma to add</em></span>
						<div class="chips">
							{#each formTags as t (t)}
								<span class="chip2">{t}<button type="button" onclick={() => dropTag(t)} aria-label="Remove tag {t}">×</button></span>
							{/each}
							<input class="chips__in" bind:value={tagDraft} placeholder={formTags.length ? "" : "e.g. advertised"} onkeydown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTags(); } else if (e.key === "Backspace" && !tagDraft && formTags.length) dropTag(formTags[formTags.length - 1]); }} onblur={() => tagDraft.trim() && addTags()} />
						</div>
					</div>
				</section>
			</div>

			<div class="dlg__foot">
				{#if formProblem && (subjectForm.make || subjectForm.propertyLabel || subjectForm.model)}<span class="sd__warn">{formProblem}</span>{/if}
				<button class="btn" onclick={() => (subjectDlg = null)}>Cancel</button>
				<button class="btn btn--primary" disabled={busy || !!formProblem || !!formDup} onclick={submitSubject}>{#if busy}<Spinner />{/if}{editing ? "Save changes" : "Add subject"}</button>
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
	.cm { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 16px; align-items: stretch; }
	.muted { color: var(--text-tertiary); }
	.mono { font-family: var(--font-mono); }
	.n { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.link { background: none; border: none; padding: 0; font: inherit; color: var(--text-brand, var(--color-brand)); cursor: pointer; }
	.link:hover { text-decoration: underline; }

	/* ── list ── */
	.cm__list { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
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
	.subjects { list-style: none; margin: 0; padding: 6px; overflow-y: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 1px; }
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
	.mrow { display: flex; align-items: center; gap: 4px; }
	.mrow .row { flex: 1; min-width: 0; width: auto; }
	.row--gen { padding-left: 22px; }
	.row--uncat .row__name { font-style: italic; font-weight: 500; color: var(--text-secondary); }
	.mrow--trim { margin-left: 10px; }
	.lbtns { display: inline-flex; gap: 2px; flex-shrink: 0; opacity: 0.35; transition: opacity 0.12s; }
	.mrow:hover .lbtns, .mrow:focus-within .lbtns { opacity: 1; }
	@media (hover: none) { .lbtns { opacity: 0.8; } }
	.row--trim .row__name { font-weight: 500; }
	.row--gen .row__name { font-size: 0.9375rem; font-weight: 600; }
	.row--gen .row__sub { margin-right: 6px; font-size: 0.8125rem; }
	.icon--sm { width: 22px; height: 22px; flex-shrink: 0; }
	.gens { display: flex; flex-direction: column; gap: 8px; }
	.gen { display: grid; grid-template-columns: minmax(0, 1fr) 84px 84px 26px; gap: 6px; align-items: center; }
	.gen__err { min-height: 1.2em; }
	.yr { display: inline-flex; align-items: center; gap: 7px; padding: 5px 13px; font-family: var(--font-mono); font-size: 0.9375rem; font-weight: 500; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.yr:hover { color: var(--text-primary); }
	.yr--on { color: var(--text-primary); border-color: var(--color-brand-dim); background: color-mix(in srgb, var(--color-brand) 12%, transparent); }
	.yr .dot { width: 8px; height: 8px; }
	.yr__soon { color: var(--color-warning); }
	.subj__count { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
	.dot--published { background: var(--color-success); }
	.dot--review { background: var(--color-warning); }
	.cm__foot { padding: 8px 12px; border-top: 1px solid var(--border-subtle); font-size: 0.6875rem; color: var(--text-tertiary); }

	/* ── subject ── */
	.cm__main { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 12px; }
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
	.tag--gen { font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); }
	.tag--gen .mono { margin-left: 6px; font-weight: 500; color: var(--text-tertiary); }
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
	.overlay--top { z-index: 210; }
	.overlay { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.55); }
	.dlg { width: 480px; max-width: 100%; max-height: calc(100dvh - 40px); display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-xl); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); }
	.dlg--wide { width: 860px; }
	.dlg--subject { width: 620px; }
	.sd__head { padding-bottom: 4px; }
	.sd__head .dlg__title { padding-bottom: 2px; }
	.sd__sub { margin: 0; padding: 0 20px; font-size: 0.8125rem; color: var(--text-tertiary); }
	.sd { gap: 16px; padding-top: 12px; }
	.sd__sec { display: flex; flex-direction: column; gap: 10px; }
	.sd__h { margin: 0; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); }
	.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 3px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.seg--stack { grid-auto-flow: row; padding: 0; gap: 6px; background: none; border: none; }
	.seg__btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 10px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: none; border: 1px solid transparent; border-radius: var(--radius-sm, 6px); cursor: pointer; }
	.seg__btn:hover { color: var(--text-primary); }
	.seg__btn--on { color: var(--text-primary); background: var(--bg-surface); border-color: var(--color-brand-dim); }
	.seg__btn--col { justify-content: flex-start; text-align: left; padding: 9px 12px; background: var(--bg-base); border-color: var(--border-default); }
	.seg__btn--col small { display: block; margin-top: 1px; font-size: 0.75rem; font-weight: 400; color: var(--text-tertiary); }
	.seg__btn--col b { font-weight: 600; }
	.where { padding: 12px 14px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.where--bad { border-color: color-mix(in srgb, var(--color-danger) 50%, transparent); }
	.where__k { font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
	.where__path { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 4px; font-size: 0.9375rem; font-weight: 600; }
	.where__sep { color: var(--text-tertiary); font-weight: 400; }
	.where__part--dim { font-weight: 500; font-style: italic; color: var(--text-tertiary); }
	.where__note { margin: 8px 0 0; font-size: 0.8125rem; color: var(--text-secondary); }
	.where__note--bad { color: var(--color-danger); }
	.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
	.chips:focus-within { border-color: var(--color-brand-dim); }
	.chips__in { flex: 1; min-width: 100px; padding: 3px 0; font: inherit; font-size: 0.8125rem; color: var(--text-primary); background: none; border: none; outline: none; }
	.chip2 { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-surface-3); border-radius: 99px; }
	.chip2 button { width: 18px; height: 18px; padding: 0; font: inherit; line-height: 1; color: var(--text-tertiary); background: none; border: none; border-radius: 50%; cursor: pointer; }
	.chip2 button:hover { color: var(--text-primary); background: var(--bg-surface-2); }
	.sd__warn { margin-right: auto; align-self: center; font-size: 0.8125rem; color: var(--color-danger); }
	.dlg__title { margin: 0; padding: 18px 20px 8px; font-size: 1.0625rem; }
	.dlg__body { padding: 8px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
	.dlg__body--split { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 18px; }
	.dlg__form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
	.dlg__prev { align-self: start; position: sticky; top: 0; padding: 10px; display: grid; place-items: center; min-height: 160px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.dlg__foot { padding: 12px 20px 16px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-subtle); }

	@media (max-width: 960px) {
		.cm { grid-template-columns: minmax(0, 1fr); }
		.cm { height: auto !important; }
		.cm__list { max-height: 380px; }
		.cm__main { overflow: visible; padding-right: 0; }
		.dlg__body--split { grid-template-columns: minmax(0, 1fr); }
		.dlg__prev { position: static; }
	}
	@media (max-width: 520px) {
		.grid2 { grid-template-columns: minmax(0, 1fr); }
	}
</style>
