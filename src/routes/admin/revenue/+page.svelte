<script lang="ts">
	import type { PageData } from './$types';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { auth } from '$lib/firebase/client';
	import { onMount } from 'svelte';

	interface Props { data: PageData; }
	let { data }: Props = $props();

	// ─── Types (mirror /api/admin/revenue) ─────────
	interface Month {
		month: string; gross: number; refunds: number; disputes: number;
		fees: number; net: number; charges: number; platformGross: number;
	}
	interface Payment {
		id: string; created: number; email: string | null; description: string | null;
		amount: number; amountRefunded: number; fee: number; disputed: boolean;
		account: 'connected' | 'platform';
	}
	interface Sub {
		id: string; email: string | null; plan: string; status: string; mrr: number;
		cancelAtPeriodEnd: boolean; paused: boolean; oneOffDiscount: boolean;
		nextBill: number | null; created: number; kind: 'individual' | 'org';
	}
	interface Totals { gross: number; refunds: number; disputes: number; fees: number; net: number; charges: number; }
	interface Revenue {
		currency: string;
		generatedAt: number;
		connected: Totals & { payouts: number };
		platform: { gross: number; refunds: number; fees: number; net: number; charges: number };
		totals: Totals;
		mrr: number; arr: number;
		activeSubscribers: number; trialing: number; cancelling: number; atRiskMrr: number;
		byPlan: Record<string, { count: number; mrr: number }>;
		balance: { available: number; pending: number } | null;
		months: Month[];
		payments: Payment[];
		subscriptions: Sub[];
		warnings: string[];
	}

	type Period = 'mtd' | 'last' | '12m' | 'all';
	const PERIODS: { id: Period; label: string }[] = [
		{ id: 'mtd',  label: 'This month' },
		{ id: 'last', label: 'Last month' },
		{ id: '12m',  label: 'Last 12 months' },
		{ id: 'all',  label: 'All time' },
	];

	// ─── State ─────────────────────────────────────
	let loading = $state(true);
	let error   = $state<string | null>(null);
	let rev     = $state<Revenue | null>(null);
	let period  = $state<Period>('mtd');
	let hovered = $state<number | null>(null);
	let showAllPayments = $state(false);

	// ─── Helpers ───────────────────────────────────
	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	function money(cents: number, opts: { compact?: boolean } = {}): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency', currency: (rev?.currency ?? 'usd').toUpperCase(),
			...(opts.compact && Math.abs(cents) >= 100_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
		}).format(cents / 100);
	}

	function fmtDate(unix: number): string {
		return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function fmtMonth(key: string, short = false): string {
		const [y, m] = key.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
			month: 'short', ...(short ? {} : { year: 'numeric' }), timeZone: 'UTC',
		});
	}

	function monthOffset(offset: number): string {
		const d = new Date();
		return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
	}

	// ─── Load ──────────────────────────────────────
	async function load() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/admin/revenue', { headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json()).error ?? 'Load failed');
			rev = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load revenue';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// ─── Derived ───────────────────────────────────
	const periodMonths = $derived.by(() => {
		const all = rev?.months ?? [];
		switch (period) {
			case 'mtd':  return all.filter((m) => m.month === monthOffset(0));
			case 'last': return all.filter((m) => m.month === monthOffset(-1));
			case '12m':  return all.filter((m) => m.month > monthOffset(-12));
			default:     return all;
		}
	});

	const periodTotals = $derived(periodMonths.reduce(
		(t, m) => ({
			gross: t.gross + m.gross, refunds: t.refunds + m.refunds, disputes: t.disputes + m.disputes,
			fees: t.fees + m.fees, net: t.net + m.net, charges: t.charges + m.charges,
		}),
		{ gross: 0, refunds: 0, disputes: 0, fees: 0, net: 0, charges: 0 },
	));

	// Previous equivalent period for the delta on the net tile.
	const comparison = $derived.by(() => {
		if (!rev || (period !== 'mtd' && period !== 'last')) return null;
		const key = monthOffset(period === 'mtd' ? -1 : -2);
		const m = rev.months.find((x) => x.month === key);
		return m ? { label: fmtMonth(key), net: m.net } : null;
	});

	const chartMonths = $derived((rev?.months ?? []).slice(-12));
	const chartMax = $derived(Math.max(1, ...chartMonths.map((m) => Math.max(m.gross, m.net))));
	const chartTicks = $derived.by(() => {
		const raw = chartMax / 100 / 3;
		const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
		const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? mag * 10;
		return [0, 1, 2, 3].map((i) => i * step * 100).filter((v, i) => i === 0 || v <= chartMax * 1.15);
	});
	const chartTop = $derived(Math.max(chartMax, chartTicks.at(-1) ?? chartMax));

	const planRows = $derived(Object.entries(rev?.byPlan ?? {}).sort((a, b) => b[1].mrr - a[1].mrr));
	const visiblePayments = $derived(showAllPayments ? rev?.payments ?? [] : (rev?.payments ?? []).slice(0, 15));
	const hasPlatform = $derived((rev?.platform.charges ?? 0) > 0);
