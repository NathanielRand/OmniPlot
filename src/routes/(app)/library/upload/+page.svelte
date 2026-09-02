<script lang="ts">
	import { goto } from "$app/navigation";
	import { userStore, toastStore } from "$lib/stores";
	import { patternStore, PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST, MIRROR_PAIRS } from "$lib/stores/patternStore.svelte";
	import { addUserPattern } from "$lib/firebase/firestore";
	import SvgPathInput from "$lib/components/ui/SvgPathInput.svelte";
	import VehicleCombobox from "$lib/components/ui/VehicleCombobox.svelte";
	import type { PatternCategory, PatternZone, PatternCoverage } from "$lib/types";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";

	type BodyStyle = NonNullable<VehicleEntry["bodyStyle"]>;

	// ─── Top-level mode: private or community ────
	let mode = $state<"private" | "community">("private");

	// ─── Form state ───────────────────────────────
	let step = $state<"form" | "success">("form");
	let submitting  = $state(false);
	let isImporting = $state(false); // true while SvgPathInput multi-vectorize is in flight

	// ─── Multi-pattern extraction mode ───────────
	interface MultiSlot {
		svgPath: string;
		zone: PatternZone | "";
		widthInches: number;
		heightInches: number;
		skip: boolean;
	}
	let multiMode = $state(false);
	let multiSlots = $state<MultiSlot[]>([]);
	let multiErrors = $state<Record<number, Record<string, string>>>({});
	let multiSavedCount = $state(0);

	// ─── Upload type + individual slots ──────────
	type UploadMode = "single" | "multi";
	type MultiMethod = "individual" | "single-file";
	interface IndividualSlot {
		zone: PatternZone | "";
		widthInches: number;
		heightInches: number;
		svgPath: string;
	}
	let uploadMode  = $state<UploadMode>("single");
	let multiMethod = $state<MultiMethod>("individual");
	let multiFileSvgPath = $state("");
	let individualSlots = $state<IndividualSlot[]>([{ zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, svgPath: "" }]);
	let indivErrors = $state<Record<number, Record<string, string>>>({});

	// ─── Project type ─────────────────────────────
	type ProjectType = "custom" | "vehicle" | "residential" | "commercial";
	let projectType = $state<ProjectType>("vehicle");
	let customName      = $state(""); // "custom" projects
	let propertyAddress = $state(""); // "residential" / "commercial"
	let propertyLabel   = $state(""); // "residential" / "commercial"

	const identityTitle = $derived(
		projectType === "vehicle"     ? "Vehicle" :
		projectType === "custom"      ? "Pattern Name" :
		projectType === "residential" ? "Property" :
		"Property",
	);

	let vehicle = $state({
		make:      "",
		models:    [] as string[],
		years:     [] as string[],
		bodyStyle: "sedan" as BodyStyle,
	});

	const identitySummary = $derived(
		projectType === "vehicle"     ? `${vehicle.years.join(", ")} ${vehicle.make} ${vehicle.models.join(" / ")}` :
		projectType === "custom"      ? customName.trim() :
		propertyLabel.trim() || propertyAddress.trim(),
	);

	let pattern = $state({
		category:     "window-tint" as PatternCategory,
		zones:        [] as PatternZone[],
		coverage:     "full" as PatternCoverage,
		widthInches:  0,
		heightInches: 0,
		svgPath:      "",
		notes:        "",
	});

	let modelInput = $state("");
	let yearInput  = $state("");
	let errors = $state<Record<string, string>>({});

	// ─── Derived ──────────────────────────────────
	const allMakes = $derived(
		[...new Set(patternStore.vehicles.map(v => v.make ?? ""))].sort(),
	);

	const makeModels = $derived(
		vehicle.make.trim()
			? [...new Set(
				patternStore.vehicles
					.filter(v => (v.make ?? "").toLowerCase() === vehicle.make.trim().toLowerCase())
					.map(v => v.model ?? ""),
			)].sort()
			: [],
	);

	const zoneList = $derived(
		projectType === "residential" ? RESIDENTIAL_ZONES_LIST :
		projectType === "commercial"  ? COMMERCIAL_ZONES_LIST :
		projectType === "custom"      ? [{ value: "custom" as PatternZone, label: "Custom" }] :
		pattern.category === "ppf"    ? PPF_ZONES_LIST : TINT_ZONES_LIST,
	);

	// Reset zones when category or pattern type changes (zone lists are disjoint)
	$effect(() => { zoneList; pattern.zones = []; });

	$effect(() => {
		if (pattern.category === "window-tint") pattern.coverage = "full";
	});

	const availableZones = $derived(
		zoneList.filter(z => !pattern.zones.includes(z.value)),
	);

	const hasMirrorPair = $derived(
		pattern.zones.some(z => {
			const m = MIRROR_PAIRS[z];
			return m !== undefined && pattern.zones.includes(m);
		}),
	);

	// Zone labels for the mirror preview panels in SvgPathInput
	const mirrorZoneLabels = $derived((() => {
		for (const z of pattern.zones) {
			const m = MIRROR_PAIRS[z];
			if (m && pattern.zones.includes(m)) {
				return { orig: zoneLabel(z), flip: zoneLabel(m) };
			}
		}
		return null;
	})());

	// ─── Zone helpers ─────────────────────────────
	function addZone(z: PatternZone) {
		if (!pattern.zones.includes(z)) pattern.zones = [...pattern.zones, z];
	}
	function removeZone(z: PatternZone) {
		pattern.zones = pattern.zones.filter(z2 => z2 !== z);
	}
	function onZoneAdd(e: Event) {
		const val = (e.target as HTMLSelectElement).value as PatternZone;
		if (val) { addZone(val); (e.target as HTMLSelectElement).value = ""; }
	}
	function zoneLabel(z: PatternZone): string {
		return zoneList.find(zl => zl.value === z)?.label ?? z;
	}
	function mirrorOf(z: PatternZone): PatternZone | undefined {
		return MIRROR_PAIRS[z];
	}

	// ─── Individual slot helpers ──────────────────
	function addIndividualSlot() {
		individualSlots = [...individualSlots, { zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, svgPath: "" }];
	}
	function removeIndividualSlot(i: number) {
		if (individualSlots.length > 1) individualSlots = individualSlots.filter((_, idx) => idx !== i);
	}
	function validateIndividual(): boolean {
		const errs: Record<number, Record<string, string>> = {};
		individualSlots.forEach((slot, i) => {
			const e: Record<string, string> = {};
			if (!slot.zone)                                    e.zone    = "Select a zone";
			if (!slot.widthInches  || slot.widthInches  <= 0) e.width   = "Enter a positive width";
			if (!slot.heightInches || slot.heightInches <= 0) e.height  = "Enter a positive height";
			if (!slot.svgPath.trim())                          e.svgPath = "Import a pattern first";
			if (Object.keys(e).length) errs[i] = e;
		});
		indivErrors = errs;
		return Object.keys(errs).length === 0;
	}

	// ─── Year helpers ─────────────────────────────
	function parseYear(s: string): string | null {
		s = s.trim().replace(/[–—]/g, '-');
		const maxY = new Date().getFullYear() + 2;
		if (/^\d{4}$/.test(s)) {
			const y = +s;
			return y >= 1950 && y <= maxY ? s : null;
		}
		if (/^\d{4}-\d{4}$/.test(s)) {
			const [a, b] = s.split('-').map(Number);
			return a >= 1950 && b <= maxY && a < b ? s : null;
		}
		return null;
	}
	function commitYear() {
		const parsed = parseYear(yearInput);
		if (parsed && !vehicle.years.includes(parsed))
			vehicle.years = [...vehicle.years, parsed];
		yearInput = "";
	}
	function onYearKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitYear(); }
		else if (e.key === "Backspace" && yearInput === "" && vehicle.years.length)
			vehicle.years = vehicle.years.slice(0, -1);
	}

	// ─── Multi-pattern extraction ─────────────────
	function handleMultiExtract(paths: string[]) {
		multiSlots = paths.map(p => ({ svgPath: p, zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, skip: false }));
		multiErrors = {};
		multiMode = true;
	}

	function exitMultiMode() {
		multiMode = false;
		multiSlots = [];
		multiErrors = {};
	}

	// ─── Validation ───────────────────────────────
	function validateIdentity(): boolean {
		const e: Record<string, string> = {};
		if (projectType === "vehicle") {
			if (!vehicle.make.trim())    e.make   = "Make is required";
			if (!vehicle.models.length)  e.models = "Add at least one model";
			if (!vehicle.years.length)   e.years  = "Add at least one year or range";
		} else if (projectType === "custom") {
			if (!customName.trim())      e.customName = "Pattern name is required";
		} else {
			if (!propertyAddress.trim()) e.propertyAddress = "Address is required";
		}
		errors = { ...errors, ...e };
		return Object.keys(e).length === 0;
	}

	function validate(): boolean {
		const e: Record<string, string> = {};
		if (projectType === "vehicle") {
			if (!vehicle.make.trim())    e.make   = "Make is required";
			if (!vehicle.models.length)  e.models = "Add at least one model";
			if (!vehicle.years.length)   e.years  = "Add at least one year or range";
		} else if (projectType === "custom") {
			if (!customName.trim())      e.customName = "Pattern name is required";
		} else {
			if (!propertyAddress.trim()) e.propertyAddress = "Address is required";
		}
		if (!pattern.zones.length)   e.zones  = "Select at least one zone";
		if (!pattern.widthInches  || pattern.widthInches  <= 0) e.width  = "Enter a positive width";
		if (!pattern.heightInches || pattern.heightInches <= 0) e.height = "Enter a positive height";
		if (!pattern.svgPath.trim()) e.svgPath = "SVG path data is required";
		errors = e;
		return Object.keys(e).length === 0;
	}

	function validateMulti(): boolean {
		const errs: Record<number, Record<string, string>> = {};
		const active = multiSlots.filter(s => !s.skip);
		if (active.length === 0) {
			// mark all as needing a zone so the user sees feedback
			multiSlots.forEach((_, i) => { errs[i] = { zone: "Select a zone or skip" }; });
			multiErrors = errs;
			return false;
		}
		multiSlots.forEach((slot, i) => {
			if (slot.skip) return;
			const e: Record<string, string> = {};
			if (!slot.zone) e.zone = "Select a zone";
			if (!slot.widthInches  || slot.widthInches  <= 0) e.width  = "Enter a positive width";
			if (!slot.heightInches || slot.heightInches <= 0) e.height = "Enter a positive height";
			if (Object.keys(e).length) errs[i] = e;
		});
		multiErrors = errs;
		return Object.keys(errs).length === 0;
	}

	// ─── Identity payload (branches on projectType) ───
	function identityPayload() {
		if (projectType === "vehicle") {
			return {
				projectType,
				make:      vehicle.make.trim(),
				models:    vehicle.models,
				years:     vehicle.years,
				bodyStyle: vehicle.bodyStyle,
			};
		}
		if (projectType === "custom") {
			return {
				projectType,
				make:        "Custom",
				models:      [customName.trim()],
				years:       [] as string[],
				bodyStyle:   "sedan" as BodyStyle,
				patternName: customName.trim(),
			};
		}
		return {
			projectType,
			make:          projectType === "residential" ? "Residential" : "Commercial",
			models:        [propertyLabel.trim() || propertyAddress.trim()],
			years:         [] as string[],
			bodyStyle:     "sedan" as BodyStyle,
			address:       propertyAddress.trim(),
			propertyLabel: propertyLabel.trim() || undefined,
		};
	}

	// ─── Submit ───────────────────────────────────
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!userStore.user) { toastStore.error("Not signed in", "Please log in first."); return; }

		if (uploadMode === "multi" && multiMethod === "individual") {
			if (!validateIdentity() || !validateIndividual()) return;
			submitting = true;
			try {
				let saved = 0;
				for (const slot of individualSlots) {
					const zone = slot.zone as PatternZone;
					await addUserPattern({
						ownerId:           userStore.user.uid,
						submitToCommunity: mode === "community",
						...identityPayload(),
						category:          pattern.category,
						zones:             [zone],
						name:              zoneLabel(zone),
						coverage:          pattern.coverage,
						widthInches:       slot.widthInches,
						heightInches:      slot.heightInches,
						svgPath:           slot.svgPath.trim(),
						notes:             pattern.notes.trim() || undefined,
					});
					saved++;
				}
				multiSavedCount = saved;
				step = "success";
			} catch (err) {
				console.error(err);
				toastStore.error("Submission failed", "Could not save patterns. Please try again.");
			} finally {
				submitting = false;
			}
			return;
		}

		if (uploadMode === "multi" && multiMethod === "single-file" && !multiMode) {
			toastStore.error("Extract patterns first", "Upload a combined image and split it into patterns before saving.");
			return;
		}

		if (multiMode) {
			if (!validateIdentity() || !validateMulti()) return;
			submitting = true;
			try {
				const active = multiSlots.filter(s => !s.skip && s.zone);
				let saved = 0;
				for (const slot of active) {
					const zone = slot.zone as PatternZone;
					await addUserPattern({
						ownerId:           userStore.user.uid,
						submitToCommunity: mode === "community",
						...identityPayload(),
						category:          pattern.category,
						zones:             [zone],
						name:              zoneLabel(zone),
						coverage:          pattern.coverage,
						widthInches:       slot.widthInches,
						heightInches:      slot.heightInches,
						svgPath:           slot.svgPath,
						notes:             pattern.notes.trim() || undefined,
					});
					saved++;
				}
				multiSavedCount = saved;
				step = "success";
			} catch (err) {
				console.error(err);
				toastStore.error("Submission failed", "Could not save patterns. Please try again.");
			} finally {
				submitting = false;
			}
			return;
		}

		if (!validate()) return;
		submitting = true;
		try {
			const name = pattern.zones.map(z => zoneLabel(z)).join(" + ");
			await addUserPattern({
				ownerId:           userStore.user.uid,
				submitToCommunity: mode === "community",
				...identityPayload(),
				category:          pattern.category,
				zones:             pattern.zones,
				name,
				coverage:          pattern.coverage,
				widthInches:       pattern.widthInches,
				heightInches:      pattern.heightInches,
				svgPath:           pattern.svgPath.trim(),
				notes:             pattern.notes.trim() || undefined,
			});
			step = "success";
		} catch (err) {
			console.error(err);
			toastStore.error("Submission failed", "Could not save your pattern. Please try again.");
		} finally {
			submitting = false;
		}
	}

	function resetForm() {
		projectType      = "vehicle";
		customName       = "";
		propertyAddress  = "";
		propertyLabel    = "";
		vehicle    = { make: "", models: [], years: [], bodyStyle: "sedan" };
		pattern    = { category: "ppf", zones: [], coverage: "full", widthInches: 0, heightInches: 0, svgPath: "", notes: "" };
		modelInput = "";
		yearInput  = "";
		errors     = {};
		mode       = "private";
		step       = "form";
		multiMode  = false;
		multiSlots = [];
		multiErrors = {};
		multiSavedCount = 0;
		uploadMode  = "single";
		multiMethod = "individual";
		multiFileSvgPath = "";
		individualSlots = [{ zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, svgPath: "" }];
		indivErrors = {};
	}
