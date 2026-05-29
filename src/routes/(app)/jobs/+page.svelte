<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";
	import { cutJobStore } from "$lib/stores";
	import type { JobStatus } from "$lib/types";

	let search = $state("");
	let filterStatus = $state<"all" | JobStatus>("all");
	let selected = $state<Set<string>>(new Set());

	const jobs    = $derived(cutJobStore.jobs);
	const loading = $derived(cutJobStore.loading);
	const error   = $derived(cutJobStore.error);

	const filtered = $derived(
		jobs.filter((j) => {
			const q = search.toLowerCase();
			const mq = !q || j.name.toLowerCase().includes(q) || j.vehicleId.toLowerCase().includes(q);
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

	const STATUS_VARIANT: Record<JobStatus, "success" | "danger" | "warning" | "info" | "default"> = {
		complete: "success",
		error: "danger",
		cutting: "info",
		ready: "warning",
		draft: "default",
	};

	const STATUS_LABEL: Record<JobStatus, string> = {
		complete: "Complete",
		error: "Error",
		cutting: "Cutting",
		ready: "Ready",
		draft: "Draft",
	};

	const stats = $derived({
		total: jobs.length,
		completed: jobs.filter((j) => j.status === "complete").length,
		failed: jobs.filter((j) => j.status === "error").length,
		avgEff: (() => {
			const withEff = jobs.filter((j) => j.metrics?.materialEfficiency);
			if (!withEff.length) return "—";
			const avg = withEff.reduce((s, j) => s + j.metrics.materialEfficiency, 0) / withEff.length;
			return `${(avg * 100).toFixed(0)}%`;
		})(),
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
		{#each [["Total Jobs", loading ? "…" : stats.total.toString(), ""], ["Completed", loading ? "…" : stats.completed.toString(), "success"], ["Failed", loading ? "…" : stats.failed.toString(), "danger"], ["Avg Efficiency", loading ? "…" : stats.avgEff, "brand"]] as [label, val, cls]}
			<div class="stat-card" class:shimmer={loading}>
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
			{#each [["all","All"],["complete","Complete"],["error","Error"],["cutting","Cutting"],["ready","Ready"],["draft","Draft"]] as [val, label]}
				<button
					class="status-filter"
					class:active={filterStatus === val}
					onclick={() => (filterStatus = val as any)}
					aria-pressed={filterStatus === val}
					>{label}</button
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

	<!-- ─── Error ─── -->
	{#if error}
		<div class="jobs-error">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
			{error}
			<button class="link-btn" onclick={() => location.reload()}>Retry</button>
		</div>
	{/if}

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
					<th>Material</th>
					<th>Status</th>
					<th>Pieces</th>
					<th>Efficiency</th>
					<th>Cut Time</th>
					<th>Created</th>
					<th class="th-actions"></th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: 5 } as _}
						<tr class="shimmer-row">
							<td class="td-check"><div class="skel skel-check"></div></td>
							<td class="td-name"><div class="skel skel-name"></div><div class="skel skel-sub"></div></td>
							<td><div class="skel skel-md"></div></td>
							<td><div class="skel skel-sm"></div></td>
							<td><div class="skel skel-xs"></div></td>
							<td><div class="skel skel-xs"></div></td>
							<td><div class="skel skel-sm"></div></td>
							<td><div class="skel skel-sm"></div></td>
							<td></td>
						</tr>
					{/each}
				{:else}
					{#each filtered as job (job.id)}
						{@const eff = job.metrics?.materialEfficiency ?? 0}
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
								<div class="job-zones">{job.vehicleId}</div>
							</td>
							<td class="td-material">
								{job.materialSheet?.name ?? job.canvasState?.sheet?.name ?? "—"}
							</td>
							<td>
								<Badge variant={STATUS_VARIANT[job.status] as any} dot>
									{STATUS_LABEL[job.status]}
								</Badge>
							</td>
							<td class="td-mono">{job.metrics?.itemCount ?? "—"}</td>
							<td
								class="td-mono"
								class:text-success={eff > 0.7}
								class:text-warning={eff > 0 && eff <= 0.7}
							>
								{fmtEff(eff)}
							</td>
							<td class="td-mono">{fmtTime(job.metrics?.estimatedCutSeconds ?? 0)}</td>
							<td class="td-date" title={formatDate(job.createdAt)}
								>{formatRelativeTime(job.createdAt)}</td
							>
							<td
								class="td-actions"
								onclick={(e) => e.stopPropagation()}
							>
								<div class="row-actions">
									{#if job.exportUrl}
										<a
											class="row-action-btn"
											href={job.exportUrl}
											download
											title="Download"
											aria-label="Download {job.name}"
										>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
										</a>
									{/if}
									<button
										class="row-action-btn row-action-btn--danger"
										title="Delete"
										aria-label="Delete {job.name}"
									>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
									</button>
								</div>
							</td>
						</tr>
					{/each}

					{#if !loading && jobs.length === 0}
						<tr>
							<td colspan="9" class="td-empty">
								<div class="empty-state">
									<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6a3 3 0 100-6 3 3 0 000 6zM6 18a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
									<p>No cut jobs yet.</p>
									<Button variant="primary" size="sm" href="/studio">Start a new job</Button>
								</div>
							</td>
						</tr>
					{:else if !loading && filtered.length === 0}
						<tr>
							<td colspan="9" class="td-empty">
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

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--text-tertiary);
	}
	.empty-state p { margin: 0; font-size: 0.875rem; }

	.jobs-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: rgba(255, 77, 109, 0.07);
		border: 1px solid rgba(255, 77, 109, 0.2);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	/* Shimmer skeleton */
	@keyframes shimmer {
		from { background-position: -200% 0; }
		to { background-position: 200% 0; }
	}

	.skel {
		border-radius: 4px;
		background: linear-gradient(90deg, var(--bg-surface-3) 25%, var(--bg-surface-2) 50%, var(--bg-surface-3) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease infinite;
	}
	.skel-check { width: 14px; height: 14px; }
	.skel-name { width: 140px; height: 13px; margin-bottom: 5px; }
	.skel-sub { width: 80px; height: 10px; }
	.skel-md { width: 100px; height: 13px; }
	.skel-sm { width: 70px; height: 13px; }
	.skel-xs { width: 40px; height: 13px; }
	.shimmer-row td { padding-top: 14px; padding-bottom: 14px; }

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
