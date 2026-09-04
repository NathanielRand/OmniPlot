<script lang="ts">
	import { onMount } from "svelte";
	import { toastStore, canvasStore, userStore } from "$lib/stores";
	import { patternStore, TINT_ZONE_GROUP, PPF_ZONE_GROUP, MIRROR_PAIRS, zonesForCategory, categoryShortLabel, categoryMeta } from "$lib/stores/patternStore.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { uid, getItemColor } from "$lib/utils";
	import { bestNest } from "$lib/utils/nesting";
	import { getUserPatterns, updateUserPattern, deleteUserPattern, addPatternAdjustmentRequest } from "$lib/firebase/firestore";
	import type { CanvasItem, Pattern, PatternZone, UserPattern } from "$lib/types";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";

	// ─── Zone filter lists ────────────────────────
	const PPF_ZONES = [
		"All zones", "Hood", "Fenders", "Bumpers", "Doors", "Mirrors", "Rocker Panels", "Roof", "Trunk",
	];
	const TINT_ZONES = [
		"All zones", "Windshield", "Side Windows", "Rear Window", "Sunroof", "Quarter / Vent",
	];


	// ─── State ────────────────────────────────────
	let tab            = $state<"library" | "mine">("library");
	let projectType    = $state<"vehicle" | "residential" | "commercial" | "custom">("vehicle");
	let mode           = $state<"ppf" | "tint">("ppf");
	let search         = $state("");
	let activeMake     = $state("All");
	let activeYear     = $state("All");
	let activeZone     = $state("All zones");
	let selectedVehicle = $state<VehicleEntry | null>(null);
	let view           = $state<"grid" | "list">("grid");
	let selectedPatternIds = $state<Set<string>>(new Set());
	let openNotes          = $state<Set<string>>(new Set());

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

	// ─── Delete pattern ──────────────────────────
	let deletePending = $state<Set<string>>(new Set());
	let deleting      = $state<Set<string>>(new Set());

	async function confirmDelete(p: UserPattern) {
		if (!deletePending.has(p.id)) {
			deletePending = new Set([...deletePending, p.id]);
			return;
		}
		deleting      = new Set([...deleting,      p.id]);
		deletePending = new Set([...deletePending].filter(id => id !== p.id));
		try {
			await deleteUserPattern(p.id);
			myPatterns = myPatterns.filter(m => m.id !== p.id);
			toastStore.success("Pattern deleted", `${compactZones(p.zones, p.category)} removed from your library.`);
		} catch {
			toastStore.error("Delete failed", "Could not delete the pattern. Please try again.");
			deleting = new Set([...deleting].filter(id => id !== p.id));
		}
	}

	function cancelDelete(id: string) {
		deletePending = new Set([...deletePending].filter(i => i !== id));
	}

	// Collapses mirror pairs into compact labels, e.g. "Front Door (L/R)" instead of
	// "Door Front Left + Door Front Right". Unpaired zones get their full label.
	function compactZones(zones: PatternZone[], category: UserPattern["category"]): string {
		const list = zonesForCategory(category);
		const getLabel = (z: PatternZone) => list.find(l => l.value === z)?.label ?? z;
		const remaining = new Set(zones);
		const parts: string[] = [];
		for (const z of zones) {
			if (!remaining.has(z)) continue;
			const mirror = MIRROR_PAIRS[z];
			if (mirror && remaining.has(mirror)) {
				const base = getLabel(z).replace(/ Left$| Right$/, "");
				parts.push(`${base} (L/R)`);
				remaining.delete(z);
				remaining.delete(mirror);
			} else {
				parts.push(getLabel(z));
				remaining.delete(z);
			}
		}
		return parts.join(" · ");
	}

	// Convert a UserPattern to a Pattern for canvas
	function userPatternToPattern(up: UserPattern): Pattern {
		return {
			id:           up.id,
			vehicleId:    up.vehicleId ?? `user_${up.ownerId}`,
			category:     up.category,
			zone:         up.zones[0] ?? "hood",
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
		const list = zonesForCategory(mirrorTarget.category);
		const getLabel = (z: PatternZone) => list.find(l => l.value === z)?.label ?? String(z);
		for (const z of mirrorTarget.zones) {
			const m = MIRROR_PAIRS[z];
			if (m && mirrorTarget.zones.includes(m)) {
				return {
					orig: { zone: z, label: getLabel(z) },
					flip: { zone: m, label: getLabel(m) },
				};
			}
		}
		return null;
	});

	function hasMirrorZones(p: UserPattern): boolean {
		return p.zones.some(z => {
			const m = MIRROR_PAIRS[z];
			return m !== undefined && p.zones.includes(m);
		});
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

	const totalPPF  = $derived(patternStore.vehicles.filter(v => v.status === "published").reduce((n, v) => n + patternStore.getPatterns(v.id, "ppf", true).length, 0));
	const totalTint = $derived(patternStore.vehicles.filter(v => v.status === "published").reduce((n, v) => n + patternStore.getPatterns(v.id, "window-tint", true).length, 0));

	const vehiclesWithPPF  = $derived(patternStore.vehicles.filter(v => v.status === "published" && patternStore.getPatterns(v.id, "ppf", true).length > 0).length);
	const vehiclesWithTint = $derived(patternStore.vehicles.filter(v => v.status === "published" && patternStore.getPatterns(v.id, "window-tint", true).length > 0).length);

	const avgPPFZones  = $derived(vehiclesWithPPF  > 0 ? Math.round(totalPPF  / vehiclesWithPPF)  : 0);
	const avgTintZones = $derived(vehiclesWithTint > 0 ? Math.round(totalTint / vehiclesWithTint) : 0);

	// Makes list — all published vehicles with patterns for current mode
	const MAKES = $derived(
		["All", ...new Set(
			patternStore.vehicles
				.filter((v) => v.status === "published")
				.filter((v) => patternStore.getPatterns(v.id, mode === "ppf" ? "ppf" : "window-tint", true).length > 0)
				.map((v) => v.make ?? "")
				.sort()
		)],
	);

	// Years list — scoped to current make selection, newest first
	const YEARS = $derived(
		["All", ...new Set(
			patternStore.vehicles
				.filter((v) => v.status === "published")
				.filter((v) => patternStore.getPatterns(v.id, mode === "ppf" ? "ppf" : "window-tint", true).length > 0)
				.filter((v) => activeMake === "All" || v.make === activeMake)
				.map((v) => String(v.year))
				.sort((a, b) => Number(b) - Number(a))
		)],
	);

	function switchMode(m: "ppf" | "tint") {
		mode      = m;
		activeYear = "All";
		activeZone = "All zones";
		selectedPatternIds = new Set();
	}

	// Reset year when make changes (year options are scoped to make)
	$effect(() => {
		activeMake; // track
		activeYear = "All";
	});

	// ─── Filtered vehicles (published only) ───────
	const filtered = $derived(
		patternStore.vehicles
			.filter((v) => v.status === "published")
			.filter((v) => (v.projectType ?? "vehicle") === projectType)
			.filter((v) => projectType !== "vehicle" || patternStore.getPatterns(v.id, mode === "ppf" ? "ppf" : "window-tint", true).length > 0)
			.filter((v) => projectType === "vehicle" || patternStore.getPatterns(v.id, undefined, true).length > 0)
			.filter((v) => {
				const q = search.toLowerCase();
				const matchSearch = !q || `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.propertyLabel ?? ""} ${v.address ?? ""}`.toLowerCase().includes(q);
				const matchMake   = projectType !== "vehicle" || activeMake === "All" || v.make === activeMake;
				const matchYear   = projectType !== "vehicle" || activeYear === "All" || String(v.year) === activeYear;
				return matchSearch && matchMake && matchYear;
			}),
	);

	function switchProjectType(p: typeof projectType) {
		projectType = p;
		selectedVehicle = null;
		activeMake = "All";
		activeYear = "All";
		activeZone = "All zones";
		search = "";
	}

	// ─── Vehicle-specific patterns from store ─────
	const vehiclePatterns = $derived(
		selectedVehicle
			? patternStore.getPatterns(selectedVehicle.id, mode === "ppf" ? "ppf" : "window-tint", true)
			: [],
	);

	// When the store has patterns for this vehicle+mode, use them; otherwise generic fallback
	const useStorePatterns = $derived(vehiclePatterns.length > 0);

	// Zone group map for the active mode
	const zoneGroupMap = $derived(mode === "ppf" ? PPF_ZONE_GROUP : TINT_ZONE_GROUP);

	// Store patterns visible under the current zone filter
	const visibleStorePatterns = $derived(
		activeZone === "All zones"
			? vehiclePatterns
			: vehiclePatterns.filter((p) => zoneGroupMap[p.zone] === activeZone),
	);

	// ─── Add store pattern to canvas ─────────────
	function addPatternToCanvas(pattern: Pattern, flippedH = false) {
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

	function selectAll() {
		if (useStorePatterns) {
			selectedPatternIds = new Set(visibleStorePatterns.map((p) => p.id));
		}
	}

	const selectedCount = $derived(selectedPatternIds.size);

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
				placeholder={projectType === "vehicle" ? "Search make, model, year…" : "Search by name or address…"}
				bind:value={search}
				aria-label={projectType === "vehicle" ? "Search vehicles" : "Search subjects"}
			/>
		</div>

		{#if projectType === "vehicle"}
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

		<div class="lib-section-label">Year</div>
		<div class="lib-filter-pills">
			{#each YEARS as year}
				<button
					class="lib-pill"
					class:active={activeYear === year}
					onclick={() => (activeYear = year)}
					aria-pressed={activeYear === year}>{year}</button>
			{/each}
		</div>
		{/if}

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
					<span class="lib-stat__val">{totalPPF}</span>
					<span class="lib-stat__label">PPF Patterns</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{vehiclesWithPPF}</span>
					<span class="lib-stat__label">Vehicles</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{avgPPFZones}</span>
					<span class="lib-stat__label">Avg Zones</span>
				</div>
			{:else}
				<div class="lib-stat">
					<span class="lib-stat__val">{totalTint}</span>
					<span class="lib-stat__label">Tint Patterns</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{vehiclesWithTint}</span>
					<span class="lib-stat__label">Vehicles</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">{avgTintZones}</span>
					<span class="lib-stat__label">Avg Zones</span>
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
		<!-- Project type switcher -->
		<div class="mode-switcher" role="group" aria-label="Project type">
			<button class="mode-btn" class:active={projectType === "vehicle"} onclick={() => switchProjectType("vehicle")} aria-pressed={projectType === "vehicle"}>Vehicle</button>
			<button class="mode-btn" class:active={projectType === "residential"} onclick={() => switchProjectType("residential")} aria-pressed={projectType === "residential"}>Residential</button>
			<button class="mode-btn" class:active={projectType === "commercial"} onclick={() => switchProjectType("commercial")} aria-pressed={projectType === "commercial"}>Commercial</button>
			<button class="mode-btn" class:active={projectType === "custom"} onclick={() => switchProjectType("custom")} aria-pressed={projectType === "custom"}>Custom</button>
		</div>

		{#if projectType === "vehicle"}
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
				{#if totalPPF > 0}<span class="mode-count">{totalPPF}</span>{/if}
			</button>
			<button
				class="mode-btn"
				class:active={mode === "tint"}
				onclick={() => switchMode("tint")}
				aria-pressed={mode === "tint"}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M7 6v12M12 6v12M17 6v12" opacity="0.4"/></svg>
				Window Tint
				{#if totalTint > 0}<span class="mode-count">{totalTint}</span>{/if}
			</button>
		</div>
		{/if}

		<!-- Header -->
		<div class="library__header">
			<div>
				<h1 class="library__title">
					{projectType !== "vehicle"
						? `${projectType[0].toUpperCase()}${projectType.slice(1)} Library`
						: (mode === "ppf" ? "PPF Pattern Library" : "Window Tint Library")}
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
					{@const storeCount = patternStore.getPatterns(vehicle.id, projectType === "vehicle" ? (mode === "ppf" ? "ppf" : "window-tint") : undefined, true).length}
					<button
						class="vehicle-card"
						onclick={() => (selectedVehicle = vehicle)}
						aria-label="Select {projectType === 'vehicle' ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : (vehicle.propertyLabel || vehicle.address || vehicle.model || 'project')}"
					>
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
								{:else}<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>{/if}
							</svg>
							{/if}
						</div>
						<div class="vehicle-card__body">
							{#if projectType === "vehicle"}
							<div class="vehicle-card__year-make">{vehicle.make}</div>
							<div class="vehicle-card__model">{vehicle.model}</div>
							{:else}
							<div class="vehicle-card__year-make">{vehicle.propertyLabel || vehicle.model || "Project"}</div>
							<div class="vehicle-card__model">{vehicle.address || ""}</div>
							{/if}
							<div class="vehicle-card__meta">
								{#if projectType === "vehicle"}
								<span
									class="year-badge"
									class:year-badge--active={activeYear === String(vehicle.year)}
									role="button"
									tabindex="0"
									aria-pressed={activeYear === String(vehicle.year)}
									aria-label="Filter by {vehicle.year}"
									title="Filter by {vehicle.year}"
									onclick={(e) => { e.stopPropagation(); activeYear = activeYear === String(vehicle.year) ? "All" : String(vehicle.year); }}
									onkeydown={(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === "Enter" || e.key === " ") activeYear = activeYear === String(vehicle.year) ? "All" : String(vehicle.year); }}
								>{vehicle.year}</span>
								{/if}
								{#if storeCount > 0}
									<Badge variant="default" size="sm">
										{storeCount} {mode === "tint" ? "windows" : "patterns"}
									</Badge>
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
						<p class="lib-empty__title">No patterns found</p>
						<p class="lib-empty__sub">
							Try a different search or <button class="lib-empty__request" onclick={() => (showRequestModal = true)}>request a pattern</button>.
						</p>
						<a href="/library/upload" class="lib-empty__upload">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
							Upload Pattern
						</a>
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
							<button class="lib-pill active" onclick={selectAll}>Select all</button>
						{/if}
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
							<div
								class="zone-card"
								class:selected
								class:zone-card--tint={mode === "tint"}
								role="button"
								tabindex="0"
								onclick={() => togglePattern(pattern.id)}
								onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePattern(pattern.id); } }}
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
									<div class="zone-card__badges">
										<Badge variant={pattern.coverage === "full" ? "success" : "warning"} size="sm">
											{pattern.coverage}
										</Badge>
										{#if pattern.notes}
											<button
												class="notes-toggle"
												class:notes-toggle--open={openNotes.has(pattern.id)}
												onclick={(e) => {
													e.stopPropagation();
													const next = new Set(openNotes);
													next.has(pattern.id) ? next.delete(pattern.id) : next.add(pattern.id);
													openNotes = next;
												}}
												title="View disclosure"
												aria-label="View pattern disclosure"
												aria-expanded={openNotes.has(pattern.id)}
											>
												<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
											</button>
										{/if}
									</div>
									{#if pattern.notes && openNotes.has(pattern.id)}
										<div class="zone-card__disclosure">
											{pattern.notes}
										</div>
									{/if}
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
							</div>
						{/each}

					<!-- ─ No verified patterns yet ─ -->
					{:else}
						<div class="zone-empty">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
							<p>No verified {mode === "ppf" ? "PPF" : "window tint"} patterns for this vehicle yet.</p>
							<a href="/library/upload" class="zone-empty__cta">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
								Upload a pattern for this vehicle
							</a>
						</div>
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
								<div class="my-pattern-card__name">{compactZones(p.zones, p.category)}</div>
								<div class="my-pattern-card__meta">{p.years.join(", ")} {p.make} {p.models.join(" / ")} · {p.widthInches}" × {p.heightInches}"</div>
								<div class="my-pattern-card__badges">
									<span class="mpbadge" style="--cat-accent: {categoryMeta(p.category).accent}">{categoryShortLabel(p.category)}</span>
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
									onclick={() => {
										if (hasMirrorZones(p)) {
											mirrorTarget = p;
											mirrorAddOrig = true;
											mirrorAddFlip = true;
										} else {
											addPatternToCanvas(pat);
										}
									}}
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
									<!-- Private/pending — edit + community submit toggle + delete -->
									<a
										href="/library/edit/{p.id}"
										class="my-pattern-card__edit"
										title="Edit this pattern"
										aria-label="Edit {p.name}"
									>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/></svg>
										Edit
									</a>
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
									{#if deletePending.has(p.id)}
										<button
											class="my-pattern-card__del-confirm"
											onclick={() => confirmDelete(p)}
											disabled={deleting.has(p.id)}
											aria-label="Confirm delete {p.name}"
										>
											{deleting.has(p.id) ? "Deleting…" : "Confirm?"}
										</button>
										<button
											class="my-pattern-card__del-cancel"
											onclick={() => cancelDelete(p.id)}
											aria-label="Cancel delete"
										>Cancel</button>
									{:else}
										<button
											class="my-pattern-card__delete"
											onclick={() => confirmDelete(p)}
											disabled={deleting.has(p.id)}
											title="Delete this pattern"
											aria-label="Delete {p.name}"
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
											Delete
										</button>
									{/if}
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
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showRequestModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
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
								<path d={mirrorTarget.svgPath} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="2"/>
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
								<path d={mirrorTarget.svgPath} transform="matrix(-1 0 0 1 100 0)" fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="2"/>
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
		color: #fff;
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

	.notes-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0;
		transition: color 0.12s, background 0.12s;
		flex-shrink: 0;
	}
	.notes-toggle:hover { color: var(--text-secondary); background: var(--bg-surface-3); }
	.notes-toggle--open { color: var(--color-brand); }

	.zone-card__disclosure {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		line-height: 1.45;
		margin-top: 6px;
		padding: 6px 8px;
		background: var(--bg-surface-2);
		border-left: 2px solid var(--border-default);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

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
	.my-pattern-card__add:hover {
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
</style>
