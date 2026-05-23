<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import {
		patternStore,
		PPF_ZONES_LIST,
		TINT_ZONES_LIST,
		type VehicleEntry,
		type PatternStatus,
	} from "$lib/stores/patternStore.svelte";
	import type { PatternCategory, PatternCoverage, PatternZone } from "$lib/types";

	// ─── Filter state ─────────────────────────────
	let search        = $state("");
	let filterStatus  = $state<"all" | PatternStatus>("all");
	let filterCategory = $state<"both" | PatternCategory>("both");

	// ─── Derived vehicle rows with live pattern counts ─
	const filteredVehicles = $derived(
		patternStore.vehicles
			.filter((v) => {
				const q = search.toLowerCase();
				const mq = !q || `${v.make} ${v.model} ${v.year}`.toLowerCase().includes(q);
				const ms = filterStatus === "all" || v.status === filterStatus;
				return mq && ms;
			})
			.map((v) => {
				const ppfPats  = patternStore.getPatterns(v.id, "ppf");
				const tintPats = patternStore.getPatterns(v.id, "window-tint");
				return {
					...v,
					patterns:      ppfPats.length,
					published:     ppfPats.filter((p) => p.isPublished).length,
					tintZones:     tintPats.length,
					tintPublished: tintPats.filter((p) => p.isPublished).length,
				};
			}),
	);

	const totals = $derived({
		vehicles:     patternStore.vehicles.length,
		ppfPatterns:  patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id, "ppf").length, 0),
		ppfPublished: patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id, "ppf").filter((p) => p.isPublished).length, 0),
		tintZones:    patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id, "window-tint").length, 0),
		tintPublished:patternStore.vehicles.reduce((s, v) => s + patternStore.getPatterns(v.id, "window-tint").filter((p) => p.isPublished).length, 0),
		drafts:       patternStore.vehicles.filter((v) => v.status === "draft" || v.status === "review").length,
	});

	// ─── Add Vehicle modal ────────────────────────
	let showAddModal = $state(false);
	let newVehicle = $state({
		year:      new Date().getFullYear(),
		make:      "",
		model:     "",
		bodyStyle: "sedan" as VehicleEntry["bodyStyle"],
		status:    "draft"  as PatternStatus,
	});

	function handleAddVehicle() {
		if (!newVehicle.make.trim() || !newVehicle.model.trim()) return;
		patternStore.addVehicle({
			make:      newVehicle.make.trim(),
			model:     newVehicle.model.trim(),
			year:      newVehicle.year,
			bodyStyle: newVehicle.bodyStyle,
			status:    newVehicle.status,
			tags:      [],
			updatedAt: new Date().toISOString().split("T")[0],
		});
		showAddModal = false;
		newVehicle = { year: new Date().getFullYear(), make: "", model: "", bodyStyle: "sedan", status: "draft" };
	}

	// ─── Edit Patterns panel ──────────────────────
	let editingVehicle  = $state<VehicleEntry | null>(null);
	let editPanelTab    = $state<PatternCategory>("window-tint");
	let showAddPattern  = $state(false);
	let editPatternId   = $state<string | null>(null);

	let newPattern = $state({
		zone:        "windshield" as PatternZone,
		name:        "",
		coverage:    "full" as PatternCoverage,
		widthInches: 24,
		heightInches:16,
		svgPath:     "",
		notes:       "",
		isPublished: false,
	});

	let editPatch = $state({
		name:        "",
		widthInches: 0,
		heightInches:0,
		isPublished: false,
		notes:       "",
	});

	function openEditPanel(v: VehicleEntry) {
		editingVehicle = v;
		editPanelTab   = "window-tint";
		showAddPattern = false;
		editPatternId  = null;
	}

	function closeEditPanel() {
		editingVehicle = null;
		showAddPattern = false;
		editPatternId  = null;
	}

	const panelPatterns = $derived(
		editingVehicle ? patternStore.getPatterns(editingVehicle.id, editPanelTab) : [],
	);

	const zoneOptions = $derived(editPanelTab === "ppf" ? PPF_ZONES_LIST : TINT_ZONES_LIST);

	function handleAddPattern() {
		if (!editingVehicle || !newPattern.name.trim()) return;
		patternStore.addPattern({
			vehicleId:   editingVehicle.id,
			category:    editPanelTab,
			zone:        newPattern.zone,
			name:        newPattern.name.trim(),
			coverage:    newPattern.coverage,
			svgPath:     newPattern.svgPath.trim() || "M10,90 Q15,20 50,5 Q85,20 90,90",
			widthInches: newPattern.widthInches,
			heightInches:newPattern.heightInches,
			revision:    new Date().toISOString().split("T")[0].slice(0, 7),
			notes:       newPattern.notes.trim() || undefined,
			isPublished: newPattern.isPublished,
		});
		newPattern = { zone: "windshield", name: "", coverage: "full", widthInches: 24, heightInches: 16, svgPath: "", notes: "", isPublished: false };
		showAddPattern = false;
	}

	function startEditPattern(id: string) {
		const p = panelPatterns.find((x) => x.id === id);
		if (!p) return;
		editPatternId = id;
		editPatch = { name: p.name, widthInches: p.widthInches, heightInches: p.heightInches, isPublished: p.isPublished, notes: p.notes ?? "" };
		showAddPattern = false;
	}

	function saveEditPattern() {
		if (!editPatternId) return;
		patternStore.updatePattern(editPatternId, {
			name:        editPatch.name,
			widthInches: editPatch.widthInches,
			heightInches:editPatch.heightInches,
			isPublished: editPatch.isPublished,
			notes:       editPatch.notes || undefined,
		});
		editPatternId = null;
	}
