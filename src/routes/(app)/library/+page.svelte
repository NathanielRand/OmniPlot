<script lang="ts">
	import { onMount } from "svelte";
	import { toastStore, canvasStore, userStore } from "$lib/stores";
	import { patternStore, TINT_ZONE_GROUP, PPF_ZONE_GROUP } from "$lib/stores/patternStore.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { uid, getItemColor } from "$lib/utils";
	import { autoNest } from "$lib/utils/nesting";
	import { getUserPatterns, updateUserPattern, addPatternAdjustmentRequest } from "$lib/firebase/firestore";
	import type { CanvasItem, Pattern, PatternZone, UserPattern } from "$lib/types";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";

	// ─── Zone filter lists ────────────────────────
	const PPF_ZONES = [
		"All zones", "Hood", "Fenders", "Bumpers", "Doors", "Mirrors", "Rocker Panels", "Roof", "Trunk",
	];
	const TINT_ZONES = [
		"All zones", "Windshield", "Side Windows", "Rear Window", "Sunroof", "Quarter / Vent",
	];

	// Generic fallback zone lists (shown when vehicle has no patterns in the store)
	const PPF_ZONE_PATTERNS = [
		{ zone: "Hood",        pieces: 3, size: '60" × 48"', coverage: "full",    group: "Hood",         patternZone: "hood" as PatternZone },
		{ zone: "Hood Edges",  pieces: 2, size: '12" × 36"', coverage: "partial", group: "Hood",         patternZone: "hood-edge-left" as PatternZone },
		{ zone: "Front Bumper",pieces: 1, size: '62" × 22"', coverage: "full",    group: "Bumpers",      patternZone: "bumper-front" as PatternZone },
		{ zone: "Rear Bumper", pieces: 1, size: '60" × 18"', coverage: "full",    group: "Bumpers",      patternZone: "bumper-rear" as PatternZone },
		{ zone: "Fender FL",   pieces: 1, size: '28" × 42"', coverage: "full",    group: "Fenders",      patternZone: "fender-front-left" as PatternZone },
		{ zone: "Fender FR",   pieces: 1, size: '28" × 42"', coverage: "full",    group: "Fenders",      patternZone: "fender-front-right" as PatternZone },
		{ zone: "Mirror L",    pieces: 1, size: '10" × 8"',  coverage: "full",    group: "Mirrors",      patternZone: "mirror-left" as PatternZone },
		{ zone: "Mirror R",    pieces: 1, size: '10" × 8"',  coverage: "full",    group: "Mirrors",      patternZone: "mirror-right" as PatternZone },
		{ zone: "Door FL",     pieces: 1, size: '38" × 52"', coverage: "full",    group: "Doors",        patternZone: "door-front-left" as PatternZone },
		{ zone: "Door FR",     pieces: 1, size: '38" × 52"', coverage: "full",    group: "Doors",        patternZone: "door-front-right" as PatternZone },
		{ zone: "Door RL",     pieces: 1, size: '36" × 50"', coverage: "full",    group: "Doors",        patternZone: "door-rear-left" as PatternZone },
		{ zone: "Door RR",     pieces: 1, size: '36" × 50"', coverage: "full",    group: "Doors",        patternZone: "door-rear-right" as PatternZone },
		{ zone: "Rocker L",    pieces: 1, size: '72" × 8"',  coverage: "full",    group: "Rocker Panels",patternZone: "rocker-left" as PatternZone },
		{ zone: "Rocker R",    pieces: 1, size: '72" × 8"',  coverage: "full",    group: "Rocker Panels",patternZone: "rocker-right" as PatternZone },
		{ zone: "A-Pillar L",  pieces: 1, size: '4" × 28"',  coverage: "partial", group: "Roof",         patternZone: "a-pillar-left" as PatternZone },
		{ zone: "A-Pillar R",  pieces: 1, size: '4" × 28"',  coverage: "partial", group: "Roof",         patternZone: "a-pillar-right" as PatternZone },
		{ zone: "Roof",        pieces: 1, size: '60" × 68"', coverage: "full",    group: "Roof",         patternZone: "roof" as PatternZone },
		{ zone: "Trunk",       pieces: 1, size: '56" × 40"', coverage: "full",    group: "Trunk",        patternZone: "trunk" as PatternZone },
	];

	const TINT_ZONE_PATTERNS = [
		{ zone: "Windshield",       pieces: 1, size: '66" × 30"', coverage: "full",    group: "Windshield",    patternZone: "windshield" as PatternZone,       vltNote: "Usually front strip only in legal states" },
		{ zone: "Windshield Strip", pieces: 1, size: '66" × 6"',  coverage: "partial", group: "Windshield",    patternZone: "windshield-strip" as PatternZone,  vltNote: "Top visor strip — legal in all states" },
		{ zone: "Rear Window",      pieces: 1, size: '58" × 26"', coverage: "full",    group: "Rear Window",   patternZone: "rear-windshield" as PatternZone,   vltNote: "" },
		{ zone: "Sunroof",          pieces: 1, size: '32" × 28"', coverage: "full",    group: "Sunroof",       patternZone: "sunroof" as PatternZone,           vltNote: "Panoramic roof — check fit per model" },
		{ zone: "Moonroof",         pieces: 1, size: '24" × 20"', coverage: "full",    group: "Sunroof",       patternZone: "moonroof" as PatternZone,          vltNote: "" },
		{ zone: "Window Front L",   pieces: 1, size: '28" × 24"', coverage: "full",    group: "Side Windows",  patternZone: "window-front-left" as PatternZone, vltNote: "" },
		{ zone: "Window Front R",   pieces: 1, size: '28" × 24"', coverage: "full",    group: "Side Windows",  patternZone: "window-front-right" as PatternZone, vltNote: "" },
		{ zone: "Window Rear L",    pieces: 1, size: '26" × 22"', coverage: "full",    group: "Side Windows",  patternZone: "window-rear-left" as PatternZone,  vltNote: "" },
		{ zone: "Window Rear R",    pieces: 1, size: '26" × 22"', coverage: "full",    group: "Side Windows",  patternZone: "window-rear-right" as PatternZone, vltNote: "" },
		{ zone: "Quarter Window L", pieces: 1, size: '10" × 14"', coverage: "full",    group: "Quarter / Vent",patternZone: "quarter-window-left" as PatternZone, vltNote: "" },
		{ zone: "Quarter Window R", pieces: 1, size: '10" × 14"', coverage: "full",    group: "Quarter / Vent",patternZone: "quarter-window-right" as PatternZone, vltNote: "" },
		{ zone: "Vent Window L",    pieces: 1, size: '6" × 10"',  coverage: "full",    group: "Quarter / Vent",patternZone: "vent-window-left" as PatternZone,  vltNote: "" },
		{ zone: "Vent Window R",    pieces: 1, size: '6" × 10"',  coverage: "full",    group: "Quarter / Vent",patternZone: "vent-window-right" as PatternZone, vltNote: "" },
	];

	// ─── State ────────────────────────────────────
	let tab            = $state<"library" | "mine">("library");
	let mode           = $state<"ppf" | "tint">("ppf");
	let search         = $state("");
	let activeMake     = $state("All");
	let activeZone     = $state("All zones");
	let selectedVehicle = $state<VehicleEntry | null>(null);
	let view           = $state<"grid" | "list">("grid");
	let selectedZones  = $state<Set<string>>(new Set()); // generic zone selection (zone name)
	let selectedPatternIds = $state<Set<string>>(new Set()); // store pattern selection (pattern.id)

	// My Patterns
	let myPatterns       = $state<UserPattern[]>([]);
	let myPatternsLoading = $state(false);
	let myPatternsError  = $state("");

	onMount(async () => {
		if (!userStore.user) return;
		myPatternsLoading = true;
		try {
			myPatterns = await getUserPatterns(userStore.user.uid);
		} catch {
			myPatternsError = "Could not load your patterns.";
		} finally {
			myPatternsLoading = false;
		}
	});

	async function toggleCommunitySubmit(p: UserPattern) {
		const next = !p.submitToCommunity;
		myPatterns = myPatterns.map((m) =>
			m.id === p.id ? { ...m, submitToCommunity: next, status: next ? "pending" : "private" } : m,
		);
		try {
			await updateUserPattern(p.id, { submitToCommunity: next });
		} catch {
			// revert on failure
			myPatterns = myPatterns.map((m) =>
				m.id === p.id ? { ...m, submitToCommunity: p.submitToCommunity, status: p.status } : m,
			);
			toastStore.error("Update failed", "Could not update community setting.");
		}
	}

	// Convert a UserPattern to a Pattern for canvas
	function userPatternToPattern(up: UserPattern): Pattern {
		return {
			id:           up.id,
			vehicleId:    up.vehicleId ?? `user_${up.ownerId}`,
			category:     up.category,
			zone:         up.zone,
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

	// Request vehicle modal
	let showRequestModal = $state(false);
	let requestForm = $state({ year: new Date().getFullYear(), make: "", model: "", notes: "" });

	const ZONES = $derived(mode === "ppf" ? PPF_ZONES : TINT_ZONES);
	const ZONE_PATTERNS = $derived(mode === "ppf" ? PPF_ZONE_PATTERNS : TINT_ZONE_PATTERNS);

	// Makes list derived from store (published vehicles only)
	const MAKES = $derived(
		["All", ...new Set(
			patternStore.vehicles
				.filter((v) => v.status === "published")
				.map((v) => v.make)
				.sort()
		)],
	);

	function switchMode(m: "ppf" | "tint") {
		mode      = m;
		activeZone = "All zones";
		selectedZones = new Set();
		selectedPatternIds = new Set();
	}

	// ─── Filtered vehicles (published only) ───────
	const filtered = $derived(
		patternStore.vehicles
			.filter((v) => v.status === "published")
			.filter((v) => {
				const q = search.toLowerCase();
				const matchSearch = !q || `${v.year} ${v.make} ${v.model}`.toLowerCase().includes(q);
				const matchMake   = activeMake === "All" || v.make === activeMake;
				return matchSearch && matchMake;
			}),
	);

	// ─── Vehicle-specific patterns from store ─────
	const vehiclePatterns = $derived(
		selectedVehicle
			? patternStore.getPatterns(selectedVehicle.id, mode === "ppf" ? "ppf" : "window-tint")
			: [],
	);

	// When the store has patterns for this vehicle+mode, use them; otherwise generic fallback
	const useStorePatterns = $derived(vehiclePatterns.length > 0);

	// Zone group map for the active mode
	const zoneGroupMap = $derived(mode === "ppf" ? PPF_ZONE_GROUP : TINT_ZONE_GROUP);

	// Generic fallback visible zones
	const visibleGenericZones = $derived(
		activeZone === "All zones"
			? ZONE_PATTERNS
			: ZONE_PATTERNS.filter((z) => z.group === activeZone),
	);

	// Store patterns visible under the current zone filter
	const visibleStorePatterns = $derived(
		activeZone === "All zones"
			? vehiclePatterns
			: vehiclePatterns.filter((p) => zoneGroupMap[p.zone] === activeZone),
	);

	// ─── Add store pattern to canvas ─────────────
	function addPatternToCanvas(pattern: Pattern) {
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
			flippedH: false, flippedV: false,
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
		const nested = autoNest([...canvasStore.items, newItem], ts);
		canvasStore.setItems(nested);

		const placed = nested.find((i) => i.id === newItem.id);
		if (placed?.outOfBounds) {
			toastStore.warning("Added — won't cut", `${pattern.name} exceeds the ${canvasStore.sheet.widthInches}" roll width.`);
		} else {
			toastStore.success(
				"Added to canvas",
				`${pattern.name} — ${pattern.widthInches}" × ${pattern.heightInches}"${placed?.rotation ? " (rotated)" : ""}`,
			);
		}
	}

	// ─── Add generic zone to canvas ───────────────
	function addToCanvas(zone: (typeof PPF_ZONE_PATTERNS)[0]) {
		if (!selectedVehicle) return;
		const idx = canvasStore.items.length;
		const w = parseFloat(zone.size.split('"')[0]);
		const h = parseFloat(zone.size.split("×")[1]);

		const newItem: CanvasItem = {
			id:        uid("item_"),
			patternId: `${selectedVehicle.id}_${zone.zone.toLowerCase().replace(/\s+/g, "-")}`,
			pattern: {
				id:          uid("pat_"),
				vehicleId:   selectedVehicle.id,
				category:    (mode === "ppf" ? "ppf" : "window-tint") as import("$lib/types").PatternCategory,
				zone:        zone.patternZone,
				name:        zone.zone,
				coverage:    zone.coverage as "full" | "partial",
				svgPath:     "M10,90 Q15,20 50,5 Q85,20 90,90",
				widthInches: w,
				heightInches:h,
				revision:    "2024-11",
				isPublished: true,
				createdAt:   new Date(),
				updatedAt:   new Date(),
			},
			x: 0, y: 0, width: w, height: h, rotation: 0,
			outOfBounds: false, flippedH: false, flippedV: false,
			scale: 1, layer: idx, locked: false,
			color: getItemColor(idx), label: zone.zone,
		};

		const ts = {
			...canvasStore.sheet,
			widthInches:  canvasStore.sheet.heightInches,
			heightInches: canvasStore.sheet.widthInches,
		};
		const nested = autoNest([...canvasStore.items, newItem], ts);
		canvasStore.setItems(nested);

		const placed = nested.find((i) => i.id === newItem.id);
		if (placed?.outOfBounds) {
			toastStore.warning("Added — won't cut", `${zone.zone} exceeds the ${canvasStore.sheet.widthInches}" roll width.`);
		} else {
			toastStore.success("Added to canvas", `${zone.zone} — ${zone.size}${placed?.rotation ? " (rotated)" : ""}`);
		}
	}

	// ─── Batch add (selected zones / patterns) ────
	function addAllSelected() {
		if (!selectedVehicle) return;
		if (useStorePatterns) {
			const toAdd = vehiclePatterns.filter((p) => selectedPatternIds.has(p.id));
			toAdd.forEach(addPatternToCanvas);
			if (toAdd.length > 1) {
				toastStore.success(`${toAdd.length} patterns added`, "Open Studio to arrange and cut.");
			}
			selectedPatternIds = new Set();
		} else {
			const toAdd = ZONE_PATTERNS.filter((z) => selectedZones.has(z.zone));
			toAdd.forEach(addToCanvas);
			if (toAdd.length > 1) {
				toastStore.success(`${toAdd.length} patterns added`, "Open Studio to arrange and cut.");
			}
			selectedZones = new Set();
		}
	}

	function togglePattern(patternId: string) {
		const next = new Set(selectedPatternIds);
		next.has(patternId) ? next.delete(patternId) : next.add(patternId);
		selectedPatternIds = next;
	}

	function toggleZone(zone: string) {
		const next = new Set(selectedZones);
		next.has(zone) ? next.delete(zone) : next.add(zone);
		selectedZones = next;
	}

	function selectAll() {
		if (useStorePatterns) {
			selectedPatternIds = new Set(visibleStorePatterns.map((p) => p.id));
		} else {
			selectedZones = new Set(visibleGenericZones.map((z) => z.zone));
		}
	}

	const selectedCount = $derived(
		useStorePatterns ? selectedPatternIds.size : selectedZones.size,
	);

	// ─── Request vehicle ──────────────────────────
	function submitRequest() {
		const { year, make, model, notes } = requestForm;
		if (!make.trim() || !model.trim()) return;
		patternStore.addRequest({ year, make: make.trim(), model: model.trim(), notes: notes.trim() });
		toastStore.success(
			"Request submitted!",
			`${year} ${make.trim()} ${model.trim()} has been added to the queue.`,
		);
		showRequestModal = false;
		requestForm = { year: new Date().getFullYear(), make: "", model: "", notes: "" };
	}

	// ─── SVG preview paths (generic zones) ────────
	const ZONE_PATHS: Record<string, string> = {
		Hood:              "M5,85 Q10,20 50,5 Q90,20 95,85 Z",
		"Hood Edges":      "M5,85 Q10,60 50,55 Q90,60 95,85 L90,85 Q50,65 10,85 Z",
		"Front Bumper":    "M5,85 Q50,5 95,85 Z",
		"Rear Bumper":     "M5,15 Q50,85 95,15 Z",
		"Fender FL":       "M5,85 Q5,10 40,5 L45,85 Z",
		"Fender FR":       "M95,85 Q95,10 60,5 L55,85 Z",
		"Door FL":         "M5,5 L45,5 L45,95 L5,95 Z",
		"Door FR":         "M55,5 L95,5 L95,95 L55,95 Z",
		"Door RL":         "M5,5 L45,5 L45,95 L5,95 Z",
		"Door RR":         "M55,5 L95,5 L95,95 L55,95 Z",
		"Rocker L":        "M5,45 L95,45 L95,55 L5,55 Z",
		"Rocker R":        "M5,45 L95,45 L95,55 L5,55 Z",
		"Mirror L":        "M5,20 Q5,5 30,5 L35,30 Q20,40 5,35 Z",
		"Mirror R":        "M95,20 Q95,5 70,5 L65,30 Q80,40 95,35 Z",
		"A-Pillar L":      "M5,5 L20,5 L15,95 L5,95 Z",
		"A-Pillar R":      "M95,5 L80,5 L85,95 L95,95 Z",
		Roof:              "M10,5 L90,5 L90,95 L10,95 Z",
		Trunk:             "M10,10 Q50,5 90,10 L90,90 Q50,95 10,90 Z",
		Windshield:        "M8,90 Q12,30 32,8 L68,8 Q88,30 92,90 Z",
		"Windshield Strip":"M8,90 L92,90 L90,78 L10,78 Z",
		"Rear Window":     "M10,10 Q50,5 90,10 L88,90 Q50,95 12,90 Z",
		Sunroof:           "M15,15 Q50,10 85,15 L85,85 Q50,90 15,85 Z",
		Moonroof:          "M20,20 L80,20 L80,80 L20,80 Z",
		"Window Front L":  "M8,8 Q8,50 12,92 L48,88 L48,12 Z",
		"Window Front R":  "M92,8 Q92,50 88,92 L52,88 L52,12 Z",
		"Window Rear L":   "M8,8 Q8,50 12,92 L44,88 L44,12 Z",
		"Window Rear R":   "M92,8 Q92,50 88,92 L56,88 L56,12 Z",
		"Quarter Window L":"M5,15 L35,10 L40,90 L5,85 Z",
		"Quarter Window R":"M95,15 L65,10 L60,90 L95,85 Z",
		"Vent Window L":   "M5,10 L25,5 L28,45 L5,50 Z",
		"Vent Window R":   "M95,10 L75,5 L72,45 L95,50 Z",
	};

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
		<div class="lib-search-wrap">
			<svg class="lib-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
			<input
				type="search"
				class="lib-search"
				placeholder="Search make, model, year…"
				bind:value={search}
				aria-label="Search vehicles"
			/>
		</div>

		<div class="lib-section-label">Make</div>
		<div class="lib-filter-pills">
			{#each MAKES as make}
				<button
					class="lib-pill"
					class:active={activeMake === make}
					onclick={() => (activeMake = make)}
					aria-pressed={activeMake === make}>{make}</button>
			{/each}
		</div>

		<div class="lib-section-label">Zone</div>
		<div class="lib-filter-pills">
			{#each ZONES as zone}
				<button
					class="lib-pill"
					class:active={activeZone === zone}
					onclick={() => (activeZone = zone)}
					aria-pressed={activeZone === zone}>{zone}</button>
			{/each}
		</div>

		<div class="lib-section-label">Stats</div>
		<div class="lib-stats">
			{#if mode === "ppf"}
				<div class="lib-stat">
					<span class="lib-stat__val">12,400+</span>
					<span class="lib-stat__label">PPF Patterns</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{patternStore.vehicles.filter(v => v.status === "published").length}+</span>
					<span class="lib-stat__label">Vehicles</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">Weekly</span>
					<span class="lib-stat__label">Updates</span>
				</div>
			{:else}
				<div class="lib-stat">
					<span class="lib-stat__val">9,200+</span>
					<span class="lib-stat__label">Tint Patterns</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{patternStore.vehicles.filter(v => v.status === "published").length}+</span>
					<span class="lib-stat__label">Vehicles</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">11</span>
					<span class="lib-stat__label">Zones/Vehicle</span>
				</div>
			{/if}
		</div>

		<button class="lib-request-btn" onclick={() => (showRequestModal = true)}>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			Request a vehicle
		</button>
	</aside>

	<!-- ─── Main ─── -->
	<div class="library__main">

		<!-- Library / My Patterns tab bar -->
		<div class="lib-tabs" role="tablist">
			<button
				class="lib-tab"
				class:lib-tab--active={tab === "library"}
				role="tab"
				aria-selected={tab === "library"}
				onclick={() => (tab = "library")}
			>Library</button>
			<button
				class="lib-tab"
				class:lib-tab--active={tab === "mine"}
				role="tab"
				aria-selected={tab === "mine"}
				onclick={() => (tab = "mine")}
			>
				My Patterns
				{#if myPatterns.length}
					<span class="lib-tab__badge">{myPatterns.length}</span>
				{/if}
			</button>
		</div>

		{#if tab === "library"}
		<!-- Mode switcher -->
		<div class="mode-switcher" role="group" aria-label="Pattern mode">
			<button
				class="mode-btn"
				class:active={mode === "ppf"}
				onclick={() => switchMode("ppf")}
				aria-pressed={mode === "ppf"}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5"/><path d="M14 17a3 3 0 100 6 3 3 0 000-6z"/><path d="M8 17a3 3 0 100 6 3 3 0 000-6z"/></svg>
				PPF
			</button>
			<button
				class="mode-btn"
				class:active={mode === "tint"}
				onclick={() => switchMode("tint")}
				aria-pressed={mode === "tint"}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M7 6v12M12 6v12M17 6v12" opacity="0.4"/></svg>
				Window Tint
			</button>
		</div>

		<!-- Header -->
		<div class="library__header">
			<div>
				<h1 class="library__title">
					{mode === "ppf" ? "PPF Pattern Library" : "Window Tint Library"}
				</h1>
				<p class="library__sub">
					{filtered.length} vehicles · {selectedVehicle
						? "Select zones below"
						: "Select a vehicle to view patterns"}
				</p>
			</div>
			<div class="library__header-actions">
				<a href="/library/upload" class="upload-cta" title="Save a pattern to your library">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					Upload Pattern
				</a>
				<div class="view-divider" aria-hidden="true"></div>
				<button class="view-btn" class:active={view === "grid"} onclick={() => (view = "grid")} aria-label="Grid view">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
				</button>
				<button class="view-btn" class:active={view === "list"} onclick={() => (view = "list")} aria-label="List view">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
				</button>
			</div>
		</div>

		<!-- Vehicle grid -->
		{#if !selectedVehicle}
			<div class="vehicle-grid" class:vehicle-grid--list={view === "list"}>
				{#each filtered as vehicle (vehicle.id)}
					{@const storeCount = patternStore.getPatterns(vehicle.id, mode === "ppf" ? "ppf" : "window-tint").length}
					<button
						class="vehicle-card"
						onclick={() => (selectedVehicle = vehicle)}
						aria-label="Select {vehicle.year} {vehicle.make} {vehicle.model}"
					>
						<div class="vehicle-card__thumb">
							<svg width="80" height="40" viewBox="0 0 24 14" fill="none" stroke="var(--color-brand)" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d={BODY_STYLE_ICON[vehicle.bodyStyle] ?? BODY_STYLE_ICON.sedan}/>
								<ellipse cx="6.5" cy="14" rx="2" ry="1.5"/>
								<ellipse cx="17.5" cy="14" rx="2" ry="1.5"/>
							</svg>
						</div>
						<div class="vehicle-card__body">
							<div class="vehicle-card__year-make">{vehicle.year} {vehicle.make}</div>
							<div class="vehicle-card__model">{vehicle.model}</div>
							<div class="vehicle-card__meta">
								{#if storeCount > 0}
									<Badge variant="default" size="sm">
										{storeCount} {mode === "tint" ? "windows" : "patterns"}
									</Badge>
								{:else}
									<Badge variant="default" size="sm">{ZONE_PATTERNS.length} zones</Badge>
								{/if}
								{#if vehicle.popular}
									<Badge variant="brand" size="sm">Popular</Badge>
								{/if}
							</div>
						</div>
					</button>
				{/each}

				{#if filtered.length === 0}
					<div class="lib-empty">
						<p class="lib-empty__title">No vehicles found</p>
						<p class="lib-empty__sub">
							Try a different search or <button class="lib-empty__request" onclick={() => (showRequestModal = true)}>request this vehicle</button>.
						</p>
					</div>
				{/if}
			</div>

		<!-- Zone pattern browser -->
		{:else}
			<div class="zone-browser">
				<div class="zone-browser__header">
					<button class="back-btn" onclick={() => (selectedVehicle = null)}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
						Back to vehicles
					</button>
					<h2 class="zone-browser__title">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</h2>
					<div class="zone-browser__actions">
						{#if useStorePatterns}
							<Badge variant="success" size="sm" dot>
								{visibleStorePatterns.length} {mode === "tint" ? "windows" : "zones"} · verified
							</Badge>
						{:else}
							<Badge variant={mode === "tint" ? "info" : "default"}>
								{visibleGenericZones.length} {mode === "tint" ? "windows" : "zones"} · generic
							</Badge>
						{/if}
						<button class="lib-pill active" onclick={selectAll}>Select all</button>
						{#if selectedCount > 0}
							<Button variant="primary" size="sm" onclick={addAllSelected}>
								Add {selectedCount} to canvas →
							</Button>
						{/if}
					</div>
				</div>

				<div class="zone-grid">
					<!-- ─ Store patterns (vehicle-specific) ─ -->
					{#if useStorePatterns}
						{#each visibleStorePatterns as pattern (pattern.id)}
							{@const selected = selectedPatternIds.has(pattern.id)}
							<button
								class="zone-card"
								class:selected
								class:zone-card--tint={mode === "tint"}
								onclick={() => togglePattern(pattern.id)}
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
											fill={mode === "tint" ? "rgba(0,112,255,0.08)" : "rgba(0,229,255,0.06)"}
											stroke={mode === "tint" ? "var(--color-brand-dim)" : "var(--color-brand)"}
											stroke-width="2"
											stroke-linecap="round"
										/>
									</svg>
								</div>

								<div class="zone-card__info">
									<div class="zone-card__name">{pattern.name}</div>
									<div class="zone-card__meta">
										1 piece · {pattern.widthInches}" × {pattern.heightInches}"
									</div>
									{#if pattern.notes}
										<div class="zone-card__vlt-note">{pattern.notes}</div>
									{/if}
									<Badge variant={pattern.coverage === "full" ? "success" : "warning"} size="sm">
										{pattern.coverage}
									</Badge>
								</div>

								<div
									class="zone-card__add"
									role="button"
									tabindex="0"
									onclick={(e) => { e.stopPropagation(); addPatternToCanvas(pattern); }}
									onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); addPatternToCanvas(pattern); } }}
									aria-label="Add {pattern.name} to canvas"
									title="Add to canvas"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
								</div>
							</button>
						{/each}

					<!-- ─ Generic fallback zones ─ -->
					{:else}
						{#if mode === "tint"}
							<div class="zone-generic-notice">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
								Vehicle-specific patterns coming soon. Using generic tint zone templates.
							</div>
						{/if}

						{#each visibleGenericZones as zone}
							{@const selected = selectedZones.has(zone.zone)}
							<button
								class="zone-card"
								class:selected
								class:zone-card--tint={mode === "tint"}
								onclick={() => toggleZone(zone.zone)}
								aria-pressed={selected}
								aria-label="Select {zone.zone}"
							>
								{#if selected}
									<div class="zone-card__check" aria-hidden="true">
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
									</div>
								{/if}

								<div class="zone-card__preview">
									<svg width="60" height="50" viewBox="0 0 100 100" fill="none" aria-hidden="true">
										<path
											d={ZONE_PATHS[zone.zone] ?? ZONE_PATHS["Hood"]}
											fill={mode === "tint" ? "rgba(0,112,255,0.08)" : "rgba(0,229,255,0.06)"}
											stroke={mode === "tint" ? "var(--color-brand-dim)" : "var(--color-brand)"}
											stroke-width="2"
											stroke-linecap="round"
										/>
									</svg>
								</div>

								<div class="zone-card__info">
									<div class="zone-card__name">{zone.zone}</div>
									<div class="zone-card__meta">
										{zone.pieces} piece{zone.pieces !== 1 ? "s" : ""} · {zone.size}
									</div>
									{#if mode === "tint" && "vltNote" in zone && zone.vltNote}
										<div class="zone-card__vlt-note">{zone.vltNote}</div>
									{/if}
									<Badge variant={zone.coverage === "full" ? "success" : "warning"} size="sm">
										{zone.coverage}
									</Badge>
								</div>

								<div
									class="zone-card__add"
									role="button"
									tabindex="0"
									onclick={(e) => { e.stopPropagation(); addToCanvas(zone); }}
									onkeydown={(e) => { if (e.key === "Enter") { e.stopPropagation(); addToCanvas(zone); } }}
									aria-label="Add {zone.zone} to canvas"
									title="Add to canvas"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
								</div>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/if}

		{:else}

		<!-- ─── My Patterns tab ─── -->
		<div class="my-patterns">
			{#if myPatternsLoading}
				<div class="my-patterns__empty">
					<span class="ai-spinner" style="width:18px;height:18px" aria-hidden="true"></span>
				</div>
			{:else if myPatternsError}
				<p class="my-patterns__empty">{myPatternsError}</p>
			{:else if myPatterns.length === 0}
				<div class="my-patterns__empty">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
					<p>No patterns yet. <a href="/library/upload">Upload your first pattern →</a></p>
				</div>
			{:else}
				<div class="my-patterns__list">
					{#each myPatterns as p (p.id)}
						{@const pat = userPatternToPattern(p)}
						<div class="my-pattern-card">
							<div class="my-pattern-card__preview" aria-hidden="true">
								<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
									<path d={p.svgPath} fill="none" stroke="var(--color-brand)" stroke-width="2"/>
								</svg>
							</div>
							<div class="my-pattern-card__body">
								<div class="my-pattern-card__name">{p.name}</div>
								<div class="my-pattern-card__meta">{p.year} {p.make} {p.model} · {p.widthInches}" × {p.heightInches}"</div>
								<div class="my-pattern-card__badges">
									<span class="mpbadge mpbadge--{p.category === 'ppf' ? 'ppf' : 'tint'}">{p.category === 'ppf' ? 'PPF' : 'Tint'}</span>
									{#if p.isPublished}
										<span class="mpbadge mpbadge--published">Published</span>
									{:else if p.status === 'pending'}
										<span class="mpbadge mpbadge--pending">Review Pending</span>
									{:else}
										<span class="mpbadge mpbadge--private">Private</span>
									{/if}
								</div>
							</div>
							<div class="my-pattern-card__actions">
								<!-- Always: Add to canvas -->
								<button
									class="my-pattern-card__add"
									onclick={() => addPatternToCanvas(pat)}
									title="Add to canvas"
									aria-label="Add {p.name} to canvas"
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
									Add
								</button>

								{#if p.isPublished}
									<!-- Locked — approved community pattern -->
									<button
										class="my-pattern-card__locked"
										onclick={() => { adjustTarget = p; adjustNotes = ""; }}
										title="Request a change to this community pattern"
										aria-label="Request changes to {p.name}"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
										Request Changes
									</button>
								{:else}
									<!-- Private/pending — user can toggle community submission -->
									<button
										class="my-pattern-card__share"
										class:my-pattern-card__share--on={p.submitToCommunity}
										onclick={() => toggleCommunitySubmit(p)}
										title={p.submitToCommunity ? "Remove from community queue" : "Submit for community review"}
										aria-label={p.submitToCommunity ? "Remove from community queue" : "Submit for community review"}
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
										{p.submitToCommunity ? "Submitted" : "Submit"}
									</button>
								{/if}
							</div>
						</div>
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

<!-- ─── Request Vehicle Modal ─────────────────── -->
{#if showRequestModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showRequestModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<div>
					<h2 class="modal__title">Request a Vehicle</h2>
					<p class="modal__sub">We'll add verified patterns within 72 hours.</p>
				</div>
				<button class="modal__close" onclick={() => (showRequestModal = false)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>

			<form class="modal__body" onsubmit={(e) => { e.preventDefault(); submitRequest(); }}>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="req-year">Year</label>
						<input id="req-year" type="number" class="form-input" bind:value={requestForm.year} min="1990" max="2030" required />
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

				<div class="form-group">
					<label class="form-label" for="req-notes">Notes <span class="form-label__opt">(optional)</span></label>
					<input id="req-notes" type="text" class="form-input" bind:value={requestForm.notes} placeholder="Any specific zones you need — PPF, tint, both?" />
				</div>

				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (showRequestModal = false)}>Cancel</button>
					<button type="submit" class="btn-primary">Submit Request</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ─── Pattern Adjustment Request Modal ──── -->
{#if adjustTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (adjustTarget = null)}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
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
	.vehicle-card__model { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; font-family: var(--font-display); }
	.vehicle-card__meta { display: flex; gap: 4px; flex-wrap: wrap; }

	/* Empty */
	.lib-empty { grid-column: 1 / -1; text-align: center; padding: 48px 0; color: var(--text-tertiary); }
	.lib-empty__title { font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
	.lib-empty__sub   { font-size: 0.875rem; }
	.lib-empty__request { background: none; border: none; color: var(--text-brand); cursor: pointer; font-size: inherit; text-decoration: underline; font-family: inherit; }

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

	.zone-generic-notice {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: rgba(0, 112, 255, 0.05);
		border: 1px solid rgba(0, 112, 255, 0.15);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

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
	.zone-card__vlt-note { font-size: 0.6875rem; color: var(--color-warning); margin-bottom: 4px; line-height: 1.3; }

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
		.library { grid-template-columns: 1fr; }
		.library__sidebar { display: none; }
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
		gap: 6px;
		padding: 8px 16px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-tertiary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.lib-tab:hover { color: var(--text-secondary); }
	.lib-tab--active {
		color: var(--text-primary);
		border-bottom-color: var(--color-brand);
		font-weight: 600;
	}
	.lib-tab__badge {
		background: var(--color-brand);
		color: #fff;
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
	}
	.mpbadge--ppf  { background: color-mix(in srgb, #00e5ff 12%, transparent); color: #00e5ff; }
	.mpbadge--tint { background: color-mix(in srgb, #a78bfa 12%, transparent); color: #a78bfa; }
	.mpbadge--published { background: color-mix(in srgb, #22c55e 12%, transparent); color: #4ade80; }
	.mpbadge--pending   { background: color-mix(in srgb, #f59e0b 12%, transparent); color: #fbbf24; }
	.mpbadge--private   { background: var(--bg-surface-3); color: var(--text-tertiary); }
	.my-pattern-card__actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.my-pattern-card__add,
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
	.my-pattern-card__add:hover {
		background: var(--color-brand);
		border-color: var(--color-brand);
		color: #fff;
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
</style>
