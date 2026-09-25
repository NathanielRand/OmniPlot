<script lang="ts">
	import { toastStore, canvasStore, userStore, confirmStore } from "$lib/stores";
	import {
		patternStore, TINT_ZONE_GROUP, PPF_ZONE_GROUP, MIRROR_PAIRS, PATTERN_CATEGORIES,
		zoneLabel, categoryShortLabel, categoryLabel, categoryMeta,
	} from "$lib/stores/patternStore.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { uid, getItemColor } from "$lib/utils";
	import { bestNest } from "$lib/utils/nesting";
	import { getUserPatterns, updateUserPattern, deleteUserPattern, addPatternAdjustmentRequest } from "$lib/firebase/firestore";
	import { tooltip } from "$lib/actions/tooltip";
	import type { CanvasItem, Pattern, PatternCategory, PatternZone, ProjectType, UserPattern } from "$lib/types";
	import { fitPattern } from "$lib/actions/fitPattern";
	import { sizeError } from "$lib/utils/patternSize";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";

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
		return [v.year, v.make, v.model].filter(Boolean).join(" ");
	}

	// ─── State ────────────────────────────────────
	// ?tab=mine deep-links to My patterns (the upload/edit pages return here).
	let tab            = $state<"library" | "mine">(page.url.searchParams.get("tab") === "mine" ? "mine" : "library");
	function setTab(t: "library" | "mine") {
		tab = t;
		const url = new URL(page.url);
		if (t === "mine") url.searchParams.set("tab", "mine"); else url.searchParams.delete("tab");
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}
	let projectType    = $state<ProjectType>("vehicle");
	let category       = $state<PatternCategory>("ppf");
	let search         = $state("");
	let activeMake     = $state("All");
	let activeYear     = $state("All");
	let activeZone     = $state("All zones");
	let selectedVehicle = $state<VehicleEntry | null>(null);
	let view           = $state<"grid" | "list">("grid");
	let selectedPatternIds = $state<Set<string>>(new Set());

	// ─── What this account can see ────────────────
	// The community library is published subjects and their published
	// patterns — nothing else. Every count, filter option and list on this
	// tab derives from `visible`, so a number can never promise a pattern
	// that isn't actually shown.
	const visible = $derived(
		patternStore.vehicles
			.filter((v) => v.status === "published")
			.map((v) => ({ v, pats: patternStore.getPatterns(v.id, undefined, true) }))
			.filter((x) => x.pats.length > 0),
	);

	const typeCounts = $derived(
		visible.reduce((acc, x) => {
			acc[typeOf(x.v)] = (acc[typeOf(x.v)] ?? 0) + x.pats.length;
			return acc;
		}, {} as Record<string, number>),
	);

	// Categories that actually have patterns for the chosen subject type.
	const categoriesForType = $derived(
		PATTERN_CATEGORIES
			.map((c) => ({
				...c,
				count: visible
					.filter((x) => typeOf(x.v) === projectType)
					.reduce((n, x) => n + x.pats.filter((p) => p.category === c.value).length, 0),
			}))
			.filter((c) => c.count > 0),
	);

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
			.filter((x) => x.pats.length > 0),
	);

	// ─── Zone groups ──────────────────────────────
	// Vehicle PPF/tint zones roll up into familiar groups ("Doors", "Side
	// Windows"); everything else groups by its own zone name.
	const ZONE_GROUP_ORDER: Record<string, string[]> = {
		ppf: ["Hood", "Fenders", "Bumpers", "Doors", "Mirrors", "Rocker Panels", "Roof", "Trunk"],
		"window-tint": ["Windshield", "Side Windows", "Rear Window", "Sunroof", "Quarter / Vent"],
	};
	function zoneGroup(p: Pattern, t: ProjectType = projectType): string {
		if (t === "vehicle") {
			const map: Partial<Record<PatternZone, string>> = p.category === "ppf" ? PPF_ZONE_GROUP : p.category === "window-tint" ? TINT_ZONE_GROUP : {};
			const g = map[p.zone];
			if (g) return g;
		}
		return zoneLabel(p.zone, p.category, t, p.customZoneLabel);
	}
	const inZone = (p: Pattern) => activeZone === "All zones" || zoneGroup(p) === activeZone;

	// ─── Vehicle filters (vehicle subjects only, never blank) ──
	const MAKES = $derived(
		["All", ...new Set(
			inScope.filter((x) => typeOf(x.v) === "vehicle" && x.v.make).map((x) => x.v.make!).sort((a, b) => a.localeCompare(b)),
		)],
	);
	const YEARS = $derived(
		["All", ...new Set(
			inScope
				.filter((x) => typeOf(x.v) === "vehicle" && x.v.year)
				.filter((x) => activeMake === "All" || x.v.make === activeMake)
				.map((x) => String(x.v.year))
				.sort((a, b) => Number(b) - Number(a)),
		)],
	);

	// Year options are scoped to the make; a make with no such year resets it.
	$effect(() => {
		if (!YEARS.includes(activeYear)) activeYear = "All";
	});
	$effect(() => {
		if (!MAKES.includes(activeMake)) activeMake = "All";
	});
	$effect(() => {
		if (!ZONES.includes(activeZone)) activeZone = "All zones";
	});

	// ─── Subjects shown ───────────────────────────
	// Everything except the zone filter — zone counts are taken from here so a
	// pill's number is exactly what clicking it will show.
	const baseFiltered = $derived(
		inScope.filter((x) => {
			const v = x.v;
			const q = search.trim().toLowerCase();
			const matchSearch = !q || `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.propertyLabel ?? ""} ${v.address ?? ""}`.toLowerCase().includes(q);
			const isVehicle = typeOf(v) === "vehicle";
			const matchMake = !isVehicle || activeMake === "All" || v.make === activeMake;
			const matchYear = !isVehicle || activeYear === "All" || String(v.year) === activeYear;
			return matchSearch && matchMake && matchYear;
		}),
	);

	const filtered = $derived(
		baseFiltered
			.map((x) => ({ ...x, shown: x.pats.filter(inZone) }))
			.filter((x) => x.shown.length > 0),
	);

	// Zone pills + counts: the open subject's patterns, else every subject the
	// other filters leave.
	const zoneSource = $derived(
		selectedVehicle
			? patternStore.getPatterns(selectedVehicle.id, category, true)
			: baseFiltered.flatMap((x) => x.pats),
	);
	const zoneCounts = $derived(
		zoneSource.reduce((acc, p) => {
			const g = zoneGroup(p);
			acc[g] = (acc[g] ?? 0) + 1;
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
	const stats = $derived({
		patterns: filtered.reduce((n, x) => n + x.shown.length, 0),
		subjects: filtered.length,
	});

	function switchProjectType(p: ProjectType) {
		projectType = p;
		selectedVehicle = null;
		activeMake = "All";
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

	// ─── Selected subject's patterns ──────────────
	const vehiclePatterns = $derived(
		selectedVehicle ? patternStore.getPatterns(selectedVehicle.id, category, true) : [],
	);
	const visibleStorePatterns = $derived(vehiclePatterns.filter(inZone));
	const useStorePatterns = $derived(vehiclePatterns.length > 0);

	// Leaving a subject that no longer has patterns in this category.
	$effect(() => {
		if (selectedVehicle && !patternStore.vehicles.some((v) => v.id === selectedVehicle!.id && v.status === "published")) {
			selectedVehicle = null;
		}
	});

	const pieceWord = $derived(category === "window-tint" ? "windows" : "patterns");

	// ─── Pattern detail dialog ────────────────────
	let detailPattern = $state<Pattern | null>(null);

	// "Add both sides": the subject's own pattern for the opposite zone when it
	// has one, otherwise a mirrored copy of this one.
	const detailMirror = $derived.by(() => {
		const p = detailPattern;
		if (!p) return null;
		const m = MIRROR_PAIRS[p.zone];
		if (!m) return null;
		const t = p.projectType ?? (selectedVehicle ? typeOf(selectedVehicle) : projectType);
		const partner = vehiclePatterns.find((x) => x.zone === m && x.id !== p.id) ?? null;
		return { zone: m, label: zoneLabel(m, p.category, t), partner };
	});

	function addDetail(both: boolean) {
		const p = detailPattern;
		if (!p) return;
		addPatternToCanvas(p);
		if (both && detailMirror) {
			if (detailMirror.partner) addPatternToCanvas(detailMirror.partner);
			else addPatternToCanvas({ ...p, zone: detailMirror.zone, name: detailMirror.label }, true);
		}
		detailPattern = null;
	}

	const cm = (inches: number) => (inches * 2.54).toFixed(1);

	// ─── My Patterns ──────────────────────────────
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
			.catch(() => { myPatternsError = "Could not load your patterns."; })
			.finally(() => { myPatternsLoading = false; });
	}
	$effect(() => {
		const id = userStore.user?.uid;
		if (!id || id === loadedForUid) return;
		loadedForUid = id;
		loadMyPatterns(id);
	});

	type MineStatus = "all" | "private" | "pending" | "published" | "rejected";
	let mineStatus   = $state<MineStatus>("all");
	let mineCategory = $state<"all" | PatternCategory>("all");
	let mineSearch   = $state("");

	function mineStatusOf(p: UserPattern): Exclude<MineStatus, "all"> {
		if (p.isPublished) return "published";
		if (p.status === "pending") return "pending";
		if (p.status === "rejected") return "rejected";
		return "private";
	}
	const MINE_STATUS_LABEL: Record<Exclude<MineStatus, "all">, string> = {
		private: "Private", pending: "In review", published: "Published", rejected: "Not approved",
	};
	const mineStatusCounts = $derived(
		myPatterns.reduce((acc, p) => { const s = mineStatusOf(p); acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<string, number>),
	);
	const mineCategories = $derived(PATTERN_CATEGORIES.filter((c) => myPatterns.some((p) => p.category === c.value)));

	function mySubjectLabel(p: UserPattern): string {
		if ((p.projectType ?? "vehicle") !== "vehicle") return p.propertyLabel || p.patternName || p.address || "";
		return [p.years.join(", "), p.make, p.models.join(" / ")].filter(Boolean).join(" ");
	}

	const shownMine = $derived(
		myPatterns.filter((p) => {
			if (mineStatus !== "all" && mineStatusOf(p) !== mineStatus) return false;
			if (mineCategory !== "all" && p.category !== mineCategory) return false;
			const q = mineSearch.trim().toLowerCase();
			return !q || `${p.name} ${mySubjectLabel(p)} ${compactZones(p)}`.toLowerCase().includes(q);
		}),
	);

	async function toggleCommunitySubmit(p: UserPattern) {
		const next = !p.submitToCommunity;
		if (next) {
			const ok = await confirmStore.ask({
				title: `Submit "${p.name}" to the community library?`,
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
				{ label: "Size", value: `${p.widthInches}" × ${p.heightInches}"` },
			],
			variant: "danger",
			confirmLabel: "Delete pattern",
		});
		if (!ok) return;
		deleting = new Set([...deleting, p.id]);
		try {
			await deleteUserPattern(p.id);
			myPatterns = myPatterns.filter((m) => m.id !== p.id);
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

	// Convert a UserPattern to a Pattern for canvas
	function userPatternToPattern(up: UserPattern): Pattern {
		const zone = up.zones[0] ?? "custom";
		return {
			id:           up.id,
			vehicleId:    up.vehicleId ?? `user_${up.ownerId}`,
			projectType:  up.projectType,
			category:     up.category,
			zone,
			customZoneLabel: zone === "custom" ? up.customZoneLabels?.[0] : undefined,
			name:         up.name,
			coverage:     up.coverage,
			svgPath:      up.svgPath,
			widthInches:  up.widthInches,
			heightInches: up.heightInches,
			revision:     new Date(up.createdAt).toISOString().slice(0, 7),
			notes:        up.notes,
			isPublished:  up.isPublished,
			createdAt:    up.createdAt,
			updatedAt:    up.updatedAt,
		};
	}

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
	let requestForm = $state({ year: new Date().getFullYear(), make: "", model: "", title: "", notes: "" });
	function openRequest(t: ProjectType = projectType) {
		requestType = t;
		showRequestModal = true;
	}

	// ─── Add store pattern to canvas ─────────────
	// PRECISION: the pattern goes onto the canvas exactly as stored — same
	// svgPath, same widthInches × heightInches. The packer may only choose
	// position and rotation; it never resizes or re-proportions a piece.
	function addPatternToCanvas(pattern: Pattern, flippedH = false) {
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
				`${pattern.name}${suffix} — ${pattern.widthInches}" × ${pattern.heightInches}"${placed?.rotation ? " (rotated)" : ""}`,
			);
		}
	}

	// ─── Batch add (selected patterns) ──────────
	function addAllSelected() {
		if (!selectedVehicle || !useStorePatterns) return;
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
	function submitRequest() {
		const { year, make, model, title, notes } = requestForm;
		if (requestType === "vehicle") {
			if (!make.trim() || !model.trim()) return;
			patternStore.addRequest({ projectType: "vehicle", year, make: make.trim(), model: model.trim(), notes: notes.trim() });
			toastStore.success("Request submitted!", `${year} ${make.trim()} ${model.trim()} has been added to the queue.`);
		} else {
			if (!title.trim()) return;
			patternStore.addRequest({ projectType: requestType, year: 0, make: typeMeta(requestType).label, model: title.trim(), notes: notes.trim() });
			toastStore.success("Request submitted!", `"${title.trim()}" has been added to the queue.`);
		}
		showRequestModal = false;
		requestForm = { year: new Date().getFullYear(), make: "", model: "", title: "", notes: "" };
	}

	const BODY_STYLE_ICON: Record<string, string> = {
		sedan:       "M2 14 L6 8 L18 8 L22 14 Z",
		coupe:       "M3 14 L7 7 L17 7 L21 14 Z",
		suv:         "M2 14 L4 6 L20 6 L22 14 Z",
		truck:       "M2 14 L4 8 L12 8 L12 6 L20 6 L22 14 Z",
		hatchback:   "M2 14 L5 8 L19 8 L22 11 L22 14 Z",
		wagon:       "M2 14 L4 7 L20 7 L22 14 Z",
		convertible: "M3 14 L8 10 L16 10 L21 14 Z",
	};
</script>

<svelte:head>
	<title>Pattern Library — OmniPlot</title>
</svelte:head>

<div class="library">
	<!-- ─── Sidebar ─── -->
	<aside class="library__sidebar">
		{#if tab === "library"}
			<div class="lib-search-wrap">
				<svg class="lib-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
				<input
					type="search"
					class="lib-search"
					placeholder={projectType === "vehicle" ? "Search make, model, year…" : "Search by name or address…"}
					bind:value={search}
					aria-label="Search {typeMeta(projectType).nounPlural}"
				/>
			</div>

			{#if projectType === "vehicle" && MAKES.length > 2}
				<div class="lib-section-label">Make</div>
				<div class="lib-filter-pills">
					{#each MAKES as make}
						<button class="lib-pill" class:active={activeMake === make} onclick={() => (activeMake = make)} aria-pressed={activeMake === make}>{make}</button>
					{/each}
				</div>
			{/if}

			{#if projectType === "vehicle" && YEARS.length > 2}
				<div class="lib-section-label">Year</div>
				<div class="lib-filter-pills">
					{#each YEARS as year}
						<button class="lib-pill" class:active={activeYear === year} onclick={() => (activeYear = year)} aria-pressed={activeYear === year}>{year}</button>
					{/each}
				</div>
			{/if}

			{#if ZONES.length > 2}
				<div class="lib-section-label">Zone</div>
				<div class="lib-filter-pills">
					{#each ZONES as zone}
						<button class="lib-pill" class:active={activeZone === zone} onclick={() => (activeZone = zone)} aria-pressed={activeZone === zone}>
							{zone} <span class="lib-pill__count">{zone === "All zones" ? zoneSource.length : zoneCounts[zone] ?? 0}</span>
						</button>
					{/each}
				</div>
			{/if}

			<div class="lib-section-label">Showing</div>
			<div class="lib-stats">
				<div class="lib-stat">
					<span class="lib-stat__val">{stats.patterns}</span>
					<span class="lib-stat__label">{categoryShortLabel(category)} {pieceWord}</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{stats.subjects}</span>
					<span class="lib-stat__label">{stats.subjects === 1 ? typeMeta(projectType).noun : typeMeta(projectType).nounPlural}</span>
				</div>
			</div>

			<button class="lib-request-btn" onclick={() => openRequest()}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
				{projectType === "vehicle" ? "Request a vehicle" : projectType === "custom" ? "Request a pattern" : "Request a property pattern"}
			</button>
		{:else}
			<div class="lib-search-wrap">
				<svg class="lib-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
				<input type="search" class="lib-search" placeholder="Search your patterns…" bind:value={mineSearch} aria-label="Search your patterns" />
			</div>

			<div class="lib-section-label">Status</div>
			<div class="lib-filter-pills">
				<button class="lib-pill" class:active={mineStatus === "all"} aria-pressed={mineStatus === "all"} onclick={() => (mineStatus = "all")}>All <span class="lib-pill__count">{myPatterns.length}</span></button>
				{#each (["private", "pending", "published", "rejected"] as const) as s}
					{#if mineStatusCounts[s]}
						<button class="lib-pill" class:active={mineStatus === s} aria-pressed={mineStatus === s} onclick={() => (mineStatus = s)}>{MINE_STATUS_LABEL[s]} <span class="lib-pill__count">{mineStatusCounts[s]}</span></button>
					{/if}
				{/each}
			</div>

			{#if mineCategories.length > 1}
				<div class="lib-section-label">Category</div>
				<div class="lib-filter-pills">
					<button class="lib-pill" class:active={mineCategory === "all"} aria-pressed={mineCategory === "all"} onclick={() => (mineCategory = "all")}>All</button>
					{#each mineCategories as c (c.value)}
						<button class="lib-pill" class:active={mineCategory === c.value} aria-pressed={mineCategory === c.value} onclick={() => (mineCategory = c.value)}>{c.shortLabel}</button>
					{/each}
				</div>
			{/if}

			<a href="/library/upload" class="lib-request-btn">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
				Upload a pattern
			</a>
		{/if}
	</aside>

	<!-- ─── Main ─── -->
	<div class="library__main">

		<!-- Community / Private tab bar -->
		<div class="lib-tabs" role="tablist">
			<button class="lib-tab" class:lib-tab--active={tab === "library"} role="tab" aria-selected={tab === "library"} onclick={() => setTab("library")}>
				<svg class="lib-tab__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
				Community
				{#if visible.length}<span class="lib-tab__badge">{visible.reduce((n, x) => n + x.pats.length, 0)}</span>{/if}
			</button>
			<button class="lib-tab" class:lib-tab--active={tab === "mine"} role="tab" aria-selected={tab === "mine"} onclick={() => setTab("mine")}>
				<svg class="lib-tab__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
				My patterns
				{#if myPatterns.length}<span class="lib-tab__badge">{myPatterns.length}</span>{/if}
			</button>
		</div>

		{#if tab === "library"}
		<!-- Subject type -->
		<div class="mode-switcher mode-switcher--full" role="group" aria-label="Subject type">
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
		{#if categoriesForType.length > 0}
			<div class="mode-switcher" role="group" aria-label="Pattern category">
				{#each categoriesForType as c (c.value)}
					<button class="mode-btn" class:active={category === c.value} onclick={() => switchCategory(c.value)} aria-pressed={category === c.value}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={c.icon}/></svg>
						{c.shortLabel === "Tint" ? "Window Tint" : c.shortLabel}
						<span class="mode-count">{c.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Header -->
		<div class="library__header">
			<div>
				<h1 class="library__title">
					{categoriesForType.length ? `${categoryLabel(category)} · ${typeMeta(projectType).label}` : `${typeMeta(projectType).label} library`}
				</h1>
				<p class="library__sub">
					{#if selectedVehicle}
						Select patterns below
					{:else}
						{filtered.length} {filtered.length === 1 ? typeMeta(projectType).noun : typeMeta(projectType).nounPlural} · select one to view its patterns
					{/if}
				</p>
			</div>
			<div class="library__header-actions">
				<a href="/library/upload" class="upload-cta" use:tooltip={"Save a pattern to your library"}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					Upload Pattern
				</a>
				{#if !selectedVehicle}
					<div class="view-divider" aria-hidden="true"></div>
					<button class="view-btn" class:active={view === "grid"} onclick={() => (view = "grid")} aria-label="Grid view" aria-pressed={view === "grid"}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
					</button>
					<button class="view-btn" class:active={view === "list"} onclick={() => (view = "list")} aria-label="List view" aria-pressed={view === "list"}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
					</button>
				{/if}
			</div>
		</div>

		<!-- Subject grid -->
		{#if !selectedVehicle}
			<div class="vehicle-grid" class:vehicle-grid--list={view === "list"}>
				{#each filtered as { v: vehicle, shown } (vehicle.id)}
					<button class="vehicle-card" onclick={() => openSubject(vehicle)} aria-label="Open {subjectName(vehicle)} — {shown.length} {pieceWord}">
						<div class="vehicle-card__thumb">
							{#if projectType === "vehicle"}
							<svg width="80" height="40" viewBox="0 0 24 14" fill="none" stroke="var(--color-brand)" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d={BODY_STYLE_ICON[vehicle.bodyStyle ?? "sedan"] ?? BODY_STYLE_ICON.sedan}/>
								<ellipse cx="6.5" cy="14" rx="2" ry="1.5"/>
								<ellipse cx="17.5" cy="14" rx="2" ry="1.5"/>
							</svg>
							{:else}
							<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								{#if projectType === "residential"}<path d="M3 11l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>
								{:else if projectType === "commercial"}<path d="M4 21V7l8-4 8 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>
								{:else}<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/>{/if}
							</svg>
							{/if}
						</div>
						<div class="vehicle-card__body">
							{#if projectType === "vehicle"}
							<div class="vehicle-card__year-make">{vehicle.make}</div>
							<div class="vehicle-card__model">{vehicle.model}</div>
							{:else}
							<div class="vehicle-card__year-make">{subjectName(vehicle)}</div>
							{#if vehicle.address}<div class="vehicle-card__model">{vehicle.address}</div>{/if}
							{/if}
							<div class="vehicle-card__meta">
								{#if projectType === "vehicle" && vehicle.year}
								<span
									class="year-badge"
									class:year-badge--active={activeYear === String(vehicle.year)}
									role="button"
									tabindex="0"
									aria-pressed={activeYear === String(vehicle.year)}
									aria-label="Filter by {vehicle.year}"
									use:tooltip={`Filter by ${vehicle.year}`}
									onclick={(e) => { e.stopPropagation(); activeYear = activeYear === String(vehicle.year) ? "All" : String(vehicle.year); }}
									onkeydown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); activeYear = activeYear === String(vehicle.year) ? "All" : String(vehicle.year); } }}
								>{vehicle.year}</span>
								{/if}
								<Badge variant="default" size="sm">{shown.length} {shown.length === 1 ? pieceWord.replace(/s$/, "") : pieceWord}</Badge>
								{#if vehicle.popular}
									<Badge variant="brand" size="sm">Popular</Badge>
								{/if}
							</div>
						</div>
					</button>
				{/each}

				{#if filtered.length === 0}
					<div class="lib-empty">
						{#if patternStore.loading}
							<p class="lib-empty__title">Loading the pattern library…</p>
						{:else if patternStore.catalogError && !visible.length}
							<p class="lib-empty__title">Couldn't load the pattern library</p>
							<p class="lib-empty__sub">Check your connection and reload the page. Your own uploads under "My patterns" are unaffected.</p>
						{:else if !typeCounts[projectType]}
							<p class="lib-empty__title">No {typeMeta(projectType).label.toLowerCase()} patterns yet</p>
							<p class="lib-empty__sub">The community library doesn't have any {typeMeta(projectType).noun} patterns yet. <button class="lib-empty__request" onclick={() => openRequest()}>Request one</button>, or upload your own to use right away.</p>
						{:else}
							<p class="lib-empty__title">Nothing matches these filters</p>
							<p class="lib-empty__sub">
								Try a different search or filter, or <button class="lib-empty__request" onclick={() => openRequest()}>request {projectType === "vehicle" ? "a vehicle" : "a pattern"}</button>.
							</p>
						{/if}
						<a href="/library/upload" class="lib-empty__upload">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
							Upload Pattern
						</a>
					</div>
				{/if}
			</div>

		<!-- Pattern browser for one subject -->
		{:else}
			<div class="zone-browser">
				<div class="zone-browser__header">
					<button class="back-btn" onclick={() => (selectedVehicle = null)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
						All {typeMeta(projectType).nounPlural}
					</button>
					<h2 class="zone-browser__title">{subjectName(selectedVehicle)}</h2>
					<div class="zone-browser__actions">
						{#if useStorePatterns}
							<Badge variant="success" size="sm" dot>
								{visibleStorePatterns.length}{activeZone !== "All zones" ? ` of ${vehiclePatterns.length}` : ""} {pieceWord} · verified
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

				<div class="zone-grid">
					{#if visibleStorePatterns.length}
						{#each visibleStorePatterns as pattern (pattern.id)}
							{@const selected = selectedPatternIds.has(pattern.id)}
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

								<div class="zone-card__preview">
									<svg width="60" height="50" viewBox="0 0 100 100" fill="none" aria-hidden="true">
										<path
											d={pattern.svgPath}
											use:fitPattern={{ w: pattern.widthInches, h: pattern.heightInches, d: pattern.svgPath }}
											fill={category === "window-tint" ? "rgba(0,112,255,0.08)" : "rgba(0,229,255,0.06)"}
											stroke={category === "window-tint" ? "var(--color-brand-dim)" : "var(--color-brand)"}
											stroke-width="2"
											stroke-linecap="round"
										/>
									</svg>
								</div>

								<div class="zone-card__info">
									<div class="zone-card__name">{pattern.name}</div>
									<div class="zone-card__meta">
										{zoneLabel(pattern.zone, pattern.category, pattern.projectType ?? typeOf(selectedVehicle), pattern.customZoneLabel)} · {pattern.widthInches}" × {pattern.heightInches}"
									</div>
									<div class="zone-card__badges">
										<Badge variant={pattern.coverage === "full" ? "success" : "warning"} size="sm">
											{pattern.coverage === "edge-only" ? "edge only" : pattern.coverage}
										</Badge>
										<button
											class="details-btn"
											onclick={(e) => { e.stopPropagation(); detailPattern = pattern; }}
											aria-label="Details for {pattern.name}"
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
											Details{pattern.notes ? " & notes" : ""}
										</button>
									</div>
								</div>

								<button
									class="zone-card__add"
									onclick={(e) => { e.stopPropagation(); addPatternToCanvas(pattern); }}
									aria-label="Add {pattern.name} to canvas"
									use:tooltip={"Add to canvas"}
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
								</button>
							</div>
						{/each}

					{:else}
						<div class="zone-empty">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
							{#if useStorePatterns}
								<p>No {categoryShortLabel(category)} patterns in “{activeZone}” for this {typeMeta(projectType).noun}.</p>
								<button class="zone-empty__cta" onclick={() => (activeZone = "All zones")}>Show all zones</button>
							{:else}
								<p>No verified {categoryLabel(category)} patterns for this {typeMeta(projectType).noun} yet.</p>
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

		{:else}

		<!-- ─── My patterns tab ─── -->
		<div class="my-patterns">
			{#if myPatternsLoading}
				<div class="my-patterns__empty">
					<span class="ai-spinner" style="width:18px;height:18px" aria-hidden="true"></span>
				</div>
			{:else if myPatternsError}
				<div class="my-patterns__empty">
					<p>{myPatternsError}</p>
					<button class="lib-pill" onclick={() => userStore.user && loadMyPatterns(userStore.user.uid)}>Try again</button>
				</div>
			{:else if myPatterns.length === 0}
				<div class="my-patterns__empty my-patterns__empty--intro">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					<p class="my-patterns__intro-title">Your own patterns live here</p>
					<p>Upload a pattern from an SVG, a photo or a scan. It's private to you until you choose to submit it to the community library.</p>
					<a href="/library/upload" class="upload-cta">Upload your first pattern</a>
				</div>
			{:else}
				<div class="my-patterns__summary">
					{shownMine.length === myPatterns.length ? `${myPatterns.length} pattern${myPatterns.length === 1 ? "" : "s"}` : `${shownMine.length} of ${myPatterns.length} patterns`}
					{#if mineStatus !== "all" || mineCategory !== "all" || mineSearch}
						<button class="lib-empty__request" onclick={() => { mineStatus = "all"; mineCategory = "all"; mineSearch = ""; }}>Clear filters</button>
					{/if}
				</div>
				{#if shownMine.length === 0}
					<p class="my-patterns__empty">No patterns match these filters.</p>
				{/if}
				<div class="my-patterns__list">
					{#each shownMine as p (p.id)}
						{@const st = mineStatusOf(p)}
						<article class="my-pattern-card">
							<div class="my-pattern-card__preview" aria-hidden="true">
								<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
									<path d={p.svgPath} use:fitPattern={{ w: p.widthInches, h: p.heightInches, d: p.svgPath }} fill="none" stroke="var(--color-brand)" stroke-width="2"/>
								</svg>
							</div>
							<div class="my-pattern-card__body">
								<div class="my-pattern-card__name">{p.name || compactZones(p)}</div>
								<div class="my-pattern-card__meta">
									{#if mySubjectLabel(p)}{mySubjectLabel(p)} · {/if}{compactZones(p)}
								</div>
								<div class="my-pattern-card__badges">
									<span class="mpbadge" style="--cat-accent: {categoryMeta(p.category).accent}">{categoryShortLabel(p.category)}</span>
									<span class="mpbadge mpbadge--{st}">{MINE_STATUS_LABEL[st]}</span>
									<span class="my-pattern-card__size">{p.widthInches.toFixed(2)}" × {p.heightInches.toFixed(2)}"</span>
									{#if sizeError(p, p.svgPath)}
										<span class="mpbadge mpbadge--rejected" use:tooltip={"Its saved width × height doesn't match its outline, so it would cut stretched. Edit it and re-enter the width or height."}>Size doesn't match outline</span>
									{/if}
									<span class="my-pattern-card__date">Added {p.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
								</div>
								{#if st === "rejected"}
									<div class="my-pattern-card__note my-pattern-card__note--rejected">
										{#if p.rejectionReason}
											<strong>Not approved:</strong> {p.rejectionReason}
										{:else}
											Not approved for the community library.
										{/if}
										<span class="my-pattern-card__note-sub">It's still yours to use — edit it and resubmit anytime.</span>
									</div>
								{:else if st === "pending"}
									<p class="my-pattern-card__note">Waiting for admin review. You can keep using it meanwhile.</p>
								{/if}
							</div>
							<div class="my-pattern-card__actions">
								<button class="my-pattern-card__add" onclick={() => addMine(p)} disabled={!!sizeError(p, p.svgPath)} use:tooltip={sizeError(p, p.svgPath) ? "Fix this pattern's size before adding it" : "Add to canvas"} aria-label="Add {p.name} to canvas">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
									Add
								</button>

								{#if p.isPublished}
									<!-- Locked — approved community pattern -->
									<button class="my-pattern-card__locked" onclick={() => { adjustTarget = p; adjustNotes = ""; }} use:tooltip={"It's in the community library, so changes go through a request"} aria-label="Request changes to {p.name}">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
										Request changes
									</button>
								{:else}
									<a href="/library/edit/{p.id}" class="my-pattern-card__edit" use:tooltip={"Edit this pattern"} aria-label="Edit {p.name}">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>
										Edit
									</a>
									<button
										class="my-pattern-card__share"
										class:my-pattern-card__share--on={p.submitToCommunity}
										onclick={() => toggleCommunitySubmit(p)}
										use:tooltip={p.submitToCommunity ? "Withdraw from community review" : "Submit for community review"}
										aria-label={p.submitToCommunity ? "Withdraw from community review" : "Submit for community review"}
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
										{p.submitToCommunity ? "Withdraw" : st === "rejected" ? "Resubmit" : "Submit"}
									</button>
									<button
										class="my-pattern-card__delete"
										onclick={() => confirmDelete(p)}
										disabled={deleting.has(p.id)}
										use:tooltip={"Delete this pattern"}
										aria-label="Delete {p.name}"
									>
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
										{deleting.has(p.id) ? "Deleting…" : "Delete"}
									</button>
								{/if}
							</div>
						</article>
					{/each}
				</div>
				<a href="/library/upload" class="my-patterns__upload-cta">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					Upload another pattern
				</a>
			{/if}
		</div>

		{/if}

	</div>
</div>

<!-- ─── Pattern detail dialog ─────────────────── -->
{#if detailPattern}
	{@const p = detailPattern}
	{@const t = p.projectType ?? (selectedVehicle ? typeOf(selectedVehicle) : projectType)}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (detailPattern = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal modal--detail" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="pd-title">
			<div class="modal__header">
				<div>
					<h2 class="modal__title" id="pd-title">{p.name}</h2>
					<p class="modal__sub">
						{#if selectedVehicle}{subjectName(selectedVehicle)} · {/if}{categoryLabel(p.category)}
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
					<div><dt>Zone</dt><dd>{zoneLabel(p.zone, p.category, t, p.customZoneLabel)}</dd></div>
					<div><dt>Size</dt><dd>{p.widthInches}" × {p.heightInches}" <span class="pd__muted">({cm(p.widthInches)} × {cm(p.heightInches)} cm)</span></dd></div>
					<div><dt>Coverage</dt><dd>{p.coverage === "edge-only" ? "Edge only" : p.coverage === "full" ? "Full" : "Partial"}</dd></div>
					{#if p.revision}<div><dt>Revision</dt><dd>{p.revision}</dd></div>{/if}
				</dl>

				{#if p.notes}
					<div class="pd__notes">
						<div class="pd__notes-title">Notes & disclosure</div>
						<p>{p.notes}</p>
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
						<button type="button" class="btn-primary" onclick={() => addDetail(false)}>Add to canvas</button>
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
							<label class="form-label" for="req-year">Year</label>
							<input id="req-year" type="number" class="form-input" bind:value={requestForm.year} min="1990" max={new Date().getFullYear() + 2} required />
						</div>
						<div class="form-group" style="flex:2">
							<label class="form-label" for="req-make">Make</label>
							<input id="req-make" type="text" class="form-input" bind:value={requestForm.make} placeholder="e.g. Toyota" required />
						</div>
					</div>
					<div class="form-group">
						<label class="form-label" for="req-model">Model</label>
						<input id="req-model" type="text" class="form-input" bind:value={requestForm.model} placeholder="e.g. GR86" required />
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

				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (showRequestModal = false)}>Cancel</button>
					<button type="submit" class="btn-primary">Submit request</button>
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

	.lib-search-wrap {
		position: relative;
		margin-bottom: 16px;
	}

	.lib-search-icon {
		position: absolute;
		left: 9px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.lib-search {
		width: 100%;
		padding: 7px 10px 7px 30px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
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

	.library__title { font-size: 1.25rem; margin-bottom: 3px; }
	.library__sub   { font-size: 0.8125rem; color: var(--text-secondary); }

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

	.year-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 7px;
		border-radius: 5px;
		font-size: 0.6875rem;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--bg-surface-3);
		color: var(--text-tertiary);
		border: 1px solid var(--border-subtle);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		user-select: none;
	}
	.year-badge:hover {
		background: color-mix(in srgb, var(--color-brand) 12%, var(--bg-surface-3));
		border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
		color: var(--color-brand);
	}
	.year-badge--active {
		background: color-mix(in srgb, var(--color-brand) 15%, var(--bg-surface-2));
		border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
		color: var(--color-brand);
	}

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
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}

	.zone-card {
		position: relative;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 14px;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, box-shadow 0.15s;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.zone-card:hover { border-color: var(--border-strong); }

	.zone-card.selected {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.04);
	}

	.zone-card--tint:hover    { border-color: var(--color-brand-dim); }
	.zone-card--tint.selected { border-color: var(--color-brand-dim); background: rgba(0, 112, 255, 0.05); }

	.zone-card__check {
		position: absolute;
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

	.zone-card__preview {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 60px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
	}

	.zone-card__name { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
	.zone-card__meta { font-family: var(--font-mono); font-size: 0.625rem; color: var(--text-tertiary); margin-bottom: 2px; }
	.zone-card__badges { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

	.zone-card__add {
		position: absolute;
		bottom: 10px;
		right: 10px;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s, background 0.12s;
	}

	.zone-card:hover .zone-card__add { opacity: 1; }
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

	/* Responsive */
	@media (max-width: 768px) {
		.library { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }

		/* Sidebar becomes a horizontally-scrollable filter strip instead of
		   vanishing — hiding it outright removed search/filters/request on mobile. */
		.library__sidebar {
			flex-direction: row;
			align-items: center;
			overflow-x: auto;
			overflow-y: hidden;
			border-right: none;
			border-bottom: 1px solid var(--border-subtle);
			padding: 10px 12px;
			gap: 8px;
			-webkit-overflow-scrolling: touch;
		}
		.lib-search-wrap { margin-bottom: 0; flex: 0 0 150px; }
		.lib-section-label { display: none; }
		.lib-filter-pills { flex-wrap: nowrap; margin-bottom: 0; flex-shrink: 0; }
		.lib-stats { display: none; }
		.lib-request-btn { margin-top: 0; width: auto; flex-shrink: 0; white-space: nowrap; }

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

	@media (max-width: 640px) {
		.my-pattern-card { flex-wrap: wrap; }
		.my-pattern-card__body { flex-basis: 100%; order: 1; }
		.my-pattern-card__actions { flex-wrap: wrap; order: 2; width: 100%; justify-content: flex-end; }
	}

	/* ─── Library / My Patterns tab bar ─── */
	.lib-tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid var(--border-subtle);
		margin-bottom: 16px;
	}
	.lib-tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 18px;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.lib-tab__icon { flex-shrink: 0; opacity: 0.8; }
	.lib-tab:hover { color: var(--text-secondary); }
	.lib-tab--active {
		color: var(--color-brand);
		border-bottom-color: var(--color-brand);
	}
	.lib-tab--active .lib-tab__icon { opacity: 1; }
	.lib-tab__badge {
		background: var(--bg-surface-3);
		color: var(--text-primary);
		font-size: 0.6875rem;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 10px;
		line-height: 1.4;
	}

	/* ─── My Patterns panel ─── */
	.my-patterns {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.my-patterns__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 24px;
		color: var(--text-tertiary);
		font-size: 0.9375rem;
		text-align: center;
	}
	.my-patterns__empty a {
		color: var(--color-brand);
		text-decoration: none;
	}
	.my-patterns__list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.my-patterns__upload-cta {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 10px 14px;
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: border-color 0.12s, color 0.12s;
	}
	.my-patterns__upload-cta:hover {
		border-color: var(--color-brand);
		color: var(--color-brand);
	}

	/* ─── My Pattern card ─── */
	.my-pattern-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}
	.my-pattern-card__preview {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 6px;
	}
	.my-pattern-card__preview svg { width: 100%; height: 100%; }
	.my-pattern-card__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.my-pattern-card__name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.35;
	}
	.my-pattern-card__meta {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.my-pattern-card__badges {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}
	.mpbadge {
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--cat-accent, var(--text-tertiary)) 14%, transparent);
		color: var(--cat-accent, var(--text-tertiary));
	}
	.mpbadge--published { background: color-mix(in srgb, #22c55e 12%, transparent); color: #4ade80; }
	.mpbadge--pending   { background: color-mix(in srgb, #f59e0b 12%, transparent); color: #fbbf24; }
	.mpbadge--private   { background: var(--bg-surface-3); color: var(--text-tertiary); }
	.my-pattern-card__actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.my-pattern-card__add,
	.my-pattern-card__edit,
	.my-pattern-card__share {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		white-space: nowrap;
	}
	.my-pattern-card__add:disabled { opacity: 0.45; cursor: not-allowed; }
	.my-pattern-card__add:hover:not(:disabled) {
		background: var(--color-brand);
		border-color: var(--color-brand);
		color: #fff;
	}
	.my-pattern-card__edit:hover {
		background: var(--bg-surface-3);
		border-color: var(--border-strong, var(--border-default));
		color: var(--text-primary);
	}
	.my-pattern-card__share--on {
		border-color: color-mix(in srgb, var(--color-brand) 50%, transparent);
		color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 10%, var(--bg-surface-2));
	}
	.my-pattern-card__share:hover {
		border-color: var(--color-brand);
		color: var(--color-brand);
	}
	.my-pattern-card__delete {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		white-space: nowrap;
	}
	.my-pattern-card__delete:hover {
		border-color: color-mix(in srgb, #ef4444 50%, transparent);
		color: #f87171;
		background: color-mix(in srgb, #ef4444 10%, var(--bg-surface-2));
	}
	.my-pattern-card__del-confirm {
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 700;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, #ef4444 60%, transparent);
		background: color-mix(in srgb, #ef4444 15%, var(--bg-surface-2));
		color: #f87171;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
		white-space: nowrap;
	}
	.my-pattern-card__del-confirm:hover:not(:disabled) {
		background: color-mix(in srgb, #ef4444 25%, var(--bg-surface-2));
		border-color: #ef4444;
	}
	.my-pattern-card__del-confirm:disabled { opacity: 0.6; cursor: not-allowed; }
	.my-pattern-card__del-cancel {
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
		white-space: nowrap;
	}
	.my-pattern-card__del-cancel:hover { background: var(--bg-surface-3); color: var(--text-secondary); }

	.my-pattern-card__locked {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		white-space: nowrap;
	}
	.my-pattern-card__locked:hover {
		border-color: color-mix(in srgb, #f59e0b 50%, transparent);
		color: #fbbf24;
		background: color-mix(in srgb, #f59e0b 10%, var(--bg-surface-2));
	}

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
	.mode-btn--empty:not(.active) { opacity: 0.55; }
	button.zone-empty__cta { background: transparent; color: var(--text-brand); cursor: pointer; font-family: var(--font-body); }
	button.zone-card__add { border: none; font: inherit; }

	.my-patterns__summary {
		display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
		font-size: 0.8125rem; color: var(--text-tertiary);
	}
	.my-patterns__empty--intro { max-width: 440px; margin: 0 auto; }
	.my-patterns__empty--intro p { margin: 0; font-size: 0.875rem; line-height: 1.5; }
	.my-patterns__intro-title { font-size: 1rem !important; font-weight: 600; color: var(--text-primary); }
	.mpbadge--rejected { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
	.my-pattern-card__badges { align-items: center; }
	.my-pattern-card__size,
	.my-pattern-card__date { font-size: 0.6875rem; color: var(--text-tertiary); font-family: var(--font-mono); }
	.my-pattern-card__note { margin: 6px 0 0; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.4; }
	.my-pattern-card__note--rejected {
		padding: 7px 9px; border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 7%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
	}
	.my-pattern-card__note--rejected strong { color: var(--color-danger); font-weight: 600; }
	.my-pattern-card__note-sub { display: block; margin-top: 3px; color: var(--text-tertiary); }

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

	.details-btn {
		display: inline-flex; align-items: center; gap: 4px;
		padding: 2px 7px; border-radius: var(--radius-sm);
		border: 1px solid var(--border-subtle); background: transparent;
		font-size: 0.6875rem; font-family: var(--font-body); color: var(--text-secondary); cursor: pointer;
	}
	.details-btn:hover { color: var(--text-primary); border-color: var(--border-default); background: var(--interactive-hover); }
	.details-btn:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
</style>