</script>

<svelte:head><title>Revenue — Admin — OmniPlot</title></svelte:head>

<div class="rev-page">

	<!-- Header -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Revenue</h1>
			<p class="page-sub">
				Read live from Stripe's ledger on every load
				{#if rev}· as of {new Date(rev.generatedAt * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{/if}
			</p>
		</div>
		<div class="header-actions">
			<a href="https://dashboard.stripe.com/{data.stripeConnectedAccountId}/balance" target="_blank" rel="noopener noreferrer" class="ext-link">
				Stripe balance
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
			</a>
			<button class="refresh-btn" onclick={load} disabled={loading} aria-label="Refresh">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class:spinning={loading}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
				Refresh
			</button>
		</div>
	</div>

	{#if error}
		<div class="load-error">
			<p class="error-msg">{error}</p>
			<button class="retry-btn" onclick={load}>Retry</button>
		</div>
	{/if}

	{#if rev?.warnings.length}
		<div class="warn-box" role="status">
			{#each rev.warnings as w}<p>{w}</p>{/each}
		</div>
	{/if}

	<!-- ── Recurring ───────────────────────────────── -->
	<div class="section">
		<div class="kpi-row">
			<div class="kpi">
				<div class="kpi-label">MRR</div>
				{#if loading && !rev}<div class="skel" style="width:110px;height:28px"></div>
				{:else}<div class="kpi-value">{money(rev?.mrr ?? 0)}</div>{/if}
				<div class="kpi-note">Active subs, net of recurring discounts</div>
			</div>
			<div class="kpi">
				<div class="kpi-label">ARR</div>
				{#if loading && !rev}<div class="skel" style="width:110px;height:28px"></div>
				{:else}<div class="kpi-value">{money(rev?.arr ?? 0)}</div>{/if}
				<div class="kpi-note">MRR × 12</div>
			</div>
			<div class="kpi">
				<div class="kpi-label">Paying subscribers</div>
				{#if loading && !rev}<div class="skel" style="width:60px;height:28px"></div>
				{:else}<div class="kpi-value">{rev?.activeSubscribers ?? 0}</div>{/if}
				<div class="kpi-note">
					{#if rev?.trialing}{rev.trialing} trialing · {/if}{rev?.cancelling
						? `${rev.cancelling} cancelling (${money(rev.atRiskMrr)} MRR)`
						: 'None set to cancel'}
				</div>
			</div>
			<div class="kpi kpi--muted">
				<div class="kpi-label">Stripe balance</div>
				{#if loading && !rev}<div class="skel" style="width:110px;height:28px"></div>
				{:else if rev?.balance}
					<div class="kpi-value">{money(rev.balance.available + rev.balance.pending)}</div>
				{:else}<div class="kpi-value kpi-value--dim">—</div>{/if}
				<div class="kpi-note">
					{#if rev?.balance}{money(rev.balance.available)} available · {money(rev.balance.pending)} pending{:else}Unavailable{/if}
				</div>
			</div>
		</div>

		{#if planRows.length}
			<div class="plan-strip">
				{#each planRows as [plan, p]}
					<div class="plan-chip">
						<span class="plan-name">{plan}</span>
						<span class="plan-count">{p.count} × </span>
						<span class="plan-mrr">{money(p.mrr)}/mo</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ── Collected revenue ──────────────────────── -->
	<div class="section">
		<div class="section-head">
			<div>
				<h2 class="section-title">Collected revenue</h2>
				<p class="section-desc">Charges, refunds, disputes and Stripe fees from the balance ledger. Months are UTC.</p>
			</div>
			<div class="seg" role="tablist" aria-label="Period">
				{#each PERIODS as p}
					<button role="tab" aria-selected={period === p.id} class="seg-btn" class:seg-btn--on={period === p.id} onclick={() => (period = p.id)}>{p.label}</button>
				{/each}
			</div>
		</div>

		<div class="kpi-row">
			<div class="kpi">
				<div class="kpi-label">Net revenue</div>
				{#if loading && !rev}<div class="skel" style="width:110px;height:28px"></div>
				{:else}<div class="kpi-value">{money(periodTotals.net)}</div>{/if}
				<div class="kpi-note">
					{#if comparison}
						{@const diff = periodTotals.net - comparison.net}
						<span class:up={diff > 0} class:down={diff < 0}>{diff >= 0 ? '+' : '−'}{money(Math.abs(diff))}</span> vs {comparison.label}
					{:else}After refunds, disputes and fees{/if}
				</div>
			</div>
			<div class="kpi">
				<div class="kpi-label">Gross charges</div>
				{#if loading && !rev}<div class="skel" style="width:110px;height:28px"></div>
				{:else}<div class="kpi-value">{money(periodTotals.gross)}</div>{/if}
				<div class="kpi-note">{periodTotals.charges} payment{periodTotals.charges === 1 ? '' : 's'}</div>
			</div>
			<div class="kpi">
				<div class="kpi-label">Refunds & disputes</div>
				{#if loading && !rev}<div class="skel" style="width:90px;height:28px"></div>
				{:else}<div class="kpi-value">{money(periodTotals.refunds + periodTotals.disputes)}</div>{/if}
				<div class="kpi-note">{periodTotals.disputes ? `${money(periodTotals.disputes)} disputed` : 'No disputes'}</div>
			</div>
			<div class="kpi">
				<div class="kpi-label">Stripe fees</div>
				{#if loading && !rev}<div class="skel" style="width:90px;height:28px"></div>
				{:else}<div class="kpi-value">{money(periodTotals.fees)}</div>{/if}
				<div class="kpi-note">
					{periodTotals.gross ? `${((periodTotals.fees / periodTotals.gross) * 100).toFixed(1)}% of gross` : 'Processing + billing fees'}
				</div>
			</div>
		</div>

		<!-- Monthly net chart -->
		{#if chartMonths.length}
			<figure class="chart" aria-label="Net revenue by month">
				<figcaption class="chart-title">Net revenue by month</figcaption>
				<div class="chart-plot">
					<div class="chart-grid" aria-hidden="true">
						{#each chartTicks as t}
							<div class="chart-gridline" style="bottom:{(t / chartTop) * 100}%">
								<span class="chart-tick">{money(t, { compact: true })}</span>
							</div>
						{/each}
					</div>
					<div class="chart-bars">
						{#each chartMonths as m, i (m.month)}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="chart-col"
								role="img"
								tabindex="0"
								aria-label="{fmtMonth(m.month)}: net {money(m.net)}, gross {money(m.gross)}"
								onmouseenter={() => (hovered = i)}
								onmouseleave={() => (hovered = null)}
								onfocus={() => (hovered = i)}
								onblur={() => (hovered = null)}
							>
								<div class="chart-bar" class:chart-bar--dim={hovered !== null && hovered !== i} style="height:{(Math.max(0, m.net) / chartTop) * 100}%"></div>
								{#if hovered === i}
									<div class="chart-tip" class:chart-tip--left={i > chartMonths.length / 2}>
										<div class="tip-title">{fmtMonth(m.month)}</div>
										<div class="tip-row"><span>Gross</span><span>{money(m.gross)}</span></div>
										{#if m.refunds}<div class="tip-row"><span>Refunds</span><span>−{money(m.refunds)}</span></div>{/if}
										{#if m.disputes}<div class="tip-row"><span>Disputes</span><span>−{money(m.disputes)}</span></div>{/if}
										<div class="tip-row"><span>Fees</span><span>−{money(m.fees)}</span></div>
										<div class="tip-row tip-row--total"><span>Net</span><span>{money(m.net)}</span></div>
										{#if m.platformGross}<div class="tip-foot">{money(m.platformGross)} gross collected on platform acct</div>{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
				<div class="chart-labels" aria-hidden="true">
					{#each chartMonths as m}<span>{fmtMonth(m.month, true)}</span>{/each}
				</div>
			</figure>

			<details class="month-table">
				<summary>Monthly breakdown table</summary>
				<div class="table-scroll">
					<table class="tbl">
						<thead><tr><th>Month</th><th class="num">Payments</th><th class="num">Gross</th><th class="num">Refunds</th><th class="num">Disputes</th><th class="num">Fees</th><th class="num">Net</th></tr></thead>
						<tbody>
							{#each [...(rev?.months ?? [])].reverse() as m (m.month)}
								<tr>
									<td class="mono">{fmtMonth(m.month)}</td>
									<td class="mono num">{m.charges}</td>
									<td class="mono num">{money(m.gross)}</td>
									<td class="mono num">{m.refunds ? `−${money(m.refunds)}` : '—'}</td>
									<td class="mono num">{m.disputes ? `−${money(m.disputes)}` : '—'}</td>
									<td class="mono num">−{money(m.fees)}</td>
									<td class="mono num strong">{money(m.net)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		{:else if !loading}
			<p class="empty">No charges yet.</p>
		{/if}

		{#if hasPlatform && rev}
			<div class="note">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
				<span>
					Includes {rev.platform.charges} charge{rev.platform.charges === 1 ? '' : 's'} ({money(rev.platform.gross)} gross, {money(rev.platform.refunds)} refunded, {money(rev.platform.net)} net)
					collected on the <strong>platform</strong> account during the Sep 2026 misrouting. That money sits in the platform balance,
					not the connected balance above. Connected account alone: {money(rev.connected.net)} net all-time.
				</span>
			</div>
		{/if}
	</div>

	<!-- ── Subscriptions ──────────────────────────── -->
	<div class="section">
		<div class="section-head">
			<div>
				<h2 class="section-title">Subscriptions</h2>
				<p class="section-desc">Active, past-due and trialing subscriptions on the connected account.</p>
			</div>
		</div>
		{#if rev?.subscriptions.length}
			<div class="table-scroll">
				<table class="tbl">
					<thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th class="num">MRR</th><th>Next bill</th><th>Since</th></tr></thead>
					<tbody>
						{#each rev.subscriptions as s (s.id)}
							<tr>
								<td class="mono">
									<a class="row-link" href="https://dashboard.stripe.com/{data.stripeConnectedAccountId}/subscriptions/{s.id}" target="_blank" rel="noopener noreferrer">{s.email ?? s.id}</a>
								</td>
								<td>
									<Badge variant={s.plan === 'pro' ? 'pro' : s.plan === 'lite' ? 'lite' : 'brand'} size="sm">{s.plan}</Badge>
								</td>
								<td>
									<Badge variant={s.status === 'active' && !s.cancelAtPeriodEnd ? 'success' : s.status === 'past_due' ? 'danger' : 'warning'} size="sm" dot>
										{s.cancelAtPeriodEnd ? 'cancelling' : s.status.replace('_', ' ')}
									</Badge>
									{#if s.oneOffDiscount}<span class="hint" title="A one-time coupon (e.g. free month) applies to the next invoice">coupon</span>{/if}
								</td>
								<td class="mono num">{s.mrr ? money(s.mrr) : '—'}</td>
								<td class="mono">{s.nextBill ? fmtDate(s.nextBill) : '—'}</td>
								<td class="mono dim">{fmtDate(s.created)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if !loading}
			<p class="empty">No active subscriptions.</p>
		{/if}
	</div>

	<!-- ── Payments ───────────────────────────────── -->
	<div class="section">
		<div class="section-head">
			<div>
				<h2 class="section-title">Payments</h2>
				<p class="section-desc">Every charge, newest first, with Stripe's fee and what you kept.</p>
			</div>
		</div>
		{#if rev?.payments.length}
			<div class="table-scroll">
				<table class="tbl">
					<thead><tr><th>Date</th><th>Customer</th><th>Description</th><th class="num">Amount</th><th class="num">Fee</th><th class="num">Kept</th><th>Status</th></tr></thead>
					<tbody>
						{#each visiblePayments as p (p.id)}
							{@const kept = p.amount - p.amountRefunded - p.fee}
							<tr>
								<td class="mono">{fmtDate(p.created)}</td>
								<td class="mono">{p.email ?? '—'}</td>
								<td class="dim">
									{p.description ?? '—'}
									{#if p.account === 'platform'}<span class="hint" title="Collected on the platform account during the Sep 2026 misrouting">platform acct</span>{/if}
								</td>
								<td class="mono num">{money(p.amount)}</td>
								<td class="mono num dim">−{money(p.fee)}</td>
								<td class="mono num strong">{money(kept)}</td>
								<td>
									{#if p.disputed}<Badge variant="danger" size="sm" dot>disputed</Badge>
									{:else if p.amountRefunded >= p.amount}<Badge variant="warning" size="sm" dot>refunded</Badge>
									{:else if p.amountRefunded > 0}<Badge variant="warning" size="sm" dot>part refunded</Badge>
									{:else}<Badge variant="success" size="sm" dot>paid</Badge>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if rev.payments.length > 15}
				<button class="more-btn" onclick={() => (showAllPayments = !showAllPayments)}>
					{showAllPayments ? 'Show fewer' : `Show all ${rev.payments.length}`}
				</button>
			{/if}
		{:else if !loading}
			<p class="empty">No payments yet.</p>
		{/if}
	</div>
</div>

<style>
	@keyframes spin { to { transform: rotate(360deg); } }
	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

	.rev-page {
		padding: 24px; display: flex; flex-direction: column; gap: 20px;
		max-width: 1080px; margin: 0 auto;
	}

	/* Header */
	.page-header    { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.header-actions { display: flex; gap: 8px; align-items: center; }
	.page-title     { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub       { font-size: 0.875rem; color: var(--text-secondary); }
	.refresh-btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 6px 12px; font-size: 0.8125rem; font-family: var(--font-body); font-weight: 500;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.refresh-btn:hover    { background: var(--bg-surface-3); color: var(--text-primary); }
	.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.spinning { animation: spin 0.9s linear infinite; }
	.ext-link {
		display: inline-flex; align-items: center; gap: 4px;
		font-size: 0.8125rem; color: var(--text-brand); text-decoration: none;
		padding: 6px 10px; border: 1px solid var(--border-default); border-radius: var(--radius-md);
		white-space: nowrap;
	}
	.ext-link:hover { background: var(--interactive-hover); }

	.load-error { background: var(--bg-surface); border: 1px solid rgba(255,77,109,0.25); border-radius: var(--radius-lg); padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.error-msg  { font-size: 0.875rem; color: var(--color-danger); margin: 0; }
	.retry-btn  { padding: 5px 12px; font-size: 0.8125rem; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; }
	.warn-box {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent);
		border-radius: var(--radius-lg); padding: 10px 16px; font-size: 0.8125rem; color: var(--text-primary);
	}
	.warn-box p { margin: 2px 0; }

	/* Sections */
	.section {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl); overflow: hidden;
	}
	.section-head {
		display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle);
	}
	.section-title { font-size: 0.9375rem; font-weight: 600; margin: 0 0 2px; }
	.section-desc  { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; line-height: 1.5; }

	.seg { display: inline-flex; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 2px; }
	.seg-btn {
		border: 0; background: transparent; padding: 4px 10px; font-size: 0.75rem; font-family: var(--font-body);
		color: var(--text-secondary); border-radius: calc(var(--radius-md) - 2px); cursor: pointer; white-space: nowrap;
	}
	.seg-btn:hover  { color: var(--text-primary); }
	.seg-btn--on    { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

	/* KPI tiles */
	.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border-subtle); }
	.kpi     { background: var(--bg-surface); padding: 16px; display: flex; flex-direction: column; gap: 4px; }
	.kpi--muted { background: var(--bg-surface-2); }
	.kpi-label { font-size: 0.6875rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.kpi-value { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; font-variant-numeric: tabular-nums; }
	.kpi-value--dim { color: var(--text-tertiary); }
	.kpi-note  { font-size: 0.75rem; color: var(--text-tertiary); }
	.up   { color: var(--color-success); font-weight: 600; }
	.down { color: var(--color-danger); font-weight: 600; }

	.plan-strip { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); }
	.plan-chip  {
		display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px;
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: 20px;
		font-size: 0.75rem; font-family: var(--font-mono);
	}
	.plan-name  { font-weight: 600; color: var(--text-primary); text-transform: capitalize; }
	.plan-count { color: var(--text-tertiary); }
	.plan-mrr   { color: var(--text-secondary); }

	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; display: block;
	}

	/* Chart — single series, so one hue; identity comes from the title. */
	.chart       { margin: 0; padding: 16px 16px 8px 16px; border-top: 1px solid var(--border-subtle); }
	.chart-title { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; }
	.chart-plot  { position: relative; height: 180px; margin-left: 52px; }
	.chart-grid  { position: absolute; inset: 0; pointer-events: none; }
	.chart-gridline { position: absolute; left: 0; right: 0; border-top: 1px solid var(--border-subtle); }
	.chart-tick  {
		position: absolute; right: calc(100% + 8px); top: -7px;
		font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary); white-space: nowrap;
	}
	.chart-bars  { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; }
	.chart-col   {
		position: relative; flex: 1; height: 100%; display: flex; align-items: flex-end; justify-content: center;
		outline: none; cursor: default;
	}
	.chart-col:focus-visible { box-shadow: inset 0 0 0 2px var(--text-brand); border-radius: 4px; }
	.chart-bar   {
		width: min(100%, 36px); min-height: 0; background: var(--text-brand);
		border-radius: 4px 4px 0 0; transition: opacity 0.12s;
	}
	.chart-bar--dim { opacity: 0.45; }
	.chart-labels {
		display: flex; gap: 2px; margin-left: 52px; margin-top: 6px;
		font-size: 0.625rem; font-family: var(--font-mono); color: var(--text-tertiary);
	}
	.chart-labels span { flex: 1; text-align: center; }
	.chart-tip {
		position: absolute; bottom: calc(100% - 40px); left: 60%; z-index: 5; min-width: 170px;
		background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md);
		box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 8px 10px; font-size: 0.75rem; pointer-events: none;
	}
	.chart-tip--left { left: auto; right: 60%; }
	.tip-title { font-weight: 600; margin-bottom: 4px; color: var(--text-primary); }
	.tip-row   { display: flex; justify-content: space-between; gap: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
	.tip-row--total { color: var(--text-primary); font-weight: 600; border-top: 1px solid var(--border-subtle); margin-top: 4px; padding-top: 4px; }
	.tip-foot  { margin-top: 4px; color: var(--text-tertiary); font-size: 0.6875rem; }

	.month-table { border-top: 1px solid var(--border-subtle); }
	.month-table summary {
		padding: 10px 16px; font-size: 0.75rem; color: var(--text-secondary); cursor: pointer;
	}
	.month-table summary:hover { color: var(--text-primary); }

	.note {
		display: flex; align-items: flex-start; gap: 8px; padding: 10px 16px;
		background: var(--bg-surface-2); border-top: 1px solid var(--border-subtle);
		font-size: 0.8125rem; color: var(--text-tertiary); line-height: 1.5;
	}
	.note svg { flex-shrink: 0; margin-top: 3px; }
	.note strong { color: var(--text-secondary); }

	/* Tables */
	.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.tbl thead { background: var(--bg-surface-2); }
	.tbl th {
		padding: 7px 14px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.08em; white-space: nowrap;
	}
	.tbl tbody tr { border-top: 1px solid var(--border-subtle); }
	.tbl tbody tr:hover { background: var(--interactive-hover); }
	.tbl td { padding: 9px 14px; vertical-align: middle; }
	.num    { text-align: right; }
	.mono   { font-family: var(--font-mono); white-space: nowrap; font-variant-numeric: tabular-nums; }
	.dim    { color: var(--text-secondary); }
	.strong { font-weight: 600; color: var(--text-primary); }
	.row-link { color: var(--text-primary); text-decoration: none; }
	.row-link:hover { color: var(--text-brand); text-decoration: underline; }
	.hint {
		display: inline-block; margin-left: 6px; padding: 1px 6px; font-size: 0.625rem; font-family: var(--font-mono);
		border: 1px solid var(--border-default); border-radius: 10px; color: var(--text-tertiary); white-space: nowrap;
	}
	.more-btn {
		display: block; width: 100%; padding: 9px; border: 0; border-top: 1px solid var(--border-subtle);
		background: transparent; font-size: 0.8125rem; color: var(--text-brand); cursor: pointer; font-family: var(--font-body);
	}
	.more-btn:hover { background: var(--interactive-hover); }
	.empty { padding: 16px; font-size: 0.875rem; color: var(--text-tertiary); margin: 0; }

	@media (max-width: 900px) {
		.kpi-row { grid-template-columns: 1fr 1fr; }
	}
	@media (max-width: 600px) {
		.rev-page { padding: 16px; }
		.kpi-row  { grid-template-columns: 1fr; }
		.seg      { width: 100%; overflow-x: auto; }
		.chart-plot, .chart-labels { margin-left: 44px; }
	}
</style>
