<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";

	type PatternStatus = "published" | "draft" | "review";
	type RequestStatus = "queued" | "in-progress" | "done";

	interface VehicleRow {
		id: string;
		make: string;
		model: string;
		year: number;
		patterns: number;
		published: number;
		status: PatternStatus;
		updatedAt: string;
	}

	interface PatternRequest {
		id: string;
		vehicle: string;
		votes: number;
		status: RequestStatus;
		requestedAt: string;
	}

	const VEHICLES: VehicleRow[] = [
		{ id: "v1", make: "BMW", model: "M4", year: 2024, patterns: 18, published: 18, status: "published", updatedAt: "2024-11-12" },
		{ id: "v2", make: "Tesla", model: "Model 3", year: 2024, patterns: 14, published: 14, status: "published", updatedAt: "2024-11-08" },
		{ id: "v3", make: "Porsche", model: "911 GT3", year: 2024, patterns: 22, published: 20, status: "published", updatedAt: "2024-10-31" },
		{ id: "v4", make: "Mercedes", model: "G63 AMG", year: 2024, patterns: 16, published: 12, status: "review", updatedAt: "2024-12-02" },
		{ id: "v5", make: "Ford", model: "F-150", year: 2024, patterns: 10, published: 10, status: "published", updatedAt: "2024-10-14" },
		{ id: "v6", make: "Lamborghini", model: "Urus", year: 2024, patterns: 8, published: 0, status: "draft", updatedAt: "2024-12-10" },
		{ id: "v7", make: "Toyota", model: "GR86", year: 2024, patterns: 12, published: 12, status: "published", updatedAt: "2024-09-22" },
		{ id: "v8", make: "BMW", model: "M5", year: 2025, patterns: 4, published: 0, status: "draft", updatedAt: "2024-12-14" },
		{ id: "v9", make: "Audi", model: "RS6", year: 2024, patterns: 15, published: 15, status: "published", updatedAt: "2024-11-01" },
		{ id: "v10", make: "Chevrolet", model: "Corvette Z06", year: 2024, patterns: 11, published: 11, status: "published", updatedAt: "2024-10-05" },
	];

	const REQUESTS: PatternRequest[] = [
		{ id: "r1", vehicle: "2025 BMW M5", votes: 34, status: "in-progress", requestedAt: "2024-11-20" },
		{ id: "r2", vehicle: "2025 Mercedes CLE", votes: 28, status: "queued", requestedAt: "2024-11-22" },
		{ id: "r3", vehicle: "2025 Tesla Model Y", votes: 22, status: "queued", requestedAt: "2024-11-25" },
		{ id: "r4", vehicle: "2024 Lamborghini Urus", votes: 18, status: "queued", requestedAt: "2024-12-01" },
		{ id: "r5", vehicle: "2024 Rivian R1T", votes: 14, status: "queued", requestedAt: "2024-12-03" },
		{ id: "r6", vehicle: "2025 Ford Mustang GT500", votes: 11, status: "queued", requestedAt: "2024-12-05" },
	];

	let search = $state("");
	let filterStatus = $state<"all" | PatternStatus>("all");
	let requests = $state(REQUESTS);

	const filtered = $derived(
		VEHICLES.filter((v) => {
			const q = search.toLowerCase();
			const mq = !q || `${v.make} ${v.model} ${v.year}`.toLowerCase().includes(q);
			const ms = filterStatus === "all" || v.status === filterStatus;
			return mq && ms;
		})
	);

	const totals = $derived({
		vehicles: VEHICLES.length,
		patterns: VEHICLES.reduce((s, v) => s + v.patterns, 0),
		published: VEHICLES.reduce((s, v) => s + v.published, 0),
		drafts: VEHICLES.filter((v) => v.status === "draft").length,
	});

	function advanceRequest(id: string) {
		requests = requests.map((r) => {
			if (r.id !== id) return r;
			if (r.status === "queued") return { ...r, status: "in-progress" };
			if (r.status === "in-progress") return { ...r, status: "done" };
			return r;
		});
	}
</script>

<svelte:head><title>Patterns — Admin — OmniPlot</title></svelte:head>

