<script lang="ts">
	import { toastStore, canvasStore } from "$lib/stores";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { uid, getItemColor } from "$lib/utils";
	import { autoNest } from "$lib/utils/nesting";
	import type { CanvasItem } from "$lib/types";

	// ─── Mock data (replace with Firestore fetch) ─
	const MAKES = [
		"All",
		"BMW",
		"Mercedes",
		"Tesla",
		"Toyota",
		"Ford",
		"Porsche",
		"Audi",
		"Chevrolet",
		"Honda",
		"Dodge",
	];
	const PPF_ZONES = [
		"All zones",
		"Hood",
		"Fenders",
		"Bumpers",
		"Doors",
		"Mirrors",
		"Rocker Panels",
		"Roof",
		"Trunk",
	];

	const TINT_ZONES = [
		"All zones",
		"Windshield",
		"Side Windows",
		"Rear Window",
		"Sunroof",
		"Quarter / Vent",
	];

	interface MockVehicle {
		id: string;
		make: string;
		model: string;
		year: number;
		bodyStyle: string;
		patternCount: number;
		tags: string[];
		popular?: boolean;
	}

	const VEHICLES: MockVehicle[] = [
		{
			id: "bmw-m4-2024",
			make: "BMW",
			model: "M4",
			year: 2024,
			bodyStyle: "coupe",
			patternCount: 14,
			tags: ["popular", "sport"],
			popular: true,
		},
		{
			id: "bmw-m3-2024",
			make: "BMW",
			model: "M3",
			year: 2024,
			bodyStyle: "sedan",
			patternCount: 12,
			tags: ["sport"],
		},
		{
			id: "tesla-model3-2024",
			make: "Tesla",
			model: "Model 3",
			year: 2024,
			bodyStyle: "sedan",
			patternCount: 11,
			tags: ["popular", "ev"],
			popular: true,
		},
		{
			id: "tesla-models-2024",
			make: "Tesla",
			model: "Model S",
			year: 2024,
			bodyStyle: "sedan",
			patternCount: 13,
			tags: ["ev"],
		},
		{
			id: "porsche-911-2024",
			make: "Porsche",
			model: "911 GT3",
			year: 2024,
			bodyStyle: "coupe",
			patternCount: 16,
			tags: ["sport", "popular"],
			popular: true,
		},
		{
			id: "ford-f150-2024",
			make: "Ford",
			model: "F-150",
			year: 2024,
			bodyStyle: "truck",
			patternCount: 10,
			tags: ["truck"],
		},
		{
			id: "mercedes-c300-2024",
			make: "Mercedes",
			model: "C300",
			year: 2024,
			bodyStyle: "sedan",
			patternCount: 12,
			tags: [],
		},
		{
			id: "audi-rs6-2024",
			make: "Audi",
			model: "RS6 Avant",
			year: 2024,
			bodyStyle: "wagon",
			patternCount: 13,
			tags: ["sport"],
		},
		{
			id: "toyota-supra-2024",
			make: "Toyota",
			model: "GR Supra",
			year: 2024,
			bodyStyle: "coupe",
			patternCount: 9,
			tags: ["sport"],
		},
		{
			id: "dodge-hellcat-2024",
			make: "Dodge",
			model: "Challenger Hellcat",
			year: 2024,
			bodyStyle: "coupe",
			patternCount: 11,
			tags: ["sport"],
		},
		{
			id: "bmw-x5-2024",
			make: "BMW",
			model: "X5",
			year: 2024,
			bodyStyle: "suv",
			patternCount: 10,
			tags: [],
		},
		{
			id: "tesla-modelx-2024",
			make: "Tesla",
			model: "Model X",
			year: 2024,
			bodyStyle: "suv",
			patternCount: 12,
			tags: ["ev"],
		},
		{
			id: "porsche-cayenne-24",
			make: "Porsche",
			model: "Cayenne GTS",
			year: 2024,
			bodyStyle: "suv",
			patternCount: 11,
			tags: [],
		},
		{
			id: "ford-mustang-2024",
			make: "Ford",
			model: "Mustang GT",
			year: 2024,
			bodyStyle: "coupe",
			patternCount: 10,
			tags: ["sport"],
		},
		{
			id: "honda-civic-2024",
			make: "Honda",
			model: "Civic Type R",
			year: 2024,
			bodyStyle: "hatchback",
			patternCount: 9,
			tags: [],
		},
		{
			id: "mercedes-g63-2024",
			make: "Mercedes",
			model: "G 63 AMG",
			year: 2024,
			bodyStyle: "suv",
			patternCount: 12,
			tags: ["popular"],
			popular: true,
		},
	];

	const PPF_ZONE_PATTERNS = [
		{ zone: "Hood", pieces: 3, size: '60" × 48"', coverage: "full", group: "Hood" },
		{ zone: "Hood Edges", pieces: 2, size: '12" × 36"', coverage: "partial", group: "Hood" },
		{ zone: "Front Bumper", pieces: 1, size: '62" × 22"', coverage: "full", group: "Bumpers" },
		{ zone: "Rear Bumper", pieces: 1, size: '60" × 18"', coverage: "full", group: "Bumpers" },
		{ zone: "Fender FL", pieces: 1, size: '28" × 42"', coverage: "full", group: "Fenders" },
		{ zone: "Fender FR", pieces: 1, size: '28" × 42"', coverage: "full", group: "Fenders" },
		{ zone: "Mirror L", pieces: 1, size: '10" × 8"', coverage: "full", group: "Mirrors" },
		{ zone: "Mirror R", pieces: 1, size: '10" × 8"', coverage: "full", group: "Mirrors" },
		{ zone: "Door FL", pieces: 1, size: '38" × 52"', coverage: "full", group: "Doors" },
		{ zone: "Door FR", pieces: 1, size: '38" × 52"', coverage: "full", group: "Doors" },
		{ zone: "Door RL", pieces: 1, size: '36" × 50"', coverage: "full", group: "Doors" },
		{ zone: "Door RR", pieces: 1, size: '36" × 50"', coverage: "full", group: "Doors" },
		{ zone: "Rocker L", pieces: 1, size: '72" × 8"', coverage: "full", group: "Rocker Panels" },
		{ zone: "Rocker R", pieces: 1, size: '72" × 8"', coverage: "full", group: "Rocker Panels" },
		{ zone: "A-Pillar L", pieces: 1, size: '4" × 28"', coverage: "partial", group: "Roof" },
		{ zone: "A-Pillar R", pieces: 1, size: '4" × 28"', coverage: "partial", group: "Roof" },
		{ zone: "Roof", pieces: 1, size: '60" × 68"', coverage: "full", group: "Roof" },
		{ zone: "Trunk", pieces: 1, size: '56" × 40"', coverage: "full", group: "Trunk" },
	];

	const TINT_ZONE_PATTERNS = [
		{ zone: "Windshield", pieces: 1, size: '66" × 30"', coverage: "full", group: "Windshield", vltNote: "Usually front strip only in legal states" },
		{ zone: "Windshield Strip", pieces: 1, size: '66" × 6"', coverage: "partial", group: "Windshield", vltNote: "Top visor strip — legal in all states" },
		{ zone: "Rear Window", pieces: 1, size: '58" × 26"', coverage: "full", group: "Rear Window", vltNote: "" },
		{ zone: "Sunroof", pieces: 1, size: '32" × 28"', coverage: "full", group: "Sunroof", vltNote: "Panoramic roof — check fit per model" },
		{ zone: "Moonroof", pieces: 1, size: '24" × 20"', coverage: "full", group: "Sunroof", vltNote: "" },
		{ zone: "Window Front L", pieces: 1, size: '28" × 24"', coverage: "full", group: "Side Windows", vltNote: "" },
		{ zone: "Window Front R", pieces: 1, size: '28" × 24"', coverage: "full", group: "Side Windows", vltNote: "" },
		{ zone: "Window Rear L", pieces: 1, size: '26" × 22"', coverage: "full", group: "Side Windows", vltNote: "" },
		{ zone: "Window Rear R", pieces: 1, size: '26" × 22"', coverage: "full", group: "Side Windows", vltNote: "" },
		{ zone: "Quarter Window L", pieces: 1, size: '10" × 14"', coverage: "full", group: "Quarter / Vent", vltNote: "" },
		{ zone: "Quarter Window R", pieces: 1, size: '10" × 14"', coverage: "full", group: "Quarter / Vent", vltNote: "" },
		{ zone: "Vent Window L", pieces: 1, size: '6" × 10"', coverage: "full", group: "Quarter / Vent", vltNote: "" },
		{ zone: "Vent Window R", pieces: 1, size: '6" × 10"', coverage: "full", group: "Quarter / Vent", vltNote: "" },
	];

	// ─── State ────────────────────────────────────
	let mode = $state<"ppf" | "tint">("ppf");
	let search = $state("");
	let activeMake = $state("All");
	let activeZone = $state("All zones");
	let selectedVehicle = $state<MockVehicle | null>(null);
	let view = $state<"grid" | "list">("grid");
	let selectedZones = $state<Set<string>>(new Set());

	const ZONES = $derived(mode === "ppf" ? PPF_ZONES : TINT_ZONES);
	const ZONE_PATTERNS = $derived(mode === "ppf" ? PPF_ZONE_PATTERNS : TINT_ZONE_PATTERNS);

	// Reset zone filter when switching modes
	function switchMode(m: "ppf" | "tint") {
		mode = m;
		activeZone = "All zones";
		selectedZones = new Set();
	}

	// ─── Filtered vehicles ────────────────────────
	const filtered = $derived(
		VEHICLES.filter((v) => {
			const q = search.toLowerCase();
			const matchSearch =
				!q ||
				`${v.year} ${v.make} ${v.model}`.toLowerCase().includes(q);
			const matchMake = activeMake === "All" || v.make === activeMake;
			return matchSearch && matchMake;
		}),
	);

	const visibleZones = $derived(
		activeZone === "All zones"
			? ZONE_PATTERNS
			: ZONE_PATTERNS.filter((z) => z.group === activeZone)
	);

	// ─── Add zone to canvas ───────────────────────
	// Adds the new item then re-nests ALL items with the skyline algorithm so
	// patterns are always packed optimally — the shelf algorithm in findNextPosition
	// can't stack items in unused vertical space, leading to false OOB results.
	function addToCanvas(zone: (typeof PPF_ZONE_PATTERNS)[0]) {
		if (!selectedVehicle) return;
		const idx = canvasStore.items.length;
		const w = parseFloat(zone.size.split('"')[0]);
		const h = parseFloat(zone.size.split("×")[1]);

		const newItem: CanvasItem = {
			id: uid("item_"),
			patternId: `${selectedVehicle.id}_${zone.zone.toLowerCase().replace(/\s+/g, "-")}`,
			pattern: {
				id: uid("pat_"),
				vehicleId: selectedVehicle.id,
				category: mode,
				zone: "hood",
				name: zone.zone,
				coverage: zone.coverage as "full" | "partial",
				svgPath: "M10,90 Q15,20 50,5 Q85,20 90,90",
				widthInches: w,
				heightInches: h,
				revision: "2024-11",
				isPublished: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			x: 0, y: 0, width: w, height: h, rotation: 0,
			outOfBounds: false, flippedH: false, flippedV: false,
			scale: 1, layer: idx, locked: false,
			color: getItemColor(idx), label: zone.zone,
		};

		// Transposed sheet: roll_length = X (unconstrained), roll_width = Y (constraint)
		const ts = {
			...canvasStore.sheet,
			widthInches: canvasStore.sheet.heightInches,
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

	function addAllSelected() {
		if (!selectedVehicle) return;
		const toAdd = ZONE_PATTERNS.filter((z) => selectedZones.has(z.zone));
		toAdd.forEach(addToCanvas);
		toastStore.success(
			`${toAdd.length} patterns added`,
			"Open Studio to arrange and cut.",
		);
		selectedZones = new Set();
	}

	function toggleZone(zone: string) {
		const next = new Set(selectedZones);
		next.has(zone) ? next.delete(zone) : next.add(zone);
		selectedZones = next;
	}

	function selectAll() {
		selectedZones = new Set(visibleZones.map((z) => z.zone));
	}

	// SVG preview paths per zone (simplified)
	const ZONE_PATHS: Record<string, string> = {
		// PPF zones
		Hood:            "M5,85 Q10,20 50,5 Q90,20 95,85 Z",
		"Hood Edges":    "M5,85 Q10,60 50,55 Q90,60 95,85 L90,85 Q50,65 10,85 Z",
		"Front Bumper":  "M5,85 Q50,5 95,85 Z",
		"Rear Bumper":   "M5,15 Q50,85 95,15 Z",
		"Fender FL":     "M5,85 Q5,10 40,5 L45,85 Z",
		"Fender FR":     "M95,85 Q95,10 60,5 L55,85 Z",
		"Door FL":       "M5,5 L45,5 L45,95 L5,95 Z",
		"Door FR":       "M55,5 L95,5 L95,95 L55,95 Z",
		"Door RL":       "M5,5 L45,5 L45,95 L5,95 Z",
		"Door RR":       "M55,5 L95,5 L95,95 L55,95 Z",
		"Rocker L":      "M5,45 L95,45 L95,55 L5,55 Z",
		"Rocker R":      "M5,45 L95,45 L95,55 L5,55 Z",
		"Mirror L":      "M5,20 Q5,5 30,5 L35,30 Q20,40 5,35 Z",
		"Mirror R":      "M95,20 Q95,5 70,5 L65,30 Q80,40 95,35 Z",
		"A-Pillar L":    "M5,5 L20,5 L15,95 L5,95 Z",
		"A-Pillar R":    "M95,5 L80,5 L85,95 L95,95 Z",
		Roof:            "M10,5 L90,5 L90,95 L10,95 Z",
		Trunk:           "M10,10 Q50,5 90,10 L90,90 Q50,95 10,90 Z",
		// Window tint zones
		Windshield:          "M8,90 Q12,30 32,8 L68,8 Q88,30 92,90 Z",
		"Windshield Strip":  "M8,90 L92,90 L90,78 L10,78 Z",
		"Rear Window":       "M10,10 Q50,5 90,10 L88,90 Q50,95 12,90 Z",
		Sunroof:             "M15,15 Q50,10 85,15 L85,85 Q50,90 15,85 Z",
		Moonroof:            "M20,20 L80,20 L80,80 L20,80 Z",
		"Window Front L":    "M8,8 Q8,50 12,92 L48,88 L48,12 Z",
		"Window Front R":    "M92,8 Q92,50 88,92 L52,88 L52,12 Z",
		"Window Rear L":     "M8,8 Q8,50 12,92 L44,88 L44,12 Z",
		"Window Rear R":     "M92,8 Q92,50 88,92 L56,88 L56,12 Z",
		"Quarter Window L":  "M5,15 L35,10 L40,90 L5,85 Z",
		"Quarter Window R":  "M95,15 L65,10 L60,90 L95,85 Z",
		"Vent Window L":     "M5,10 L25,5 L28,45 L5,50 Z",
		"Vent Window R":     "M95,10 L75,5 L72,45 L95,50 Z",
	};

	const BODY_STYLE_ICON: Record<string, string> = {
		sedan: "M2 14 L6 8 L18 8 L22 14 Z",
		coupe: "M3 14 L7 7 L17 7 L21 14 Z",
		suv: "M2 14 L4 6 L20 6 L22 14 Z",
		truck: "M2 14 L4 8 L12 8 L12 6 L20 6 L22 14 Z",
		hatchback: "M2 14 L5 8 L19 8 L22 11 L22 14 Z",
		wagon: "M2 14 L4 7 L20 7 L22 14 Z",
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
			<svg
				class="lib-search-icon"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
				><circle cx="11" cy="11" r="8" /><path
					d="M21 21l-4.35-4.35"
				/></svg
			>
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
					aria-pressed={activeMake === make}>{make}</button
				>
			{/each}
		</div>

		<div class="lib-section-label">Zone</div>
		<div class="lib-filter-pills">
			{#each ZONES as zone}
				<button
					class="lib-pill"
					class:active={activeZone === zone}
					onclick={() => (activeZone = zone)}
					aria-pressed={activeZone === zone}>{zone}</button
				>
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
					<span class="lib-stat__val">850+</span>
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
					<span class="lib-stat__val">850+</span>
					<span class="lib-stat__label">Vehicles</span>
				</div>
				<div class="lib-stat">
					<span class="lib-stat__val">13</span>
					<span class="lib-stat__label">Zones/Vehicle</span>
				</div>
			{/if}
		</div>

		<button class="lib-request-btn">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
			>
			Request a vehicle
		</button>
	</aside>

	<!-- ─── Main ─── -->
	<div class="library__main">
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
				<button
					class="view-btn"
					class:active={view === "grid"}
					onclick={() => (view = "grid")}
					aria-label="Grid view"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
						><rect x="3" y="3" width="7" height="7" /><rect
							x="14"
							y="3"
							width="7"
							height="7"
						/><rect x="3" y="14" width="7" height="7" /><rect
							x="14"
							y="14"
							width="7"
							height="7"
						/></svg
					>
				</button>
				<button
					class="view-btn"
					class:active={view === "list"}
					onclick={() => (view = "list")}
					aria-label="List view"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
						><path
							d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
						/></svg
					>
				</button>
			</div>
		</div>

		<!-- Vehicle grid -->
		{#if !selectedVehicle}
			<div
				class="vehicle-grid"
				class:vehicle-grid--list={view === "list"}
			>
				{#each filtered as vehicle (vehicle.id)}
					<button
						class="vehicle-card"
						onclick={() => (selectedVehicle = vehicle)}
						aria-label="Select {vehicle.year} {vehicle.make} {vehicle.model}"
					>
						<!-- SVG vehicle silhouette -->
						<div class="vehicle-card__thumb">
							<svg
								width="80"
								height="40"
								viewBox="0 0 24 14"
								fill="none"
								stroke="var(--color-brand)"
								stroke-width="0.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path
									d={BODY_STYLE_ICON[vehicle.bodyStyle] ??
										BODY_STYLE_ICON.sedan}
								/>
								<ellipse cx="6.5" cy="14" rx="2" ry="1.5" />
								<ellipse cx="17.5" cy="14" rx="2" ry="1.5" />
							</svg>
						</div>
						<div class="vehicle-card__body">
							<div class="vehicle-card__year-make">
								{vehicle.year}
								{vehicle.make}
							</div>
							<div class="vehicle-card__model">
								{vehicle.model}
							</div>
							<div class="vehicle-card__meta">
								<Badge variant="default" size="sm">
									{vehicle.patternCount} {mode === "tint" ? "windows" : "patterns"}
								</Badge>
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
							Try a different search or <button
								class="lib-empty__request"
								onclick={() =>
									toastStore.info(
										"Request submitted",
										"We'll add your vehicle within 72 hours.",
									)}>request this vehicle</button
							>.
						</p>
					</div>
				{/if}
			</div>

			<!-- Zone pattern browser -->
		{:else}
			<div class="zone-browser">
				<div class="zone-browser__header">
					<button
						class="back-btn"
						onclick={() => (selectedVehicle = null)}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							aria-hidden="true"
							><path d="M19 12H5M12 5l-7 7 7 7" /></svg
						>
						Back to vehicles
					</button>
					<h2 class="zone-browser__title">
						{selectedVehicle.year}
						{selectedVehicle.make}
						{selectedVehicle.model}
					</h2>
					<div class="zone-browser__actions">
						<Badge variant={mode === "tint" ? "info" : "default"}>
							{visibleZones.length} {mode === "tint" ? "windows" : "zones"}
						</Badge>
						<button class="lib-pill active" onclick={selectAll}
							>Select all</button
						>
						{#if selectedZones.size > 0}
							<Button
								variant="primary"
								size="sm"
								onclick={addAllSelected}
							>
								Add {selectedZones.size} to canvas →
							</Button>
						{/if}
					</div>
				</div>

				<div class="zone-grid">
					{#each visibleZones as zone}
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
								<svg
									width="60"
									height="50"
									viewBox="0 0 100 100"
									fill="none"
									aria-hidden="true"
								>
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
								<Badge
									variant={zone.coverage === "full" ? "success" : "warning"}
									size="sm"
								>{zone.coverage}</Badge>
							</div>

							<div
								class="zone-card__add"
								role="button"
								tabindex="0"
								onclick={(e) => {
									e.stopPropagation();
									addToCanvas(zone);
								}}
								onkeydown={(e) => {
									if (e.key === "Enter") {
										e.stopPropagation();
										addToCanvas(zone);
									}
								}}
								aria-label="Add {zone.zone} to canvas"
								title="Add to canvas"
							>
								<svg
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									aria-hidden="true"
									><path d="M12 5v14M5 12h14" /></svg
								>
							</div>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

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

	.lib-search:focus {
		border-color: var(--color-brand-dim);
	}
	.lib-search::placeholder {
		color: var(--text-tertiary);
	}

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

	.lib-pill:hover {
		border-color: var(--border-default);
		color: var(--text-primary);
	}
	.lib-pill.active {
		background: var(--color-brand-dim);
		border-color: var(--color-brand-dim);
		color: #fff;
	}

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

	.lib-request-btn:hover {
		border-color: var(--color-brand-dim);
		color: var(--text-brand);
	}

	/* ─── Main ────── */
	.library__main {
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Mode switcher */
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

	.mode-btn.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
		box-shadow: 0 1px 3px rgba(0,0,0,0.12);
	}

	.library__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.library__title {
		font-size: 1.25rem;
		margin-bottom: 3px;
	}

	.library__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.library__header-actions {
		display: flex;
		gap: 4px;
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

	.view-btn.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.view-btn:hover {
		color: var(--text-primary);
	}

	/* Vehicle grid */
	.vehicle-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px;
	}

	.vehicle-grid--list {
		grid-template-columns: 1fr;
	}

	.vehicle-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		cursor: pointer;
		text-align: left;
		transition:
			border-color 0.15s,
			transform 0.12s,
			box-shadow 0.15s;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.vehicle-card:hover {
		border-color: var(--color-brand-dim);
		transform: translateY(-1px);
		box-shadow: var(--shadow-md);
	}

	.vehicle-grid--list .vehicle-card {
		flex-direction: row;
		align-items: center;
	}

	.vehicle-card__thumb {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 50px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}

	.vehicle-grid--list .vehicle-card__thumb {
		width: 80px;
	}

	.vehicle-card__body {
		flex: 1;
	}
	.vehicle-card__year-make {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin-bottom: 2px;
	}
	.vehicle-card__model {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
		font-family: var(--font-display);
	}

	.vehicle-card__meta {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	/* Empty */
	.lib-empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: 48px 0;
		color: var(--text-tertiary);
	}

	.lib-empty__title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 6px;
	}
	.lib-empty__sub {
		font-size: 0.875rem;
	}

	.lib-empty__request {
		background: none;
		border: none;
		color: var(--text-brand);
		cursor: pointer;
		font-size: inherit;
		text-decoration: underline;
		font-family: inherit;
	}

	/* Zone browser */
	.zone-browser {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.zone-browser__header {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.zone-browser__title {
		font-size: 1.125rem;
		flex: 1;
	}

	.zone-browser__actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

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

	.back-btn:hover {
		color: var(--text-primary);
		background: var(--bg-surface-3);
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
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.zone-card:hover { border-color: var(--border-strong); }

	.zone-card.selected {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.04);
	}

	.zone-card--tint:hover { border-color: var(--color-brand-dim); }
	.zone-card--tint.selected {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.05);
	}

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

	.zone-card__name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.zone-card__meta {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		color: var(--text-tertiary);
		margin-bottom: 2px;
	}
	.zone-card__vlt-note {
		font-size: 0.6875rem;
		color: var(--color-warning);
		margin-bottom: 4px;
		line-height: 1.3;
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
		transition:
			opacity 0.12s,
			background 0.12s;
	}

	.zone-card:hover .zone-card__add {
		opacity: 1;
	}
	.zone-card__add:hover {
		background: var(--color-brand-dim);
		color: #fff;
		border-color: transparent;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.library {
			grid-template-columns: 1fr;
		}
		.library__sidebar {
			display: none;
		}
	}
</style>
