<script lang="ts">
	import Spinner from "$lib/components/ui/Spinner.svelte";
	import { toastStore, canvasStore, userStore, confirmStore } from "$lib/stores";
	import {
		patternStore, TINT_ZONE_GROUP, PPF_ZONE_GROUP, MIRROR_PAIRS, PATTERN_CATEGORIES,
		zoneLabel, categoryShortLabel, categoryLabel, categoryMeta,
	} from "$lib/stores/patternStore.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { uid, getItemColor, formatMeasure } from "$lib/utils";
	import { bestNest } from "$lib/utils/nesting";
	import { getUserPatterns, updateUserPattern, deleteUserPattern, addPatternAdjustmentRequest, type VoteTarget } from "$lib/firebase/firestore";
	import { tooltip } from "$lib/actions/tooltip";
	import type { CanvasItem, Pattern, PatternCategory, PatternZone, ProjectType, UserPattern } from "$lib/types";
	import { fitPattern } from "$lib/actions/fitPattern";
	import { sizeError } from "$lib/utils/patternSize";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";
	import VehicleTile from "$lib/components/library/VehicleTile.svelte";
	import VehicleHero from "$lib/components/library/VehicleHero.svelte";
	import ComingSoon from "$lib/components/library/ComingSoon.svelte";
	import VoteSummary from "$lib/components/library/VoteSummary.svelte";
	import VehicleTreeFilter, { type TreePath } from "$lib/components/library/VehicleTreeFilter.svelte";
	import {
		buildTree, entriesUnder, mediaFor, yearSpan, trimFilter, matchesQuery,
		yearOptions, generationOf, groupByGeneration, vehicleImage,
		BASE_TRIM_LABEL, TRIM_BASE, TRIM_ALL, makeKey, modelKey,
	} from "$lib/utils/vehicleCatalog";
	import { demandId, hasVoted } from "$lib/utils/demand";
	import {
		communityRows, comingSoonRows, privateRows, rowsForSource, uniquePatterns, distinctCount, patternKey, shareStatusOf, userPatternToPattern,
		type LibPattern, type LibRow, type LibrarySource, type ShareStatus,
	} from "$lib/utils/libraryRows";

	// ─── Subject types ────────────────────────────
	const PROJECT_TYPES: { value: ProjectType; label: string; noun: string; nounPlural: string }[] = [
		{ value: "vehicle",     label: "Vehicle",     noun: "vehicle",  nounPlural: "vehicles" },
		{ value: "residential", label: "Residential", noun: "property", nounPlural: "properties" },
		{ value: "commercial",  label: "Commercial",  noun: "property", nounPlural: "properties" },
		{ value: "custom",      label: "Custom",      noun: "project",  nounPlural: "projects" },
	];
	const typeMeta = (t: ProjectType) => PROJECT_TYPES.find((p) => p.value === t) ?? PROJECT_TYPES[0];
	const typeOf = (v: { projectType?: ProjectType }): ProjectType => v.projectType ?? "vehicle";

	function subjectName(v: VehicleEntry): string {
		if (typeOf(v) !== "vehicle") return v.propertyLabel || v.model || v.address || "Untitled";
		return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
	}

	// ─── Source: community, private, or both ──────
	// ?source=all|community|private. Older links used ?tab=mine → private.
	const SOURCES: { value: LibrarySource; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "community", label: "Community" },
		{ value: "private", label: "Private" },
	];
	function sourceFromUrl(): LibrarySource {
		const q = page.url.searchParams;
		const s = q.get("source");
		if (s === "all" || s === "community" || s === "private") return s;
		return q.get("tab") === "mine" ? "private" : "all";
	}
	let source = $state<LibrarySource>(sourceFromUrl());

	// ─── State ────────────────────────────────────
	// ?type= deep-links to a subject type (the dashboard's community counts use it).
	const urlType = page.url.searchParams.get("type");
	let projectType    = $state<ProjectType>(
		urlType === "residential" || urlType === "commercial" || urlType === "custom" ? urlType : "vehicle",
	);
	let category       = $state<PatternCategory>("ppf");
	let search         = $state("");
	let activeYear     = $state("All");
	let activeZone     = $state("All zones");
	// Where a private pattern stands (not shared / in review / in community / not approved).
	let shareFilter    = $state<"all" | ShareStatus>("all");
	// Non-vehicle subjects (property / custom) still open one subject at a time.
	// Vehicles drill down by URL instead — see `path` below.
	let selectedVehicle = $state<VehicleEntry | null>(null);
	let browseOpen     = $state(false);
	let filtersOpen    = $state(false);

	// ─── Vehicle drill-down: ?make=&model=&trim= ──
	// In the URL so Back, deep links and breadcrumbs all work. Values are the
	// grouping keys from vehicleCatalog; trim is TRIM_BASE / TRIM_ALL / a trim key.
	const path = $derived.by<TreePath>(() => {
		const q = page.url.searchParams;
		const make = q.get("make") || undefined;
		const model = make ? q.get("model") || undefined : undefined;
		const trim = model ? q.get("trim") || undefined : undefined;
		return { make, model, trim };
	});
	function go(p: TreePath) {
		const url = new URL(page.url);
		for (const k of ["make", "model", "trim"] as const) {
			const val = p[k];
			if (val) url.searchParams.set(k, val); else url.searchParams.delete(k);
		}
		search = "";
		browseOpen = false;
		goto(url, { noScroll: true, keepFocus: true });
	}
	// Any move (including browser Back) starts the new level with a clean slate.
	$effect(() => {
		void `${path.make}/${path.model}/${path.trim}`;
		activeZone = "All zones";
		selectedPatternIds = new Set();
	});
	let view           = $state<"grid" | "list">("grid");
	let selectedPatternIds = $state<Set<string>>(new Set());

	// ─── The user's own uploads ───────────────────
	let myPatterns       = $state<UserPattern[]>([]);
	let myPatternsLoading = $state(false);
	let myPatternsError  = $state("");

	// Reactive on userStore.user so patterns load once auth resolves,
	// even if it resolves after this component mounts.
	let loadedForUid = $state<string | null>(null);
	function loadMyPatterns(uidToLoad: string) {
		myPatternsLoading = true;
		myPatternsError = "";
		getUserPatterns(uidToLoad)
			.then((patterns) => { myPatterns = patterns; })
			.catch(() => { myPatternsError = "Could not load your private patterns."; })
			.finally(() => { myPatternsLoading = false; });
	}
	$effect(() => { patternStore.watchVotes(userStore.user?.uid ?? null); });
	$effect(() => {
		const id = userStore.user?.uid;
		if (!id || id === loadedForUid) return;
		loadedForUid = id;
		loadMyPatterns(id);
	});

	const STATUS_LABEL: Record<ShareStatus, string> = {
		unshared: "Not shared", pending: "In review", published: "In community", rejected: "Not approved",
	};
	const STATUS_VARIANT: Record<ShareStatus, "default" | "warning" | "success" | "danger"> = {
		unshared: "default", pending: "warning", published: "success", rejected: "danger",
	};

	// ─── What this account can see ────────────────
	// ONE list of { subject, patterns } rows, each pattern tagged community or
	// private. Every count, filter option and list below derives from `visible`,
	// so a number can never promise a pattern that isn't actually shown.
	const communityAll = $derived(
		communityRows(patternStore.vehicles, (id) => patternStore.getPatterns(id, undefined, true)),
	);
	// Subjects an admin has listed ahead of their patterns. They show as "coming soon"
	// (vehicles only) until the first pattern is published; no pattern count includes them.
	let hideSoon = $state(false);
	const soonAll = $derived(source === "private" ? [] : comingSoonRows(patternStore.vehicles, (id) => patternStore.getPatterns(id, undefined, true)));
	const privateAll = $derived(privateRows(myPatterns));
	const sourceRows = $derived(rowsForSource(source, communityAll, privateAll));
	const sourceCounts = $derived({
		all: distinctCount(rowsForSource("all", communityAll, privateAll)),
		community: distinctCount(communityAll),
		private: distinctCount(privateAll),
	});

	const statusOf = (p: LibPattern): ShareStatus => (p.up ? shareStatusOf(p.up) : "published");
	const statusCounts = $derived(
		myPatterns.reduce((acc, p) => { const s = shareStatusOf(p); acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<string, number>),
	);
	const statusKinds = $derived((["unshared", "pending", "published", "rejected"] as const).filter((s) => statusCounts[s]));
	const showStatus = $derived(source !== "community" && myPatterns.length > 0 && statusKinds.length > 1);

	const visible = $derived<LibRow[]>(
		source === "community" || shareFilter === "all"
			? sourceRows
			: sourceRows
				.map((r) => ({ v: r.v, pats: r.pats.filter((p) => p.source === "community" || statusOf(p) === shareFilter) }))
				.filter((r) => r.pats.length > 0),
	);

	const typeCounts = $derived(
		Object.fromEntries(PROJECT_TYPES.map((t) => [t.value, distinctCount(visible.filter((x) => typeOf(x.v) === t.value))])) as Record<string, number>,
	);

	// Categories that actually have patterns for the chosen subject type.
	const categoriesForType = $derived.by(() => {
		const inType = uniquePatterns(visible.filter((x) => typeOf(x.v) === projectType).flatMap((x) => x.pats));
		return PATTERN_CATEGORIES
			.map((c) => ({ ...c, count: inType.filter((p) => p.category === c.value).length }))
			.filter((c) => c.count > 0);
	});

	// Keep the category valid for the type (a residential catalog may only have tint).
	$effect(() => {
		if (categoriesForType.length && !categoriesForType.some((c) => c.value === category)) {
			category = categoriesForType[0].value;
		}
	});

	// Subjects of the chosen type with their patterns in the chosen category.
	const inScope = $derived(
		visible
			.filter((x) => typeOf(x.v) === projectType)
			.map((x) => ({ v: x.v, pats: x.pats.filter((p) => p.category === category) }))
			.filter((x) => x.pats.length > 0)
			.concat(projectType === "vehicle" && !hideSoon ? soonAll : []),
	);

	// ─── Zone groups ──────────────────────────────
	// Vehicle PPF/tint zones roll up into familiar groups ("Doors", "Side
	// Windows"); everything else groups by its own zone name. A private upload
	// can cover several zones with one outline, so a pattern has several groups.
	const ZONE_GROUP_ORDER: Record<string, string[]> = {
		ppf: ["Hood", "Fenders", "Bumpers", "Doors", "Mirrors", "Rocker Panels", "Roof", "Trunk"],
		"window-tint": ["Windshield", "Side Windows", "Rear Window", "Sunroof", "Quarter / Vent"],
	};
	function groupOfZone(zone: PatternZone, cat: PatternCategory, t: ProjectType, customLabel?: string): string {
		if (t === "vehicle") {
			const map: Partial<Record<PatternZone, string>> = cat === "ppf" ? PPF_ZONE_GROUP : cat === "window-tint" ? TINT_ZONE_GROUP : {};
			const g = map[zone];
			if (g) return g;
		}
		return zoneLabel(zone, cat, t, customLabel);
	}
	function zoneGroups(p: LibPattern, t: ProjectType = p.projectType ?? projectType): string[] {
		if (p.zones?.length) {
			return [...new Set(p.zones.map((z, i) => groupOfZone(z, p.category, t, p.customZoneLabels?.[i])))];
		}
		return [groupOfZone(p.zone, p.category, t, p.customZoneLabel)];
	}
	const inZone = (p: LibPattern) => activeZone === "All zones" || zoneGroups(p).includes(activeZone);

	// ─── Vehicle catalog (make → model → trim) ────
	const isVeh = $derived(projectType === "vehicle");
	const vehScope = $derived(inScope.filter((x) => typeOf(x.v) === "vehicle" && x.v.make && x.v.model));
	const toRow = (x: { v: VehicleEntry; pats: LibPattern[] }) => ({ v: x.v, count: x.pats.length, ids: x.pats.map(patternKey) });
	// Unfiltered tree — names, logos and year options come from here, so a
	// search or year filter can never make the current breadcrumb lose its label.
	const catalogTree = $derived(buildTree(vehScope.map(toRow)));
	const trimArg = $derived(trimFilter(path.trim));
	const pathEntries = $derived(entriesUnder(vehScope, { make: path.make, model: path.model, trim: trimArg }));

	// Year filter. Once a model is chosen its years fold into the generations an
	// admin set for it (a generation is one button; years in none stay single).
	// activeYear is an option key: "All", a year, or "g:<generation>".
	const modelGens = $derived.by(() => {
		const e = path.model ? pathEntries[0]?.v : undefined;
		return e?.make && e.model ? mediaFor(patternStore.media, e.make, e.model)?.generations ?? [] : [];
	});
	const yearOpts = $derived(yearOptions(pathEntries, modelGens));
	const YEARS = $derived(["All", ...yearOpts.map((o) => o.key)]);
	const yearSel = $derived(yearOpts.find((o) => o.key === activeYear));
	// A year that isn't in the current branch resets it.
	$effect(() => {
		if (!YEARS.includes(activeYear)) activeYear = "All";
	});
	$effect(() => {
		if (!ZONES.includes(activeZone)) activeZone = "All zones";
	});

	// ─── Subjects shown ───────────────────────────
	// Everything except the zone filter — zone counts are taken from here so a
	// pill's number is exactly what clicking it will show. Search matches the
	// subject AND its pattern names, the same for both sources.
	const baseFiltered = $derived(
		inScope.filter((x) => {
			const v = x.v;
			const q = search.trim().toLowerCase();
			const matchSearch = !q || matchesQuery(`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.trim ?? ""} ${v.bodyStyle ?? ""} ${v.propertyLabel ?? ""} ${v.address ?? ""} ${x.pats.map((p) => `${p.name} ${zoneGroups(p).join(" ")}`).join(" ")}`, q);
			const matchYear = typeOf(v) !== "vehicle" || activeYear === "All" || (!!yearSel && !!v.year && v.year >= yearSel.from && v.year <= yearSel.to);
			return matchSearch && matchYear;
		}),
	);

	// Tree the tiles and sidebar render: search + year applied, zone not (zone
	// is a pattern-level filter, offered once a trim's patterns are showing).
	const vehBase = $derived(baseFiltered.filter((x) => typeOf(x.v) === "vehicle" && x.v.make && x.v.model));
	// Makes and models with patterns first; coming-soon ones after, each group A–Z.
	const tree = $derived(
		buildTree(vehBase.map(toRow))
			.map((m) => ({ ...m, models: [...m.models].sort((a, b) => Number(a.count === 0) - Number(b.count === 0)) }))
			.sort((a, b) => Number(a.count === 0) - Number(b.count === 0)),
	);
	const treeTotal = $derived(tree.reduce((n, m) => n + m.count, 0));

	const makeNode = $derived(path.make ? tree.find((m) => m.key === path.make) : undefined);
	const modelNode = $derived(path.model ? makeNode?.models.find((o) => o.key === path.model) : undefined);
	const makeLabel = $derived(catalogTree.find((m) => m.key === path.make)?.label ?? "");
	const modelLabel = $derived(catalogTree.find((m) => m.key === path.make)?.models.find((o) => o.key === path.model)?.label ?? "");
	// A model with a single trim skips the trim level and opens its patterns.
	const effTrim = $derived.by(() => {
		if (!path.model) return undefined;
		if (path.trim) return path.trim;
		const only = catalogTree.find((m) => m.key === path.make)?.models.find((o) => o.key === path.model)?.trims;
		return only?.length === 1 ? (only[0].key === "" ? TRIM_BASE : only[0].key) : undefined;
	});
	// The trim being shown: the chosen one, or the model's only one. A model with a
	// single trim skips the trim level, so this is what keeps "Crew Cab" visible in
	// the breadcrumb and title instead of vanishing.
	const trimLabel = $derived.by(() => {
		const t = effTrim;
		if (!t || t === TRIM_ALL) return "";
		if (t === TRIM_BASE) return BASE_TRIM_LABEL;
		return catalogTree.find((m) => m.key === path.make)?.models.find((o) => o.key === path.model)?.trims.find((x) => x.key === t)?.label ?? "";
	});
	type Level = "makes" | "models" | "trims" | "patterns";
	const level = $derived<Level>(!path.make ? "makes" : !path.model ? "models" : effTrim === undefined ? "trims" : "patterns");

	const mediaOf = (make: string, model?: string, trim?: string) => mediaFor(patternStore.media, make, model, trim);
	const logoFor = (makeLabel: string) => mediaOf(makeLabel)?.logoUrl;
	// A model's picture: the year's, else its generation's (when the Year filter or a
	// generation is chosen), else the trim's, else the model's.
	const imageOf = (make: string, model: string, trim?: string, scoped = false) => {
		const sel = scoped ? yearSel : undefined;
		return vehicleImage(patternStore.media, make, model, {
			trim,
			...(sel ? (sel.isGen ? { generation: sel.label } : { year: sel.from }) : {}),
		});
	};

	// Flat matches while searching from the top: every model across makes.
	const searching = $derived(isVeh && search.trim() !== "" && !path.make);
	const searchHits = $derived(tree.flatMap((m) => m.models.map((o) => ({ m, o }))));

	// Example queries drawn from the catalog itself, so the placeholder shows
	// real makes, models, trims and years that will find something.
	const searchExamples = $derived.by<string[]>(() => {
		if (!isVeh) {
			const names = inScope.map((x) => subjectName(x.v)).filter((n) => n && n !== "Untitled");
			return [...new Set([...names.slice(0, 4), "Storefront glass", "Lobby windows", "Skylight"])].slice(0, 6);
		}
		const out: string[] = [];
		const makes = catalogTree.length > 6 ? catalogTree.filter((_, i) => i % Math.ceil(catalogTree.length / 6) === 0) : catalogTree;
		for (const m of makes.slice(0, 6)) {
			const o = m.models[0];
			if (!o) continue;
			out.push(`${m.label} ${o.label}`);
			const trim = o.trims.find((t) => t.key !== "");
			if (trim) out.push(`${o.label} ${trim.label}`);
			else if (o.years[0]) out.push(`${o.years[0]} ${o.label}`);
		}
		const fallback = ["Ford F-150 Raptor", "Tesla Model 3", "2023 Honda Civic Type R", "Silverado", "Porsche 911 GT3", "Hood", "Windshield"];
		return (out.length >= 4 ? out : [...out, ...fallback]).slice(0, 10);
	});
	let exampleIdx = $state(0);
	let searchFocused = $state(false);
	$effect(() => {
		const n = searchExamples.length;
		if (n < 2 || search || searchFocused || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const t = setInterval(() => (exampleIdx = (exampleIdx + 1) % n), 2400);
		return () => clearInterval(t);
	});
	const searchPlaceholder = $derived(
		`Search ${isVeh ? "make, model, trim, year or pattern" : "name, address or pattern"} — try “${searchExamples[exampleIdx % Math.max(1, searchExamples.length)] ?? ""}”`,
	);

	// Leaf: the patterns under the chosen make / model / trim, across years.
	const leafEntries = $derived(
		level === "patterns"
			? entriesUnder(vehBase, { make: path.make, model: path.model, trim: trimFilter(effTrim) })
					.sort((a, b) => (b.v.year ?? 0) - (a.v.year ?? 0))
			: [],
	);
	// Years and trims each pattern fits, for the chip on its card. A private
	// upload spans several entries and a community outline is stored once per
	// model year; either way it gets ONE card. Taken from the branch before the
	// year filter, so picking 2021 still shows the card's full "2019–2024".
	const patMeta = $derived.by(() => {
		const m = new Map<string, { years: number[]; trims: string[] }>();
		const entries = level === "patterns" ? entriesUnder(vehScope, { make: path.make, model: path.model, trim: trimFilter(effTrim) }) : [];
		for (const x of entries) {
			for (const p of x.pats) {
				const k = patternKey(p);
				const e = m.get(k) ?? m.set(k, { years: [], trims: [] }).get(k)!;
				if (x.v.year && !e.years.includes(x.v.year)) e.years.push(x.v.year);
				if (x.v.trim && !e.trims.includes(x.v.trim)) e.trims.push(x.v.trim);
			}
		}
		return m;
	});
	function chipFor(p: LibPattern): string {
		const e = patMeta.get(patternKey(p));
		if (!e) return "";
		const trims = e.trims.length === 1 ? e.trims[0] : e.trims.length > 1 ? `${e.trims.length} trims` : "";
		// Name the generation when every year the pattern fits sits in the same one.
		const gens = new Set(e.years.map((y) => generationOf(y, modelGens)?.label ?? ""));
		const gen = gens.size === 1 ? [...gens][0] : "";
		return [gen, yearSpan(e.years), trims].filter(Boolean).join(" ");
	}
	// "2 generations · 3 model years" instead of one long run of years.
	const leafYearsLabel = $derived.by(() => {
		const { groups, loose } = groupByGeneration(leafEntries, modelGens);
		const gens = groups.length ? `${groups.length} ${groups.length === 1 ? "generation" : "generations"}` : "";
		const yrs = new Set(loose.map((x) => x.v.year)).size;
		const years = gens
			? (yrs ? `${yrs} other ${yrs === 1 ? "year" : "years"}` : "")
			: `${leafEntries.length} model ${leafEntries.length === 1 ? "year" : "years"}`;
		return [gens, years].filter(Boolean).join(" · ");
	});

	const leafActive = $derived(isVeh ? level === "patterns" : !!selectedVehicle);

	const filtered = $derived(
		baseFiltered
			.map((x) => ({ ...x, shown: x.pats.filter(inZone) }))
			.filter((x) => x.shown.length > 0),
	);

	// ─── Selected subject's patterns ──────────────
	const vehiclePatterns = $derived<LibPattern[]>(
		isVeh
			? uniquePatterns(leafEntries.flatMap((x) => x.pats))
			: selectedVehicle
				? uniquePatterns(inScope.filter((x) => x.v.id === selectedVehicle!.id).flatMap((x) => x.pats))
				: [],
	);
	const visibleStorePatterns = $derived(vehiclePatterns.filter(inZone));
	// Model years in this branch that have no patterns yet (vehicles).
	const soonYears = $derived(isVeh && leafActive ? leafEntries.filter((x) => x.pats.length === 0 && x.v.year).map((x) => x.v.year as number) : []);
	const allSoonLeaf = $derived(soonYears.length > 0 && vehiclePatterns.length === 0);
	const useStorePatterns = $derived(vehiclePatterns.length > 0);

	// Zone pills + counts: the patterns on screen, else every subject the
	// other filters leave (non-vehicle types).
	const zoneSource = $derived<LibPattern[]>(
		isVeh || selectedVehicle ? vehiclePatterns : uniquePatterns(baseFiltered.flatMap((x) => x.pats)),
	);
	const zoneCounts = $derived(
		zoneSource.reduce((acc, p) => {
			for (const g of zoneGroups(p)) acc[g] = (acc[g] ?? 0) + 1;
			return acc;
		}, {} as Record<string, number>),
	);
	const ZONES = $derived.by(() => {
		const order = ZONE_GROUP_ORDER[category] ?? [];
		const sorted = Object.keys(zoneCounts).sort((a, b) => {
			const ia = order.indexOf(a), ib = order.indexOf(b);
			return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
		});
		return ["All zones", ...sorted];
	});

	// Stats reflect exactly what the filters above leave visible.
	const stats = $derived.by(() => {
		if (!isVeh) return { patterns: distinctCount(filtered.map((x) => ({ pats: x.shown }))), subjects: filtered.length, subjectLabel: "" };
		if (leafActive) return { patterns: visibleStorePatterns.length, subjects: leafEntries.length, subjectLabel: "model years" };
		const scope = path.make ? (makeNode ? [makeNode] : []) : tree;
		return {
			patterns: scope.reduce((n, m) => n + m.count, 0),
			subjects: scope.reduce((n, m) => n + m.models.length, 0),
			subjectLabel: "models",
		};
	});

	function switchProjectType(p: ProjectType) {
		projectType = p;
		selectedVehicle = null;
		if (path.make) go({});
		activeYear = "All";
		activeZone = "All zones";
		search = "";
		selectedPatternIds = new Set();
	}

	function switchCategory(c: PatternCategory) {
		category = c;
		activeZone = "All zones";
		selectedPatternIds = new Set();
	}

	function openSubject(v: VehicleEntry) {
		selectedVehicle = v;
		selectedPatternIds = new Set();
	}

	function setSource(s: LibrarySource) {
		if (s === source) return;
		source = s;
		if (s === "community") shareFilter = "all";
		selectedVehicle = null;
		selectedPatternIds = new Set();
		activeZone = "All zones";
		activeYear = "All";
		search = "";
		autoPick = !urlType;
		const url = new URL(page.url);
		if (s === "all") url.searchParams.delete("source"); else url.searchParams.set("source", s);
		url.searchParams.delete("tab");
		for (const k of ["make", "model", "trim"]) url.searchParams.delete(k);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	// When the source (or a deep link) lands on a subject type that has nothing,
	// move to the first type that does once the data is in — once only, so a
	// user who clicks an empty type on purpose isn't bounced back.
	let autoPick = $state(!urlType);
	$effect(() => {
		if (!autoPick || patternStore.loading) return;
		if (source !== "community" && (myPatternsLoading || (!!userStore.user && loadedForUid !== userStore.user.uid))) return;
		autoPick = false;
		if (typeCounts[projectType]) return;
		const first = PROJECT_TYPES.find((t) => typeCounts[t.value]);
		if (first) switchProjectType(first.value);
	});

	// Leaving a subject that no longer has patterns in this view.
	$effect(() => {
		if (selectedVehicle && !visible.some((x) => x.v.id === selectedVehicle!.id)) {
			selectedVehicle = null;
		}
	});

	const pieceWord = $derived(category === "window-tint" ? "windows" : "patterns");
	const pieces = (n: number) => (n === 0 ? "Coming soon" : `${n} ${n === 1 ? pieceWord.replace(/s$/, "") : pieceWord}`);

	// ─── Pattern detail dialog ────────────────────
	let detailPattern = $state<LibPattern | null>(null);

	// "Add both sides": the subject's own pattern for the opposite zone when it
	// has one, otherwise a mirrored copy of this one. Private uploads carry
	// their own mirror pair and go through the mirror dialog instead.
	const detailMirror = $derived.by(() => {
		const p = detailPattern;
		if (!p || p.source !== "community") return null;
		const m = MIRROR_PAIRS[p.zone];
		if (!m) return null;
		const t = p.projectType ?? (selectedVehicle ? typeOf(selectedVehicle) : projectType);
		// Prefer the same model year's own pattern — a leaf spans several years.
		const partner = vehiclePatterns.find((x) => x.zone === m && x.id !== p.id && x.vehicleId === p.vehicleId)
			?? vehiclePatterns.find((x) => x.zone === m && x.id !== p.id) ?? null;
		return { zone: m, label: zoneLabel(m, p.category, t), partner };
	});

	function addDetail(both: boolean) {
		const p = detailPattern;
		if (!p) return;
		if (p.up) {
			addMine(p.up);
		} else {
			addPatternToCanvas(p);
			if (both && detailMirror) {
				if (detailMirror.partner) addPatternToCanvas(detailMirror.partner);
				else addPatternToCanvas({ ...p, zone: detailMirror.zone, name: detailMirror.label }, true);
			}
		}
		detailPattern = null;
	}

	const cm = (inches: number) => (inches * 2.54).toFixed(1);

	// ─── Private pattern actions ──────────────────
	function mySubjectLabel(p: UserPattern): string {
		if ((p.projectType ?? "vehicle") !== "vehicle") return p.propertyLabel || p.patternName || p.address || "";
		return [p.years.join(", "), p.make, p.models.join(" / "), p.trims?.join(" / ")].filter(Boolean).join(" ");
	}

	async function toggleCommunitySubmit(p: UserPattern) {
		const next = !p.submitToCommunity;
		if (next) {
			const ok = await confirmStore.ask({
				title: `Share "${p.name}" with the community library?`,
				message: "An admin reviews it first. If it's approved, everyone can cut it and your copy becomes read-only — you'd request changes instead of editing.",
				confirmLabel: "Submit for review",
			});
			if (!ok) return;
		}
		myPatterns = myPatterns.map((m) =>
			m.id === p.id ? { ...m, submitToCommunity: next, status: next ? "pending" : "private" } : m,
		);
		try {
			await updateUserPattern(p.id, { submitToCommunity: next });
			toastStore.success(next ? "Submitted for review" : "Withdrawn", p.name);
		} catch {
			// revert on failure
			myPatterns = myPatterns.map((m) =>
				m.id === p.id ? { ...m, submitToCommunity: p.submitToCommunity, status: p.status } : m,
			);
			toastStore.error("Update failed", "Could not update community setting.");
		}
	}

	// ─── Delete pattern ──────────────────────────
	let deleting = $state<Set<string>>(new Set());

	async function confirmDelete(p: UserPattern) {
		const ok = await confirmStore.ask({
			title: `Delete "${p.name}"?`,
			message: "It's removed from your library for good. Anything already placed in Studio stays there.",
			details: [
				{ label: "Zones", value: compactZones(p) || "—" },
				{ label: "Size", value: `${formatMeasure(p.widthInches)}" × ${formatMeasure(p.heightInches)}"` },
			],
			variant: "danger",
			confirmLabel: "Delete pattern",
		});
		if (!ok) return;
		deleting = new Set([...deleting, p.id]);
		try {
			await deleteUserPattern(p.id);
			myPatterns = myPatterns.filter((m) => m.id !== p.id);
			if (detailPattern?.id === p.id) detailPattern = null;
			toastStore.success("Pattern deleted", p.name);
		} catch {
			toastStore.error("Delete failed", "Could not delete the pattern. Please try again.");
		} finally {
			deleting = new Set([...deleting].filter((id) => id !== p.id));
		}
	}

	// Collapses mirror pairs into compact labels, e.g. "Front Door (L/R)" instead of
	// "Door Front Left + Door Front Right". Unpaired zones get their full label.
	function compactZones(p: Pick<UserPattern, "zones" | "category" | "projectType" | "customZoneLabels">): string {
		const getLabel = (z: PatternZone, i: number) => zoneLabel(z, p.category, p.projectType, p.customZoneLabels?.[i]);
		const remaining = new Set(p.zones);
		const parts: string[] = [];
		p.zones.forEach((z, i) => {
			if (!remaining.has(z)) return;
			const mirror = MIRROR_PAIRS[z];
			if (mirror && remaining.has(mirror)) {
				parts.push(`${getLabel(z, i).replace(/ Left$| Right$/, "")} (L/R)`);
				remaining.delete(z);
				remaining.delete(mirror);
			} else {
				parts.push(getLabel(z, i));
				remaining.delete(z);
			}
		});
		return parts.join(" · ");
	}

	/** The zone badge on a card: a community pattern's group, a private one's full zone list. */
	const zoneBadge = (p: LibPattern) => (p.up ? compactZones(p.up) : zoneGroups(p)[0]);

	// ─── Mirror-add dialog ───────────────────────
	let mirrorTarget  = $state<UserPattern | null>(null);
	let mirrorAddOrig = $state(true);
	let mirrorAddFlip = $state(true);

	const mirrorPat = $derived(mirrorTarget ? userPatternToPattern(mirrorTarget) : null);
	const mirrorSidePair = $derived.by(() => {
		if (!mirrorTarget) return null;
		const t = mirrorTarget;
		for (const z of t.zones) {
			const m = MIRROR_PAIRS[z];
			if (m && t.zones.includes(m)) {
				return {
					orig: { zone: z, label: zoneLabel(z, t.category, t.projectType) },
					flip: { zone: m, label: zoneLabel(m, t.category, t.projectType) },
				};
			}
		}
		return null;
	});

	function hasMirrorZones(p: UserPattern): boolean {
		return p.zones.some((z) => {
			const m = MIRROR_PAIRS[z];
			return m !== undefined && p.zones.includes(m);
		});
	}

	function addMine(p: UserPattern) {
		if (hasMirrorZones(p)) {
			mirrorTarget = p;
			mirrorAddOrig = true;
			mirrorAddFlip = true;
		} else {
			addPatternToCanvas(userPatternToPattern(p));
		}
	}

	/** Card "+": a private pattern with a left/right pair opens the mirror dialog. */
	function addLib(p: LibPattern) {
		if (p.up) addMine(p.up); else addPatternToCanvas(p);
	}
	const addBlocked = (p: LibPattern) => (p.up ? sizeError(p, p.svgPath) : null);

	// ─── Adjustment request modal ────────────────
	let adjustTarget = $state<UserPattern | null>(null);
	let adjustNotes  = $state("");
	let adjustSending = $state(false);

	async function submitAdjustmentRequest() {
		if (!adjustTarget || !adjustNotes.trim() || !userStore.user) return;
		adjustSending = true;
		try {
			await addPatternAdjustmentRequest({
				patternId:   adjustTarget.id,
				requestedBy: userStore.user.uid,
				notes:       adjustNotes.trim(),
			});
			toastStore.success("Request sent", "Admin will review your adjustment request.");
			adjustTarget = null;
			adjustNotes  = "";
		} catch {
			toastStore.error("Failed", "Could not send request. Please try again.");
		} finally {
			adjustSending = false;
		}
	}

	// Request modal — for whichever subject type is active
	let showRequestModal = $state(false);
	let requestType = $state<ProjectType>("vehicle");
	let requestForm = $state<{ year: number | null; make: string; model: string; title: string; notes: string }>({ year: null, make: "", model: "", title: "", notes: "" });
	// Suggestions come from the catalog so the same car isn't requested five different ways.
	const vehicleSubjects = $derived(patternStore.vehicles.filter((v) => (v.projectType ?? "vehicle") === "vehicle" && v.make && v.model));
	const reqMakes = $derived([...new Map(vehicleSubjects.map((v) => [makeKey(v.make), v.make!])).values()].sort());
	const reqModels = $derived([...new Map(vehicleSubjects.filter((v) => makeKey(v.make) === makeKey(requestForm.make)).map((v) => [modelKey(v.model), v.model!])).values()].sort());
	// Already voted for what's typed? Show that instead of submitting again.
	const reqId = $derived(
		requestType === "vehicle"
			? (requestForm.make.trim() && requestForm.model.trim() ? demandId({ projectType: "vehicle", make: requestForm.make, model: requestForm.model }) : "")
			: (requestForm.title.trim() ? demandId({ projectType: requestType, model: requestForm.title }) : ""),
	);
	const reqMine = $derived(reqId ? patternStore.myVotes[reqId] : undefined);
	const reqVoted = $derived(!!reqMine && hasVoted(reqMine, requestType === "vehicle" ? requestForm.year || undefined : undefined));
	let reqBusy = $state(false);
	async function removeReqVote() {
		if (reqBusy || !reqId) return;
		reqBusy = true;
		await patternStore.vote(requestType === "vehicle"
			? { projectType: "vehicle", make: requestForm.make.trim(), model: requestForm.model.trim() }
			: { projectType: requestType, model: requestForm.title.trim() }, false);
		reqBusy = false;
	}
	function openRequest(t: ProjectType = projectType) {
		requestType = t;
		showRequestModal = true;
	}

	// ─── Add pattern to canvas ───────────────────
	// PRECISION: the pattern goes onto the canvas exactly as stored — same
	// svgPath, same widthInches × heightInches. The packer may only choose
	// position and rotation; it never resizes or re-proportions a piece.
	// The library's own bookkeeping (source, owner record, zone list) is
	// stripped so none of it is carried into the canvas state.
	function addPatternToCanvas(input: Pattern | LibPattern, flippedH = false) {
		const { source: _s, zones: _z, customZoneLabels: _c, up: _u, ...pattern } = input as LibPattern;
		// PRECISION: a pattern whose W × H doesn't match its outline would be
		// cut stretched. It never reaches the canvas until its owner fixes it.
		const problem = sizeError(pattern, pattern.svgPath);
		if (problem) {
			toastStore.error("Can't add this pattern", `${pattern.name}: ${problem} Edit the pattern to fix it.`);
			return;
		}
		const idx = canvasStore.items.length;
		const newItem: CanvasItem = {
			id:        uid("item_"),
			patternId: pattern.id,
			pattern:   { ...pattern },
			x: 0, y: 0,
			width:   pattern.widthInches,
			height:  pattern.heightInches,
			rotation: 0,
			outOfBounds: false,
			flippedH, flippedV: false,
			scale:  1,
			layer:  idx,
			locked: false,
			color:  getItemColor(idx),
			label:  pattern.name,
		};

		const ts = {
			...canvasStore.sheet,
			widthInches:  canvasStore.sheet.heightInches,
			heightInches: canvasStore.sheet.widthInches,
		};
		const nested = bestNest([...canvasStore.items, newItem], ts, true, canvasStore.state.bufferInches);
		canvasStore.setItems(nested);

		const placed = nested.find((i) => i.id === newItem.id);
		const suffix = flippedH ? " (mirrored)" : "";
		if (placed?.outOfBounds) {
			toastStore.warning("Added — won't cut", `${pattern.name}${suffix} exceeds the ${canvasStore.sheet.widthInches}" roll width.`);
		} else {
			toastStore.success(
				"Added to canvas",
				`${pattern.name}${suffix} — ${formatMeasure(pattern.widthInches)}" × ${formatMeasure(pattern.heightInches)}"${placed?.rotation ? " (rotated)" : ""}`,
			);
		}
	}

	// ─── Batch add (selected patterns) ──────────
	function addAllSelected() {
		if (!leafActive || !useStorePatterns) return;
		const toAdd = vehiclePatterns.filter((p) => selectedPatternIds.has(p.id));
		toAdd.forEach((pattern) => addPatternToCanvas(pattern));
		if (toAdd.length > 1) {
			toastStore.success(`${toAdd.length} patterns added`, "Open Studio to arrange and cut.");
		}
		selectedPatternIds = new Set();
	}

	function togglePattern(patternId: string) {
		const next = new Set(selectedPatternIds);
		next.has(patternId) ? next.delete(patternId) : next.add(patternId);
		selectedPatternIds = next;
	}

	const allVisibleSelected = $derived(visibleStorePatterns.length > 0 && visibleStorePatterns.every((p) => selectedPatternIds.has(p.id)));
	function toggleSelectAll() {
		selectedPatternIds = allVisibleSelected ? new Set() : new Set(visibleStorePatterns.map((p) => p.id));
	}

	const selectedCount = $derived(selectedPatternIds.size);

	// ─── Request vehicle ──────────────────────────
	async function submitRequest() {
		const { year, make, model, title, notes } = requestForm;
		if (!userStore.user) { toastStore.error("Sign in to request a pattern", "Requests and votes are tied to your account."); return; }
		const t: VoteTarget = requestType === "vehicle"
			? { projectType: "vehicle", make: make.trim(), model: model.trim(), year: year || 0, notes: notes.trim() }
			: { projectType: requestType, model: title.trim(), notes: notes.trim() };
		if (!t.model || (requestType === "vehicle" && !t.make)) return;
		if (reqVoted || reqBusy) return;
		// Already requested? The server adds this to the same record — one vote each.
		reqBusy = true;
		const ok = await patternStore.vote(t);
		reqBusy = false;
		if (!ok) return;
		const what = requestType === "vehicle" ? [year || "", make.trim(), model.trim()].filter(Boolean).join(" ") : `"${t.model}"`;
		toastStore.success("Thanks — you're on the list", `${what}: requests are counted once, so this added your vote.`);
		showRequestModal = false;
		requestForm = { year: null, make: "", model: "", title: "", notes: "" };
	}

	// ─── Header copy ──────────────────────────────
	const privateLoading = $derived(source !== "community" && (myPatternsLoading || (!!userStore.user && loadedForUid !== userStore.user.uid)));
	const hasPrivate = $derived(myPatterns.length > 0);

	// "Nothing here" copy depends on which library the user is looking at.
	const emptyKind = $derived<"loading" | "error" | "none-source" | "none-type" | "filters">(
		patternStore.loading && source !== "private" || privateLoading
			? "loading"
			: patternStore.catalogError && source !== "private" && !communityAll.length
				? "error"
				: sourceCounts[source] === 0 && !soonAll.length
					? "none-source"
					: !typeCounts[projectType] && !(isVeh && soonAll.length)
						? "none-type"
						: "filters",
	);


	// ─── Mobile filter sheet ──────────────────────
	const filterCount = $derived(
		(isVeh && activeYear !== "All" ? 1 : 0) +
		(hideSoon ? 1 : 0) +
		(activeZone !== "All zones" ? 1 : 0) +
		(showStatus && shareFilter !== "all" ? 1 : 0),
	);
	const hasFilterGroups = $derived((isVeh && YEARS.length > 1) || (isVeh && soonAll.length > 0) || ZONES.length > 2 || showStatus);
	function resetFilters() {
		activeYear = "All";
		activeZone = "All zones";
		shareFilter = "all";
		hideSoon = false;
	}

	// Keep the active tab of a horizontally scrolling switcher in view.
	function revealActive(node: HTMLElement, _key?: unknown) {
		const run = () =>
			requestAnimationFrame(() =>
				node.querySelector<HTMLElement>(".active")?.scrollIntoView({ inline: "center", block: "nearest" }),
			);
		run();
		return { update: run };
	}
</script>
<svelte:head>
	<title>Pattern Library — OmniPlot</title>
</svelte:head>

{#snippet filterGroups()}
		{#if isVeh && YEARS.length > 1}
			<section class="lib-fgroup">
				<div class="lib-fgroup__head">
					<span class="lib-section-label">Year</span>
					{#if activeYear !== "All"}<button class="lib-fgroup__clear" onclick={() => (activeYear = "All")}>Clear</button>{/if}
				</div>
				<div class="lib-years" use:revealActive={activeYear}>
					<button class="lib-year lib-year--all" class:active={activeYear === "All"} onclick={() => (activeYear = "All")} aria-pressed={activeYear === "All"}>All years</button>
					{#each yearOpts as o (o.key)}
						<button class="lib-year" class:active={activeYear === o.key} class:lib-year--gen={o.isGen} onclick={() => (activeYear = o.key)} aria-pressed={activeYear === o.key}>
							{#if o.isGen}<span class="lib-year__name">{o.label}</span><span class="lib-year__span">{o.from === o.to ? o.from : `${o.from}–${o.to}`}</span>{:else}{o.label}{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if isVeh && soonAll.length}
			<section class="lib-fgroup">
				<div class="lib-fgroup__head"><span class="lib-section-label">Availability</span></div>
				<div class="lib-seg" role="group" aria-label="Availability">
					<button class="lib-seg__btn" class:active={!hideSoon} aria-pressed={!hideSoon} onclick={() => (hideSoon = false)}>All</button>
					<button class="lib-seg__btn" class:active={hideSoon} aria-pressed={hideSoon} onclick={() => (hideSoon = true)}>Available only</button>
				</div>
			</section>
		{/if}

		{#if ZONES.length > 2}
			<section class="lib-fgroup">
				<div class="lib-fgroup__head"><span class="lib-section-label">Zone</span></div>
				<div class="lib-filter-pills">
					{#each ZONES as zone}
						<button class="lib-pill" class:active={activeZone === zone} onclick={() => (activeZone = zone)} aria-pressed={activeZone === zone}>
							{zone} <span class="lib-pill__count">{zone === "All zones" ? zoneSource.length : zoneCounts[zone] ?? 0}</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if showStatus}
			<section class="lib-fgroup">
				<div class="lib-fgroup__head"><span class="lib-section-label">Your patterns</span></div>
				<div class="lib-opts" role="group" aria-label="Your patterns">
					<button class="lib-opt" class:active={shareFilter === "all"} aria-pressed={shareFilter === "all"} onclick={() => (shareFilter = "all")}><span>Any</span><span class="lib-pill__count">{myPatterns.length}</span></button>
					{#each statusKinds as s (s)}
						<button class="lib-opt" class:active={shareFilter === s} aria-pressed={shareFilter === s} onclick={() => (shareFilter = s)}><span>{STATUS_LABEL[s]}</span><span class="lib-pill__count">{statusCounts[s]}</span></button>
					{/each}
				</div>
			</section>
		{/if}

{/snippet}

{#snippet requestBtn(inSheet: boolean)}
	{#if source !== "private"}
		<button class="lib-request-btn" class:lib-request-btn--in-sheet={inSheet} onclick={() => { filtersOpen = false; openRequest(); }}>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			{projectType === "vehicle" ? "Request a vehicle" : projectType === "custom" ? "Request a pattern" : "Request a property pattern"}
		</button>
	{/if}
{/snippet}

<div class="library">
	<!-- ─── Sidebar: one set of filters for every source ─── -->
	<aside class="library__sidebar">
			{#if hasFilterGroups}
				<button class="lib-pill lib-filter-btn" class:has-filters={filterCount > 0} onclick={() => (filtersOpen = true)} aria-haspopup="dialog">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>
					Filters
					{#if filterCount}<span class="lib-filter-btn__n">{filterCount}</span>{/if}
				</button>
			{/if}

			<!-- Desktop: filters live in the sidebar. ≤768px they open in a sheet. -->
			<div class="lib-filters-desktop">
				{@render filterGroups()}
			</div>

		{#if isVeh && tree.length}
			<!-- Desktop: the tree lives here. ≤768px it moves into a sheet. -->
			<div class="lib-tree">
				<div class="lib-section-label">Browse</div>
				<VehicleTreeFilter {tree} {path} total={treeTotal} {logoFor} onselect={go} trimBase={TRIM_BASE} gens={yearOpts.filter((o) => o.isGen)} {activeYear} onyear={(k) => (activeYear = activeYear === k ? "All" : k)} />
			</div>
			<button class="lib-pill lib-browse-btn" onclick={() => (browseOpen = true)}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
				{makeLabel ? [makeLabel, modelLabel].filter(Boolean).join(" › ") : "Browse makes"}
			</button>
		{/if}

		<div class="lib-side-foot">
		<div class="lib-section-label">Showing</div>
		<div class="lib-stats">
			<div class="lib-stat">
				<span class="lib-stat__val">{stats.patterns}</span>
				<span class="lib-stat__label">{categoryShortLabel(category)} {pieceWord}</span>
			</div>
			<div class="lib-stat">
				<span class="lib-stat__val">{stats.subjects}</span>
				<span class="lib-stat__label">{isVeh ? (stats.subjects === 1 ? stats.subjectLabel.replace(/s$/, "") : stats.subjectLabel) : stats.subjects === 1 ? typeMeta(projectType).noun : typeMeta(projectType).nounPlural}</span>
			</div>
		</div>

		{@render requestBtn(hasFilterGroups)}
		</div>
	</aside>

	<!-- ─── Main ─── -->
	<div class="library__main">

		<!-- Header: title + which library you're looking at -->
		<div class="library__header">
			<div class="library__heading">
				<h1 class="library__title">Library</h1>
				<p class="library__sub">
					{#if leafActive}
						Select patterns below
					{:else if isVeh}
						{#if level === "makes"}{tree.length} {tree.length === 1 ? "make" : "makes"} · choose one to see its models
						{:else if level === "models"}Choose a model
						{:else}Choose a trim or variant{/if}
					{:else}
						{filtered.length} {filtered.length === 1 ? typeMeta(projectType).noun : typeMeta(projectType).nounPlural} · select one to view its patterns
					{/if}
				</p>
			</div>
			<div class="library__header-actions">
				<div class="src-switch" role="group" aria-label="Library source">
					{#each SOURCES as s (s.value)}
						<button class="src-btn" class:active={source === s.value} onclick={() => setSource(s.value)} aria-pressed={source === s.value}>
							{#if s.value === "private"}
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
							{:else if s.value === "community"}
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
							{/if}
							{s.label}
							<span class="mode-count">{s.value === "private" && myPatternsLoading ? "…" : sourceCounts[s.value]}</span>
						</button>
					{/each}
				</div>
				<a href="/library/upload" class="upload-cta" aria-label="Upload pattern" use:tooltip={"Add a pattern to your private library"}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					<span class="upload-cta__text">Upload pattern</span>
				</a>
				<div class="view-toggle" class:view-toggle--off={isVeh || !!selectedVehicle} aria-hidden={isVeh || !!selectedVehicle}>
					<div class="view-divider" aria-hidden="true"></div>
					<button class="view-btn" class:active={view === "grid"} onclick={() => (view = "grid")} aria-label="Grid view" aria-pressed={view === "grid"}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
					</button>
					<button class="view-btn" class:active={view === "list"} onclick={() => (view = "list")} aria-label="List view" aria-pressed={view === "list"}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
					</button>
				</div>
			</div>
		</div>

		<!-- Subject type -->
		<div class="mode-switcher mode-switcher--full" role="group" aria-label="Subject type" use:revealActive={projectType}>
			{#each PROJECT_TYPES as t (t.value)}
				<button
					class="mode-btn mode-btn--lg"
					class:active={projectType === t.value}
					class:mode-btn--empty={!typeCounts[t.value]}
					onclick={() => switchProjectType(t.value)}
					aria-pressed={projectType === t.value}
				>
					{t.label}
					<span class="mode-count">{typeCounts[t.value] ?? 0}</span>
				</button>
			{/each}
		</div>

		<!-- Category (only categories this type actually has) -->
		<div class="cat-row">
		{#if categoriesForType.length > 0}
			<div class="mode-switcher" role="group" aria-label="Pattern category" use:revealActive={category}>
				{#each categoriesForType as c (c.value)}
					<button class="mode-btn" class:active={category === c.value} onclick={() => switchCategory(c.value)} aria-pressed={category === c.value}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={c.icon}/></svg>
						{c.shortLabel === "Tint" ? "Window Tint" : c.shortLabel}
						<span class="mode-count">{c.count}</span>
					</button>
				{/each}
			</div>
		{/if}
		</div>

		{#if myPatternsError && source !== "community"}
			<div class="lib-banner" role="alert">
				{myPatternsError}
				<button class="lib-empty__request" onclick={() => userStore.user && loadMyPatterns(userStore.user.uid)}>Try again</button>
			</div>
		{/if}

		<!-- Search: one bar for makes, models, trims, years and patterns -->
		<div class="lib-search-block">
			<div class="lib-search-wrap">
				<svg class="lib-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
				<input
					type="search"
					class="lib-search"
					placeholder={searchPlaceholder}
					bind:value={search}
					onfocus={() => (searchFocused = true)}
					onblur={() => (searchFocused = false)}
					autocomplete="off"
					spellcheck="false"
					aria-label="Search {isVeh ? "makes, models, trims, years and patterns" : typeMeta(projectType).nounPlural}"
				/>
			</div>
			{#if !search.trim() && searchExamples.length}
				<div class="lib-search-tries" aria-label="Search examples">
					<span class="lib-search-tries__lead">Try</span>
					{#each searchExamples as ex (ex)}
						<button type="button" class="lib-search-try" onclick={() => (search = ex)}>{ex}</button>
					{/each}
				</div>
			{/if}
		</div>

		{#snippet crumbs()}
			<nav class="crumbs" aria-label="Breadcrumb">
				{#if path.make}<button class="crumb" onclick={() => go({})}>All makes</button>{:else}<span class="crumb crumb--current" aria-current="page">All makes</span>{/if}
				{#if path.make}
					<span class="crumb-sep" aria-hidden="true">/</span>
					{#if path.model}
						<button class="crumb" onclick={() => go({ make: path.make })}>{makeLabel || path.make}</button>
						<span class="crumb-sep" aria-hidden="true">/</span>
						{#if level === "patterns" && (path.trim || (trimLabel && trimLabel !== BASE_TRIM_LABEL))}
							<button class="crumb" onclick={() => go({ make: path.make, model: path.model })}>{modelLabel}</button>
							<span class="crumb-sep" aria-hidden="true">/</span>
							<span class="crumb crumb--current" aria-current="page">{path.trim === TRIM_ALL ? "All trims" : trimLabel || path.trim}</span>
						{:else}
							<span class="crumb crumb--current" aria-current="page">{modelLabel || path.model}</span>
						{/if}
					{:else}
						<span class="crumb crumb--current" aria-current="page">{makeLabel || path.make}</span>
					{/if}
				{/if}
			</nav>
		{/snippet}

		{#snippet emptyState()}
			<div class="lib-empty">
				{#if emptyKind === "loading"}
					<p class="lib-empty__title">Loading the pattern library…</p>
				{:else if emptyKind === "error"}
					<p class="lib-empty__title">Couldn't load the community library</p>
					<p class="lib-empty__sub">Check your connection and reload the page. Your private patterns are unaffected.</p>
				{:else if emptyKind === "none-source"}
					{#if source === "private"}
						<p class="lib-empty__title">Your private library is empty</p>
						<p class="lib-empty__sub">Upload a pattern from an SVG, a photo or a scan. It's organised here the same way as the community library, and only you can see and cut it.</p>
					{:else if source === "community"}
						<p class="lib-empty__title">The community library is empty</p>
						<p class="lib-empty__sub">No patterns have been published yet.</p>
					{:else}
						<p class="lib-empty__title">No patterns yet</p>
						<p class="lib-empty__sub">Upload one to your private library to get started.</p>
					{/if}
				{:else if emptyKind === "none-type"}
					<p class="lib-empty__title">No {source === "private" ? "private " : ""}{typeMeta(projectType).label.toLowerCase()} patterns yet</p>
					<p class="lib-empty__sub">
						{#if source === "private"}
							Upload one and it will show up here, ready to cut.
						{:else}
							There aren't any {typeMeta(projectType).noun} patterns here yet. <button class="lib-empty__request" onclick={() => openRequest()}>Request one</button>, or upload your own to use right away.
						{/if}
					</p>
				{:else}
					<p class="lib-empty__title">Nothing matches these filters</p>
					<p class="lib-empty__sub">
						Try a different search or filter{#if isVeh && (path.make || activeYear !== "All")}, <button class="lib-empty__request" onclick={() => { activeYear = "All"; go({}); }}>start over</button>{/if}{#if source !== "private"}, or <button class="lib-empty__request" onclick={() => openRequest()}>request {projectType === "vehicle" ? "a vehicle" : "a pattern"}</button>{/if}.
					</p>
				{/if}
				{#if emptyKind !== "loading" && emptyKind !== "error"}
					<a href="/library/upload" class="lib-empty__upload">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
						Upload pattern
					</a>
				{/if}
			</div>
		{/snippet}

		<!-- ─── Vehicles: make → model → trim ─── -->
		{#if isVeh && !leafActive}
			<div class="vb">
				{@render crumbs()}

				{#if searching}
					{#if searchHits.length}
						<div class="vb-grid vb-grid--model">
							{#each searchHits as { m, o } (m.key + "/" + o.key)}
								<VehicleTile
									variant="model"
									title={o.label}
									eyebrow={m.label}
									years={yearSpan(o.years)}
									bodyStyle={o.bodyStyle}
									imageUrl={imageOf(m.label, o.label)}
									meta={[...(o.trims.length > 1 ? [`${o.trims.length} trims`] : o.trims.length === 1 && o.trims[0].key !== "" ? [o.trims[0].label] : []), pieces(o.count)]}
									onclick={() => go(o.trims.length === 1 && o.trims[0].key !== "" ? { make: m.key, model: o.key, trim: o.trims[0].key } : { make: m.key, model: o.key })}
								/>
							{/each}
						</div>
					{:else}
						{@render emptyState()}
					{/if}

				{:else if level === "makes"}
					{#if tree.length}
						<div class="vb-grid vb-grid--make">
							{#each tree as m (m.key)}
								{@const md = mediaOf(m.label)}
								<VehicleTile
									variant="make"
									title={m.label}
									logoUrl={md?.logoUrl}
									imageUrl={md?.imageUrl}
									meta={[`${m.models.length} ${m.models.length === 1 ? "model" : "models"}`, pieces(m.count)]}
									onclick={() => go({ make: m.key })}
								/>
							{/each}
						</div>
					{:else}
						{@render emptyState()}
					{/if}

				{:else if level === "models"}
					{#if makeNode}
						{@const md = mediaOf(makeNode.label)}
						<VehicleHero
							title={makeNode.label}
							eyebrow="Make"
							logoUrl={md?.logoUrl}
							imageUrl={md?.imageUrl}
							stats={[`${makeNode.models.length} ${makeNode.models.length === 1 ? "model" : "models"}`, pieces(makeNode.count)]}
						/>
						<div class="vb-grid vb-grid--model">
							{#each makeNode.models as o (o.key)}
								<VehicleTile
									variant="model"
									title={o.label}
									years={yearSpan(o.years)}
									bodyStyle={o.bodyStyle}
									imageUrl={imageOf(makeNode.label, o.label)}
									meta={[...(o.trims.length > 1 ? [`${o.trims.length} trims`] : o.trims.length === 1 && o.trims[0].key !== "" ? [o.trims[0].label] : []), pieces(o.count)]}
									onclick={() => go({ make: makeNode.key, model: o.key })}
								/>
							{/each}
						</div>
					{:else}
						{@render emptyState()}
					{/if}

				{:else}
					{#if modelNode && makeNode}
						{@const mdImg = imageOf(makeNode.label, modelNode.label, undefined, true)}
						<VehicleHero
							title={modelNode.label}
							eyebrow={makeNode.label}
							logoUrl={mediaOf(makeNode.label)?.logoUrl}
							imageUrl={mdImg}
							stats={[`${modelNode.trims.length} trims & variants`, pieces(modelNode.count), yearSpan(modelNode.years)].filter(Boolean)}
						/>
						<div class="vb-grid vb-grid--trim">
							<VehicleTile
								variant="trim"
								title="All {modelNode.label} patterns"
								meta={[pieces(modelNode.count)]}
								years={yearSpan(modelNode.years)}
								onclick={() => go({ make: makeNode.key, model: modelNode.key, trim: TRIM_ALL })}
							/>
							{#each modelNode.trims as t (t.key)}
								<VehicleTile
									variant="trim"
									title={t.label}
									years={yearSpan(t.years)}
									imageUrl={imageOf(makeNode.label, modelNode.label, t.key ? t.label : undefined, true)}
									meta={[pieces(t.count)]}
									onclick={() => go({ make: makeNode.key, model: modelNode.key, trim: t.key === "" ? TRIM_BASE : t.key })}
								/>
							{/each}
						</div>
					{:else}
						{@render emptyState()}
					{/if}
				{/if}
			</div>

		<!-- Subject grid (property / custom) -->
		{:else if !isVeh && !selectedVehicle}
			<nav class="crumbs" aria-label="Breadcrumb"><span class="crumb crumb--current" aria-current="page">All {typeMeta(projectType).nounPlural}</span></nav>
			<div class="vehicle-grid" class:vehicle-grid--list={view === "list"}>
				{#each filtered as { v: vehicle, shown } (vehicle.id)}
					<button class="vehicle-card" onclick={() => openSubject(vehicle)} aria-label="Open {subjectName(vehicle)} — {shown.length} {pieceWord}">
						<div class="vehicle-card__thumb">
							<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								{#if projectType === "residential"}<path d="M3 11l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>
								{:else if projectType === "commercial"}<path d="M4 21V7l8-4 8 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>
								{:else}<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/>{/if}
							</svg>
						</div>
						<div class="vehicle-card__body">
							<div class="vehicle-card__year-make">{subjectName(vehicle)}</div>
							{#if vehicle.address}<div class="vehicle-card__model">{vehicle.address}</div>{/if}
							<div class="vehicle-card__meta">
								<Badge variant="default" size="sm">{shown.length} {shown.length === 1 ? pieceWord.replace(/s$/, "") : pieceWord}</Badge>
								{#if source === "all" && shown.every((p) => p.source === "private")}
									<Badge variant="default" size="sm">Private</Badge>
								{/if}
								{#if vehicle.popular}
									<Badge variant="brand" size="sm">Popular</Badge>
								{/if}
							</div>
						</div>
					</button>
				{/each}

				{#if filtered.length === 0}{@render emptyState()}{/if}
			</div>

		<!-- Pattern browser: one trim's patterns (vehicles) or one subject's -->
		{:else}
			<div class="zone-browser">
				{#if isVeh}
					{@render crumbs()}
					<VehicleHero
						title={[modelLabel, trimLabel && trimLabel !== BASE_TRIM_LABEL ? trimLabel : ""].filter(Boolean).join(" ")}
						eyebrow={makeLabel}
						logoUrl={mediaOf(makeLabel)?.logoUrl}
						imageUrl={imageOf(makeLabel, modelLabel, trimLabel && trimLabel !== BASE_TRIM_LABEL ? trimLabel : undefined, true)}
						stats={[yearSpan(leafEntries.map((x) => x.v.year ?? 0).filter(Boolean)), leafYearsLabel].filter(Boolean)}
					/>
				{/if}
				<div class="zone-browser__header">
					{#if !isVeh && selectedVehicle}
						<button class="back-btn" onclick={() => (selectedVehicle = null)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
							All {typeMeta(projectType).nounPlural}
						</button>
						<h2 class="zone-browser__title">{subjectName(selectedVehicle)}</h2>
					{/if}
					<div class="zone-browser__actions">
						{#if useStorePatterns}
							<Badge variant="success" size="sm" dot>
								{visibleStorePatterns.length}{activeZone !== "All zones" ? ` of ${vehiclePatterns.length}` : ""} {pieceWord}{source === "community" ? " · verified" : ""}
							</Badge>
							<button class="lib-pill" class:active={allVisibleSelected} onclick={toggleSelectAll}>{allVisibleSelected ? "Clear selection" : "Select all"}</button>
						{/if}
						{#if selectedCount > 0}
							<Button variant="primary" size="sm" onclick={addAllSelected}>
								Add {selectedCount} to canvas →
							</Button>
						{/if}
					</div>
				</div>

				{#if soonYears.length}
					<ComingSoon make={makeLabel} model={modelLabel} years={soonYears} allSoon={allSoonLeaf} gens={modelGens} />
				{/if}

				<div class="zone-grid" hidden={allSoonLeaf}>
					{#if visibleStorePatterns.length}
						{#each visibleStorePatterns as pattern (pattern.id)}
							{@const selected = selectedPatternIds.has(pattern.id)}
							{@const st = pattern.up ? shareStatusOf(pattern.up) : null}
							{@const blocked = addBlocked(pattern)}
							{@const chip = isVeh ? chipFor(pattern) : ""}
							<div
								class="zone-card"
								class:selected
								class:zone-card--tint={category === "window-tint"}
								role="button"
								tabindex="0"
								onclick={() => togglePattern(pattern.id)}
								onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); togglePattern(pattern.id); } }}
								aria-pressed={selected}
								aria-label="Select {pattern.name}"
							>
								{#if selected}
									<div class="zone-card__check" aria-hidden="true">
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
									</div>
								{/if}

								<!-- Full-bleed preview. fitPattern sets the viewBox to the real W × H,
								     so the shape is only ever scaled uniformly to fill the card. -->
								<div class="zone-card__preview">
									<svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" aria-hidden="true">
										<path
											d={pattern.svgPath}
											use:fitPattern={{ w: pattern.widthInches, h: pattern.heightInches, d: pattern.svgPath }}
											fill={category === "window-tint" ? "rgba(0,112,255,0.10)" : "rgba(0,229,255,0.08)"}
											stroke={category === "window-tint" ? "var(--color-brand-dim)" : "var(--color-brand)"}
											stroke-width="1"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</div>

								<div class="zone-card__tags">
									{#if chip}<span class="zc-tag zc-tag--mono">{chip}</span>{/if}
									{#if pattern.up && source === "all"}
										<span class="zc-tag" use:tooltip={"In your private library"}>
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
											Private
										</span>
									{/if}
									{#if st && st !== "unshared"}
										<span class="zc-tag zc-tag--{st}">{STATUS_LABEL[st]}</span>
									{/if}
									{#if blocked}
										<span class="zc-tag zc-tag--rejected" use:tooltip={"Its saved width × height doesn't match its outline, so it would cut stretched. Edit it and re-enter the width or height."}>Size mismatch</span>
									{/if}
								</div>

								<!-- Quick view: short zone + coverage only. Full title, size and notes live in Details. -->
								<div class="zone-card__bar">
									<div class="zone-card__badges">
										<Badge variant="brand" size="sm">{zoneBadge(pattern)}</Badge>
										<Badge variant={pattern.coverage === "full" ? "success" : "warning"} size="sm">
											{pattern.coverage === "edge-only" ? "edge only" : pattern.coverage}
										</Badge>
									</div>
									<div class="zone-card__actions">
										<button
											class="zone-card__icon"
											onclick={(e) => { e.stopPropagation(); detailPattern = pattern; }}
											aria-label="Details for {pattern.name}"
											use:tooltip={pattern.up ? "Details & manage" : pattern.notes ? "Details & notes" : "Details"}
										>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
										</button>
										{#if pattern.up && st !== "published"}
											<a
												class="zone-card__icon"
												href="/library/edit/{pattern.id}"
												onclick={(e) => e.stopPropagation()}
												aria-label="Edit {pattern.name}"
												use:tooltip={"Edit this pattern"}
											>
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>
											</a>
										{/if}
										<button
											class="zone-card__icon zone-card__add"
											onclick={(e) => { e.stopPropagation(); addLib(pattern); }}
											disabled={!!blocked}
											aria-label="Add {pattern.name} to canvas"
											use:tooltip={blocked ? "Fix this pattern's size before adding it" : "Add to canvas"}
										>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
										</button>
									</div>
								</div>
							</div>
						{/each}

					{:else}
						<div class="zone-empty">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
							{#if useStorePatterns}
								<p>No {categoryShortLabel(category)} patterns in “{activeZone}” for this {typeMeta(projectType).noun}.</p>
								<button class="zone-empty__cta" onclick={() => (activeZone = "All zones")}>Show all zones</button>
							{:else}
								<p>No {categoryLabel(category)} patterns for this {typeMeta(projectType).noun} yet.</p>
								<a href="/library/upload" class="zone-empty__cta">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
									Upload a pattern
								</a>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}

	</div>
</div>

<!-- ─── Mobile: browse makes / models / trims ─── -->
<svelte:window onkeydown={(e) => { if (e.key !== "Escape") return; if (browseOpen) browseOpen = false; if (filtersOpen) filtersOpen = false; }} />
{#if browseOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={() => (browseOpen = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="sheet" role="dialog" aria-modal="true" aria-label="Browse vehicles" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sheet__grab" aria-hidden="true"></div>
			<div class="sheet__head">
				Browse vehicles
				<button class="sheet__close" onclick={() => (browseOpen = false)} aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="sheet__body">
				<VehicleTreeFilter {tree} {path} total={treeTotal} {logoFor} onselect={go} trimBase={TRIM_BASE} gens={yearOpts.filter((o) => o.isGen)} {activeYear} onyear={(k) => (activeYear = activeYear === k ? "All" : k)} />
			</div>
		</div>
	</div>
{/if}

{#if filtersOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="sheet-backdrop" onclick={() => (filtersOpen = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="sheet" role="dialog" aria-modal="true" aria-label="Filters" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="sheet__grab" aria-hidden="true"></div>
			<div class="sheet__head">
				Filters
				<span class="sheet__head-right">
					{#if filterCount}<button class="sheet__reset" onclick={resetFilters}>Reset</button>{/if}
					<button class="sheet__close" onclick={() => (filtersOpen = false)} aria-label="Close">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
					</button>
				</span>
			</div>
			<div class="sheet__body">
				{@render filterGroups()}
				{@render requestBtn(false)}
			</div>
			<div class="sheet__foot">
				<button class="sheet__done" onclick={() => (filtersOpen = false)}>Done</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Pattern detail dialog ─────────────────── -->
{#if detailPattern}
	{@const p = detailPattern}
	{@const own = p.up ?? null}
	{@const st = own ? shareStatusOf(own) : null}
	{@const ent = own ? null : (leafEntries.find((x) => x.pats.some((q) => q.id === p.id))?.v ?? selectedVehicle)}
	{@const t = p.projectType ?? (ent ? typeOf(ent) : projectType)}
	{@const blocked = addBlocked(p)}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (detailPattern = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal modal--detail" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="pd-title">
			<div class="modal__header">
				<div>
					<h2 class="modal__title" id="pd-title">{p.name}</h2>
					<p class="modal__sub">
						{#if own}{mySubjectLabel(own) || "Your pattern"} · {:else if ent}{subjectName(ent)} · {/if}{categoryLabel(p.category)}
					</p>
				</div>
				<button class="modal__close" onclick={() => (detailPattern = null)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>

			<div class="modal__body pd">
				<div class="pd__preview">
					<PatternPreview svgPath={p.svgPath} widthInches={p.widthInches} heightInches={p.heightInches} label="Outline of {p.name} at its real proportions" />
				</div>

				<dl class="pd__facts">
					<div><dt>Zone</dt><dd>{own ? compactZones(own) : zoneLabel(p.zone, p.category, t, p.customZoneLabel)}</dd></div>
					<div><dt>Size</dt><dd>{formatMeasure(p.widthInches)}" × {formatMeasure(p.heightInches)}" <span class="pd__muted">({cm(p.widthInches)} × {cm(p.heightInches)} cm)</span></dd></div>
					<div><dt>Coverage</dt><dd>{p.coverage === "edge-only" ? "Edge only" : p.coverage === "full" ? "Full" : "Partial"}</dd></div>
					<div><dt>Library</dt><dd>{own ? "Private" : "Community"}</dd></div>
					{#if own}<div><dt>Added</dt><dd>{own.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd></div>{/if}
					{#if p.revision}<div><dt>Revision</dt><dd>{p.revision}</dd></div>{/if}
				</dl>

				{#if p.notes}
					<div class="pd__notes">
						<div class="pd__notes-title">Notes & disclosure</div>
						<p>{p.notes}</p>
					</div>
				{/if}

				{#if own && st}
					<div class="pd__own">
						<Badge variant={STATUS_VARIANT[st]} size="sm">{STATUS_LABEL[st]}</Badge>
						<p>
							{#if st === "rejected"}
								{#if own.rejectionReason}<strong>Not approved:</strong> {own.rejectionReason}{:else}Not approved for the community library.{/if}
								It's still yours to use — edit it and resubmit anytime.
							{:else if st === "pending"}
								Waiting for admin review. You can keep using it meanwhile.
							{:else if st === "published"}
								Shared with the community. Changes go through a request.
							{:else}
								Only you can see and cut this pattern.
							{/if}
						</p>
						{#if blocked}
							<p class="pd__warn">{blocked} Edit the pattern to fix it before adding it to the canvas.</p>
						{/if}
					</div>

					<div class="pd__manage">
						{#if st === "published"}
							<button type="button" class="pd__mbtn" onclick={() => { adjustTarget = own; adjustNotes = ""; detailPattern = null; }}>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
								Request changes
							</button>
						{:else}
							<a href="/library/edit/{own.id}" class="pd__mbtn">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>
								Edit
							</a>
							<button type="button" class="pd__mbtn" onclick={() => toggleCommunitySubmit(own)}>
								{own.submitToCommunity ? "Withdraw from review" : st === "rejected" ? "Resubmit to community" : "Share with community"}
							</button>
							<button type="button" class="pd__mbtn pd__mbtn--danger" onclick={() => confirmDelete(own)} disabled={deleting.has(own.id)}>
								{deleting.has(own.id) ? "Deleting…" : "Delete"}
							</button>
						{/if}
					</div>
				{/if}

				{#if detailMirror}
					<div class="pd__mirror">
						<div class="pd__mirror-previews" aria-hidden="true">
							<PatternPreview svgPath={p.svgPath} widthInches={p.widthInches} heightInches={p.heightInches} size="thumb" />
							{#if detailMirror.partner}
								<PatternPreview svgPath={detailMirror.partner.svgPath} widthInches={detailMirror.partner.widthInches} heightInches={detailMirror.partner.heightInches} size="thumb" />
							{:else}
								<span class="pd__flip"><PatternPreview svgPath={p.svgPath} widthInches={p.widthInches} heightInches={p.heightInches} size="thumb" /></span>
							{/if}
						</div>
						<p class="pd__mirror-text">
							Pairs with <strong>{detailMirror.label}</strong>
							{detailMirror.partner ? "— this subject has its own pattern for that side." : "— added as a mirrored copy of this pattern."}
						</p>
					</div>
				{/if}

				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (detailPattern = null)}>Close</button>
					{#if detailMirror}
						<button type="button" class="btn-ghost" onclick={() => addDetail(false)}>Add this side</button>
						<button type="button" class="btn-primary" onclick={() => addDetail(true)}>Add both sides</button>
					{:else}
						<button type="button" class="btn-primary" onclick={() => addDetail(false)} disabled={!!blocked}>Add to canvas</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Request Modal ─────────────────────────── -->
{#if showRequestModal}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showRequestModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="req-title">
			<div class="modal__header">
				<div>
					<h2 class="modal__title" id="req-title">
						{requestType === "vehicle" ? "Request a vehicle" : requestType === "custom" ? "Request a custom pattern" : `Request a ${requestType} pattern`}
					</h2>
					<p class="modal__sub">
						{requestType === "vehicle" ? "We'll add verified patterns within 72 hours." : "Tell us what you're cutting and we'll add it to the queue."}
					</p>
				</div>
				<button class="modal__close" onclick={() => (showRequestModal = false)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>

			<form class="modal__body" onsubmit={(e) => { e.preventDefault(); submitRequest(); }}>
				<div class="req-types" role="radiogroup" aria-label="What kind of pattern">
					{#each PROJECT_TYPES as t (t.value)}
						<label class="req-type" class:req-type--active={requestType === t.value}>
							<input type="radio" name="req-type" value={t.value} bind:group={requestType} />
							{t.label}
						</label>
					{/each}
				</div>

				{#if requestType === "vehicle"}
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="req-year">Year <span class="muted">optional</span></label>
							<input id="req-year" type="number" class="form-input" bind:value={requestForm.year} min="1990" max={new Date().getFullYear() + 2} placeholder="Any" />
						</div>
						<div class="form-group" style="flex:2">
							<label class="form-label" for="req-make">Make</label>
							<input id="req-make" type="text" class="form-input" bind:value={requestForm.make} placeholder="e.g. Toyota" list="req-makes" autocomplete="off" required />
							<datalist id="req-makes">{#each reqMakes as m}<option value={m}></option>{/each}</datalist>
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="req-model">Model</label>
						<input id="req-model" type="text" class="form-input" bind:value={requestForm.model} placeholder="e.g. GR86" list="req-models" autocomplete="off" required />
						<datalist id="req-models">{#each reqModels as m}<option value={m}></option>{/each}</datalist>
					</div>
				{:else}
					<div class="form-group">
						<label class="form-label" for="req-what">
							{requestType === "custom" ? "What should the pattern be?" : "Window or glass you need"}
						</label>
						<input
							id="req-what"
							type="text"
							class="form-input"
							bind:value={requestForm.title}
							placeholder={requestType === "residential" ? "e.g. Andersen 400 double-hung, 3052" : requestType === "commercial" ? "e.g. Storefront transom, 96 × 24 in" : "e.g. Kitchen canister labels"}
							required
						/>
					</div>
				{/if}

				<div class="form-group">
					<label class="form-label" for="req-notes">Notes <span class="form-label__opt">(optional)</span></label>
					<input id="req-notes" type="text" class="form-input" bind:value={requestForm.notes} placeholder={requestType === "vehicle" ? "Any specific zones — PPF, tint, both?" : "Sizes, brand, film type — anything that helps"} />
				</div>

				{#if reqVoted}<div class="req-voted"><VoteSummary mine={reqMine} busy={reqBusy} onRemove={removeReqVote} gens={requestType === "vehicle" ? mediaFor(patternStore.media, requestForm.make, requestForm.model)?.generations ?? [] : []} /></div>{/if}

				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (showRequestModal = false)}>{reqVoted ? "Close" : "Cancel"}</button>
					<button type="submit" class="btn-primary" disabled={reqVoted || reqBusy}>{#if reqBusy}<Spinner />Sending…{:else}{reqVoted ? "Already voted" : "Submit request"}{/if}</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ─── Mirror Pair Add Dialog ───────────── -->
{#if mirrorTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (mirrorTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<div>
					<h2 class="modal__title">Add Mirror Pair</h2>
					<p class="modal__sub">Both sides are selected — uncheck to add only one.</p>
				</div>
				<button class="modal__close" onclick={() => (mirrorTarget = null)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="modal__body">
				<div class="mirror-opts">
					<label class="mirror-opt">
						<input type="checkbox" class="mirror-opt__check" bind:checked={mirrorAddOrig}/>
						<div class="mirror-opt__preview" aria-hidden="true">
							<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
								<path d={mirrorTarget.svgPath} use:fitPattern={{ w: mirrorTarget.widthInches, h: mirrorTarget.heightInches, d: mirrorTarget.svgPath }} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="2"/>
							</svg>
						</div>
						<div class="mirror-opt__info">
							<strong>{mirrorSidePair?.orig.label ?? "As uploaded"}</strong>
							<span>Original orientation</span>
						</div>
					</label>
					<label class="mirror-opt">
						<input type="checkbox" class="mirror-opt__check" bind:checked={mirrorAddFlip}/>
						<div class="mirror-opt__preview" aria-hidden="true">
							<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
								<path d={mirrorTarget.svgPath} use:fitPattern={{ w: mirrorTarget.widthInches, h: mirrorTarget.heightInches, d: mirrorTarget.svgPath, mirror: true }} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="2"/>
							</svg>
						</div>
						<div class="mirror-opt__info">
							<strong>{mirrorSidePair?.flip.label ?? "Mirrored"}</strong>
							<span>Horizontally flipped</span>
						</div>
					</label>
				</div>
				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (mirrorTarget = null)}>Cancel</button>
					<button
						type="button"
						class="btn-primary"
						disabled={!mirrorAddOrig && !mirrorAddFlip}
						onclick={() => {
							const pat = mirrorPat!;
							const pair = mirrorSidePair;
							if (mirrorAddOrig) addPatternToCanvas(pair
								? { ...pat, zone: pair.orig.zone, name: pair.orig.label }
								: pat);
							if (mirrorAddFlip) addPatternToCanvas(pair
								? { ...pat, zone: pair.flip.zone, name: pair.flip.label }
								: pat, true);
							mirrorTarget = null;
						}}
					>
						Add to Canvas
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Pattern Adjustment Request Modal ──── -->
{#if adjustTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (adjustTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<div>
					<h2 class="modal__title">Request Pattern Changes</h2>
					<p class="modal__sub">
						<strong>{adjustTarget.name}</strong> is a published community pattern.
						Describe the change needed — admin will review and update it.
					</p>
				</div>
				<button class="modal__close" onclick={() => (adjustTarget = null)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="modal__body">
				<div class="form-group">
					<label class="form-label" for="adj-notes">What needs to change?</label>
					<textarea
						id="adj-notes"
						class="form-input"
						style="resize:vertical;min-height:100px"
						bind:value={adjustNotes}
						placeholder="e.g. Hood width should be 62.5&quot; not 60.5&quot; — verified against physical vehicle 2026-06-01"
					></textarea>
				</div>
				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (adjustTarget = null)}>Cancel</button>
					<button
						type="button"
						class="btn-primary"
						disabled={adjustSending || !adjustNotes.trim()}
						onclick={submitAdjustmentRequest}
					>
						{adjustSending ? "Sending…" : "Send Request"}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.library {
		display: grid;
		grid-template-columns: 220px 1fr;
		height: 100%;
		overflow: hidden;
	}

	/* ─── Sidebar ────── */
	.library__sidebar {
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
		padding: 16px 12px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lib-search-block { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 14px; width: 100%; }
	.lib-search-wrap { position: relative; width: 100%; }
	.lib-search-tries { display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
	.lib-search-tries::-webkit-scrollbar { display: none; }
	.lib-search-tries__lead { flex: none; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
	.lib-search-try {
		flex: none;
		padding: 3px 10px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		font: inherit;
		font-size: 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.lib-search-try:hover { background: var(--bg-surface-2); color: var(--text-primary); border-color: var(--border-default); }
	.lib-search-try:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }

	.lib-search-icon {
		position: absolute;
		left: 13px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.lib-search {
		width: 100%;
		height: 44px;
		padding: 0 14px 0 40px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}

	.lib-search:focus { border-color: var(--color-brand-dim); }
	.lib-search::placeholder { color: var(--text-tertiary); }

	.lib-section-label {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 8px 4px 4px;
		margin-top: 8px;
	}

	.lib-filter-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 4px;
	}

	.lib-pill {
		padding: 4px 9px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}

	.lib-pill:hover { border-color: var(--border-default); color: var(--text-primary); }
	.lib-pill.active { background: var(--color-brand-dim); border-color: var(--color-brand-dim); color: #fff; }

	.lib-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin: 8px 0;
	}

	.lib-stat {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 8px 6px;
		text-align: center;
	}

	.lib-stat__val {
		display: block;
		font-family: var(--font-display);
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.lib-stat__label {
		display: block;
		font-size: 0.5625rem;
		color: var(--text-tertiary);
		margin-top: 1px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.lib-request-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 12px;
		margin-top: 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		justify-content: center;
	}

	.lib-request-btn:hover { border-color: var(--color-brand-dim); color: var(--text-brand); }

	/* ─── Main ────── */
	.library__main {
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.mode-switcher {
		display: flex;
		gap: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 3px;
		align-self: flex-start;
	}

	.mode-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.mode-btn:hover { color: var(--text-primary); }
	.mode-btn.active { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }

	.mode-switcher--full { display: flex; width: 100%; align-self: stretch; }
	.mode-btn--lg {
		flex: 1 1 0;
		justify-content: center;
		padding: 10px 16px;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.mode-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--bg-surface-3);
		font-size: 0.6875rem;
		font-weight: 700;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		line-height: 1;
	}
	.mode-btn.active .mode-count {
		background: var(--color-brand);
		color: #0a0a0a;
	}

	.library__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.library__title { font-size: 1.875rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 3px; }
	.library__sub   { font-size: 0.8125rem; color: var(--text-secondary); min-height: 1.2em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.library__header-actions { display: flex; align-items: center; gap: 4px; }

	.upload-cta {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 11px;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-brand) 45%, transparent);
		background: color-mix(in srgb, var(--color-brand) 10%, transparent);
		color: var(--color-brand);
		text-decoration: none;
		white-space: nowrap;
		transition: background 0.12s, border-color 0.12s;
	}
	.upload-cta:hover {
		background: color-mix(in srgb, var(--color-brand) 18%, transparent);
		border-color: var(--color-brand);
	}

	.view-divider {
		width: 1px;
		height: 18px;
		background: var(--border-default);
		margin: 0 4px;
	}

	.view-btn {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}

	.view-btn.active { background: var(--bg-surface-3); color: var(--text-primary); }
	.view-btn:hover  { color: var(--text-primary); }

	/* Vehicle grid */
	.vehicle-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px;
	}

	.vehicle-grid--list { grid-template-columns: 1fr; }

	.vehicle-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.vehicle-card:hover { border-color: var(--color-brand-dim); transform: translateY(-1px); box-shadow: var(--shadow-md); }

	.vehicle-grid--list .vehicle-card { flex-direction: row; align-items: center; }

	.vehicle-card__thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 50px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}

	.vehicle-grid--list .vehicle-card__thumb { width: 80px; }

	.vehicle-card__body { flex: 1; }
	.vehicle-card__year-make { font-size: 0.6875rem; color: var(--text-tertiary); margin-bottom: 2px; }
	.vehicle-card__model { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; font-family: var(--font-display); }
	.vehicle-card__meta { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }

	/* Empty */
	.lib-empty { grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 0; color: var(--text-tertiary); }
	.lib-empty__title { font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
	.lib-empty__sub   { font-size: 0.875rem; margin-bottom: 20px; }
	.lib-empty__request { background: none; border: none; color: var(--text-brand); cursor: pointer; font-size: inherit; text-decoration: underline; font-family: inherit; }
	.lib-empty__upload {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 20px;
		font-size: 0.9375rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-brand) 45%, transparent);
		background: color-mix(in srgb, var(--color-brand) 10%, transparent);
		color: var(--color-brand);
		text-decoration: none;
		white-space: nowrap;
		transition: background 0.12s, border-color 0.12s;
	}
	.lib-empty__upload:hover {
		background: color-mix(in srgb, var(--color-brand) 18%, transparent);
		border-color: var(--color-brand);
	}

	/* Zone browser */
	.zone-browser { display: flex; flex-direction: column; gap: 16px; }

	.zone-browser__header {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.zone-browser__title { font-size: 1.125rem; flex: 1; }

	.zone-browser__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

	.back-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		white-space: nowrap;
	}
	.back-btn:hover { color: var(--text-primary); background: var(--bg-surface-3); }

	.zone-empty {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 24px;
		color: var(--text-tertiary);
		font-size: 0.9375rem;
		text-align: center;
	}
	.zone-empty p { margin: 0; }
	.zone-empty__cta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-brand) 45%, transparent);
		background: color-mix(in srgb, var(--color-brand) 10%, transparent);
		color: var(--color-brand);
		text-decoration: none;
		transition: background 0.12s;
	}
	.zone-empty__cta:hover { background: color-mix(in srgb, var(--color-brand) 18%, transparent); }

	.zone-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 12px;
	}

	.zone-card {
		position: relative;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		aspect-ratio: 1 / 0.92;
		overflow: hidden;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
	}

	.zone-card:hover { border-color: var(--border-strong); box-shadow: 0 8px 22px -14px rgba(0, 0, 0, 0.4); }
	.zone-card:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }

	.zone-card.selected {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.04);
	}

	.zone-card--tint:hover    { border-color: var(--color-brand-dim); }
	.zone-card--tint.selected { border-color: var(--color-brand-dim); background: rgba(0, 112, 255, 0.05); }

	.zone-card__check {
		position: absolute;
		z-index: 2;
		top: 10px;
		right: 10px;
		width: 18px;
		height: 18px;
		background: var(--color-brand-dim);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
	}

	/* The pattern fills the whole card; the bar floats over its bottom edge. */
	.zone-card__preview {
		position: absolute;
		inset: 0;
		padding: 6px 6px 40px;
		background: var(--bg-surface-2);
	}
	.zone-card__preview svg { display: block; width: 100%; height: 100%; }

	.zone-card__bar {
		position: absolute;
		left: 0; right: 0; bottom: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 8px 8px 8px 10px;
		background: linear-gradient(to top, color-mix(in srgb, var(--bg-surface) 92%, transparent) 55%, transparent);
	}
	.zone-card__badges { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
	.zone-card__actions { display: flex; gap: 4px; flex: none; }
	.zone-card__icon {
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.zone-card__icon:hover { color: var(--text-primary); border-color: var(--color-brand-dim); }
	.zone-card__icon:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.zone-card__add:hover { background: var(--color-brand-dim); color: #fff; border-color: transparent; }

	/* ─── Modal ───── */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		width: 460px;
		max-width: 95vw;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}

	.modal__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.modal__title { font-size: 1.0625rem; font-weight: 600; }
	.modal__sub   { font-size: 0.8125rem; color: var(--text-tertiary); margin-top: 3px; }

	.modal__close {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		flex-shrink: 0;
	}
	.modal__close:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.modal__body {
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}

	.form-row { display: flex; gap: 10px; }
	.form-group { display: flex; flex-direction: column; gap: 5px; flex: 1; }

	.form-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		font-family: var(--font-mono);
	}
	.form-label__opt { font-weight: 400; color: var(--text-tertiary); }

	.form-input {
		padding: 7px 10px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
		width: 100%;
	}
	.form-input:focus { border-color: var(--color-brand-dim); }

	.btn-primary {
		padding: 7px 16px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		background: var(--color-brand-dim);
		border: none;
		border-radius: var(--radius-md);
		color: #fff;
		cursor: pointer;
		transition: background 0.12s;
	}
	.btn-primary:hover { background: var(--color-brand); }

	.btn-ghost {
		padding: 7px 16px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.btn-ghost:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	/* ─── Vehicle drill-down ─── */
	.vb { display: flex; flex-direction: column; gap: 16px; }

	.vb-grid { display: grid; gap: 14px; }
	.vb-grid--make  { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
	.vb-grid--model { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
	.vb-grid--trim  { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }

	.crumbs {
		min-height: 32px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px 4px;
		font-size: 0.8125rem;
	}
	.crumb {
		padding: 4px 8px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		font: inherit;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	button.crumb:hover { background: var(--bg-surface-2); color: var(--color-brand-dim); }
	button.crumb:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.crumb--current { color: var(--text-primary); cursor: default; }
	.crumb-sep { color: var(--text-tertiary); }

	.zone-card__year {
		position: absolute;
		z-index: 1;
		top: 10px;
		left: 10px;
		padding: 1px 7px;
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.zone-card__year:empty { display: none; }

	/* Sidebar tree is a desktop affordance; ≤768px it opens as a sheet. */
	.lib-browse-btn { display: none; }

	.sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-end;
		animation: sheet-fade 0.15s ease-out;
	}
	.sheet {
		width: 100%;
		max-height: 82dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
		border-top: 1px solid var(--border-default);
		padding-bottom: env(safe-area-inset-bottom);
		animation: sheet-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.sheet__grab { width: 36px; height: 4px; border-radius: 2px; background: var(--border-default); margin: 8px auto 0; }
	.sheet__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		font-family: var(--font-display);
		font-weight: 600;
	}
	.sheet__close {
		width: 32px; height: 32px;
		display: grid; place-items: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: 50%;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.sheet__body { overflow-y: auto; padding: 4px 12px 16px; }
	@keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
	@keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }

	/* Wider screens: roomier sidebar for the tree, bigger tiles. */
	@media (min-width: 1200px) {
		.library { grid-template-columns: 260px 1fr; }
	}
	@media (min-width: 1600px) {
		.library { grid-template-columns: 300px 1fr; }
		.library__main { padding: 28px 36px; }
		.vb-grid--make  { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
		.vb-grid--model { grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); }
		.vb-grid--trim  { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
	}
	/* Ultrawide: keep the content a readable width instead of stretching forever. */
	@media (min-width: 2200px) {
		.library { grid-template-columns: 320px 1fr; }
		.library__main { padding-inline: max(36px, calc((100% - 2000px) / 2)); }
	}

	/* Responsive */
	@media (max-width: 768px) {
		.library { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
		.lib-tree { display: none; }
		.lib-browse-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
			max-width: 220px;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.vb-grid--make  { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
		.vb-grid--model { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
		.vb-grid--trim  { grid-template-columns: 1fr; gap: 10px; }

		.library__main { padding: 14px; }
		.library__header { flex-direction: column; align-items: stretch; gap: 10px; }
		.library__header-actions { justify-content: space-between; }
	}

	@media (max-width: 480px) {
		.mode-btn--lg { padding: 8px 6px; font-size: 0.75rem; }
	}

	/* Touch devices have no hover — the per-card add affordance must stay visible,
	   not appear only on :hover (which never fires on touch). */
	@media (hover: none) {
		.zone-card__add { opacity: 1; }
	}


	/* ─── Library / My Patterns tab bar ─── */

	/* ─── My Patterns panel ─── */

	/* ─── My Pattern card ─── */


	/* ─── Mirror pair add dialog ─── */
	.mirror-opts {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 16px;
	}
	.mirror-opt {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.mirror-opt:hover {
		border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
		background: color-mix(in srgb, var(--color-brand) 4%, transparent);
	}
	.mirror-opt:has(.mirror-opt__check:checked) {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 6%, transparent);
	}
	.mirror-opt__check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		cursor: pointer;
		accent-color: var(--color-brand);
	}
	.mirror-opt__preview {
		width: 52px;
		height: 52px;
		background: var(--bg-surface-3);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		padding: 4px;
		box-sizing: border-box;
	}
	.mirror-opt__preview svg { width: 100%; height: 100%; }
	.mirror-opt__info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mirror-opt__info strong { font-size: 0.875rem; color: var(--text-primary); font-weight: 600; }
	.mirror-opt__info span   { font-size: 0.75rem;  color: var(--text-tertiary); }

	/* ─── Counts, empty states, My patterns detail ─── */
	.lib-pill__count { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); margin-left: 2px; }
	.lib-pill.active .lib-pill__count { color: inherit; opacity: 0.75; }
	.lib-request-btn { text-decoration: none; }
	.zone-grid[hidden] { display: none; }
	.req-voted { padding: 10px 12px; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
	.muted { color: var(--text-tertiary); font-weight: 400; }
	.mode-btn--empty:not(.active) { opacity: 0.55; }
	button.zone-empty__cta { background: transparent; color: var(--text-brand); cursor: pointer; font-family: var(--font-body); }
	button.zone-card__add { border: none; font: inherit; }


	/* Request modal: subject type picker */
	.req-types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
	.req-type {
		position: relative; cursor: pointer;
		padding: 5px 12px; border-radius: 999px;
		border: 1px solid var(--border-default); background: var(--bg-surface-2);
		font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary);
	}
	.req-type input { position: absolute; opacity: 0; pointer-events: none; }
	.req-type:has(input:focus-visible) { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.req-type--active { background: var(--bg-surface-3); border-color: var(--color-brand); color: var(--text-primary); }

	/* Pattern detail dialog */
	.modal--detail { width: 560px; max-height: 92vh; overflow-y: auto; }
	.pd { display: flex; flex-direction: column; gap: 14px; }
	.pd__preview :global(.pp--large .pp__frame) { height: 260px; }
	.pd__facts {
		display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px 16px; margin: 0;
	}
	.pd__facts dt { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); margin-bottom: 2px; }
	.pd__facts dd { margin: 0; font-size: 0.875rem; color: var(--text-primary); }
	.pd__muted { color: var(--text-tertiary); font-size: 0.75rem; }
	.pd__notes {
		padding: 10px 12px; border-radius: var(--radius-md);
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
	}
	.pd__notes-title { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); margin-bottom: 4px; }
	.pd__notes p { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; }
	.pd__mirror {
		display: flex; align-items: center; gap: 12px;
		padding: 10px 12px; border-radius: var(--radius-md);
		border: 1px dashed var(--border-default);
	}
	.pd__mirror-previews { display: flex; gap: 6px; flex-shrink: 0; }
	.pd__flip { display: inline-flex; transform: scaleX(-1); }
	.pd__mirror-text { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.45; }
	.pd__mirror-text strong { color: var(--text-primary); }
	/* ─── Source switch (All / Community / Private) ─── */
	.library__heading { min-width: 0; }
	.library__header-actions { flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
	.src-switch {
		display: inline-flex;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 3px;
	}
	.src-btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 5px 11px; font: inherit; font-size: 0.8125rem; font-weight: 500;
		background: transparent; border: none; border-radius: var(--radius-md);
		color: var(--text-tertiary); cursor: pointer; white-space: nowrap;
		transition: background 0.15s, color 0.15s;
	}
	.src-btn:hover { color: var(--text-primary); }
	.src-btn.active { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
	.src-btn.active .mode-count { background: var(--color-brand); color: #0a0a0a; }

	.lib-banner {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		padding: 10px 14px; font-size: 0.8125rem; color: var(--color-danger);
		background: color-mix(in srgb, var(--color-danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
		border-radius: var(--radius-md);
	}

	/* Chips over a card's preview: years/trim, Private, status */
	.zone-card__tags {
		position: absolute; z-index: 1; top: 10px; left: 10px; right: 36px;
		display: flex; flex-wrap: wrap; gap: 4px; pointer-events: none;
	}
	.zc-tag {
		display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px;
		border-radius: 999px; font-size: 0.6875rem; line-height: 1.5;
		background: var(--bg-surface-3); color: var(--text-secondary); pointer-events: auto;
	}
	.zc-tag--mono { font-family: var(--font-mono); color: var(--text-primary); }
	.zc-tag--pending   { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
	.zc-tag--published { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
	.zc-tag--rejected  { background: color-mix(in srgb, var(--color-danger) 14%, transparent); color: var(--color-danger); }
	a.zone-card__icon { text-decoration: none; }
	.zone-card__icon:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Detail dialog: the owner's own status + manage row */
	.pd__own { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
	.pd__own p { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.45; }
	.pd__warn { color: var(--color-danger) !important; }
	.pd__manage { display: flex; flex-wrap: wrap; gap: 6px; }
	.pd__mbtn {
		display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px;
		font: inherit; font-size: 0.8125rem; font-weight: 500; text-decoration: none;
		background: var(--bg-surface-2); color: var(--text-secondary);
		border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer;
	}
	.pd__mbtn:hover { color: var(--text-primary); border-color: var(--color-brand-dim); }
	.pd__mbtn--danger:hover { color: var(--color-danger); border-color: var(--color-danger); }
	.pd__mbtn:disabled { opacity: 0.5; cursor: not-allowed; }

	@media (max-width: 768px) {
		.library__header-actions { justify-content: space-between; }
		.src-switch { width: 100%; }
		.src-btn { flex: 1; justify-content: center; }
	}

	/* ─── Stable layout: switching type / category / source never moves the controls ─── */
	.library__main, .library__sidebar { scrollbar-gutter: stable; }
	.library__header { min-height: 64px; }
	.library__header-actions { flex-wrap: nowrap; }
	.view-toggle { display: inline-flex; align-items: center; gap: 4px; }
	.view-toggle--off { visibility: hidden; }
	.cat-row { min-height: 42px; }
	.mode-count, .lib-pill__count, .lib-stat__val, .src-btn .mode-count { font-variant-numeric: tabular-nums; }
	.mode-btn--lg { min-width: 0; }
	.lib-side-foot {
		margin-top: auto; position: sticky; bottom: -16px; z-index: 1;
		display: flex; flex-direction: column; gap: 4px;
		padding: 8px 0 0; background: var(--bg-surface);
	}
	.lib-stats { min-height: 52px; }
	/* ─── Filter groups v2: one rhythm, controls sized to their content ─── */
	.lib-fgroup { display: flex; flex-direction: column; gap: 6px; padding: 12px 4px 14px; border-bottom: 1px solid var(--border-subtle); }
	.lib-fgroup__head { display: flex; align-items: center; justify-content: space-between; min-height: 18px; }
	.lib-fgroup .lib-section-label { padding: 0; margin: 0; }
	.lib-fgroup__clear { background: none; border: none; padding: 0; font: inherit; font-size: 0.6875rem; color: var(--text-brand); cursor: pointer; }
	.lib-fgroup__clear:hover { text-decoration: underline; }

	/* Years: a 4-up grid, three rows tall, scrolling inside with a fade hint. */
	.lib-years {
		display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;
		padding: 1px;
	}
	.lib-years::-webkit-scrollbar { width: 6px; }
	.lib-years::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 99px; }
	.lib-year {
		height: 40px; padding: 0; font: inherit; font-size: 0.9375rem; font-weight: 500; font-variant-numeric: tabular-nums;
		color: var(--text-secondary); background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md); cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.lib-year--all { grid-column: 1 / -1; }
	.lib-year--gen { grid-column: 1 / -1; height: 46px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
	.lib-year__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.0625rem; font-weight: 600; }
	.lib-year__span { font-family: var(--font-mono); font-size: 0.9375rem; opacity: 0.85; white-space: nowrap; }
	.lib-year:hover { border-color: var(--border-default); color: var(--text-primary); }
	.lib-year.active { background: var(--color-brand-dim); border-color: var(--color-brand-dim); color: #fff; }

	/* Segmented control (two-way choices) */
	.lib-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 2px; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.lib-seg__btn { height: 28px; padding: 0 6px; font: inherit; font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); background: none; border: none; border-radius: calc(var(--radius-md) - 2px); cursor: pointer; white-space: nowrap; transition: background 0.12s, color 0.12s; }
	.lib-seg__btn:hover { color: var(--text-primary); }
	.lib-seg__btn.active { background: var(--color-brand-dim); color: #fff; }

	/* Option rows: label left, count right */
	.lib-opts { display: flex; flex-direction: column; gap: 2px; }
	.lib-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 30px; padding: 0 10px; font: inherit; font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); background: none; border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; text-align: left; transition: background 0.12s, color 0.12s; }
	.lib-opt:hover { background: var(--bg-surface-2); color: var(--text-primary); }
	.lib-opt.active { background: color-mix(in srgb, var(--color-brand-dim) 14%, transparent); border-color: color-mix(in srgb, var(--color-brand-dim) 40%, transparent); color: var(--text-primary); }
	.lib-opt .lib-pill__count { margin: 0; }
	.lib-year:focus-visible, .lib-seg__btn:focus-visible, .lib-opt:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
	.lib-tree { margin-top: 4px; }
	@media (max-width: 1100px) {
		.library__header-actions { flex-wrap: wrap; }
	}
	@media (max-width: 768px) {
		.library__header { min-height: 0; }
		.library__header-actions { flex-wrap: wrap; }
		.view-toggle--off { display: none; }
		.lib-side-foot { display: contents; }
		.cat-row { min-height: 0; }
	}

	/* ─── Mobile v2: toolbar, header and nav controls ─── */
	.lib-filters-desktop { display: contents; }
	.lib-filter-btn { display: none; }

	.sheet__head-right { display: flex; align-items: center; gap: 8px; }
	.sheet__reset { background: none; border: none; padding: 6px 8px; font: inherit; font-size: 0.875rem; color: var(--text-brand); cursor: pointer; }
	.sheet__foot { padding: 10px 16px 14px; border-top: 1px solid var(--border-subtle); }
	.sheet__done {
		width: 100%; height: 44px; border: none; border-radius: var(--radius-md);
		background: var(--color-brand-dim); color: #fff;
		font: inherit; font-weight: 600; cursor: pointer;
	}
	.sheet__body .lib-pill { padding: 8px 14px; min-height: 38px; font-size: 0.875rem; }
	.sheet__body .lib-years { max-height: none; overflow: visible; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; -webkit-mask-image: none; mask-image: none; margin-right: 0; }
	.sheet__body .lib-year, .sheet__body .lib-seg__btn { height: 40px; font-size: 0.875rem; }
	.sheet__body .lib-opt { height: 40px; font-size: 0.9375rem; }
	.sheet__body .lib-fgroup .lib-section-label { padding-top: 0; }
	.sheet__body .lib-section-label { padding-top: 14px; }
	.sheet__body .lib-request-btn { margin-top: 18px; padding: 11px 12px; }

	@media (max-width: 768px) {
		/* Toolbar: search + Filters on one row, vehicle browse on the next */
		.lib-filters-desktop { display: none; }
		.library__sidebar {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			overflow: visible;
			border-right: none;
			border-bottom: 1px solid var(--border-subtle);
			padding: 10px 12px;
			gap: 8px;
		}
		.lib-search { height: 42px; font-size: 1rem; }
		.lib-filter-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			flex: none;
			height: 40px;
			padding: 0 12px;
			font-size: 0.875rem;
		}
		.lib-filter-btn.has-filters { border-color: var(--color-brand-dim); color: var(--text-primary); }
		.lib-filter-btn__n {
			display: inline-grid;
			place-items: center;
			min-width: 18px;
			height: 18px;
			padding: 0 5px;
			border-radius: 9px;
			background: var(--color-brand);
			color: #0a0a0a;
			font-family: var(--font-mono);
			font-size: 0.6875rem;
			font-weight: 700;
		}
		.lib-browse-btn {
			flex: 1 1 100%;
			max-width: none;
			height: 40px;
			padding: 0 12px;
			font-size: 0.875rem;
			justify-content: flex-start;
		}
		.lib-side-foot .lib-section-label,
		.lib-stats { display: none; }

		/* Scrollable (overflow ≠ visible) flex items can shrink to 0 height inside
		   the scrolling column and overlap their neighbours — never let them. */
		.library__main > * { flex-shrink: 0; }
		.lib-request-btn--in-sheet { display: none; }
		.library__sidebar .lib-request-btn { margin-top: 0; width: auto; flex: none; height: 40px; white-space: nowrap; }

		/* Header: title + upload + view toggle, then the source switch full width */
		.library__title { font-size: 1.5rem; margin-bottom: 1px; }
		.library__header {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			align-items: center;
			gap: 10px 8px;
		}
		.library__header-actions { display: contents; }
		.library__heading { grid-column: 1; grid-row: 1; }
		.upload-cta { grid-column: 2; grid-row: 1; height: 36px; padding: 0 12px; }
		.view-toggle { grid-column: 3; grid-row: 1; }
		.view-divider { display: none; }
		.view-btn { width: 36px; height: 36px; }
		.src-switch { grid-column: 1 / -1; grid-row: 2; width: 100%; }
		.src-btn { flex: 1; justify-content: center; min-height: 36px; }

		/* Type + category switchers scroll sideways instead of cramming */
		.mode-switcher {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
			-webkit-overflow-scrolling: touch;
		}
		.mode-switcher::-webkit-scrollbar { display: none; }
		.mode-btn { flex: 0 0 auto; min-height: 38px; }
		.mode-switcher--full .mode-btn--lg { flex: 1 0 auto; padding: 9px 14px; font-size: 0.875rem; }

		.crumb { padding: 7px 10px; }
	}

	@media (max-width: 400px) {
		.upload-cta__text { display: none; }
		.upload-cta { width: 36px; padding: 0; justify-content: center; }
	}
</style>