<div class="patterns-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Patterns</h1>
			<p class="page-sub">Manage vehicle templates and pattern requests.</p>
		</div>
		<Button variant="primary" size="sm">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			Add vehicle
		</Button>
	</div>

	<!-- Summary cards -->
	<div class="summary-row">
		{#each [
			{ label: "Total vehicles", value: totals.vehicles },
			{ label: "Total patterns", value: totals.patterns },
			{ label: "Published", value: totals.published },
			{ label: "Drafts / review", value: totals.drafts },
		] as s}
			<div class="summary-card">
				<div class="summary-card__label">{s.label}</div>
				<div class="summary-card__value">{s.value}</div>
			</div>
		{/each}
	</div>

	<!-- Vehicles table -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Vehicles</h2>

			<div class="toolbar">
				<div class="status-tabs" role="tablist">
					{#each (["all", "published", "review", "draft"] as const) as t}
						<button
							class="status-tab"
							class:active={filterStatus === t}
							onclick={() => (filterStatus = t)}
							role="tab"
							aria-selected={filterStatus === t}
						>
							{t.charAt(0).toUpperCase() + t.slice(1)}
						</button>
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
						<th>Patterns</th>
						<th>Published</th>
						<th>Coverage</th>
						<th>Status</th>
						<th>Updated</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as v (v.id)}
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
							<td class="td-mono">{v.patterns}</td>
							<td class="td-mono">{v.published}</td>
							<td>
								<div class="coverage-bar" role="meter" aria-valuenow={v.published} aria-valuemax={v.patterns} aria-label="Coverage">
									<div class="coverage-bar__fill" style="width: {v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%"></div>
								</div>
								<span class="coverage-pct">{v.patterns > 0 ? Math.round((v.published / v.patterns) * 100) : 0}%</span>
							</td>
							<td>
								<Badge
									variant={v.status === "published" ? "success" : v.status === "review" ? "warning" : "default"}
									size="sm"
									dot={v.status === "published"}
								>
									{v.status}
								</Badge>
							</td>
							<td class="td-date">{v.updatedAt}</td>
							<td class="td-actions">
								<div class="row-actions">
									<button class="row-btn" title="Edit patterns" aria-label="Edit {v.make} {v.model}">
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
									</button>
									<button class="row-btn" title="View patterns" aria-label="View {v.make} {v.model}">
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									</button>
								</div>
							</td>
						</tr>
					{/each}
					{#if filtered.length === 0}
						<tr><td colspan="7" class="td-empty">No vehicles match your search.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Pattern requests -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Pattern Requests</h2>
			<span class="section-sub">{requests.filter(r => r.status !== "done").length} pending</span>
		</div>

		<div class="table-wrap">
			<table class="data-table" aria-label="Pattern requests">
				<thead>
					<tr>
						<th>Vehicle</th>
						<th>Votes</th>
						<th>Requested</th>
						<th>Status</th>
						<th class="th-actions"></th>
					</tr>
				</thead>
				<tbody>
					{#each requests as r (r.id)}
						<tr class:row-done={r.status === "done"}>
							<td class="td-vehicle">{r.vehicle}</td>
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
								>
									{r.status}
								</Badge>
							</td>
							<td class="td-actions">
								{#if r.status !== "done"}
									<button class="action-btn" onclick={() => advanceRequest(r.id)}>
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

	.section-title {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.section-sub {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.status-tabs {
		display: flex;
		gap: 2px;
	}

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

	.search-wrap {
		position: relative;
	}
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

	.table-wrap {
		overflow-x: auto;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 640px;
	}

	.data-table thead {
		background: var(--bg-surface-2);
	}

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

	.data-table td {
		padding: 10px 14px;
		vertical-align: middle;
	}

	.th-actions { width: 80px; }

	.vehicle-cell {
		display: flex;
		align-items: center;
		gap: 9px;
	}

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

	.vehicle-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
	}

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
	.coverage-pct {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
		vertical-align: middle;
	}

	.td-mono  { font-family: var(--font-mono); font-size: 0.8125rem; }
	.td-date  { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.td-vehicle { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); }
	.td-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }

	.votes-cell {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.row-done { opacity: 0.45; }

	.row-actions {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.12s;
	}
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

	@media (max-width: 1024px) {
		.summary-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
