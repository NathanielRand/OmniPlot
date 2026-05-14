<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";

	type JobStatus = "completed" | "failed" | "pending" | "cutting";

	interface Job {
		id: string;
		name: string;
		vehicle: string;
		zones: string[];
		status: JobStatus;
		pieces: number;
		material: string;
		efficiency: number;
		cutTimeSecs: number;
		createdAt: Date;
		plotterName: string;
		exportFormat: string;
	}

	const MOCK_JOBS: Job[] = [
		{
			id: "j1",
			name: "BMW M4 Full Front",
			vehicle: "2024 BMW M4",
			zones: ["Hood", "Front Bumper", "Fender FL", "Fender FR"],
			status: "completed",
			pieces: 5,
			material: "STEK DYNOShield",
			efficiency: 0.78,
			cutTimeSecs: 382,
			createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
			plotterName: "Roland GX-500",
			exportFormat: "hpgl",
		},
		{
			id: "j2",
			name: "Tesla Model 3 Hood",
			vehicle: "2024 Tesla Model 3",
			zones: ["Hood", "Hood Edges"],
			status: "completed",
			pieces: 3,
			material: "XPEL Ultimate Plus",
			efficiency: 0.71,
			cutTimeSecs: 210,
			createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
			plotterName: "Graphtec CE7000",
			exportFormat: "hpgl",
		},
		{
			id: "j3",
			name: "Porsche 911 Full Kit",
			vehicle: "2024 Porsche 911 GT3",
			zones: [
				"Hood",
				"Front Bumper",
				"Fender FL",
				"Fender FR",
				"Mirror L",
				"Mirror R",
				"Rocker L",
				"Rocker R",
			],
			status: "completed",
			pieces: 10,
			material: "STEK DYNOShield",
			efficiency: 0.83,
			cutTimeSecs: 741,
			createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
			plotterName: "Roland GX-500",
			exportFormat: "hpgl",
		},
		{
			id: "j4",
			name: "Mercedes G63 Mirrors",
			vehicle: "2024 Mercedes G 63",
			zones: ["Mirror L", "Mirror R"],
			status: "failed",
			pieces: 2,
			material: "LLumar Platinum",
			efficiency: 0.44,
			cutTimeSecs: 0,
			createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
			plotterName: "USCutter MH",
			exportFormat: "hpgl",
		},
		{
			id: "j5",
			name: "Ford F-150 Rockers",
			vehicle: "2024 Ford F-150",
			zones: ["Rocker L", "Rocker R"],
			status: "completed",
			pieces: 2,
			material: "STEK DYNOShield",
			efficiency: 0.68,
			cutTimeSecs: 195,
			createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
			plotterName: "VEVOR Vinyl Cutter",
			exportFormat: "svg",
		},
		{
			id: "j6",
			name: "Audi RS6 Doors",
			vehicle: "2024 Audi RS6 Avant",
			zones: ["Door FL", "Door FR"],
			status: "pending",
			pieces: 2,
			material: "3M Scotchgard Pro",
			efficiency: 0.0,
			cutTimeSecs: 0,
			createdAt: new Date(Date.now() - 5 * 60 * 1000),
			plotterName: "—",
			exportFormat: "hpgl",
		},
	];

	let search = $state("");
	let filterStatus = $state<"all" | JobStatus>("all");
	let selected = $state<Set<string>>(new Set());

	const filtered = $derived(
		MOCK_JOBS.filter((j) => {
			const q = search.toLowerCase();
			const mq =
				!q ||
				j.name.toLowerCase().includes(q) ||
				j.vehicle.toLowerCase().includes(q);
			const ms = filterStatus === "all" || j.status === filterStatus;
			return mq && ms;
		}),
	);

	function toggleSelect(id: string) {
		const s = new Set(selected);
		s.has(id) ? s.delete(id) : s.add(id);
		selected = s;
	}

	function selectAll() {
		selected = new Set(filtered.map((j) => j.id));
	}

	function clearSelection() {
		selected = new Set();
	}

	function fmtTime(s: number) {
		if (!s) return "—";
		const m = Math.floor(s / 60);
		return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
	}

	function fmtEff(e: number) {
		return e ? `${(e * 100).toFixed(0)}%` : "—";
	}

	const STATUS_VARIANT: Record<
		JobStatus,
		"success" | "danger" | "warning" | "info"
	> = {
		completed: "success",
		failed: "danger",
		pending: "warning",
		cutting: "info",
	};

	// Summary stats
	const stats = $derived({
		total: MOCK_JOBS.length,
		completed: MOCK_JOBS.filter((j) => j.status === "completed").length,
		failed: MOCK_JOBS.filter((j) => j.status === "failed").length,
		avgEff: (
			(MOCK_JOBS.filter((j) => j.efficiency).reduce(
				(s, j) => s + j.efficiency,
				0,
			) /
				MOCK_JOBS.filter((j) => j.efficiency).length) *
			100
		).toFixed(0),
	});
