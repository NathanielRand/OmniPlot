<script lang="ts">
	import type { PageData } from './$types';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { auth } from '$lib/firebase/client';
	import { onMount } from 'svelte';

	interface Props { data: PageData; }
	let { data }: Props = $props();

	// ─── Types ─────────────────────────────────────
	interface FirebaseUsage {
		authUsers:         number | null;
		firestoreJobs:     number | null;
		firestoreShops:    number | null;
		firestorePatterns: number | null;
	}
	interface BalanceAmount { amount: number; currency: string; }
	interface StripeBalance {
		available: BalanceAmount[];
		pending:   BalanceAmount[];
	}
	interface RecentFee {
		id: string; amount: number; fee: number;
		currency: string; created: number; description: string | null;
	}
	interface Revenue {
		totalSucceeded: number;
		totalRefunded:  number;
		totalDisputed:  number;
		unattributed:   number;
		byCurrency:     Record<string, number>;
	}
	interface Transaction {
		id: string; uid: string | null; email: string | null;
		amount: number; amountRefunded: number; currency: string;
		status: string; description: string | null; created: number;
	}

	// ─── State ─────────────────────────────────────
	let loading      = $state(true);
	let error        = $state<string | null>(null);
	let firebaseUsage = $state<FirebaseUsage | null>(null);
	let stripeBalance = $state<StripeBalance | null>(null);
	let recentFees    = $state<RecentFee[]>([]);
	let revenue           = $state<Revenue | null>(null);
	let recentTransactions = $state<Transaction[]>([]);
	let syncing           = $state(false);
	let syncMsg           = $state<string | null>(null);

	// ─── Helpers ───────────────────────────────────
	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	function fmtCurrency(cents: number, currency = 'usd'): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency', currency: currency.toUpperCase(),
		}).format(cents / 100);
	}

	function fmtDate(unix: number): string {
		return new Date(unix * 1000).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
		});
	}

	function fmtNum(n: number | null): string {
		if (n === null) return '—';
		return n.toLocaleString();
	}

	// ─── Load ──────────────────────────────────────
	async function load() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/admin/billing', { headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json()).error ?? 'Load failed');
			const d = await res.json();
			firebaseUsage = d.firebaseUsage;
			stripeBalance  = d.stripeBalance;
			recentFees     = d.recentFees ?? [];
			revenue        = d.revenue ?? null;
			recentTransactions = d.recentTransactions ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load billing data';
		} finally {
			loading = false;
		}
	}

	async function runSync() {
		syncing = true; syncMsg = null;
		try {
			const res = await fetch('/api/admin/billing/sync', { method: 'POST', headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json()).error ?? 'Sync failed');
			const d = await res.json();
			syncMsg = `Synced ${d.chargesSynced} charge${d.chargesSynced === 1 ? '' : 's'} and ${d.subsSynced} subscription${d.subsSynced === 1 ? '' : 's'} from Stripe` +
				(d.subsSkipped ? ` (${d.subsSkipped} skipped — no uid in metadata).` : '.');
			await load();
		} catch (e) {
			syncMsg = e instanceof Error ? e.message : 'Sync failed';
		} finally {
			syncing = false;
		}
	}

	onMount(load);

	// Firebase free-tier limits for reference
	const FIREBASE_LIMITS = {
		authUsers:    { free: '10,000 MAU',  paid: '$0.0055 / MAU after' },
		firestoreDoc: { free: '1M reads/day', paid: '$0.06 / 100k reads' },
		storage:      { free: '5 GB',         paid: '$0.026 / GB' },
		functions:    { free: '2M calls/mo',  paid: '$0.40 / 1M calls' },
	};

	// Known fixed platform costs
	const OTHER_COSTS = [
		{ service: 'Vercel',          category: 'Hosting',      estimate: 'Pro $20/mo',   link: 'https://vercel.com/dashboard' },
		{ service: 'Google Domains',  category: 'Domain',       estimate: '~$12/yr',      link: null },
		{ service: 'Firebase Blaze',  category: 'Backend',      estimate: 'Pay-as-you-go', link: 'https://console.firebase.google.com' },
		{ service: 'Stripe Connect',  category: 'Payments',     estimate: '2.9% + 30¢',   link: `https://dashboard.stripe.com/${data.stripeConnectedAccountId}` },
	];
</script>

<svelte:head><title>Billing — Admin — OmniPlot</title></svelte:head>

