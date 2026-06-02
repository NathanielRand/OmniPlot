<script lang="ts">
	import { goto } from "$app/navigation";
	import { userStore, toastStore } from "$lib/stores";
	import { patternStore, PPF_ZONES_LIST, TINT_ZONES_LIST } from "$lib/stores/patternStore.svelte";
	import { addUserPattern } from "$lib/firebase/firestore";
	import SvgPathInput from "$lib/components/ui/SvgPathInput.svelte";
	import type { PatternCategory, PatternZone, PatternCoverage } from "$lib/types";
	import type { VehicleEntry } from "$lib/stores/patternStore.svelte";

	type BodyStyle = VehicleEntry["bodyStyle"];

	// ─── Top-level mode: private or community ────
	let mode = $state<"private" | "community">("private");

	// ─── Form state ───────────────────────────────
	let step = $state<"form" | "success">("form");
	let submitting = $state(false);

	let vehicle = $state({
		make:      "",
		model:     "",
		year:      new Date().getFullYear(),
		bodyStyle: "sedan" as BodyStyle,
	});

	let pattern = $state({
		category:     "ppf" as PatternCategory,
		zone:         "hood" as PatternZone,
		name:         "",
		coverage:     "full" as PatternCoverage,
		widthInches:  0,
		heightInches: 0,
		svgPath:      "",
		notes:        "",
	});

	let errors = $state<Record<string, string>>({});

	// ─── Derived ──────────────────────────────────
	const existingVehicle = $derived(
		vehicle.make.trim() && vehicle.model.trim() && vehicle.year
			? patternStore.vehicles.find(
					(v) =>
						v.make.toLowerCase() === vehicle.make.trim().toLowerCase() &&
						v.model.toLowerCase() === vehicle.model.trim().toLowerCase() &&
						v.year === vehicle.year,
				)
			: undefined,
	);

	const zoneList = $derived(
		pattern.category === "ppf" ? PPF_ZONES_LIST : TINT_ZONES_LIST,
	);

	$effect(() => {
		const first = zoneList[0];
		if (first) {
			pattern.zone = first.value;
			if (!pattern.name) pattern.name = first.label;
		}
	});

	function onZoneChange(e: Event) {
		const val = (e.target as HTMLSelectElement).value as PatternZone;
		const found = zoneList.find((z) => z.value === val);
		if (found) {
			const oldLabel = zoneList.find((z) =>
				z.label.toLowerCase() === pattern.name.toLowerCase(),
			);
			if (!pattern.name || oldLabel) pattern.name = found.label;
		}
		pattern.zone = val;
	}


	// ─── Validation ───────────────────────────────
	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!vehicle.make.trim())  e.make  = "Make is required";
		if (!vehicle.model.trim()) e.model = "Model is required";
		if (!vehicle.year || vehicle.year < 1950 || vehicle.year > new Date().getFullYear() + 2)
			e.year = "Enter a valid model year";
		if (!pattern.name.trim())  e.name  = "Pattern name is required";
		if (!pattern.widthInches  || pattern.widthInches  <= 0) e.width  = "Enter a positive width";
		if (!pattern.heightInches || pattern.heightInches <= 0) e.height = "Enter a positive height";
		if (!pattern.svgPath.trim()) e.svgPath = "SVG path data is required";
		errors = e;
		return Object.keys(e).length === 0;
	}

	// ─── Submit ───────────────────────────────────
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!validate()) return;
		if (!userStore.user) { toastStore.error("Not signed in", "Please log in first."); return; }

		submitting = true;
		try {
			await addUserPattern({
				ownerId:           userStore.user.uid,
				submitToCommunity: mode === "community",
				vehicleId:         existingVehicle?.id,
				make:              vehicle.make.trim(),
				model:             vehicle.model.trim(),
				year:              vehicle.year,
				bodyStyle:         vehicle.bodyStyle,
				category:          pattern.category,
				zone:              pattern.zone,
				name:              pattern.name.trim(),
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
		vehicle   = { make: "", model: "", year: new Date().getFullYear(), bodyStyle: "sedan" };
		pattern   = { category: "ppf", zone: "hood", name: "", coverage: "full", widthInches: 0, heightInches: 0, svgPath: "", notes: "" };
		errors    = {};
		mode      = "private";
		step      = "form";
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
				<h2 class="success-title">Pattern Saved</h2>
				<p class="success-body">
					<strong>{pattern.name}</strong> for the {vehicle.year} {vehicle.make} {vehicle.model}
					is available in your library.
					{#if mode === "community"}
						It's been queued for review — once approved it will appear in the public library.
					{/if}
				</p>
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

				<!-- Vehicle -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">1</span>
						Vehicle
					</h2>

					<div class="field-row field-row--3">
						<div class="field" class:field--error={errors.year}>
							<label class="field__label" for="year">Year</label>
							<input id="year" class="field__input" type="number" min="1950" max={new Date().getFullYear() + 2} bind:value={vehicle.year} placeholder="2024"/>
							{#if errors.year}<span class="field__error">{errors.year}</span>{/if}
						</div>
						<div class="field" class:field--error={errors.make}>
							<label class="field__label" for="make">Make</label>
							<input id="make" class="field__input" type="text" bind:value={vehicle.make} placeholder="Chevrolet" autocomplete="off"/>
							{#if errors.make}<span class="field__error">{errors.make}</span>{/if}
						</div>
						<div class="field" class:field--error={errors.model}>
							<label class="field__label" for="model">Model</label>
							<input id="model" class="field__input" type="text" bind:value={vehicle.model} placeholder="Silverado 1500 Crew Cab" autocomplete="off"/>
							{#if errors.model}<span class="field__error">{errors.model}</span>{/if}
						</div>
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

					{#if vehicle.make.trim() && vehicle.model.trim() && vehicle.year}
						{#if existingVehicle}
							<div class="vehicle-match vehicle-match--found">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
								This vehicle is already in the library — your pattern will be linked to it.
							</div>
						{:else}
							<div class="vehicle-match vehicle-match--new">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
								New vehicle — will be added upon approval.
							</div>
						{/if}
					{/if}
				</section>

				<!-- Pattern Details -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">2</span>
						Pattern Details
					</h2>

					<div class="field">
						<span class="field__label">Category</span>
						<div class="radio-group" role="radiogroup" aria-label="Pattern category">
							<label class="radio-option" class:radio-option--active={pattern.category === "ppf"}>
								<input type="radio" name="category" value="ppf" bind:group={pattern.category}/>
								<span class="radio-option__label">PPF</span>
								<span class="radio-option__sub">Paint Protection Film</span>
							</label>
							<label class="radio-option" class:radio-option--active={pattern.category === "window-tint"}>
								<input type="radio" name="category" value="window-tint" bind:group={pattern.category}/>
								<span class="radio-option__label">Window Tint</span>
								<span class="radio-option__sub">Glass precut patterns</span>
							</label>
						</div>
					</div>

					<div class="field-row field-row--2">
						<div class="field">
							<label class="field__label" for="zone">Zone</label>
							<select id="zone" class="field__select" value={pattern.zone} onchange={onZoneChange}>
								{#each zoneList as z}
									<option value={z.value}>{z.label}</option>
								{/each}
							</select>
						</div>
						<div class="field">
							<label class="field__label" for="coverage">Coverage</label>
							<select id="coverage" class="field__select" bind:value={pattern.coverage}>
								<option value="full">Full</option>
								<option value="partial">Partial</option>
								<option value="edge-only">Edge Only</option>
							</select>
						</div>
					</div>

					<div class="field" class:field--error={errors.name}>
						<label class="field__label" for="patternName">
							Pattern Name
							<span class="field__hint">Shown in studio and library</span>
						</label>
						<input id="patternName" class="field__input" type="text" bind:value={pattern.name} placeholder="Hood Full Wrap"/>
						{#if errors.name}<span class="field__error">{errors.name}</span>{/if}
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

					<div class="field" class:field--error={errors.svgPath}>
						<label class="field__label" for="svgPath">
							SVG Path Data
						</label>
						<SvgPathInput id="svgPath" bind:value={pattern.svgPath} error={!!errors.svgPath} />
						{#if errors.svgPath}<span class="field__error">{errors.svgPath}</span>{/if}
					</div>

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
					<button type="button" class="btn btn--ghost" onclick={() => goto("/library")}>Cancel</button>
					<button type="submit" class="btn btn--primary" disabled={submitting}>
						{#if submitting}
							<span class="spinner" aria-hidden="true"></span>
							Saving…
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

	/* ─── Form wrap ─── */
	.form-wrap {
		max-width: 720px;
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
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 4px;
	}
	.section-num {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--color-brand);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	/* ─── Fields ─── */
	.field-row { display: grid; gap: 12px; }
	.field-row--2 { grid-template-columns: 1fr 1fr; }
	.field-row--3 { grid-template-columns: 100px 1fr 1fr; }

	.field { display: flex; flex-direction: column; gap: 5px; }
	.field--half { max-width: 260px; }

	.field__label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.field__hint { font-size: 0.75rem; font-weight: 400; color: var(--text-tertiary); }

	.field__input, .field__select, .field__textarea {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: var(--font-body);
		padding: 8px 10px;
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
	.field__textarea--mono { font-family: var(--font-mono, monospace); font-size: 0.8125rem; }

	.field--error .field__input, .field--error .field__textarea { border-color: var(--color-danger, #f44); }
	.field__error { font-size: 0.75rem; color: var(--color-danger, #f44); }

	.field__note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		line-height: 1.5;
		margin: 2px 0 0;
		padding: 8px 10px;
		background: color-mix(in srgb, #f59e0b 8%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #f59e0b 25%, transparent);
		border-radius: var(--radius-md);
	}

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
	.radio-option__label { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
	.radio-option__sub { font-size: 0.75rem; color: var(--text-tertiary); }

	/* ─── Vehicle match ─── */
	.vehicle-match {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
	}
	.vehicle-match--found {
		background: color-mix(in srgb, #22c55e 10%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
		color: #4ade80;
	}
	.vehicle-match--new {
		background: color-mix(in srgb, var(--color-brand) 8%, var(--bg-surface-2));
		border: 1px solid color-mix(in srgb, var(--color-brand) 25%, transparent);
		color: var(--text-secondary);
	}

	/* ─── SVG preview ─── */
	.svg-field { display: grid; grid-template-columns: 1fr 120px; gap: 10px; }
	.svg-preview {
		aspect-ratio: 1;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 8px;
	}
	.svg-preview svg { width: 100%; height: 100%; }
	.svg-preview__empty { font-size: 0.6875rem; color: var(--text-muted); }

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
	.btn--primary { background: var(--color-brand); color: #fff; }
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

	/* ─── Responsive ─── */
	@media (max-width: 640px) {
		.mode-bar { grid-template-columns: 1fr; }
		.mode-card { border-right: none; border-bottom: 1px solid var(--border-subtle); }
		.mode-card--active { border-bottom: 3px solid var(--color-brand); }
		.field-row--3 { grid-template-columns: 1fr 1fr; }
		.field-row--3 .field:first-child { grid-column: 1 / -1; }
		.field-row--2 { grid-template-columns: 1fr; }
		.field--half { max-width: 100%; }
		.radio-group { flex-direction: column; }
		.svg-field { grid-template-columns: 1fr; }
		.svg-preview { height: 120px; aspect-ratio: auto; }
		.form-section { padding: 16px; }
		.success-card { padding: 32px 20px; }
	}
</style>