</script>

<svelte:head><title>Patterns — Admin — OmniPlot</title></svelte:head>

<div class="patterns-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Patterns</h1>
			<p class="page-sub">Manage vehicle templates and pattern requests.</p>
		</div>
		<div class="page-header__actions">
			<Button
				variant="ghost"
				size="sm"
				onclick={async () => { await patternStore.seedFirestore(); }}
				title="Write all in-memory seed data to Firestore (one-time)"
			>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7v10c0 2.2 3.6 4 8 4s8-1.8 8-4V7"/><ellipse cx="12" cy="7" rx="8" ry="3"/><path d="M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4"/></svg>
				Seed Firestore
			</Button>
			<Button variant="primary" size="sm" onclick={() => (showAddModal = true)}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
				Add vehicle
			</Button>
		</div>
	</div>

	<!-- Summary cards -->
	<div class="summary-row">
		{#each [
			{ label: "Total vehicles",    value: totals.vehicles },
			{ label: "PPF patterns",      value: totals.ppfPatterns,  sub: `${totals.ppfPublished} published` },
			{ label: "Window tint zones", value: totals.tintZones,    sub: `${totals.tintPublished} published` },
			{ label: "Drafts / review",   value: totals.drafts },
		] as s}
			<div class="summary-card">
				<div class="summary-card__label">{s.label}</div>
				<div class="summary-card__value">{s.value}</div>
				{#if s.sub}<div class="summary-card__sub">{s.sub}</div>{/if}
			</div>
		{/each}
	</div>

	<!-- Vehicles table -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Vehicles</h2>
			<div class="toolbar">
				<div class="category-tabs" role="group" aria-label="Category">
					{#each ([["both","All"], ["ppf","PPF"], ["window-tint","Tint"]] as ["both" | PatternCategory, string][]) as [val, label]}
						<button
							class="status-tab"
							class:active={filterCategory === val}
							onclick={() => (filterCategory = val)}
							aria-pressed={filterCategory === val}
						>{label}</button>
					{/each}
				</div>
				<div class="status-tabs" role="tablist">
					{#each (["all", "published", "review", "draft"] as const) as t}
						<button
							class="status-tab"
							class:active={filterStatus === t}
							onclick={() => (filterStatus = t)}
							role="tab"
							aria-selected={filterStatus === t}
						>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
					{/each}
				</div>
				<div class="search-wrap">
					<svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
					<input
						type="search"
						class="search-input"
						placeholder="Search vehicles…"
						bind:value={search}
						aria-label="Search vehicles"
					/>
				</div>
			</div>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Vehicles">
				<thead>
					<tr>
						<th>Vehicle</th>
						{#if filterCategory !== "window-tint"}
							<th>PPF patterns</th>
							<th>PPF coverage</th>
						{/if}
						{#if filterCategory !== "ppf"}
							<th>Tint zones</th>
							<th>Tint coverage</th>
						{/if}
						<th>Status</th>
						<th>Updated</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each filteredVehicles as v (v.id)}
						<tr>
							<td>
								<div class="vehicle-cell">
									<div class="vehicle-icon" aria-hidden="true">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v5"/><path d="M14 17a3 3 0 100 6 3 3 0 000-6z"/><path d="M8 17a3 3 0 100 6 3 3 0 000-6z"/></svg>
									</div>
									<div>
										<div class="vehicle-name">{v.year} {v.make} {v.model}</div>
									</div>
								</div>
							</td>
							{#if filterCategory !== "window-tint"}
								<td class="td-mono">{v.published} / {v.patterns}</td>
								<td>
									<div class="coverage-bar" role="meter" aria-valuenow={v.published} aria-valuemax={v.patterns} aria-label="PPF coverage">
										<div class="coverage-bar__fill" style="width: {v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%"></div>
									</div>
									<span class="coverage-pct">{v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%</span>
								</td>
							{/if}
							{#if filterCategory !== "ppf"}
								<td class="td-mono">{v.tintPublished} / {v.tintZones}</td>
								<td>
									<div class="coverage-bar coverage-bar--tint" role="meter" aria-valuenow={v.tintPublished} aria-valuemax={v.tintZones} aria-label="Tint coverage">
										<div class="coverage-bar__fill" style="width: {v.tintZones > 0 ? Math.round((v.tintPublished / v.tintZones) * 100) : 0}%"></div>
									</div>
									<span class="coverage-pct">{v.tintZones > 0 ? Math.round((v.tintPublished / v.tintZones) * 100) : 0}%</span>
								</td>
							{/if}
							<td>
								<Badge
									variant={v.status === "published" ? "success" : v.status === "review" ? "warning" : "default"}
									size="sm"
									dot={v.status === "published"}
								>{v.status}</Badge>
							</td>
							<td class="td-date">{v.updatedAt}</td>
							<td class="td-actions">
								<div class="row-actions">
									<button class="row-btn" title="Edit patterns" aria-label="Edit {v.make} {v.model}" onclick={() => openEditPanel(v)}>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="row-btn" title="Publish / unpublish" aria-label="Toggle {v.make} {v.model}" onclick={() => patternStore.updateVehicle(v.id, { status: v.status === "published" ? "draft" : "published" })}>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									</button>
								</div>
							</td>
						</tr>
					{/each}
					{#if filteredVehicles.length === 0}
						<tr><td colspan="9" class="td-empty">No vehicles match your search.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Pattern Requests -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Pattern Requests</h2>
			<span class="section-sub">{patternStore.requests.filter((r) => r.status !== "done").length} pending</span>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Pattern requests">
				<thead>
					<tr>
						<th>Vehicle</th>
						<th>Notes</th>
						<th>Votes</th>
						<th>Requested</th>
						<th>Status</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each patternStore.requests as r (r.id)}
						<tr class:row-done={r.status === "done"}>
							<td class="td-vehicle">{r.vehicle}</td>
							<td class="td-notes">{r.notes || "—"}</td>
							<td>
								<div class="votes-cell">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"/></svg>
									{r.votes}
								</div>
							</td>
							<td class="td-date">{r.requestedAt}</td>
							<td>
								<Badge
									variant={r.status === "in-progress" ? "brand" : r.status === "done" ? "success" : "default"}
									size="sm"
									dot={r.status === "in-progress"}
								>{r.status}</Badge>
							</td>
							<td class="td-actions">
								{#if r.status !== "done"}
									<button class="action-btn" onclick={() => patternStore.advanceRequest(r.id)}>
										{r.status === "queued" ? "Start" : "Mark done"}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>

<!-- ─── Add Vehicle Modal ─────────────────────── -->
{#if showAddModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showAddModal = false)}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal__header">
				<h2 class="modal__title">Add Vehicle</h2>
				<button class="modal__close" onclick={() => (showAddModal = false)} aria-label="Close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>

			<form class="modal__body" onsubmit={(e) => { e.preventDefault(); handleAddVehicle(); }}>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="av-year">Year</label>
						<input id="av-year" type="number" class="form-input" bind:value={newVehicle.year} min="1990" max="2030" required />
					</div>
					<div class="form-group" style="flex:2">
						<label class="form-label" for="av-make">Make</label>
						<input id="av-make" type="text" class="form-input" bind:value={newVehicle.make} placeholder="e.g. Toyota" required />
					</div>
				</div>

				<div class="form-group">
					<label class="form-label" for="av-model">Model</label>
					<input id="av-model" type="text" class="form-input" bind:value={newVehicle.model} placeholder="e.g. GR86" required />
				</div>

				<div class="form-row">
					<div class="form-group">
						<label class="form-label" for="av-body">Body Style</label>
						<select id="av-body" class="form-input" bind:value={newVehicle.bodyStyle}>
							{#each ["sedan","coupe","suv","truck","hatchback","wagon","convertible"] as s}
								<option value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
							{/each}
						</select>
					</div>
					<div class="form-group">
						<label class="form-label" for="av-status">Status</label>
						<select id="av-status" class="form-input" bind:value={newVehicle.status}>
							<option value="draft">Draft</option>
							<option value="review">Review</option>
							<option value="published">Published</option>
						</select>
					</div>
				</div>

				<div class="modal__actions">
					<button type="button" class="btn-ghost" onclick={() => (showAddModal = false)}>Cancel</button>
					<button type="submit" class="btn-primary">Add Vehicle</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ─── Edit Patterns Panel ──────────────────── -->
{#if editingVehicle}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="panel-backdrop" onclick={closeEditPanel}></div>
	<aside class="edit-panel" role="dialog" aria-label="Edit patterns">
		<div class="edit-panel__header">
			<div>
				<div class="edit-panel__sub">Editing patterns</div>
				<h2 class="edit-panel__title">{editingVehicle.year} {editingVehicle.make} {editingVehicle.model}</h2>
			</div>
			<button class="modal__close" onclick={closeEditPanel} aria-label="Close panel">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<!-- Category tabs -->
		<div class="edit-panel__tabs">
			{#each ([["window-tint","Window Tint"],["ppf","PPF"]] as [PatternCategory, string][]) as [cat, label]}
				<button
					class="ep-tab"
					class:active={editPanelTab === cat}
					onclick={() => { editPanelTab = cat; showAddPattern = false; editPatternId = null; }}
				>
					{label}
					<span class="ep-tab__count">{patternStore.getPatterns(editingVehicle.id, cat).length}</span>
				</button>
			{/each}
		</div>

		<!-- Pattern list -->
		<div class="edit-panel__list">
			{#if panelPatterns.length === 0}
				<div class="ep-empty">
					No {editPanelTab === "ppf" ? "PPF" : "window tint"} patterns yet.
					<br>Click "Add pattern zone" below to get started.
				</div>
			{/if}

			{#each panelPatterns as pat (pat.id)}
				{#if editPatternId === pat.id}
					<!-- Inline edit row -->
					<div class="pattern-row pattern-row--editing">
						<div class="pattern-edit-form">
							<div class="form-row">
								<div class="form-group" style="flex:2">
									<label class="form-label">Name</label>
									<input type="text" class="form-input form-input--sm" bind:value={editPatch.name} />
								</div>
								<div class="form-group">
									<label class="form-label">W (in)</label>
									<input type="number" class="form-input form-input--sm" bind:value={editPatch.widthInches} min="0.5" step="0.5" />
								</div>
								<div class="form-group">
									<label class="form-label">H (in)</label>
									<input type="number" class="form-input form-input--sm" bind:value={editPatch.heightInches} min="0.5" step="0.5" />
								</div>
							</div>
							<div class="form-group">
								<label class="form-label">Notes (optional)</label>
								<input type="text" class="form-input form-input--sm" bind:value={editPatch.notes} placeholder="VLT guidance, legal notes…" />
							</div>
							<div class="pattern-edit-form__footer">
								<label class="toggle-label">
									<input type="checkbox" bind:checked={editPatch.isPublished} />
									Published
								</label>
								<div class="ep-row-actions">
									<button class="btn-ghost btn-ghost--sm" onclick={() => (editPatternId = null)}>Cancel</button>
									<button class="btn-primary btn-primary--sm" onclick={saveEditPattern}>Save</button>
								</div>
							</div>
						</div>
					</div>
				{:else}
					<div class="pattern-row">
						<div class="pattern-row__preview">
							<svg width="32" height="28" viewBox="0 0 100 100" fill="none" aria-hidden="true">
								<path
									d={pat.svgPath}
									fill={editPanelTab === "window-tint" ? "rgba(0,112,255,0.08)" : "rgba(0,229,255,0.06)"}
									stroke={editPanelTab === "window-tint" ? "var(--color-brand-dim)" : "var(--color-brand)"}
									stroke-width="3"
									stroke-linecap="round"
								/>
							</svg>
						</div>
						<div class="pattern-row__info">
							<div class="pattern-row__name">{pat.name}</div>
							<div class="pattern-row__meta">{pat.widthInches}" × {pat.heightInches}" · {pat.zone}</div>
						</div>
						<div class="ep-row-right">
							<button
								class="ep-toggle"
								class:ep-toggle--on={pat.isPublished}
								onclick={() => patternStore.updatePattern(pat.id, { isPublished: !pat.isPublished })}
								title={pat.isPublished ? "Unpublish" : "Publish"}
								aria-label={pat.isPublished ? "Unpublish" : "Publish"}
							>
								<span class="ep-toggle__dot"></span>
							</button>
							<button class="row-btn" title="Edit" onclick={() => startEditPattern(pat.id)}>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
							</button>
							<button class="row-btn row-btn--danger" title="Delete" onclick={() => patternStore.deletePattern(pat.id)}>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<!-- Add Pattern form -->
		<div class="edit-panel__footer">
			{#if !showAddPattern}
				<button class="ep-add-btn" onclick={() => { showAddPattern = true; editPatternId = null; }}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
					Add pattern zone
				</button>
			{:else}
				<div class="ep-add-form">
					<div class="ep-add-form__title">New {editPanelTab === "ppf" ? "PPF" : "Tint"} Pattern</div>

					<div class="form-row">
						<div class="form-group" style="flex:2">
							<label class="form-label">Zone</label>
							<select class="form-input form-input--sm" bind:value={newPattern.zone}>
								{#each zoneOptions as z}
									<option value={z.value}>{z.label}</option>
								{/each}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label">Coverage</label>
							<select class="form-input form-input--sm" bind:value={newPattern.coverage}>
								<option value="full">Full</option>
								<option value="partial">Partial</option>
								<option value="edge-only">Edge only</option>
							</select>
						</div>
					</div>

					<div class="form-group">
						<label class="form-label">Pattern Name</label>
						<input type="text" class="form-input form-input--sm" bind:value={newPattern.name} placeholder="e.g. Front Driver Window" required />
					</div>

					<div class="form-row">
						<div class="form-group">
							<label class="form-label">Width (in)</label>
							<input type="number" class="form-input form-input--sm" bind:value={newPattern.widthInches} min="0.5" step="0.5" />
						</div>
						<div class="form-group">
							<label class="form-label">Height (in)</label>
							<input type="number" class="form-input form-input--sm" bind:value={newPattern.heightInches} min="0.5" step="0.5" />
						</div>
					</div>

					<div class="form-group">
						<label class="form-label">SVG Path <span class="form-label__opt">(optional — uses rect fallback)</span></label>
						<input type="text" class="form-input form-input--sm" bind:value={newPattern.svgPath} placeholder="M10,90 Q50,5 90,90 Z" />
					</div>

					<div class="form-group">
						<label class="form-label">Notes <span class="form-label__opt">(VLT guidance, legal info…)</span></label>
						<input type="text" class="form-input form-input--sm" bind:value={newPattern.notes} placeholder="Optional notes" />
					</div>

					<div class="ep-add-form__footer">
						<label class="toggle-label">
							<input type="checkbox" bind:checked={newPattern.isPublished} />
							Publish immediately
						</label>
						<div class="ep-row-actions">
							<button class="btn-ghost btn-ghost--sm" onclick={() => (showAddPattern = false)}>Cancel</button>
							<button class="btn-primary btn-primary--sm" onclick={handleAddPattern}>Add Pattern</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.patterns-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1100px;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.page-title { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub   { font-size: 0.875rem; color: var(--text-secondary); }
	.page-header__actions { display: flex; align-items: center; gap: 8px; }

	.summary-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.summary-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
	}

	.summary-card__label {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: var(--font-mono);
		margin-bottom: 6px;
	}

	.summary-card__value {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
	}

	.summary-card__sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
		margin-top: 2px;
	}

	.section {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-subtle);
		flex-wrap: wrap;
		gap: 10px;
	}

	.section-title { font-size: 0.9375rem; font-weight: 600; }
	.section-sub   { font-size: 0.8125rem; color: var(--text-tertiary); font-family: var(--font-mono); }

	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.category-tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 2px;
	}

	.status-tabs { display: flex; gap: 2px; }

	.status-tab {
		padding: 5px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.status-tab:hover  { color: var(--text-primary); background: var(--interactive-hover); }
	.status-tab.active { color: var(--text-primary); background: var(--bg-surface-3); border-color: var(--border-default); }

	.search-wrap { position: relative; }
	.search-icon {
		position: absolute;
		left: 8px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}
	.search-input {
		width: 220px;
		padding: 6px 10px 6px 28px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.search-input:focus { border-color: var(--color-brand-dim); }
	.search-input::placeholder { color: var(--text-tertiary); }

	.table-wrap { overflow-x: auto; }

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 640px;
	}

	.data-table thead { background: var(--bg-surface-2); }

	.data-table th {
		padding: 9px 14px;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
		border-bottom: 1px solid var(--border-subtle);
	}

	.data-table tbody tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.data-table tbody tr:last-child { border-bottom: none; }
	.data-table tbody tr:hover { background: var(--interactive-hover); }

	.data-table td { padding: 10px 14px; vertical-align: middle; }

	.th-actions { width: 80px; }

	.vehicle-cell { display: flex; align-items: center; gap: 9px; }

	.vehicle-icon {
		width: 30px;
		height: 30px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.vehicle-name { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }

	.coverage-bar {
		display: inline-block;
		width: 64px;
		height: 4px;
		background: var(--bg-surface-3);
		border-radius: 2px;
		overflow: hidden;
		vertical-align: middle;
		margin-right: 6px;
	}
	.coverage-bar__fill {
		height: 100%;
		background: var(--color-success);
		border-radius: 2px;
		transition: width 0.3s;
	}
	.coverage-bar--tint .coverage-bar__fill { background: var(--color-brand-dim); }
	.coverage-pct { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); vertical-align: middle; }

	.td-mono    { font-family: var(--font-mono); font-size: 0.8125rem; }
	.td-date    { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.td-vehicle { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); }
	.td-notes   { font-size: 0.75rem; color: var(--text-tertiary); max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.td-empty   { text-align: center; padding: 40px; color: var(--text-tertiary); }

	.votes-cell {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.row-done { opacity: 0.45; }

	.row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; }
	tr:hover .row-actions { opacity: 1; }

	.row-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.row-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.row-btn--danger:hover { background: var(--color-error); color: #fff; border-color: transparent; }

	.action-btn {
		padding: 4px 10px;
		font-size: 0.75rem;
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
	.action-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.td-actions { width: 100px; }

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
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.modal__title { font-size: 1.0625rem; font-weight: 600; }

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

	/* ─── Shared form styles ───── */
	.form-row { display: flex; gap: 10px; }

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
		flex: 1;
	}

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
	.form-input--sm { padding: 5px 8px; font-size: 0.75rem; }

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
	.btn-primary--sm { padding: 5px 12px; font-size: 0.75rem; }

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
	.btn-ghost--sm { padding: 5px 12px; font-size: 0.75rem; }

	.toggle-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		cursor: pointer;
	}

	/* ─── Edit Panel ───── */
	.panel-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		z-index: 99;
	}

	.edit-panel {
		position: fixed;
		top: 0;
		right: 0;
		height: 100vh;
		width: 480px;
		max-width: 95vw;
		background: var(--bg-surface);
		border-left: 1px solid var(--border-default);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.2);
		z-index: 100;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: ep-slide-in 0.2s ease;
	}

	@keyframes ep-slide-in {
		from { transform: translateX(100%); }
		to   { transform: translateX(0); }
	}

	.edit-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 18px 20px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.edit-panel__sub {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 3px;
	}
	.edit-panel__title { font-size: 1rem; font-weight: 600; }

	.edit-panel__tabs {
		display: flex;
		gap: 0;
		padding: 12px 20px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.ep-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}
	.ep-tab:first-child { border-radius: var(--radius-md) 0 0 var(--radius-md); }
	.ep-tab:last-child  { border-radius: 0 var(--radius-md) var(--radius-md) 0; border-left: none; }
	.ep-tab:hover { color: var(--text-primary); background: var(--bg-surface-2); }
	.ep-tab.active { background: var(--bg-surface-3); color: var(--text-primary); border-color: var(--border-default); }

	.ep-tab__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		background: var(--bg-surface-2);
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
	}
	.ep-tab.active .ep-tab__count {
		background: var(--color-brand-dim);
		color: #fff;
	}

	.edit-panel__list {
		flex: 1;
		overflow-y: auto;
		padding: 12px 0;
	}

	.ep-empty {
		text-align: center;
		padding: 32px 24px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		line-height: 1.6;
	}

	.pattern-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 20px;
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.pattern-row:last-child { border-bottom: none; }
	.pattern-row:hover { background: var(--interactive-hover); }
	.pattern-row--editing { align-items: flex-start; background: var(--bg-surface-2); }

	.pattern-row__preview {
		width: 44px;
		height: 38px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface-2);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.pattern-row__info { flex: 1; min-width: 0; }
	.pattern-row__name { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pattern-row__meta { font-size: 0.6875rem; font-family: var(--font-mono); color: var(--text-tertiary); margin-top: 2px; }

	.ep-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

	.ep-toggle {
		width: 32px;
		height: 18px;
		border-radius: 9px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		cursor: pointer;
		position: relative;
		transition: background 0.15s, border-color 0.15s;
		flex-shrink: 0;
	}
	.ep-toggle--on { background: var(--color-success); border-color: var(--color-success); }

	.ep-toggle__dot {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s;
		display: block;
	}
	.ep-toggle--on .ep-toggle__dot { transform: translateX(14px); }

	.pattern-edit-form { flex: 1; display: flex; flex-direction: column; gap: 10px; }
	.pattern-edit-form__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.ep-row-actions { display: flex; gap: 6px; }

	.edit-panel__footer {
		border-top: 1px solid var(--border-subtle);
		padding: 14px 20px;
		flex-shrink: 0;
	}

	.ep-add-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		justify-content: center;
		transition: all 0.12s;
	}
	.ep-add-btn:hover { border-color: var(--color-brand-dim); color: var(--text-brand); }

	.ep-add-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.ep-add-form__title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 2px;
	}

	.ep-add-form__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 4px;
	}

	@media (max-width: 1024px) {
		.summary-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