</script>

<svelte:head>
	<title>Save Pattern — OmniPlot</title>
</svelte:head>

<div class="page">

	{#if step === "success"}
		<div class="success-wrap">
			<div class="success-card">
				<div class="success-icon" aria-hidden="true">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
				</div>
				{#if multiSavedCount > 1}
					<h2 class="success-title">{multiSavedCount} Patterns Saved</h2>
					<p class="success-body">
						<strong>{multiSavedCount} patterns</strong> for <strong>{identitySummary}</strong> are now in your library.
						{#if mode === "community"}
							They've been queued for review — once approved they will appear in the public library.
						{/if}
					</p>
				{:else}
					<h2 class="success-title">Pattern Saved</h2>
					<p class="success-body">
						<strong>{identitySummary}</strong> pattern
						({uploadMode === "multi" && multiMethod === "individual"
							? individualSlots.map(s => zoneLabel(s.zone as PatternZone)).join(" + ")
							: multiMode
								? multiSlots.filter(s => !s.skip && s.zone).map(s => zoneLabel(s.zone as PatternZone)).join(" + ")
								: pattern.zones.map(z => zoneLabel(z)).join(" + ")
						}) is available in your library.
						{#if mode === "community"}
							It's been queued for review — once approved it will appear in the public library.
						{/if}
					</p>
				{/if}
				<div class="success-actions">
					<button class="btn btn--primary" onclick={() => goto("/library?tab=mine")}>View My Patterns</button>
					<button class="btn btn--ghost" onclick={resetForm}>Save Another</button>
				</div>
			</div>
		</div>

	{:else}

		<!-- ─── Full-width mode selector ─── -->
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

		<!-- ─── Form ─── -->
		<div class="form-wrap">
			<form class="upload-form" onsubmit={handleSubmit} novalidate>

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
						<div class="field-row field-row--2">
							<div class="field" class:field--error={!!errors.years}>
								<label class="field__label" for="upload-year-input">Year(s)</label>
								<div class="multitag" class:multitag--error={!!errors.years}>
									{#each vehicle.years as y (y)}
										<span class="chip">
											<span class="chip__label">{y}</span>
											<button type="button" class="chip__remove" aria-label="Remove {y}" onclick={() => { vehicle.years = vehicle.years.filter(x => x !== y); }}>×</button>
										</span>
									{/each}
									<input
										id="upload-year-input"
										class="year-input"
										type="text"
										placeholder={vehicle.years.length ? "Add year or range…" : "2024 or 2020-2024"}
										bind:value={yearInput}
										onkeydown={onYearKeydown}
										onblur={commitYear}
									/>
								</div>
								{#if errors.years}<span class="field__error">{errors.years}</span>{/if}
							</div>
							<div class="field" class:field--error={errors.make}>
								<label class="field__label" for="make">Make</label>
								<VehicleCombobox id="make" bind:value={vehicle.make} placeholder="Chevrolet" options={allMakes} error={!!errors.make}/>
								{#if errors.make}<span class="field__error">{errors.make}</span>{/if}
							</div>
						</div>

						<div class="field" class:field--error={!!errors.models}>
							<label class="field__label" for="model-input">Model</label>
							<div class="multitag" class:multitag--error={!!errors.models}>
								{#each vehicle.models as m (m)}
									<span class="chip">
										<span class="chip__label">{m}</span>
										<button type="button" class="chip__remove" aria-label="Remove {m}" onclick={() => { vehicle.models = vehicle.models.filter(x => x !== m); }}>×</button>
									</span>
								{/each}
								<VehicleCombobox
									id="model-input"
									bind:value={modelInput}
									placeholder={vehicle.models.length ? "Add another…" : "Silverado 1500 Crew Cab"}
									options={makeModels.filter(m => !vehicle.models.includes(m))}
									oncommit={(m) => { if (!vehicle.models.includes(m)) vehicle.models = [...vehicle.models, m]; }}
								/>
							</div>
							{#if errors.models}<span class="field__error">{errors.models}</span>{/if}
						</div>

						<div class="field field--half">
							<label class="field__label" for="bodyStyle">Body Style</label>
							<select id="bodyStyle" class="field__select" bind:value={vehicle.bodyStyle}>
								<option value="sedan">Sedan</option>
								<option value="coupe">Coupe</option>
								<option value="suv">SUV / Crossover</option>
								<option value="truck">Truck</option>
								<option value="convertible">Convertible</option>
								<option value="wagon">Wagon</option>
								<option value="hatchback">Hatchback</option>
							</select>
						</div>

					{:else if projectType === "custom"}
						<div class="field" class:field--error={!!errors.customName}>
							<label class="field__label" for="customName">Pattern Name</label>
							<input id="customName" class="field__input" type="text" bind:value={customName} placeholder="Custom cut project"/>
							{#if errors.customName}<span class="field__error">{errors.customName}</span>{/if}
						</div>

					{:else}
						<div class="field-row field-row--2">
							<div class="field" class:field--error={!!errors.propertyAddress}>
								<label class="field__label" for="propertyAddress">Address</label>
								<input id="propertyAddress" class="field__input" type="text" bind:value={propertyAddress} placeholder="123 Main St, Springfield"/>
								{#if errors.propertyAddress}<span class="field__error">{errors.propertyAddress}</span>{/if}
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
						<div class="radio-group" role="radiogroup" aria-label="Pattern category">
							<label class="radio-option" class:radio-option--active={pattern.category === "window-tint"}>
								<input type="radio" name="category" value="window-tint" bind:group={pattern.category}/>
								<span class="radio-option__label">Window Tint</span>
								<span class="radio-option__sub">Glass precut patterns</span>
							</label>
							<label class="radio-option" class:radio-option--active={pattern.category === "ppf"}>
								<input type="radio" name="category" value="ppf" bind:group={pattern.category}/>
								<span class="radio-option__label">PPF</span>
								<span class="radio-option__sub">Paint Protection Film</span>
							</label>
						</div>
					</div>

					{#if pattern.category === "ppf"}
						<div class="field field--half">
							<label class="field__label" for="coverage">Coverage</label>
							<select id="coverage" class="field__select" bind:value={pattern.coverage}>
								<option value="full">Full</option>
								<option value="partial">Partial</option>
								<option value="edge-only">Edge Only</option>
							</select>
						</div>
					{/if}

					<!-- ─── Upload type ─── -->
					<div class="field">
						<span class="field__label">Upload Type</span>
						<div class="radio-group" role="radiogroup" aria-label="Upload type">
							<label class="radio-option" class:radio-option--active={uploadMode === "single"}>
								<input type="radio" name="uploadMode" value="single" bind:group={uploadMode}
									onchange={() => { multiMode = false; multiSlots = []; multiErrors = {}; multiFileSvgPath = ""; individualSlots = [{ zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, svgPath: "" }]; indivErrors = {}; }}
								/>
								<span class="radio-option__label">Single Pattern</span>
								<span class="radio-option__sub">One pattern for one or more zones</span>
							</label>
							<label class="radio-option" class:radio-option--active={uploadMode === "multi"}>
								<input type="radio" name="uploadMode" value="multi" bind:group={uploadMode} onchange={() => {}}/>
								<span class="radio-option__label">Multiple Patterns</span>
								<span class="radio-option__sub">Import patterns for several zones at once</span>
							</label>
						</div>
					</div>
				</section>

				<!-- Pattern Importer -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">4</span>
						Pattern Importer
					</h2>

					{#if uploadMode === "multi"}
						<div class="field">
							<span class="field__label">How are you uploading?</span>
							<div class="radio-group" role="radiogroup" aria-label="Multi-upload method">
								<label class="radio-option" class:radio-option--active={multiMethod === "individual"}>
									<input type="radio" name="multiMethod" value="individual" bind:group={multiMethod}
										onchange={() => { multiMode = false; multiSlots = []; multiErrors = {}; multiFileSvgPath = ""; }}
									/>
									<span class="radio-option__label">One file per zone</span>
									<span class="radio-option__sub">Upload and assign each pattern individually</span>
								</label>
								<label class="radio-option" class:radio-option--active={multiMethod === "single-file"}>
									<input type="radio" name="multiMethod" value="single-file" bind:group={multiMethod}
										onchange={() => { individualSlots = [{ zone: "" as PatternZone | "", widthInches: 0, heightInches: 0, svgPath: "" }]; indivErrors = {}; }}
									/>
									<span class="radio-option__label">Combined file</span>
									<span class="radio-option__sub">One image containing all patterns — split and assign each</span>
								</label>
							</div>
						</div>
					{/if}

					{#if uploadMode === "multi" && multiMethod === "individual"}
						<!-- ─── Individual slots: one importer per zone ─── -->
						<div class="indiv-slots">
							{#each individualSlots as slot, i (i)}
								{@const slotErrs = indivErrors[i] ?? {}}
								<div class="indiv-slot">
									<div class="indiv-slot__hdr">
										<span class="indiv-slot__num">Zone {i + 1}</span>
										{#if individualSlots.length > 1}
											<button type="button" class="indiv-slot__remove" onclick={() => removeIndividualSlot(i)} aria-label="Remove zone {i + 1}">×</button>
										{/if}
									</div>
									<div class="field" class:field--error={!!slotErrs.zone}>
										<label class="field__label" for="indiv-zone-{i}">Zone</label>
										<select id="indiv-zone-{i}" class="field__select" bind:value={slot.zone} aria-label="Zone for slot {i + 1}">
											<option value="">Select zone…</option>
											{#each zoneList as z}
												<option value={z.value}>{z.label}</option>
											{/each}
										</select>
										{#if slotErrs.zone}<span class="field__error">{slotErrs.zone}</span>{/if}
									</div>
									<div class="field-row field-row--2">
										<div class="field" class:field--error={!!slotErrs.width}>
											<label class="field__label" for="indiv-width-{i}">Width (inches)</label>
											<input id="indiv-width-{i}" class="field__input" type="number" min="0.1" step="0.1" bind:value={slot.widthInches} placeholder="60.5" aria-label="Width for zone {i + 1}"/>
											{#if slotErrs.width}<span class="field__error">{slotErrs.width}</span>{/if}
										</div>
										<div class="field" class:field--error={!!slotErrs.height}>
											<label class="field__label" for="indiv-height-{i}">Height (inches)</label>
											<input id="indiv-height-{i}" class="field__input" type="number" min="0.1" step="0.1" bind:value={slot.heightInches} placeholder="48.0" aria-label="Height for zone {i + 1}"/>
											{#if slotErrs.height}<span class="field__error">{slotErrs.height}</span>{/if}
										</div>
									</div>
									<div class="stage-divider" role="separator" aria-hidden="true"></div>

									<div class="field" class:field--error={!!slotErrs.svgPath}>
										<span class="field__label">Pattern Importer</span>
										<SvgPathInput bind:value={slot.svgPath}/>
										{#if slotErrs.svgPath}<span class="field__error">{slotErrs.svgPath}</span>{/if}
									</div>
								</div>
							{/each}
						</div>
						<button type="button" class="btn btn--ghost indiv-add-btn" onclick={addIndividualSlot}>
							+ Add Another Zone
						</button>

					{:else if multiMode}
						<!-- ─── Multi-pattern slot cards (from combined-file extraction) ─── -->
						<div class="multi-header">
							<span class="multi-header__title">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
								{multiSlots.length} contours extracted — assign a zone to each
							</span>
							<button type="button" class="multi-header__back" onclick={exitMultiMode}>
								{uploadMode === "multi" ? "← Back to file upload" : "← Back to single pattern"}
							</button>
						</div>
						<div class="multi-slots">
							{#each multiSlots as slot, i (i)}
								{@const slotErrs = multiErrors[i] ?? {}}
								<div class="multi-slot" class:multi-slot--skip={slot.skip}>
									<div class="multi-slot__preview" aria-hidden="true">
										<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
											<path d={slot.svgPath} fill="rgba(0,229,255,0.07)" stroke="var(--color-brand)" stroke-width="2" stroke-linecap="round"/>
										</svg>
									</div>
									<div class="multi-slot__fields">
										<div class="multi-slot__num">Pattern {i + 1}</div>
										{#if !slot.skip}
											<div class="multi-slot__row" class:field--error={!!slotErrs.zone}>
												<label class="multi-slot__label" for="multi-zone-{i}">Zone</label>
												<select
													id="multi-zone-{i}"
													class="multi-slot__select"
													class:multi-slot__select--err={!!slotErrs.zone}
													bind:value={slot.zone}
													aria-label="Zone for pattern {i + 1}"
												>
													<option value="">Select zone…</option>
													{#each zoneList as z}
														<option value={z.value}>{z.label}</option>
													{/each}
												</select>
												{#if slotErrs.zone}<span class="multi-slot__err">{slotErrs.zone}</span>{/if}
											</div>
											<div class="multi-slot__dims">
												<div class:field--error={!!slotErrs.width}>
													<label class="multi-slot__label" for="multi-width-{i}">Width (in)</label>
													<input id="multi-width-{i}" type="number" class="multi-slot__input" class:multi-slot__input--err={!!slotErrs.width} min="0.1" step="0.1" bind:value={slot.widthInches} placeholder="0.0" aria-label="Width for pattern {i + 1}"/>
													{#if slotErrs.width}<span class="multi-slot__err">{slotErrs.width}</span>{/if}
												</div>
												<div class:field--error={!!slotErrs.height}>
													<label class="multi-slot__label" for="multi-height-{i}">Height (in)</label>
													<input id="multi-height-{i}" type="number" class="multi-slot__input" class:multi-slot__input--err={!!slotErrs.height} min="0.1" step="0.1" bind:value={slot.heightInches} placeholder="0.0" aria-label="Height for pattern {i + 1}"/>
													{#if slotErrs.height}<span class="multi-slot__err">{slotErrs.height}</span>{/if}
												</div>
											</div>
										{:else}
											<span class="multi-slot__skipped">Skipped</span>
										{/if}
									</div>
									<button
										type="button"
										class="multi-slot__skip-btn"
										class:multi-slot__skip-btn--skipped={slot.skip}
										onclick={() => { slot.skip = !slot.skip; }}
										title={slot.skip ? "Include this pattern" : "Skip this pattern"}
										aria-label={slot.skip ? "Include pattern {i + 1}" : "Skip pattern {i + 1}"}
									>
										{slot.skip ? "Include" : "Skip"}
									</button>
								</div>
							{/each}
						</div>

					{:else if uploadMode === "multi" && multiMethod === "single-file"}
						<!-- ─── Combined file importer (pre-extraction) ─── -->
						<div class="field">
							<span class="field__label">
								Pattern Importer
								<span class="field__hint">Upload a combined image — individual patterns are detected automatically</span>
							</span>
							<SvgPathInput
								bind:value={multiFileSvgPath}
								onMultiExtract={handleMultiExtract}
								autoExtract={true}
								onVectorizingChange={(v) => { isImporting = v; }}
							/>
						</div>

					{:else}
						<!-- ─── Single pattern form ─── -->
						<div class="field" class:field--error={!!errors.zones}>
							<span class="field__label">Zones</span>
							<div class="multitag" class:multitag--error={!!errors.zones}>
								{#each pattern.zones as z (z)}
									{@const mirror = mirrorOf(z)}
									<span class="chip">
										<span class="chip__label">{zoneLabel(z)}</span>
										{#if mirror && !pattern.zones.includes(mirror)}
											<button type="button" class="chip__mirror" title="Also add {zoneLabel(mirror)}" onclick={() => addZone(mirror)}>↔</button>
										{/if}
										<button type="button" class="chip__remove" aria-label="Remove {zoneLabel(z)}" onclick={() => removeZone(z)}>×</button>
									</span>
								{/each}
								{#if availableZones.length}
									<select class="zone-add-select" onchange={onZoneAdd} aria-label="Add zone">
										<option value="">+ Add zone</option>
										{#each availableZones as z}
											<option value={z.value}>{z.label}</option>
										{/each}
									</select>
								{/if}
							</div>
							{#if errors.zones}<span class="field__error">{errors.zones}</span>{/if}
						</div>

						<div class="field-row field-row--2">
							<div class="field" class:field--error={errors.width}>
								<label class="field__label" for="width">Width (inches)</label>
								<input id="width" class="field__input" type="number" min="0.1" step="0.1" bind:value={pattern.widthInches} placeholder="60.5"/>
								{#if errors.width}<span class="field__error">{errors.width}</span>{/if}
							</div>
							<div class="field" class:field--error={errors.height}>
								<label class="field__label" for="height">Height (inches)</label>
								<input id="height" class="field__input" type="number" min="0.1" step="0.1" bind:value={pattern.heightInches} placeholder="48.0"/>
								{#if errors.height}<span class="field__error">{errors.height}</span>{/if}
							</div>
						</div>

						<div class="stage-divider" role="separator" aria-hidden="true"></div>

						<div class="field" class:field--error={errors.svgPath}>
							<label class="field__label" for="svgPath">
								Pattern Importer
							</label>
							<SvgPathInput
								id="svgPath"
								bind:value={pattern.svgPath}
								error={!!errors.svgPath}
								showMirror={hasMirrorPair}
								mirrorOrigLabel={mirrorZoneLabels?.orig}
								mirrorFlipLabel={mirrorZoneLabels?.flip}
								onMultiExtract={handleMultiExtract}
							/>
							{#if errors.svgPath}<span class="field__error">{errors.svgPath}</span>{/if}
						</div>
					{/if}

				</section>

				<!-- Notes -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">5</span>
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
					<button type="button" class="btn btn--ghost" onclick={() => goto("/library")} disabled={isImporting}>Cancel</button>
					<button type="submit" class="btn btn--primary" disabled={submitting || isImporting}>
						{#if submitting}
							<span class="spinner" aria-hidden="true"></span>
							Saving…
						{:else if isImporting}
							<span class="spinner" aria-hidden="true"></span>
							Importing patterns…
						{:else if mode === "community"}
							Submit to Community
						{:else}
							Save to My Library
						{/if}
					</button>
				</div>

			</form>
		</div>
	{/if}

</div>

<style>
	.page {
		min-height: 100%;
		background: var(--bg-canvas);
		overflow-y: auto;
	}

	/* ─── Full-width mode bar ─── */
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
		background: color-mix(in srgb, var(--color-brand) 7%, var(--bg-surface));
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
	.year-input {
		flex: 1;
		min-width: 120px;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		padding: 4px 6px;
	}
	.year-input::placeholder { color: var(--text-tertiary); }

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
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 16px 64px;
	}

	.upload-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* ─── Form sections ─── */
	.form-section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px 24px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
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
		color: #080a0f;
		font-size: 0.8125rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	/* ─── Fields ─── */
	.stage-divider { height: 1px; background: var(--border-subtle); margin: 4px 0 6px; }

	.field-row { display: grid; gap: 14px; }
	.field-row--2 { grid-template-columns: 1fr 1fr; }

	.field { display: flex; flex-direction: column; gap: 6px; }
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

	/* ─── Category radio ─── */
	.radio-group { display: flex; gap: 8px; }
	.radio-option {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		padding: 10px 14px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.radio-option input[type="radio"] { display: none; }
	.radio-option--active {
		border-color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2));
	}
	.radio-option__label { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); }
	.radio-option__sub { font-size: 0.8125rem; color: var(--text-tertiary); }

	/* ─── Project type grid ─── */
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
		background: color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2));
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


	/* ─── Actions ─── */
	.form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

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

	.spinner {
		width: 13px;
		height: 13px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ─── Multi-pattern mode ─── */
	.multi-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.multi-header__title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.multi-header__back {
		background: none;
		border: none;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0;
		font-family: var(--font-body);
		transition: color 0.12s;
	}
	.multi-header__back:hover { color: var(--color-brand); }

	.multi-slots {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.multi-slot {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		transition: opacity 0.15s;
	}
	.multi-slot--skip {
		opacity: 0.45;
	}

	.multi-slot__preview {
		width: 72px;
		height: 72px;
		flex-shrink: 0;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		padding: 6px;
	}
	.multi-slot__preview svg { width: 100%; height: 100%; display: block; }

	.multi-slot__fields {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.multi-slot__num {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.multi-slot__label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
		display: block;
		margin-bottom: 4px;
	}

	.multi-slot__select {
		width: 100%;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		padding: 7px 10px;
		transition: border-color 0.12s;
	}
	.multi-slot__select:focus {
		outline: none;
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.multi-slot__select--err { border-color: var(--color-danger, #f44); }

	.multi-slot__dims {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.multi-slot__input {
		width: 100%;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		padding: 7px 10px;
		box-sizing: border-box;
		transition: border-color 0.12s;
	}
	.multi-slot__input:focus {
		outline: none;
		border-color: var(--color-brand);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent);
	}
	.multi-slot__input--err { border-color: var(--color-danger, #f44); }

	.multi-slot__err {
		font-size: 0.75rem;
		color: var(--color-danger, #f44);
		margin-top: 2px;
		display: block;
	}

	.multi-slot__skipped {
		font-size: 0.8125rem;
		color: var(--text-muted, var(--text-tertiary));
		font-style: italic;
	}

	.multi-slot__skip-btn {
		flex-shrink: 0;
		background: none;
		border: 1px solid var(--border-default);
		color: var(--text-tertiary);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		padding: 4px 10px;
		border-radius: 99px;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
		white-space: nowrap;
		margin-top: 2px;
	}
	.multi-slot__skip-btn:hover {
		border-color: var(--color-brand);
		color: var(--color-brand);
	}
	.multi-slot__skip-btn--skipped {
		border-color: var(--color-brand);
		color: var(--color-brand);
		background: color-mix(in srgb, var(--color-brand) 10%, transparent);
	}

	/* ─── Success ─── */
	.success-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100%;
		padding: 48px 16px;
	}
	.success-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 48px 32px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 16px;
		max-width: 480px;
		width: 100%;
	}
	.success-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: color-mix(in srgb, #22c55e 14%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #4ade80;
	}
	.success-title { font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin: 0; }
	.success-body { font-size: 0.9375rem; color: var(--text-secondary); line-height: 1.6; margin: 0; }
	.success-actions { display: flex; gap: 10px; margin-top: 8px; }

	/* ─── Individual slots ─── */
	.indiv-slots {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.indiv-slot {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}

	.indiv-slot__hdr {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.indiv-slot__num {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.indiv-slot__remove {
		background: none;
		border: none;
		font-size: 1rem;
		line-height: 1;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 3px;
		transition: background 0.08s, color 0.08s;
	}
	.indiv-slot__remove:hover {
		background: color-mix(in srgb, var(--color-danger, #f44) 12%, transparent);
		color: var(--color-danger, #f44);
	}

	.indiv-add-btn {
		align-self: flex-start;
		margin-top: 4px;
	}

	/* ─── Responsive ─── */
	@media (max-width: 640px) {
		.mode-bar { grid-template-columns: 1fr; }
		.mode-card { border-right: none; border-bottom: 1px solid var(--border-subtle); }
		.mode-card--active { border-bottom: 3px solid var(--color-brand); }
		.field-row--2 { grid-template-columns: 1fr; }
		.field--half { max-width: 100%; }
		.radio-group { flex-direction: column; }
		.type-grid { grid-template-columns: 1fr 1fr; }
		.form-section { padding: 16px; }
		.success-card { padding: 32px 20px; }
	}
</style>