</script>

<svelte:head>
	<title>Jobs — OmniPlot</title>
</svelte:head>

<div class="jobs-page">
	<!-- ─── Page header ─── -->
	<div class="jobs-header">
		<div>
			<h1 class="jobs-title">Cut Jobs</h1>
			<p class="jobs-sub">Your cut history and queued jobs</p>
		</div>
		<Button variant="primary" size="sm" href="/studio">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg
			>
			New Job
		</Button>
	</div>

	<!-- ─── Stats ─── -->
	<div class="jobs-stats">
		{#each [["Total Jobs", stats.total.toString(), ""], ["Completed", stats.completed.toString(), "success"], ["Failed", stats.failed.toString(), "danger"], ["Avg Efficiency", stats.avgEff + "%", "brand"]] as [label, val, cls]}
			<div class="stat-card">
				<span
					class="stat-card__val"
					class:text-success={cls === "success"}
					class:text-danger={cls === "danger"}
					class:text-brand={cls === "brand"}>{val}</span
				>
				<span class="stat-card__label">{label}</span>
			</div>
		{/each}
	</div>

	<!-- ─── Toolbar ─── -->
	<div class="jobs-toolbar">
		<div class="search-wrap">
			<svg
				class="search-icon"
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
				class="search-input"
				placeholder="Search jobs…"
				bind:value={search}
				aria-label="Search jobs"
			/>
		</div>

		<div class="status-filters" role="group" aria-label="Filter by status">
			{#each ["all", "completed", "failed", "pending"] as const as s}
				<button
					class="status-filter"
					class:active={filterStatus === s}
					onclick={() => (filterStatus = s)}
					aria-pressed={filterStatus === s}
					>{s.charAt(0).toUpperCase() + s.slice(1)}</button
				>
			{/each}
		</div>

		{#if selected.size > 0}
			<div class="bulk-actions">
				<span class="bulk-label">{selected.size} selected</span>
				<button class="bulk-btn" onclick={clearSelection}>Clear</button>
				<button class="bulk-btn bulk-btn--danger">
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
						><polyline points="3 6 5 6 21 6" /><path
							d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"
						/></svg
					>
					Delete
				</button>
			</div>
		{/if}
	</div>

	<!-- ─── Table ─── -->
	<div class="jobs-table-wrap">
		<table class="jobs-table" aria-label="Cut jobs">
			<thead>
				<tr>
					<th class="th-check">
						<input
							type="checkbox"
							class="row-check"
							onchange={(e) =>
								(e.target as HTMLInputElement).checked
									? selectAll()
									: clearSelection()}
							aria-label="Select all"
						/>
					</th>
					<th>Job</th>
					<th>Vehicle</th>
					<th>Status</th>
					<th>Pieces</th>
					<th>Material</th>
					<th>Efficiency</th>
					<th>Cut Time</th>
					<th>Created</th>
					<th class="th-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as job (job.id)}
					<tr
						class:row-selected={selected.has(job.id)}
						onclick={() => toggleSelect(job.id)}
					>
						<td class="td-check">
							<input
								type="checkbox"
								class="row-check"
								checked={selected.has(job.id)}
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleSelect(job.id)}
								aria-label="Select {job.name}"
							/>
						</td>
						<td class="td-name">
							<div class="job-name">{job.name}</div>
							<div class="job-zones">
								{job.zones.slice(0, 3).join(", ")}{job.zones
									.length > 3
									? ` +${job.zones.length - 3}`
									: ""}
							</div>
						</td>
						<td class="td-vehicle">{job.vehicle}</td>
						<td>
							<Badge variant={STATUS_VARIANT[job.status]} dot>
								{job.status.charAt(0).toUpperCase() +
									job.status.slice(1)}
							</Badge>
						</td>
						<td class="td-mono">{job.pieces}</td>
						<td class="td-material">{job.material}</td>
						<td
							class="td-mono"
							class:text-success={job.efficiency > 0.7}
							class:text-warning={job.efficiency > 0 &&
								job.efficiency <= 0.7}
						>
							{fmtEff(job.efficiency)}
						</td>
						<td class="td-mono">{fmtTime(job.cutTimeSecs)}</td>
						<td class="td-date" title={formatDate(job.createdAt)}
							>{formatRelativeTime(job.createdAt)}</td
						>
						<td
							class="td-actions"
							onclick={(e) => e.stopPropagation()}
						>
							<div class="row-actions">
								<button
									class="row-action-btn"
									title="Recut"
									aria-label="Recut {job.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><circle cx="6" cy="6" r="3" /><circle
											cx="6"
											cy="18"
											r="3"
										/><path
											d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"
										/></svg
									>
								</button>
								<button
									class="row-action-btn"
									title="Download PLT"
									aria-label="Download {job.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><path
											d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
										/></svg
									>
								</button>
								<button
									class="row-action-btn row-action-btn--danger"
									title="Delete"
									aria-label="Delete {job.name}"
								>
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										aria-hidden="true"
										><polyline points="3 6 5 6 21 6" /><path
											d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"
										/></svg
									>
								</button>
							</div>
						</td>
					</tr>
				{/each}

				{#if filtered.length === 0}
					<tr>
						<td colspan="10" class="td-empty">
							No jobs match your filters.
							<button
								class="link-btn"
								onclick={() => {
									search = "";
									filterStatus = "all";
								}}>Clear filters</button
							>
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>

<style>
	.jobs-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		overflow-y: auto;
		height: 100%;
	}

	.jobs-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.jobs-title {
		font-size: 1.375rem;
		margin-bottom: 3px;
	}
	.jobs-sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	/* Stats */
	.jobs-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
	}

	.stat-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-card__val {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--text-primary);
	}
	.stat-card__label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.text-success {
		color: var(--color-success) !important;
	}
	.text-danger {
		color: var(--color-danger) !important;
	}
	.text-brand {
		color: var(--color-brand) !important;
	}
	.text-warning {
		color: var(--color-warning) !important;
	}

	/* Toolbar */
	.jobs-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 180px;
		max-width: 300px;
	}
	.search-icon {
		position: absolute;
		left: 9px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 7px 10px 7px 30px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}
	.search-input:focus {
		border-color: var(--color-brand-dim);
	}
	.search-input::placeholder {
		color: var(--text-tertiary);
	}

	.status-filters {
		display: flex;
		gap: 2px;
	}

	.status-filter {
		padding: 5px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.12s;
	}

	.status-filter:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
	.status-filter.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
		border-color: var(--border-default);
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}
	.bulk-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.bulk-btn {
		padding: 5px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.12s;
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.bulk-btn:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.bulk-btn--danger {
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}
	.bulk-btn--danger:hover {
		background: rgba(255, 77, 109, 0.08);
	}

	/* Table */
	.jobs-table-wrap {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
		overflow-x: auto;
	}

	.jobs-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 860px;
	}

	.jobs-table thead {
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}

	.jobs-table th {
		padding: 10px 14px;
		text-align: left;
		font-size: 0.6875rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	.jobs-table tbody tr {
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.1s;
		cursor: pointer;
	}

	.jobs-table tbody tr:last-child {
		border-bottom: none;
	}
	.jobs-table tbody tr:hover {
		background: var(--interactive-hover);
	}
	.row-selected {
		background: rgba(0, 112, 255, 0.04) !important;
	}

	.jobs-table td {
		padding: 12px 14px;
		color: var(--text-primary);
		vertical-align: middle;
	}

	.th-check,
	.td-check {
		width: 40px;
		padding-left: 16px;
	}
	.th-actions,
	.td-actions {
		width: 110px;
	}

	.row-check {
		accent-color: var(--color-brand-dim);
		width: 14px;
		height: 14px;
		cursor: pointer;
	}

	.td-name {
		min-width: 180px;
	}
	.job-name {
		font-weight: 500;
		color: var(--text-primary);
	}
	.job-zones {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.td-vehicle {
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.td-mono {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}
	.td-material {
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.td-date {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.row-actions {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.12s;
	}
	tr:hover .row-actions {
		opacity: 1;
	}

	.row-action-btn {
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

	.row-action-btn:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}
	.row-action-btn--danger:hover {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}

	.td-empty {
		text-align: center;
		padding: 40px;
		color: var(--text-tertiary);
	}

	.link-btn {
		background: none;
		border: none;
		color: var(--text-brand);
		cursor: pointer;
		font-size: inherit;
		font-family: inherit;
		text-decoration: underline;
		margin-left: 4px;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.jobs-page {
			padding: 16px;
		}
		.jobs-stats {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
