<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { userStore, toastStore } from "$lib/stores";
	import { patternOptionsStore } from "$lib/stores/patternOptionsStore.svelte";
	import { patternStore, mirrorOf as storeMirrorOf, allCategories, allBodyStyles, zonesFor } from "$lib/stores/patternStore.svelte";
	import { getUserPatternById, updateUserPattern, deleteUserPattern } from "$lib/firebase/firestore";
	import SvgPathInput from "$lib/components/ui/SvgPathInput.svelte";
	import InfoTip from "$lib/components/ui/InfoTip.svelte";
	import VehicleCombobox from "$lib/components/ui/VehicleCombobox.svelte";
	import TagInput from "$lib/components/ui/TagInput.svelte";
	import { tooltip } from "$lib/actions/tooltip";
	import { untrack } from "svelte";
	import { deriveHeight, deriveWidth, relinkSize, applyFileSize, sizeError } from "$lib/utils/patternSize";
	import type { PatternCategory, PatternZone, PatternCoverage, ProjectType, UserPattern } from "$lib/types";

	type BodyStyle = UserPattern["bodyStyle"];
	const MINE = "/library?source=private";

	// ─── Load ─────────────────────────────────────
	let loading  = $state(true);
	let notFound = $state(false);
	let original = $state<UserPattern | null>(null);

	// ─── Form state (mirrors upload form fields) ──
	let mode = $state<"private" | "community">("private");
	let projectType = $state<ProjectType>("vehicle");

	const identityTitle = $derived(
		projectType === "vehicle"     ? "Vehicle" :
		projectType === "custom"      ? "Pattern Name" :
		"Property",
	);
	let vehicle = $state({
		make:      "",
		models:    [] as string[],
		trims:     [] as string[],
		years:     [] as string[],
		bodyStyle: "sedan" as BodyStyle,
	});
	// Residential/commercial: label + address. Custom: project name.
	let propertyLabel = $state("");
	let address       = $state("");
	let customName    = $state("");

	let pattern = $state({
		category:     "ppf" as PatternCategory,
		zones:        [] as PatternZone[],
		customZoneLabels: [] as string[], // parallel to zones; used where zones[i] === "custom"
		coverage:     "full" as PatternCoverage,
		widthInches:  0,
		heightInches: 0,
		svgPath:      "",
		notes:        "",
	});

	let pendingCustomLabel = $state("");
	let addingCustom = $state(false);
	let errors   = $state<Record<string, string>>({});
	let saving   = $state(false);
	let deleting = $state(false);
	let showDeleteConfirm = $state(false);

	// Make/model suggestions: published vehicle subjects only — never blank,
	// never a residential "make".
	const catalogVehicles = $derived(
		patternStore.vehicles.filter((v) => v.status === "published" && (v.projectType ?? "vehicle") === "vehicle" && v.make),
	);
	const allMakes = $derived([...new Set(catalogVehicles.map((v) => v.make!))].sort());
	const makeModels = $derived(
		vehicle.make.trim()
			? [...new Set(
				catalogVehicles
					.filter((v) => v.make!.toLowerCase() === vehicle.make.trim().toLowerCase() && v.model)
					.map((v) => v.model!),
			)].sort()
			: [],
	);

	// Trim / variant suggestions for the chosen make + models.
	const makeTrims = $derived(
		[...new Set(
			catalogVehicles
				.filter((v) => v.trim
					&& v.make!.toLowerCase() === vehicle.make.trim().toLowerCase()
					&& (!vehicle.models.length || vehicle.models.some((m) => m.toLowerCase() === (v.model ?? "").toLowerCase())))
				.map((v) => v.trim!),
		)].sort(),
	);

	const zoneList = $derived(zonesFor(pattern.category, projectType));

	// A vehicle's zone list depends on the category; drop zones the new list
	// doesn't have (custom zones always stay).
	// Waits for the admin-added zones and counts hidden ones as valid: a pattern
	// saved with one must keep it, not lose it to a late load or a hide.
	$effect(() => {
		if (!patternOptionsStore.loaded) return;
		const valid = new Set(zonesFor(pattern.category, projectType, true).map((z) => z.value));
		if (pattern.zones.some((z) => z !== "custom" && !valid.has(z))) {
			const keep = pattern.zones
				.map((z, i) => ({ z, l: pattern.customZoneLabels[i] ?? "" }))
				.filter(({ z }) => z === "custom" || valid.has(z));
			pattern.zones = keep.map((k) => k.z);
			pattern.customZoneLabels = keep.map((k) => k.l);
		}
	});

	$effect(() => {
		if (pattern.category === "window-tint") pattern.coverage = "full";
	});

	const availableZones = $derived(
		zoneList.filter((z) => z.value === "custom" || !pattern.zones.includes(z.value)),
	);

	const hasMirrorPair = $derived(
		pattern.zones.some((z) => {
			const m = storeMirrorOf(z);
			return m !== undefined && pattern.zones.includes(m);
		}),
	);

	const mirrorZoneLabels = $derived((() => {
		for (const z of pattern.zones) {
			const m = storeMirrorOf(z);
			if (m && pattern.zones.includes(m)) {
				return { orig: zoneLabel(z), flip: zoneLabel(m) };
			}
		}
		return null;
	})());

	// ─── Zone helpers ─────────────────────────────
	function addZone(z: PatternZone, label = "") {
		if (z !== "custom" && pattern.zones.includes(z)) return;
		pattern.zones = [...pattern.zones, z];
		pattern.customZoneLabels = [...pattern.customZoneLabels, z === "custom" ? label : ""];
	}
	function removeZoneAt(i: number) {
		pattern.zones = pattern.zones.filter((_, idx) => idx !== i);
		pattern.customZoneLabels = pattern.customZoneLabels.filter((_, idx) => idx !== i);
	}
	function onZoneAdd(e: Event) {
		const el = e.target as HTMLSelectElement;
		const val = el.value as PatternZone;
		el.value = "";
		if (!val) return;
		if (val === "custom") { addingCustom = true; pendingCustomLabel = ""; return; }
		addZone(val);
	}
	function commitCustomZone() {
		const label = pendingCustomLabel.trim();
		if (!label) return;
		addZone("custom", label);
		addingCustom = false;
		pendingCustomLabel = "";
	}
	function zoneLabel(z: PatternZone, i?: number): string {
		if (z === "custom") return (i !== undefined ? pattern.customZoneLabels[i]?.trim() : "") || "Custom";
		return zoneList.find((zl) => zl.value === z)?.label ?? z;
	}
	function mirrorOf(z: PatternZone): PatternZone | undefined {
		return storeMirrorOf(z);
	}

	// ─── Load once auth has resolved ──────────────
	// (Redirecting before auth finished bounced every refresh of this page.)
	let started = false;
	$effect(() => {
		if (userStore.loading || started) return;
		started = true;
		load();
	});

	async function load() {
		if (!userStore.user) { goto("/login"); return; }
		const id = page.params.id ?? "";
		if (!id) { notFound = true; loading = false; return; }
		try {
			const p = await getUserPatternById(id);
			if (!p || p.ownerId !== userStore.user.uid) { notFound = true; return; }
			// Published patterns are locked — changes go through a request.
			if (p.isPublished) {
				toastStore.info("This pattern is in the community library", "Request changes from My patterns instead.");
				goto(MINE);
				return;
			}
			original    = p;
			mode        = p.submitToCommunity ? "community" : "private";
			projectType = p.projectType ?? "vehicle";
			vehicle = { make: p.make, models: [...p.models], trims: [...(p.trims ?? [])], years: [...p.years], bodyStyle: p.bodyStyle };
			const isProperty = projectType === "residential" || projectType === "commercial";
			propertyLabel = p.propertyLabel ?? (isProperty ? p.models[0] ?? "" : "");
			address       = p.address ?? "";
			customName    = p.patternName ?? (projectType === "custom" ? p.models[0] ?? "" : "");
			pattern  = {
				category:     p.category,
				zones:        [...p.zones],
				customZoneLabels: p.zones.map((_, i) => p.customZoneLabels?.[i] ?? ""),
				coverage:     p.coverage,
				widthInches:  p.widthInches,
				heightInches: p.heightInches,
				svgPath:      p.svgPath,
				notes:        p.notes ?? "",
			};
			loadedPath = p.svgPath;
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	}

	// PRECISION: W × H always keeps the outline's exact proportions. When a
	// NEW outline is imported, re-derive the size from it. The loaded pattern
	// is never silently changed — if its saved size doesn't match its outline
	// the owner is told (sizeProblem) and re-enters one dimension.
	let loadedPath = $state<string | null>(null);
	$effect(() => {
		const path = pattern.svgPath;
		untrack(() => {
			if (loadedPath === null || path === loadedPath) return;
			loadedPath = path;
			relinkSize(pattern, path);
		});
	});
	const sizeProblem = $derived(original && pattern.svgPath.trim() ? sizeError(pattern, pattern.svgPath) : null);

	// ─── Year helpers ─────────────────────────────
	function parseYear(s: string): string | null {
		s = s.trim().replace(/[–—]/g, "-");
		const maxY = new Date().getFullYear() + 2;
		if (/^\d{4}$/.test(s)) {
			const y = +s;
			return y >= 1950 && y <= maxY ? s : null;
		}
		if (/^\d{4}-\d{4}$/.test(s)) {
			const [a, b] = s.split("-").map(Number);
			return a >= 1950 && b <= maxY && a < b ? s : null;
		}
		return null;
	}
	// ─── Validation ───────────────────────────────
	function validate(): boolean {
		const e: Record<string, string> = {};
		if (projectType === "vehicle") {
			if (!vehicle.make.trim())    e.make   = "Make is required";
			if (!vehicle.models.length)  e.models = "Add at least one model";
			if (!vehicle.years.length)   e.years  = "Add at least one year or range";
		} else if (projectType === "custom") {
			if (!customName.trim()) e.customName = "Give the project a name";
		} else if (!propertyLabel.trim() && !address.trim()) {
			e.propertyLabel = "Add a label or an address";
		}
		if (!pattern.zones.length)   e.zones  = "Select at least one zone";
		if (!pattern.svgPath.trim()) e.svgPath = "SVG path data is required";
		else { const se = sizeError(pattern, pattern.svgPath); if (se) e.width = se; }
		errors = e;
		return Object.keys(e).length === 0;
	}

	/** Subject fields, shaped exactly like the upload form writes them. Fields that
	 *  belong to another pattern type are explicitly cleared (undefined → deleteField),
	 *  so changing the type never leaves stale address / project name behind. */
	function identity(): Partial<UserPattern> {
		if (projectType === "vehicle") {
			return {
				projectType, make: vehicle.make.trim(), models: vehicle.models, trims: vehicle.trims.length ? [...vehicle.trims] : undefined, years: vehicle.years, bodyStyle: vehicle.bodyStyle,
				patternName: undefined, address: undefined, propertyLabel: undefined,
			};
		}
		if (projectType === "custom") {
			return {
				projectType, make: "Custom", models: [customName.trim()], trims: undefined, years: [], bodyStyle: "sedan", patternName: customName.trim(),
				address: undefined, propertyLabel: undefined,
			};
		}
		return {
			projectType,
			make: projectType === "residential" ? "Residential" : "Commercial",
			models: [propertyLabel.trim() || address.trim()],
			trims: undefined,
			years: [],
			bodyStyle: "sedan",
			address: address.trim() || undefined,
			propertyLabel: propertyLabel.trim() || undefined,
			patternName: undefined,
		};
	}


	// ─── Save ─────────────────────────────────────
	async function handleSave(e: SubmitEvent) {
		e.preventDefault();
		if (!validate() || !original) return;
		saving = true;
		try {
			const name = pattern.zones.map((z, i) => zoneLabel(z, i)).join(" + ");
			await updateUserPattern(original.id, {
				...identity(),
				category:     pattern.category,
				zones:        pattern.zones,
				customZoneLabels: pattern.zones.includes("custom") ? pattern.customZoneLabels : undefined,
				name,
				coverage:     pattern.coverage,
				widthInches:  pattern.widthInches,
				heightInches: pattern.heightInches,
				svgPath:      pattern.svgPath.trim(),
				notes:        pattern.notes.trim() || undefined,
				...((mode === "community") !== original.submitToCommunity ? { submitToCommunity: mode === "community" } : {}),
			});
			toastStore.success("Pattern saved", `${name} has been updated.`);
			goto(MINE);
		} catch (err) {
			console.error("[edit/handleSave]", err);
			toastStore.error("Save failed", "Could not save changes. Please try again.");
		} finally {
			saving = false;
		}
	}

	// ─── Delete ───────────────────────────────────
	async function handleDelete() {
		if (!original) return;
		deleting = true;
		try {
			await deleteUserPattern(original.id);
			toastStore.success("Pattern deleted", `${original.name} has been removed.`);
			goto(MINE);
		} catch {
			toastStore.error("Delete failed", "Could not delete pattern. Please try again.");
		} finally {
			deleting = false;
			showDeleteConfirm = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Pattern — OmniPlot</title>
</svelte:head>

<div class="page">

	{#if loading}
		<div class="loading">
			<span class="spinner" aria-hidden="true"></span>
			Loading…
		</div>

	{:else if notFound}
		<div class="not-found">
			<p>Pattern not found or you don't have permission to edit it.</p>
			<a href={MINE} class="btn btn--ghost">Back to My Patterns</a>
		</div>

	{:else}

		<!-- Header -->
		<div class="edit-header">
			<a href={MINE} class="back-link">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
				My patterns
			</a>
			<h1 class="edit-title">Edit Pattern</h1>
			{#if original?.status === "pending"}
				<span class="status-chip status-chip--pending">In review — the reviewer will see your changes</span>
			{/if}
		</div>

		<div class="mode-bar">
			<button
				type="button"
				class="mode-card"
				class:mode-card--active={mode === "private"}
				onclick={() => (mode = "private")}
				aria-pressed={mode === "private"}
			>
				<div class="mode-card__icon" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
				</div>
				<div class="mode-card__body">
					<span class="mode-card__title">Private</span>
					<span class="mode-card__sub">Only visible to you. Modify or delete anytime. Submit to community whenever you're ready.</span>
				</div>
				<div class="mode-card__check" aria-hidden="true">
					{#if mode === "private"}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</div>
			</button>

			<button
				type="button"
				class="mode-card"
				class:mode-card--active={mode === "community"}
				onclick={() => (mode = "community")}
				aria-pressed={mode === "community"}
			>
				<div class="mode-card__icon" aria-hidden="true">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
				</div>
				<div class="mode-card__body">
					<span class="mode-card__title">Community Submission</span>
					<span class="mode-card__sub">Queued for admin review before going public. Once approved, the pattern is locked and belongs to the community library.</span>
				</div>
				<div class="mode-card__check" aria-hidden="true">
					{#if mode === "community"}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</div>
			</button>
		</div>

		<!-- Form -->
		<div class="form-wrap">
			<form class="edit-form" onsubmit={handleSave} novalidate>

			<!-- Pattern Type -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">1</span>
						Pattern Type
					</h2>
					<div class="type-grid" role="radiogroup" aria-label="Pattern type">
						<button type="button" class="type-card" class:type-card--active={projectType === "vehicle"} onclick={() => (projectType = "vehicle")} aria-pressed={projectType === "vehicle"}>
							<span class="type-card__icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/><path d="M5 17H3v-6l2-5h11l3 5h1a1 1 0 0 1 1 1v5h-2M9 17h6"/></svg>
							</span>
							<span class="type-card__title">Vehicle</span>
							<span class="type-card__sub">PPF or window tint for a make/model/year</span>
						</button>
						<button type="button" class="type-card" class:type-card--active={projectType === "residential"} onclick={() => (projectType = "residential")} aria-pressed={projectType === "residential"}>
							<span class="type-card__icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>
							</span>
							<span class="type-card__title">Residential</span>
							<span class="type-card__sub">Window film for a home or property</span>
						</button>
						<button type="button" class="type-card" class:type-card--active={projectType === "commercial"} onclick={() => (projectType = "commercial")} aria-pressed={projectType === "commercial"}>
							<span class="type-card__icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M8 7h1M8 11h1M8 15h1M15 7h1M15 11h1M15 15h1"/></svg>
							</span>
							<span class="type-card__title">Commercial</span>
							<span class="type-card__sub">Window film for a storefront or building</span>
						</button>
						<button type="button" class="type-card" class:type-card--active={projectType === "custom"} onclick={() => (projectType = "custom")} aria-pressed={projectType === "custom"}>
							<span class="type-card__icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/></svg>
							</span>
							<span class="type-card__title">Custom</span>
							<span class="type-card__sub">Anything else — just give it a name</span>
						</button>
					</div>
				</section>

				<!-- Identity -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">2</span>
						{identityTitle}
					</h2>

					{#if projectType === "vehicle"}
						<div class="field" class:field--error={errors.make}>
							<label class="field__label" for="make">Make</label>
							<VehicleCombobox id="make" bind:value={vehicle.make} placeholder="Chevrolet" options={allMakes} error={!!errors.make}/>
							{#if errors.make}<span class="field__error">{errors.make}</span>{/if}
						</div>

						<div class="field" class:field--error={!!errors.models}>
							<label class="field__label" for="model-input">
								Model
								{#if vehicle.make.trim()}
									<span class="field__hint">Matches narrow to {vehicle.make.trim()}</span>
								{/if}
							</label>
							<TagInput id="model-input" bind:values={vehicle.models} suggestions={makeModels} placeholder="Silverado 1500" noun="model" error={!!errors.models} />
							{#if errors.models}<span class="field__error">{errors.models}</span>{/if}
						</div>

						<div class="field">
							<label class="field__label" for="trim-input">
								Trim / variant
								<span class="field__hint">Optional — type one and press Enter to add several (Sport, Crew Cab…). Blank = fits every trim.</span>
							</label>
							<TagInput id="trim-input" bind:values={vehicle.trims} suggestions={makeTrims} placeholder="Base / all trims" noun="trim" />
						</div>

						<div class="field-row field-row--2">
							<div class="field" class:field--error={!!errors.years}>
								<label class="field__label" for="year-input">Year(s)</label>
								<TagInput id="year-input" bind:values={vehicle.years} placeholder="2024 or 2020-2024" noun="year" normalize={parseYear}
									invalidMessage="Use a year (2024) or a range (2020-2024) between 1950 and next year+1."
									onreject={(m) => (errors.years = m)} error={!!errors.years} />
								{#if errors.years}<span class="field__error">{errors.years}</span>{/if}
							</div>
							<div class="field">
								<label class="field__label" for="bodyStyle">Body Style</label>
								<select id="bodyStyle" class="field__select" bind:value={vehicle.bodyStyle}>
									{#each allBodyStyles() as b (b.value)}<option value={b.value}>{b.label}</option>{/each}
								</select>
							</div>
						</div>

					{:else if projectType === "custom"}
						<div class="field" class:field--error={!!errors.customName}>
							<label class="field__label" for="customName">Pattern Name</label>
							<input id="customName" class="field__input" type="text" bind:value={customName} placeholder="Custom cut project"/>
							{#if errors.customName}<span class="field__error">{errors.customName}</span>{/if}
						</div>

					{:else}
						<div class="field-row field-row--2">
							<div class="field" class:field--error={!!errors.address}>
								<label class="field__label" for="address">Address</label>
								<input id="address" class="field__input" type="text" bind:value={address} placeholder="123 Main St, Springfield"/>
								{#if errors.address}<span class="field__error">{errors.address}</span>{/if}
							</div>
							<div class="field">
								<label class="field__label" for="propertyLabel">
									{projectType === "residential" ? "Property Name" : "Business Name"}
									<span class="field__hint">Optional</span>
								</label>
								<input id="propertyLabel" class="field__input" type="text" bind:value={propertyLabel} placeholder={projectType === "residential" ? "Smith Residence" : "Main St Storefront"}/>
							</div>
						</div>
					{/if}
				</section>

				<!-- Pattern Details -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">3</span>
						Pattern Details
						
					</h2>

					<div class="field">
						<span class="field__label">Category</span>
						<div class="category-cards" role="radiogroup" aria-label="Pattern category">
							{#each allCategories() as c (c.value)}
								<label
									class="category-card"
									class:category-card--active={pattern.category === c.value}
									style="--cat-accent: {c.accent}"
								>
									<input type="radio" name="category" value={c.value} bind:group={pattern.category}/>
									<span class="category-card__icon" aria-hidden="true">
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={c.icon}/></svg>
									</span>
									<span class="category-card__text">
										<span class="category-card__label">{c.label}</span>
										<span class="category-card__sub">{c.description}</span>
									</span>
								</label>
							{/each}
						</div>
					</div>

					{#if pattern.category !== "window-tint"}
						<div class="field field--half">
							<label class="field__label" for="coverage">
								Coverage
								<InfoTip text="How much of the panel this pattern covers — Full wraps the whole surface, Partial covers a defined portion, Edge Only traces just the border." />
							</label>
							<select id="coverage" class="field__select" bind:value={pattern.coverage}>
								<option value="full">Full</option>
								<option value="partial">Partial</option>
								<option value="edge-only">Edge Only</option>
							</select>
						</div>
					{/if}
				</section>

				<!-- Zones & Dimensions -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">4</span>
						Zones & Dimensions
					</h2>

					<div class="field" class:field--error={!!errors.zones}>
						<span class="field__label">
							Zones
							<InfoTip text="The specific panels or sections this pattern applies to — add every zone this single pattern should be assigned to." />
						</span>
						<div class="multitag" class:multitag--error={!!errors.zones}>
							{#each pattern.zones as z, i (`${z}-${i}`)}
								{@const mirror = mirrorOf(z)}
								<span class="chip">
									<span class="chip__label">{zoneLabel(z, i)}</span>
									{#if mirror && !pattern.zones.includes(mirror)}
										<button type="button" class="chip__mirror" use:tooltip={`Also add ${zoneLabel(mirror)}`} onclick={() => addZone(mirror)}>↔</button>
									{/if}
									<button type="button" class="chip__remove" aria-label="Remove {zoneLabel(z, i)}" onclick={() => removeZoneAt(i)}>×</button>
								</span>
							{/each}
							{#if addingCustom}
								<span class="custom-zone-entry">
									<input
										type="text"
										class="custom-zone-entry__input"
										bind:value={pendingCustomLabel}
										placeholder="Name this zone…"
										onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCustomZone(); } else if (e.key === "Escape") { addingCustom = false; pendingCustomLabel = ""; } }}
									/>
									<button type="button" class="custom-zone-entry__confirm" disabled={!pendingCustomLabel.trim()} onclick={commitCustomZone} aria-label="Add custom zone">✓</button>
									<button type="button" class="custom-zone-entry__cancel" onclick={() => { addingCustom = false; pendingCustomLabel = ""; }} aria-label="Cancel">×</button>
								</span>
							{:else if availableZones.length}
								<select class="zone-add-select" onchange={onZoneAdd} aria-label="Add zone">
									<option value="">+ Add zone</option>
									{#each availableZones as z}
										<option value={z.value}>{z.value === "custom" ? "Custom…" : z.label}</option>
									{/each}
								</select>
							{/if}
						</div>
						{#if errors.zones}<span class="field__error">{errors.zones}</span>{/if}
					</div>

					<div class="field-row field-row--2">
						<div class="field" class:field--error={errors.width}>
							<label class="field__label" for="width">
								Width (inches)
								<InfoTip text="The bounding box of the flattened pattern, not the vehicle or panel — measure the actual traced shape." />
							</label>
							<input id="width" class="field__input" type="number" min="0" step="any" bind:value={pattern.widthInches} oninput={() => deriveHeight(pattern, pattern.svgPath)} placeholder="60.5"/>
							{#if errors.width}<span class="field__error">{errors.width}</span>{/if}
						</div>
						<div class="field" class:field--error={errors.height}>
							<label class="field__label" for="height">Height (inches)</label>
							<input id="height" class="field__input" type="number" min="0" step="any" bind:value={pattern.heightInches} oninput={() => deriveWidth(pattern, pattern.svgPath)} placeholder="48.0"/>
							{#if errors.height}<span class="field__error">{errors.height}</span>{/if}
						</div>
					</div>
					{#if sizeProblem && !errors.width}
						<p class="field__error" role="alert">This pattern's saved size doesn't match its outline, so it can't be added to the canvas. Re-enter the width or the height to fix it.</p>
					{:else}
						<p class="field__hint">Enter the width <em>or</em> the height — the other is calculated from the outline so the pattern keeps its exact proportions.</p>
					{/if}
				</section>

				<!-- Pattern Importer -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">5</span>
						Pattern Importer
					</h2>
					<div class="field" class:field--error={errors.svgPath}>
						<SvgPathInput id="svgPath" bind:value={pattern.svgPath} widthInches={pattern.widthInches} heightInches={pattern.heightInches} onFileSize={(sz) => Promise.resolve().then(() => applyFileSize(pattern, pattern.svgPath, sz))} error={!!errors.svgPath} showMirror={hasMirrorPair} mirrorOrigLabel={mirrorZoneLabels?.orig} mirrorFlipLabel={mirrorZoneLabels?.flip}/>
						{#if errors.svgPath}<span class="field__error">{errors.svgPath}</span>{/if}
					</div>
				</section>

				<!-- Notes -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">6</span>
						Notes
					</h2>
					<div class="field">
						<label class="field__label" for="notes">
							Notes
							<span class="field__hint">Optional — fitment tips, measurement source, caveats</span>
						</label>
						<textarea id="notes" class="field__textarea" bind:value={pattern.notes} rows="3" placeholder="Measured from physical vehicle 2026-06-01. Verify before cutting."></textarea>
					</div>
				</section>

				<!-- Actions -->
				<div class="form-actions">
					<button
						type="button"
						class="btn btn--danger-ghost"
						onclick={() => (showDeleteConfirm = true)}
						disabled={saving}
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
						Delete
					</button>
					<div class="actions-spacer"></div>
					<a href={MINE} class="btn btn--ghost">Cancel</a>
					<button type="submit" class="btn btn--primary" disabled={saving}>
						{#if saving}
							<span class="spinner spinner--sm" aria-hidden="true"></span>
							Saving…
						{:else}
							Save Changes
						{/if}
					</button>
				</div>

			</form>
		</div>

	{/if}

</div>

<!-- Delete confirmation overlay -->
{#if showDeleteConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="overlay" onclick={() => (showDeleteConfirm = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="confirm-card" onclick={(e) => e.stopPropagation()}>
			<h3 class="confirm-card__title">Delete this pattern?</h3>
			<p class="confirm-card__body">
				<strong>{original?.name}</strong> will be permanently deleted and cannot be recovered.
			</p>
			<div class="confirm-card__actions">
				<button type="button" class="btn btn--ghost" onclick={() => (showDeleteConfirm = false)}>
					Cancel
				</button>
				<button type="button" class="btn btn--danger" disabled={deleting} onclick={handleDelete}>
					{#if deleting}
						<span class="spinner spinner--sm" aria-hidden="true"></span>
						Deleting…
					{:else}
						Delete Pattern
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		min-height: 100%;
		background: var(--bg-canvas);
		overflow-y: auto;
	}

	.loading, .not-found {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		min-height: 50vh;
		color: var(--text-tertiary);
		font-size: 0.9375rem;
	}

	/* ─── Header ─── */
	.edit-header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 20px clamp(16px, 3vw, 40px) 0;
		flex-wrap: wrap;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.12s;
	}
	.back-link:hover { color: var(--text-secondary); }

	.edit-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.status-chip {
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 4px;
	}
	.status-chip--pending {
		background: color-mix(in srgb, #f59e0b 14%, transparent);
		border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
		color: #fbbf24;
	}

	/* ─── Multi-tag input (models + zones) ─── */
	.multitag {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-height: 48px;
		padding: 6px 8px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		transition: border-color 0.12s;
	}
	.multitag:focus-within {
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.multitag--error { border-color: var(--color-danger, #f44); }


	.multitag :global(.vcb) { flex: 1; min-width: 140px; }
	.multitag :global(.vcb__input) {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 4px 6px;
		font-size: 0.9375rem;
	}
	.multitag :global(.vcb__input:focus) { box-shadow: none; }

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: color-mix(in srgb, var(--color-brand) 12%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, var(--color-brand) 28%, transparent);
		border-radius: 5px;
		padding: 4px 6px 4px 10px;
		font-size: 0.875rem;
		color: var(--text-primary);
		white-space: nowrap;
	}
	.chip__label { line-height: 1.4; }
	.chip__mirror, .chip__remove {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 1px 3px;
		font-size: 0.875rem;
		line-height: 1;
		border-radius: 3px;
		transition: background 0.08s, color 0.08s;
	}
	.chip__mirror { color: var(--color-brand); }
	.chip__mirror:hover { background: color-mix(in srgb, var(--color-brand) 20%, transparent); }
	.chip__remove { color: var(--text-tertiary); }
	.chip__remove:hover { background: color-mix(in srgb, var(--color-danger, #f44) 15%, transparent); color: var(--color-danger, #f44); }

	.zone-add-select {
		background: color-mix(in srgb, var(--color-brand) 10%, var(--bg-surface-2));
		border: 1px dashed color-mix(in srgb, var(--color-brand) 35%, transparent);
		border-radius: 5px;
		font-size: 0.9375rem;
		font-family: var(--font-body);
		font-weight: 600;
		color: var(--color-brand);
		cursor: pointer;
		padding: 5px 10px;
		appearance: none;
		-webkit-appearance: none;
		transition: background 0.15s, border-color 0.15s;
	}
	.zone-add-select:hover { background: color-mix(in srgb, var(--color-brand) 18%, var(--bg-surface-2)); }
	.zone-add-select:focus { outline: none; border-style: solid; box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent); }

	/* ─── Form wrap ─── */
	.form-wrap {
		width: 100%;
		box-sizing: border-box;
		padding: 24px clamp(16px, 3vw, 40px) 64px;
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* ─── Sections ─── */
	.form-section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px clamp(16px, 2.5vw, 32px) 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 4px;
	}
	.section-num {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-brand);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	/* ─── Fields ─── */
	.field-row { display: grid; gap: 14px; }
	.field-row--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }

	.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
	.field--half { max-width: 280px; }

	.field__label {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-secondary);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.field__hint { font-size: 0.8125rem; font-weight: 400; color: var(--text-tertiary); }

	.field__input, .field__select, .field__textarea {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		padding: 10px 12px;
		transition: border-color 0.12s;
		width: 100%;
		box-sizing: border-box;
	}
	.field__input:focus, .field__select:focus, .field__textarea:focus {
		outline: none;
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.field__textarea { resize: vertical; }
	.field--error .field__input { border-color: var(--color-danger, #f44); }
	.field__error { font-size: 0.8125rem; color: var(--color-danger, #f44); }

	/* ─── Category cards ─── */
	.category-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
		gap: 8px;
	}
	.category-card {
		--cat-accent: var(--color-brand);
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s, transform 0.1s;
	}
	.category-card:hover { border-color: color-mix(in srgb, var(--cat-accent) 45%, var(--border-default)); transform: translateY(-1px); }
	.category-card input[type="radio"] { display: none; }
	.category-card--active {
		border-color: var(--cat-accent);
		background: color-mix(in srgb, var(--cat-accent) 12%, var(--bg-surface-2));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--cat-accent) 40%, transparent);
	}
	.category-card__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--cat-accent) 16%, transparent);
		color: var(--cat-accent);
	}
	.category-card__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
	.category-card__label { font-size: 0.8125rem; font-weight: 600; color: var(--text-primary); line-height: 1.2; }
	.category-card__sub { font-size: 0.6875rem; color: var(--text-tertiary); line-height: 1.25; }
	.category-card--active .category-card__label { color: var(--cat-accent); }

	/* ─── Actions ─── */
	.form-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 4px;
	}
	.actions-spacer { flex: 1; }

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 9px 20px;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: var(--font-body);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s, opacity 0.12s;
		text-decoration: none;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn--primary { background: var(--color-brand); color: #080a0f; }
	.btn--primary:hover:not(:disabled) { filter: brightness(1.1); }
	.btn--ghost { background: transparent; border-color: var(--border-default); color: var(--text-secondary); }
	.btn--ghost:hover { background: var(--bg-surface-2); }
	.btn--danger {
		background: var(--color-danger, #e53e3e);
		color: #fff;
		border-color: transparent;
	}
	.btn--danger:hover:not(:disabled) { filter: brightness(1.1); }
	.btn--danger-ghost {
		background: transparent;
		border-color: var(--border-default);
		color: var(--text-tertiary);
	}
	.btn--danger-ghost:hover {
		border-color: color-mix(in srgb, var(--color-danger, #e53e3e) 60%, transparent);
		color: var(--color-danger, #e53e3e);
		background: color-mix(in srgb, var(--color-danger, #e53e3e) 8%, transparent);
	}

	.spinner {
		width: 14px; height: 14px;
		border: 2px solid rgba(255,255,255,0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	.spinner--sm { width: 11px; height: 11px; }
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ─── Delete confirm overlay ─── */
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.55);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.confirm-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 24px;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 16px 48px rgba(0,0,0,0.3);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.confirm-card__title { font-size: 1rem; font-weight: 700; color: var(--text-primary); margin: 0; }
	.confirm-card__body  { font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }
	.confirm-card__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

	/* ─── Responsive ─── */
	@media (max-width: 1024px) {
		.category-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	}
	@media (max-width: 640px) {
		.edit-header { padding-top: 16px; }
		.form-wrap { padding-top: 16px; padding-bottom: 40px; }
		.form-section { padding: 16px; }
		.field-row--2 { grid-template-columns: 1fr; }
		.field--half { max-width: 100%; }
		.category-cards { grid-template-columns: 1fr 1fr; }
		.form-actions { flex-wrap: wrap; }
		.form-actions .btn { flex: 1 1 auto; justify-content: center; }
		.actions-spacer { display: none; }
	}
	@media (max-width: 400px) {
		.category-cards { grid-template-columns: 1fr; }
	}
	/* --- Ported from the upload page so both forms look identical --- */
	.mode-bar {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	.mode-card {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 24px 28px;
		background: var(--bg-surface);
		border: none;
		border-right: 1px solid var(--border-subtle);
		cursor: pointer;
		text-align: left;
		transition: background 0.12s;
	}
	.mode-card:last-child { border-right: none; }
	.mode-card:hover { background: var(--bg-surface-2); }
	.mode-card--active {
		background: radial-gradient(140% 140% at 8% 42%,
			color-mix(in srgb, var(--color-brand) 20%, var(--bg-surface)) 0%,
			color-mix(in srgb, var(--color-brand) 7%, var(--bg-surface)) 45%,
			var(--bg-surface) 100%);
		border-bottom: 3px solid var(--color-brand);
	}
	.mode-card__icon {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-lg);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		flex-shrink: 0;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.mode-card--active .mode-card__icon {
		background: color-mix(in srgb, var(--color-brand) 14%, var(--bg-surface-2));
		border-color: color-mix(in srgb, var(--color-brand) 35%, transparent);
		color: var(--color-brand);
	}
	.mode-card__body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.mode-card__title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.mode-card__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.mode-card__check {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-brand);
		transition: border-color 0.12s, background 0.12s;
	}
	.mode-card--active .mode-card__check {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 14%, transparent);
	}
	.custom-zone-entry {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: color-mix(in srgb, var(--color-brand) 10%, var(--bg-surface-2));
		border: 1px dashed color-mix(in srgb, var(--color-brand) 35%, transparent);
		border-radius: 5px;
		padding: 3px 4px 3px 8px;
	}
	.custom-zone-entry__input {
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: var(--font-body);
		min-width: 130px;
		padding: 3px 2px;
	}
	.custom-zone-entry__confirm, .custom-zone-entry__cancel {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 2px 4px;
		font-size: 0.8125rem;
		line-height: 1;
		border-radius: 3px;
	}
	.custom-zone-entry__confirm { color: var(--color-brand); }
	.custom-zone-entry__confirm:disabled { color: var(--text-tertiary); cursor: not-allowed; }
	.custom-zone-entry__confirm:not(:disabled):hover { background: color-mix(in srgb, var(--color-brand) 20%, transparent); }
	.custom-zone-entry__cancel { color: var(--text-tertiary); }
	.custom-zone-entry__cancel:hover { background: color-mix(in srgb, var(--color-danger, #f44) 15%, transparent); color: var(--color-danger, #f44); }
	.type-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}
	.type-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 14px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		cursor: pointer;
		text-align: left;
		transition: border-color 0.12s, background 0.12s;
	}
	.type-card:hover { background: var(--bg-surface-2); }
	.type-card--active {
		border-color: var(--color-brand);
		background: radial-gradient(130% 130% at 18% 22%,
			color-mix(in srgb, var(--color-brand) 20%, var(--bg-surface-2)) 0%,
			color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2)) 45%,
			var(--bg-surface-2) 100%);
	}
	.type-card__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		background: var(--bg-surface-2);
	}
	.type-card--active .type-card__icon { color: var(--color-brand); }
	.type-card__title { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); }
	.type-card__sub { font-size: 0.8125rem; color: var(--text-tertiary); line-height: 1.3; }
	@media (max-width: 1024px) {
		.type-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
	@media (max-width: 640px) {
		.mode-bar { grid-template-columns: 1fr; }
		.mode-card { border-right: none; border-bottom: 1px solid var(--border-subtle); padding: 16px; }
		.mode-card--active { border-bottom: 3px solid var(--color-brand); }
		.type-grid { grid-template-columns: 1fr 1fr; }
	}
</style>