<div class="billing-page">

	<!-- Header -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Platform Billing</h1>
			<p class="page-sub">Operational costs and service usage for OmniPlot.</p>
		</div>
		<button class="refresh-btn" onclick={load} disabled={loading} aria-label="Refresh">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class:spinning={loading}><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
			Refresh
		</button>
	</div>

	{#if error}
		<div class="load-error">
			<p class="error-msg">{error}</p>
			<button class="retry-btn" onclick={load}>Retry</button>
		</div>
	{/if}

	<!-- ── Firebase ──────────────────────────────────── -->
	<div class="cost-section">
		<div class="section-head">
			<div class="section-icon section-icon--firebase" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 19h20L12 2z"/><path d="M12 9v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
			</div>
			<div>
				<h2 class="section-title">Firebase / Google Cloud</h2>
				<p class="section-desc">Auth, Firestore, Storage, and Cloud Functions usage on the Blaze pay-as-you-go plan.</p>
			</div>
			<a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" class="ext-link">
				Firebase Console
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
			</a>
		</div>

		<div class="usage-grid">
			<!-- Auth -->
			<div class="usage-card">
				<div class="usage-card__header">
					<span class="usage-card__label">Authentication</span>
					<Badge variant="default" size="sm">MAU</Badge>
				</div>
				{#if loading}
					<div class="skel" style="width:60px;height:26px;margin:6px 0 4px"></div>
				{:else}
					<div class="usage-card__value">{fmtNum(firebaseUsage?.authUsers ?? null)}</div>
				{/if}
				<div class="usage-card__limit">
					Free: {FIREBASE_LIMITS.authUsers.free}
					<span class="usage-card__paid">{FIREBASE_LIMITS.authUsers.paid}</span>
				</div>
			</div>

			<!-- Firestore documents -->
			<div class="usage-card">
				<div class="usage-card__header">
					<span class="usage-card__label">Firestore — Jobs</span>
					<Badge variant="default" size="sm">docs</Badge>
				</div>
				{#if loading}
					<div class="skel" style="width:60px;height:26px;margin:6px 0 4px"></div>
				{:else}
					<div class="usage-card__value">{fmtNum(firebaseUsage?.firestoreJobs ?? null)}</div>
				{/if}
				<div class="usage-card__limit">
					Free reads: {FIREBASE_LIMITS.firestoreDoc.free}
					<span class="usage-card__paid">{FIREBASE_LIMITS.firestoreDoc.paid}</span>
				</div>
			</div>

			<div class="usage-card">
				<div class="usage-card__header">
					<span class="usage-card__label">Firestore — Shops</span>
					<Badge variant="default" size="sm">docs</Badge>
				</div>
				{#if loading}
					<div class="skel" style="width:60px;height:26px;margin:6px 0 4px"></div>
				{:else}
					<div class="usage-card__value">{fmtNum(firebaseUsage?.firestoreShops ?? null)}</div>
				{/if}
				<div class="usage-card__limit">Teams billed independently via org-level plans.</div>
			</div>

			<div class="usage-card">
				<div class="usage-card__header">
					<span class="usage-card__label">Firestore — Patterns</span>
					<Badge variant="default" size="sm">docs</Badge>
				</div>
				{#if loading}
					<div class="skel" style="width:60px;height:26px;margin:6px 0 4px"></div>
				{:else}
					<div class="usage-card__value">{fmtNum(firebaseUsage?.firestorePatterns ?? null)}</div>
				{/if}
				<div class="usage-card__limit">Pattern SVGs also stored in Cloud Storage.</div>
			</div>

			<div class="usage-card usage-card--note">
				<div class="usage-card__header">
					<span class="usage-card__label">Cloud Storage</span>
					<Badge variant="default" size="sm">GCS</Badge>
				</div>
				<div class="usage-card__value usage-card__value--sm">Pattern SVGs</div>
				<div class="usage-card__limit">
					Free: {FIREBASE_LIMITS.storage.free}
					<span class="usage-card__paid">{FIREBASE_LIMITS.storage.paid}</span>
				</div>
			</div>

			<div class="usage-card usage-card--note">
				<div class="usage-card__header">
					<span class="usage-card__label">Cloud Functions</span>
					<Badge variant="default" size="sm">serverless</Badge>
				</div>
				<div class="usage-card__value usage-card__value--sm">Webhooks + API</div>
				<div class="usage-card__limit">
					Free: {FIREBASE_LIMITS.functions.free}
					<span class="usage-card__paid">{FIREBASE_LIMITS.functions.paid}</span>
				</div>
			</div>
		</div>

		<div class="gcp-billing-note">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
			Exact costs require the
			<a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener noreferrer">Google Cloud Billing Console</a>.
			Document counts shown above are proxies for read/write volume.
		</div>
	</div>

	<!-- ── Revenue ledger ───────────────────────────────── -->
	<div class="cost-section">
		<div class="section-head">
			<div class="section-icon section-icon--stripe" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
			</div>
			<div>
				<h2 class="section-title">Revenue</h2>
				<p class="section-desc">Charges synced from the Stripe webhook into Firestore — per-user financial history lives on each user's admin drawer.</p>
			</div>
			<button class="ext-link" style="cursor:pointer" onclick={runSync} disabled={syncing}>
				{syncing ? 'Syncing…' : 'Sync from Stripe'}
			</button>
		</div>

		{#if syncMsg}
			<div class="gcp-billing-note">{syncMsg}</div>
		{/if}

		{#if loading}
			<div class="balance-row">
				{#each { length: 3 } as _}
					<div class="balance-card">
						<div class="skel" style="width:70px;height:10px;margin-bottom:8px"></div>
						<div class="skel" style="width:110px;height:28px"></div>
					</div>
				{/each}
			</div>
		{:else if revenue}
			<div class="balance-row">
				<div class="balance-card">
					<div class="balance-label">Total revenue</div>
					<div class="balance-amount">{fmtCurrency(revenue.totalSucceeded)}</div>
					<div class="balance-note">Succeeded charges, gross</div>
				</div>
				<div class="balance-card balance-card--pending">
					<div class="balance-label">Refunded</div>
					<div class="balance-amount">{fmtCurrency(revenue.totalRefunded)}</div>
					<div class="balance-note">{revenue.totalDisputed > 0 ? `+ ${fmtCurrency(revenue.totalDisputed)} disputed` : 'No open disputes'}</div>
				</div>
				<div class="balance-card balance-card--info">
					<div class="balance-label">Unattributed</div>
					<div class="balance-amount balance-amount--rate">{revenue.unattributed}</div>
					<div class="balance-note">Charges with no matching user — check email/customer id</div>
				</div>
			</div>
		{/if}

		{#if recentTransactions.length > 0}
			<div class="fees-table-wrap">
				<div class="fees-table-head">Recent transactions</div>
				<table class="fees-table" aria-label="Recent transactions">
					<thead>
						<tr>
							<th>Date</th>
							<th>User</th>
							<th>Description</th>
							<th>Amount</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each recentTransactions as t}
							<tr>
								<td class="td-mono">{fmtDate(t.created)}</td>
								<td class="td-mono">{t.uid ? t.email ?? t.uid : 'Unattributed'}</td>
								<td class="td-desc">{t.description ?? '—'}</td>
								<td class="td-mono">{fmtCurrency(t.amount, t.currency)}</td>
								<td>
									<Badge
										variant={t.status === 'succeeded' ? 'success' : t.status === 'refunded' ? 'warning' : t.status === 'disputed' || t.status === 'failed' ? 'danger' : 'default'}
										size="sm" dot
									>{t.status}</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- ── Stripe ────────────────────────────────────── -->
	<div class="cost-section">
		<div class="section-head">
			<div class="section-icon section-icon--stripe" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
			</div>
			<div>
				<h2 class="section-title">Stripe</h2>
				<p class="section-desc">Connected account balance and recent transaction fees charged by Stripe.</p>
			</div>
			<a href="https://dashboard.stripe.com/{data.stripeConnectedAccountId}" target="_blank" rel="noopener noreferrer" class="ext-link">
				Stripe Dashboard
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
			</a>
		</div>

		{#if loading}
			<div class="balance-row">
				{#each { length: 2 } as _}
					<div class="balance-card">
						<div class="skel" style="width:70px;height:10px;margin-bottom:8px"></div>
						<div class="skel" style="width:110px;height:28px"></div>
					</div>
				{/each}
			</div>
		{:else if !stripeBalance}
			<div class="stripe-unavail">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
				Stripe balance unavailable — check your connected account credentials.
			</div>
		{:else}
			<div class="balance-row">
				<div class="balance-card">
					<div class="balance-label">Available balance</div>
					<div class="balance-amount">
						{#each stripeBalance.available as b}
							<span>{fmtCurrency(b.amount, b.currency)}</span>
						{:else}
							<span class="balance-zero">$0.00</span>
						{/each}
					</div>
					<div class="balance-note">Ready to pay out</div>
				</div>
				<div class="balance-card balance-card--pending">
					<div class="balance-label">Pending balance</div>
					<div class="balance-amount">
						{#each stripeBalance.pending as b}
							<span>{fmtCurrency(b.amount, b.currency)}</span>
						{:else}
							<span class="balance-zero">$0.00</span>
						{/each}
					</div>
					<div class="balance-note">In transit, not yet available</div>
				</div>
				<div class="balance-card balance-card--info">
					<div class="balance-label">Processing rate</div>
					<div class="balance-amount balance-amount--rate">2.9% + 30¢</div>
					<div class="balance-note">Per successful card charge (standard)</div>
				</div>
			</div>
		{/if}

		{#if recentFees.length > 0}
			<div class="fees-table-wrap">
				<div class="fees-table-head">Recent charges</div>
				<table class="fees-table" aria-label="Recent Stripe charges">
					<thead>
						<tr>
							<th>Date</th>
							<th>Description</th>
							<th>Charge</th>
							<th>Stripe fee</th>
							<th>Net</th>
						</tr>
					</thead>
					<tbody>
						{#each recentFees as c}
							<tr>
								<td class="td-mono">{fmtDate(c.created)}</td>
								<td class="td-desc">{c.description ?? '—'}</td>
								<td class="td-mono">{fmtCurrency(c.amount, c.currency)}</td>
								<td class="td-mono td-fee">{c.fee > 0 ? fmtCurrency(c.fee, c.currency) : '—'}</td>
								<td class="td-mono td-net">{fmtCurrency(c.amount - c.fee, c.currency)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- ── Other platform costs ───────────────────────── -->
	<div class="cost-section">
		<div class="section-head">
			<div class="section-icon section-icon--other" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
			</div>
			<div>
				<h2 class="section-title">Other platform costs</h2>
				<p class="section-desc">Fixed and recurring third-party services billed directly to OmniPlot.</p>
			</div>
		</div>

		<table class="costs-table" aria-label="Platform costs">
			<thead>
				<tr>
					<th>Service</th>
					<th>Category</th>
					<th>Estimated cost</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each OTHER_COSTS as row}
					<tr>
						<td class="td-service">{row.service}</td>
						<td><span class="category-chip">{row.category}</span></td>
						<td class="td-mono">{row.estimate}</td>
						<td class="td-link">
							{#if row.link}
								<a href={row.link} target="_blank" rel="noopener noreferrer" class="ext-link ext-link--sm">
									Dashboard
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
								</a>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

</div>

<style>
	@keyframes spin { to { transform: rotate(360deg); } }
	@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

	.billing-page {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1080px;
	}

	/* Header */
	.page-header  { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.page-title   { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub     { font-size: 0.875rem; color: var(--text-secondary); }
	.refresh-btn  {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 6px 12px; font-size: 0.8125rem; font-family: var(--font-body); font-weight: 500;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer;
		transition: background 0.12s, color 0.12s; flex-shrink: 0;
	}
	.refresh-btn:hover    { background: var(--bg-surface-3); color: var(--text-primary); }
	.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.spinning { animation: spin 0.9s linear infinite; }

	/* Error */
	.load-error  { background: var(--bg-surface); border: 1px solid rgba(255,77,109,0.25); border-radius: var(--radius-lg); padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.error-msg   { font-size: 0.875rem; color: var(--color-danger); margin: 0; }
	.retry-btn   { padding: 5px 12px; font-size: 0.8125rem; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
	.retry-btn:hover { background: var(--bg-surface-3); }

	/* Section shell */
	.cost-section {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl); overflow: hidden;
	}
	.section-head {
		display: flex; align-items: flex-start; gap: 12px;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle);
	}
	.section-icon {
		width: 32px; height: 32px; border-radius: var(--radius-md); flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		border: 1px solid transparent;
	}
	.section-icon--firebase { background: color-mix(in srgb, #f59e0b 12%, transparent); border-color: color-mix(in srgb, #f59e0b 25%, transparent); color: #f59e0b; }
	.section-icon--stripe   { background: color-mix(in srgb, #60a5ff 12%, transparent); border-color: color-mix(in srgb, #60a5ff 25%, transparent); color: #60a5ff; }
	.section-icon--other    { background: var(--bg-surface-2); border-color: var(--border-default); color: var(--text-tertiary); }
	.section-title { font-size: 0.9375rem; font-weight: 600; margin: 0 0 2px; }
	.section-desc  { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; line-height: 1.5; }

	.ext-link {
		display: inline-flex; align-items: center; gap: 4px; margin-left: auto; flex-shrink: 0;
		font-size: 0.8125rem; color: var(--text-brand); text-decoration: none;
		padding: 5px 10px; border: 1px solid var(--border-default); border-radius: var(--radius-md);
		transition: background 0.12s; white-space: nowrap;
	}
	.ext-link:hover    { background: var(--interactive-hover); }
	.ext-link--sm      { font-size: 0.75rem; padding: 3px 8px; }

	/* Skeleton */
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
		display: block;
	}

	/* Firebase usage grid */
	.usage-grid {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
		background: var(--border-subtle);
	}
	.usage-card {
		background: var(--bg-surface); padding: 14px 16px;
		display: flex; flex-direction: column; gap: 2px;
	}
	.usage-card--note { opacity: 0.8; }
	.usage-card__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
	.usage-card__label  { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); font-family: var(--font-mono); }
	.usage-card__value  { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; }
	.usage-card__value--sm { font-size: 1rem; font-weight: 600; font-family: var(--font-body); letter-spacing: 0; color: var(--text-secondary); }
	.usage-card__limit  { font-size: 0.6875rem; color: var(--text-tertiary); line-height: 1.5; margin-top: 4px; }
	.usage-card__paid   { display: block; color: var(--text-tertiary); opacity: 0.7; }

	.gcp-billing-note {
		display: flex; align-items: flex-start; gap: 8px;
		padding: 10px 16px; background: var(--bg-surface-2);
		border-top: 1px solid var(--border-subtle);
		font-size: 0.8125rem; color: var(--text-tertiary); line-height: 1.5;
	}
	.gcp-billing-note svg { flex-shrink: 0; margin-top: 1px; }
	.gcp-billing-note a   { color: var(--text-brand); text-decoration: none; }
	.gcp-billing-note a:hover { text-decoration: underline; }

	/* Stripe balance */
	.balance-row {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
		background: var(--border-subtle);
	}
	.balance-card {
		background: var(--bg-surface); padding: 16px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.balance-card--pending { opacity: 0.75; }
	.balance-card--info    { background: var(--bg-surface-2); }
	.balance-label  { font-size: 0.6875rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.balance-amount { font-family: var(--font-display); font-size: 1.625rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1.1; display: flex; flex-direction: column; gap: 2px; }
	.balance-amount--rate { font-size: 1.25rem; }
	.balance-zero   { color: var(--text-tertiary); }
	.balance-note   { font-size: 0.75rem; color: var(--text-tertiary); margin-top: 2px; }

	.stripe-unavail {
		display: flex; align-items: center; gap: 8px;
		padding: 14px 16px; font-size: 0.875rem; color: var(--text-tertiary);
	}

	/* Recent fees table */
	.fees-table-wrap { border-top: 1px solid var(--border-subtle); }
	.fees-table-head { padding: 10px 16px 6px; font-size: 0.6875rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.fees-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.fees-table thead { background: var(--bg-surface-2); }
	.fees-table th {
		padding: 7px 14px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.08em;
		border-top: 1px solid var(--border-subtle);
	}
	.fees-table tbody tr  { border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.fees-table tbody tr:hover { background: var(--interactive-hover); }
	.fees-table td { padding: 9px 14px; vertical-align: middle; }
	.td-mono { font-family: var(--font-mono); font-size: 0.8125rem; white-space: nowrap; }
	.td-desc { color: var(--text-secondary); }
	.td-fee  { color: var(--color-danger); opacity: 0.8; }
	.td-net  { color: var(--color-success); font-weight: 600; }

	/* Other costs table */
	.costs-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
	.costs-table thead { background: var(--bg-surface-2); }
	.costs-table th {
		padding: 8px 16px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.08em;
		border-top: 1px solid var(--border-subtle);
	}
	.costs-table tbody tr  { border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.costs-table tbody tr:hover { background: var(--interactive-hover); }
	.costs-table td { padding: 11px 16px; vertical-align: middle; }
	.td-service  { font-weight: 500; color: var(--text-primary); }
	.td-link     { text-align: right; }
	.category-chip {
		display: inline-flex; align-items: center;
		padding: 2px 8px; font-size: 0.6875rem; font-weight: 600; font-family: var(--font-mono);
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: 20px; color: var(--text-tertiary); white-space: nowrap;
	}

	@media (max-width: 900px) {
		.usage-grid   { grid-template-columns: repeat(2, 1fr); }
		.balance-row  { grid-template-columns: 1fr 1fr; }
	}
	@media (max-width: 600px) {
		.billing-page { padding: 16px; }
		.usage-grid   { grid-template-columns: 1fr; }
		.balance-row  { grid-template-columns: 1fr; }
	}
</style>
