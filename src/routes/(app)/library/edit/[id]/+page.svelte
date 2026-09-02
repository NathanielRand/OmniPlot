<script lang="ts">
	import { page } from "$app/stores";
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { userStore, toastStore } from "$lib/stores";
	import { patternStore, PPF_ZONES_LIST, TINT_ZONES_LIST, MIRROR_PAIRS } from "$lib/stores/patternStore.svelte";
	import { getUserPatternById, updateUserPattern, deleteUserPattern } from "$lib/firebase/firestore";
	import SvgPathInput from "$lib/components/ui/SvgPathInput.svelte";
	import VehicleCombobox from "$lib/components/ui/VehicleCombobox.svelte";
	import type { PatternCategory, PatternZone, PatternCoverage, UserPattern } from "$lib/types";

	type BodyStyle = UserPattern["bodyStyle"];

	// ─── Load ─────────────────────────────────────
	let loading  = $state(true);
	let notFound = $state(false);
	let original = $state<UserPattern | null>(null);

	// ─── Form state (mirrors upload form fields) ──
	let vehicle = $state({
		make:      "",
		models:    [] as string[],
		years:     [] as string[],
		bodyStyle: "sedan" as BodyStyle,
	});

	let pattern = $state({
		category:     "ppf" as PatternCategory,
		zones:        [] as PatternZone[],
		coverage:     "full" as PatternCoverage,
		widthInches:  0,
		heightInches: 0,
		svgPath:      "",
		notes:        "",
	});

	let modelInput = $state("");
	let yearInput  = $state("");
	let errors   = $state<Record<string, string>>({});
	let saving   = $state(false);
	let deleting = $state(false);
	let showDeleteConfirm = $state(false);

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
		pattern.category === "ppf" ? PPF_ZONES_LIST : TINT_ZONES_LIST,
	);

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

	onMount(async () => {
		if (!userStore.user) { goto("/library"); return; }
		const id = $page.params.id ?? "";
		if (!id) { notFound = true; loading = false; return; }
		try {
			const p = await getUserPatternById(id);
			if (!p) { notFound = true; loading = false; return; }
			// Only the owner can edit; published patterns are locked
			if (p.ownerId !== userStore.user.uid || p.isPublished) {
				goto("/library?tab=mine");
				return;
			}
			original = p;
			vehicle  = { make: p.make, models: p.models, years: p.years, bodyStyle: p.bodyStyle };
			pattern  = {
				category:     p.category,
				zones:        p.zones,
				coverage:     p.coverage,
				widthInches:  p.widthInches,
				heightInches: p.heightInches,
				svgPath:      p.svgPath,
				notes:        p.notes ?? "",
			};
		} catch {
			notFound = true;
		} finally {
			loading = false;
		}
	});

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

	// ─── Validation ───────────────────────────────
	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!vehicle.make.trim())    e.make   = "Make is required";
		if (!vehicle.models.length)  e.models = "Add at least one model";
		if (!vehicle.years.length)   e.years  = "Add at least one year or range";
		if (!pattern.zones.length)   e.zones  = "Select at least one zone";
		if (!pattern.widthInches  || pattern.widthInches  <= 0) e.width  = "Enter a positive width";
		if (!pattern.heightInches || pattern.heightInches <= 0) e.height = "Enter a positive height";
		if (!pattern.svgPath.trim()) e.svgPath = "SVG path data is required";
		errors = e;
		return Object.keys(e).length === 0;
	}

	// ─── Save ─────────────────────────────────────
	async function handleSave(e: SubmitEvent) {
		e.preventDefault();
		if (!validate() || !original) return;
		saving = true;
		try {
			const name = pattern.zones.map(z => zoneLabel(z)).join(" + ");
			await updateUserPattern(original.id, {
				make:         vehicle.make.trim(),
				models:       vehicle.models,
				years:        vehicle.years,
				bodyStyle:    vehicle.bodyStyle,
				category:     pattern.category,
				zones:        pattern.zones,
				name,
				coverage:     pattern.coverage,
				widthInches:  pattern.widthInches,
				heightInches: pattern.heightInches,
				svgPath:      pattern.svgPath.trim(),
				notes:        pattern.notes.trim() || undefined,
			});
			toastStore.success("Pattern saved", `${name} has been updated.`);
			goto("/library?tab=mine");
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
			goto("/library?tab=mine");
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
			<a href="/library?tab=mine" class="btn btn--ghost">Back to My Patterns</a>
		</div>

	{:else}

		<!-- Header -->
		<div class="edit-header">
			<a href="/library?tab=mine" class="back-link">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
				My Patterns
			</a>
			<h1 class="edit-title">Edit Pattern</h1>
			{#if original?.status === "pending"}
				<span class="status-chip status-chip--pending">Review Pending — edits will restart the review</span>
			{/if}
		</div>

		<!-- Form -->
		<div class="form-wrap">
			<form class="edit-form" onsubmit={handleSave} novalidate>

			<!-- Vehicle -->
				<section class="form-section">
					<h2 class="section-title">
						<span class="section-num">1</span>
						Vehicle
					</h2>

					<div class="field-row field-row--2">
						<div class="field" class:field--error={!!errors.years}>
							<label class="field__label" for="year-input">Year(s)</label>
							<div class="multitag" class:multitag--error={!!errors.years}>
								{#each vehicle.years as y (y)}
									<span class="chip">
										<span class="chip__label">{y}</span>
										<button type="button" class="chip__remove" aria-label="Remove {y}" onclick={() => { vehicle.years = vehicle.years.filter(x => x !== y); }}>×</button>
									</span>
								{/each}
								<input
									id="year-input"
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

					<div class="field-row field-row--2">
						<div class="field" class:field--error={errors.width}>
							<label class="field__label" for="width">Width (inches)</label>
							<input id="width" class="field__input" type="number" min="0.1" step="0.1"
								bind:value={pattern.widthInches}/>
							{#if errors.width}<span class="field__error">{errors.width}</span>{/if}
						</div>
						<div class="field" class:field--error={errors.height}>
							<label class="field__label" for="height">Height (inches)</label>
							<input id="height" class="field__input" type="number" min="0.1" step="0.1"
								bind:value={pattern.heightInches}/>
							{#if errors.height}<span class="field__error">{errors.height}</span>{/if}
						</div>
					</div>

					<div class="field" class:field--error={errors.svgPath}>
						<label class="field__label" for="svgPath">Pattern Importer</label>
						<SvgPathInput id="svgPath" bind:value={pattern.svgPath} error={!!errors.svgPath} showMirror={hasMirrorPair} mirrorOrigLabel={mirrorZoneLabels?.orig} mirrorFlipLabel={mirrorZoneLabels?.flip}/>
						{#if errors.svgPath}<span class="field__error">{errors.svgPath}</span>{/if}
					</div>

					<div class="field">
						<label class="field__label" for="notes">
							Notes
							<span class="field__hint">Optional — fitment tips, measurement source, caveats</span>
						</label>
						<textarea id="notes" class="field__textarea" bind:value={pattern.notes} rows="3"
							placeholder="Measured from physical vehicle. Verify before cutting."></textarea>
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
					<a href="/library?tab=mine" class="btn btn--ghost">Cancel</a>
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
		padding: 20px 24px 0;
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
		max-width: 720px;
		margin: 0 auto;
		padding: 24px 16px 64px;
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

	/* ─── Radio cards ─── */
	.radio-group { display: flex; gap: 8px; }
	.radio-option {
		display: flex; flex-direction: column; gap: 2px; flex: 1;
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
	.radio-option__sub   { font-size: 0.8125rem; color: var(--text-tertiary); }

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
	@media (max-width: 640px) {
		.edit-header { padding: 16px 16px 0; }
		.form-section { padding: 16px; }
		.field-row--2 { grid-template-columns: 1fr; }
		.field--half { max-width: 100%; }
		.radio-group { flex-direction: column; }
		.form-actions { flex-wrap: wrap; }
		.actions-spacer { display: none; }
	}
</style>
