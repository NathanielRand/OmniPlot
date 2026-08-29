<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { auth } from '$lib/firebase/client';
	import { toastStore } from '$lib/stores';

	type ReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

	interface Report {
		id: string; uid: string; email: string; displayName: string; tier: string;
		type: 'bug' | 'feature' | 'other';
		severity: 'low' | 'medium' | 'high' | 'critical' | null;
		title: string; description: string; url: string; userAgent: string;
		status: ReportStatus; createdAt: number; updatedAt: number;
	}

	let reports     = $state<Report[]>([]);
	let loading     = $state(true);
	let filter      = $state<ReportStatus | 'all'>('all');
	let expandedId  = $state<string | null>(null);
	let updatingId  = $state<string | null>(null);

	const FILTERS: { id: ReportStatus | 'all'; label: string }[] = [
		{ id: 'all',         label: 'All' },
		{ id: 'open',        label: 'Open' },
		{ id: 'in_progress', label: 'In progress' },
		{ id: 'resolved',    label: 'Resolved' },
		{ id: 'closed',      label: 'Closed' },
	];

	const STATUS_TRANSITIONS: Record<ReportStatus, { label: string; next: ReportStatus }[]> = {
		open:        [{ label: 'Start', next: 'in_progress' }, { label: 'Close', next: 'closed' }],
		in_progress: [{ label: 'Resolve', next: 'resolved' }, { label: 'Close', next: 'closed' }],
		resolved:    [{ label: 'Reopen', next: 'open' }, { label: 'Close', next: 'closed' }],
		closed:      [{ label: 'Reopen', next: 'open' }],
	};

	const TYPE_LABELS: Record<string, string>     = { bug: 'Bug', feature: 'Feature', other: 'Other' };
	const SEV_LABELS:  Record<string, string>     = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

	const filtered = $derived(
		filter === 'all' ? reports : reports.filter(r => r.status === filter)
	);

	const stats = $derived({
		open:        reports.filter(r => r.status === 'open').length,
		in_progress: reports.filter(r => r.status === 'in_progress').length,
		resolved:    reports.filter(r => r.status === 'resolved').length,
	});

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/admin/reports', { headers: await authHeader() });
			if (res.ok) reports = (await res.json()).reports ?? [];
		} catch { /* non-fatal */ } finally {
			loading = false;
		}
	}

	async function updateStatus(id: string, status: ReportStatus) {
		updatingId = id;
		try {
			const res = await fetch('/api/admin/reports', {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', ...await authHeader() },
				body:    JSON.stringify({ id, status }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			reports = reports.map(r => r.id === id ? { ...r, status } : r);
			toastStore.success('Status updated');
		} catch (err) {
			toastStore.error('Update failed', err instanceof Error ? err.message : '');
		} finally {
			updatingId = null;
		}
	}

	function fmtDate(ms: number) {
		return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function typeVariant(type: string): 'warning' | 'success' | 'default' {
		return type === 'bug' ? 'warning' : type === 'feature' ? 'success' : 'default';
	}

	function sevVariant(sev: string | null): 'danger' | 'warning' | 'default' {
		if (!sev) return 'default';
		if (sev === 'critical' || sev === 'high') return 'danger';
		if (sev === 'medium') return 'warning';
		return 'default';
	}

	function statusVariant(s: ReportStatus): 'warning' | 'success' | 'default' | 'lite' {
		if (s === 'open') return 'warning';
		if (s === 'in_progress') return 'lite';
		if (s === 'resolved') return 'success';
		return 'default';
	}

	function statusLabel(s: ReportStatus) {
		return s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1);
	}

	onMount(load);
</script>

<svelte:head><title>Reports — OmniPlot Admin</title></svelte:head>

<div class="page">
	<div class="page__header">
		<div>
			<h1 class="page__title">Reports</h1>
			<p class="page__sub">User-submitted bug reports and feature requests.</p>
		</div>
	</div>

	<!-- Stats -->
	<div class="stats-row">
		<div class="stat-card">
			<div class="stat-card__value">{stats.open}</div>
			<div class="stat-card__label">Open</div>
		</div>
		<div class="stat-card">
			<div class="stat-card__value">{stats.in_progress}</div>
			<div class="stat-card__label">In progress</div>
		</div>
		<div class="stat-card">
			<div class="stat-card__value">{stats.resolved}</div>
			<div class="stat-card__label">Resolved</div>
		</div>
		<div class="stat-card">
			<div class="stat-card__value">{reports.length}</div>
			<div class="stat-card__label">Total</div>
		</div>
	</div>

	<!-- Filter tabs -->
	<div class="filter-tabs" role="tablist">
		{#each FILTERS as f}
			<button
				role="tab"
				class="filter-tab"
				class:filter-tab--active={filter === f.id}
				aria-selected={filter === f.id}
				onclick={() => (filter = f.id)}
			>
				{f.label}
				{#if f.id !== 'all'}
					<span class="filter-tab__count">
						{reports.filter(r => r.status === f.id).length}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Table -->
	{#if loading}
		<div class="loading-state">
			<span class="spinner" aria-label="Loading…"></span>
			<span>Loading reports…</span>
		</div>
	{:else if filtered.length === 0}
		<div class="empty-state">No reports {filter === 'all' ? 'yet' : `with status "${filter}"`}.</div>
	{:else}
		<div class="report-table">
			<div class="report-table__head">
				<span>Type</span>
				<span>Title</span>
				<span>Reporter</span>
				<span>Date</span>
				<span>Status</span>
				<span></span>
			</div>

			{#each filtered as report (report.id)}
				{@const isExpanded = expandedId === report.id}

				<div class="report-row" class:report-row--expanded={isExpanded}>
					<!-- Main row -->
					<button
						class="report-row__main"
						onclick={() => (expandedId = isExpanded ? null : report.id)}
						aria-expanded={isExpanded}
					>
						<span class="report-row__type">
							<Badge variant={typeVariant(report.type)} size="sm">{TYPE_LABELS[report.type] ?? report.type}</Badge>
							{#if report.severity}
								<Badge variant={sevVariant(report.severity)} size="sm">{SEV_LABELS[report.severity]}</Badge>
							{/if}
						</span>
						<span class="report-row__title">{report.title}</span>
						<span class="report-row__reporter">
							<span class="report-row__name">{report.displayName || report.email}</span>
							<span class="report-row__tier">{report.tier}</span>
						</span>
						<span class="report-row__date">{fmtDate(report.createdAt)}</span>
						<span class="report-row__status">
							<Badge variant={statusVariant(report.status)} size="sm">{statusLabel(report.status)}</Badge>
						</span>
						<span class="report-row__chevron" aria-hidden="true">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class:rotated={isExpanded}><polyline points="6 9 12 15 18 9"/></svg>
						</span>
					</button>

					<!-- Expanded detail -->
					{#if isExpanded}
						<div class="report-detail">
							<div class="report-detail__description">
								<div class="report-detail__label">Description</div>
								<pre class="report-detail__text">{report.description}</pre>
							</div>

							<div class="report-detail__meta">
								<div class="report-detail__meta-item">
									<span class="report-detail__label">Reporter</span>
									<span>{report.displayName} · {report.email} · UID: {report.uid}</span>
								</div>
								{#if report.url}
									<div class="report-detail__meta-item">
										<span class="report-detail__label">Page</span>
										<span class="report-detail__url">{report.url}</span>
									</div>
								{/if}
								{#if report.userAgent}
									<div class="report-detail__meta-item">
										<span class="report-detail__label">User agent</span>
										<span class="report-detail__ua">{report.userAgent}</span>
									</div>
								{/if}
							</div>

							<div class="report-detail__actions">
								<span class="report-detail__label">Update status:</span>
								{#each STATUS_TRANSITIONS[report.status] as t}
									<button
										class="status-btn"
										onclick={() => updateStatus(report.id, t.next)}
										disabled={updatingId === report.id}
									>
										{updatingId === report.id ? '…' : t.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page { padding: 28px; max-width: 1000px; }
	.page__header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
	.page__title { font-size: 1.375rem; font-weight: 700; margin-bottom: 4px; }
	.page__sub { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }

	/* Stats */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 12px;
		margin-bottom: 24px;
	}
	.stat-card {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 16px 20px;
	}
	.stat-card__value { font-size: 1.5rem; font-weight: 700; font-family: var(--font-display); margin-bottom: 2px; }
	.stat-card__label { font-size: 0.8125rem; color: var(--text-tertiary); }

	/* Filters */
	.filter-tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px;
		width: fit-content;
		margin-bottom: 20px;
	}
	.filter-tab {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all 0.12s;
	}
	.filter-tab:hover { color: var(--text-primary); }
	.filter-tab--active { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
	.filter-tab__count {
		font-size: 0.6875rem;
		font-weight: 600;
		background: var(--bg-surface-3);
		color: var(--text-tertiary);
		padding: 1px 5px;
		border-radius: 99px;
		min-width: 18px;
		text-align: center;
	}

	/* Table */
	.report-table {
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.report-table__head {
		display: grid;
		grid-template-columns: 140px 1fr 160px 160px 100px 28px;
		gap: 8px;
		padding: 8px 16px;
		background: var(--bg-surface-3);
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}

	.report-row {
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface-2);
	}
	.report-row:last-child { border-bottom: none; }
	.report-row--expanded { background: var(--bg-surface); }

	.report-row__main {
		display: grid;
		grid-template-columns: 140px 1fr 160px 160px 100px 28px;
		gap: 8px;
		align-items: center;
		padding: 12px 16px;
		width: 100%;
		background: none;
		border: none;
		text-align: left;
		cursor: pointer;
		font-family: var(--font-body);
		transition: background 0.1s;
	}
	.report-row__main:hover { background: var(--interactive-hover); }

	.report-row__type { display: flex; gap: 4px; flex-wrap: wrap; }
	.report-row__title { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.report-row__reporter { display: flex; flex-direction: column; gap: 1px; }
	.report-row__name { font-size: 0.8125rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.report-row__tier { font-size: 0.6875rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
	.report-row__date { font-size: 0.75rem; color: var(--text-tertiary); }
	.report-row__chevron svg { transition: transform 0.2s; color: var(--text-tertiary); }
	.report-row__chevron svg.rotated { transform: rotate(180deg); }

	/* Detail panel */
	.report-detail {
		padding: 16px 20px 20px;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.report-detail__label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
		margin-bottom: 4px;
	}

	.report-detail__text {
		font-family: var(--font-body);
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		white-space: pre-wrap;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 12px 14px;
		margin: 0;
	}

	.report-detail__meta { display: flex; flex-direction: column; gap: 8px; }
	.report-detail__meta-item { display: flex; flex-direction: column; gap: 2px; }
	.report-detail__url,
	.report-detail__ua {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-secondary);
		word-break: break-all;
	}

	.report-detail__actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.status-btn {
		padding: 5px 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all 0.12s;
	}
	.status-btn:hover { border-color: var(--color-brand-dim); background: rgba(0,112,255,0.06); }
	.status-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* Loading / empty */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-tertiary);
		font-size: 0.875rem;
		padding: 32px 0;
	}
	.spinner {
		display: block;
		width: 16px; height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.empty-state { color: var(--text-tertiary); font-size: 0.875rem; padding: 32px 0; }
</style>
