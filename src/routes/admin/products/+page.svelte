<script lang="ts">
	import type { PageData } from './$types';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { auth } from '$lib/firebase/client';
	import { onMount } from 'svelte';
	import { toastStore } from '$lib/stores';

	interface Props { data: PageData; }
	let { data }: Props = $props();

	// ─── Types ─────────────────────────────────────
	interface PriceData {
		id: string; productId: string; active: boolean;
		unit_amount: number | null; currency: string;
		interval: 'month' | 'year' | null; nickname: string | null;
		metadata: Record<string, string>; created: number;
	}
	interface ProductWithPrices {
		id: string; name: string; description: string | null;
		active: boolean; metadata: Record<string, string>;
		created: number; prices: PriceData[];
	}
	interface EnvVar { envVar: string; priceId: string; configId: string; isNew: boolean; }

	// ─── State ─────────────────────────────────────
	let loading      = $state(true);
	let error        = $state<string | null>(null);
	let products     = $state<ProductWithPrices[]>([]);
	let summary      = $state({ activeProducts: 0, activePrices: 0, archivedProducts: 0 });
	let showArchived = $state(false);

	let syncing    = $state(false);
	let syncResult = $state<{ created: { products: { id: string; name: string }[]; prices: { id: string; configId: string }[] }; envVars: EnvVar[] } | null>(null);
	let copied     = $state(false);

	let creatingProduct = $state(false);
	let savingProduct   = $state(false);
	let newProduct      = $state({ name: '', description: '', type: 'individual', tier: '' });

	let addingPriceTo = $state<string | null>(null);
	let savingPrice   = $state(false);
	let newPrice      = $state({ amount: '', interval: 'month' as 'month' | 'year', nickname: '' });

	let archivingProduct = $state<string | null>(null);
	let archivingPrice   = $state<string | null>(null);

	// ─── Derived ───────────────────────────────────
	const visibleProducts = $derived(
		showArchived ? products : products.filter(p => p.active)
	);

	// ─── Helpers ───────────────────────────────────
	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
	}

	function fmtAmount(cents: number | null, currency = 'usd'): string {
		if (cents == null) return '—';
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
	}

	function fmtInterval(interval: 'month' | 'year' | null): string {
		if (!interval) return '—';
		return interval === 'month' ? 'Monthly' : 'Yearly';
	}

	function truncateId(id: string): string {
		return id.length > 22 ? `${id.slice(0, 22)}…` : id;
	}

	async function copyText(text: string) {
		await navigator.clipboard.writeText(text);
	}

	// ─── Load data ─────────────────────────────────
	async function load() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/admin/products', { headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json()).error ?? 'Load failed');
			const data = await res.json();
			products = data.products;
			summary  = data.summary;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load billing data';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// ─── Sync from config ──────────────────────────
	async function syncConfig() {
		syncing = true; syncResult = null;
		try {
			const res = await fetch('/api/admin/products', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'sync_config' }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Sync failed');
			syncResult = data;
			const np = data.created.products.length, nr = data.created.prices.length;
			if (np === 0 && nr === 0) {
				toastStore.success('Already in sync', 'All plans already exist in Stripe.');
			} else {
				toastStore.success('Sync complete', `Created ${np} product${np !== 1 ? 's' : ''} and ${nr} price${nr !== 1 ? 's' : ''}.`);
			}
			await load();
		} catch (e) {
			toastStore.error('Sync failed', e instanceof Error ? e.message : 'Unknown error');
		} finally {
			syncing = false;
		}
	}

	// ─── Create product ────────────────────────────
	async function createProduct() {
		if (!newProduct.name.trim()) return;
		savingProduct = true;
		try {
			const meta: Record<string, string> = { type: newProduct.type };
			if (newProduct.tier) meta.tier = newProduct.tier;
			const res = await fetch('/api/admin/products', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'create_product', name: newProduct.name.trim(), description: newProduct.description, metadata: meta }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Create failed');
			products = [data.product, ...products];
			summary.activeProducts++;
			newProduct = { name: '', description: '', type: 'individual', tier: '' };
			creatingProduct = false;
			toastStore.success('Product created', `${data.product.name} added to Stripe.`);
		} catch (e) {
			toastStore.error('Create failed', e instanceof Error ? e.message : 'Unknown error');
		} finally {
			savingProduct = false;
		}
	}

	// ─── Create price ──────────────────────────────
	async function createPrice(productId: string) {
		if (!newPrice.amount) return;
		savingPrice = true;
		try {
			const res = await fetch('/api/admin/products', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'create_price', productId, amount: newPrice.amount, interval: newPrice.interval, nickname: newPrice.nickname }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Create failed');
			products = products.map(p =>
				p.id === productId ? { ...p, prices: [...p.prices, data.price] } : p
			);
			summary.activePrices++;
			newPrice = { amount: '', interval: 'month', nickname: '' };
			addingPriceTo = null;
			toastStore.success('Price created', `${data.price.nickname ?? data.price.id} added.`);
		} catch (e) {
			toastStore.error('Create failed', e instanceof Error ? e.message : 'Unknown error');
		} finally {
			savingPrice = false;
		}
	}

	// ─── Archive product ───────────────────────────
	async function archiveProduct(productId: string) {
		archivingProduct = productId;
		try {
			const res = await fetch('/api/admin/products', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'archive_product', productId }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Archive failed');
			products = products.map(p => p.id === productId ? { ...p, active: false } : p);
			summary.activeProducts = Math.max(0, summary.activeProducts - 1);
			summary.archivedProducts++;
			toastStore.success('Archived', 'Product archived in Stripe.');
		} catch (e) {
			toastStore.error('Archive failed', e instanceof Error ? e.message : 'Unknown error');
		} finally {
			archivingProduct = null;
		}
	}

	// ─── Archive price ─────────────────────────────
	async function archivePrice(priceId: string, productId: string) {
		archivingPrice = priceId;
		try {
			const res = await fetch('/api/admin/products', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'archive_price', priceId }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Archive failed');
			products = products.map(p =>
				p.id === productId
					? { ...p, prices: p.prices.map(pr => pr.id === priceId ? { ...pr, active: false } : pr) }
					: p
			);
			summary.activePrices = Math.max(0, summary.activePrices - 1);
			toastStore.success('Price archived', 'Price archived in Stripe.');
		} catch (e) {
			toastStore.error('Archive failed', e instanceof Error ? e.message : 'Unknown error');
		} finally {
			archivingPrice = null;
		}
	}

	async function copyEnvVars() {
		if (!syncResult) return;
		const text = syncResult.envVars.map(v => `${v.envVar}=${v.priceId}`).join('\n');
		await copyText(text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head><title>Products — Admin — OmniPlot</title></svelte:head>

<div class="billing-page">

	<!-- Header -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Products</h1>
			<p class="page-sub">Stripe products, prices, and subscription plans.</p>
		</div>
		<div class="header-actions">
			<a href="https://dashboard.stripe.com/{data.stripeConnectedAccountId}/products" target="_blank" rel="noopener noreferrer" class="stripe-link">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
				Stripe Dashboard
			</a>
		</div>
	</div>

	<!-- Error -->
	{#if error}
		<div class="load-error">
			<div>
				<p class="error-title">Could not connect to Stripe</p>
				<p class="error-detail">{error}</p>
			</div>
			<button class="retry-btn" onclick={load}>Retry</button>
		</div>
	{/if}

	<!-- Summary -->
	{#if !error}
		<div class="summary-bar">
			{#if loading}
				{#each { length: 3 } as _}
					<div class="summary-card summary-card--skel">
						<div class="skel" style="width:80px;height:9px;"></div>
						<div class="skel" style="width:40px;height:26px;margin-top:6px;"></div>
					</div>
				{/each}
			{:else}
				<div class="summary-card">
					<div class="summary-label">Active Products</div>
					<div class="summary-value">{summary.activeProducts}</div>
				</div>
				<div class="summary-card">
					<div class="summary-label">Active Prices</div>
					<div class="summary-value">{summary.activePrices}</div>
				</div>
				<div class="summary-card summary-card--muted">
					<div class="summary-label">Archived Products</div>
					<div class="summary-value">{summary.archivedProducts}</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Sync from config -->
	<div class="section">
		<div class="section-header">
			<div>
				<h2 class="section-title">Sync from pricing config</h2>
				<p class="section-desc">Creates all products and prices defined in your app's pricing config. Safe to re-run — skips anything already in Stripe.</p>
			</div>
			<Button variant="primary" size="sm" onclick={syncConfig} disabled={syncing}>
				{#if syncing}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" style="animation:spin 0.9s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
					Syncing…
				{:else}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
					Sync from config
				{/if}
			</Button>
		</div>

		<!-- Plans being synced -->
		<div class="sync-plans">
			<div class="sync-plans-label">Plans included</div>
			<div class="plan-chips">
				{#each ['Lite', 'Pro', 'Shop — Starter', 'Shop — Team', 'Shop — Studio'] as plan}
					<span class="plan-chip">{plan}</span>
				{/each}
				<span class="plan-chip plan-chip--muted">Free (no Stripe product needed)</span>
			</div>
		</div>

		<!-- Sync result -->
		{#if syncResult}
			<div class="sync-result">
				<div class="sync-result__header">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color:var(--color-success)"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
					<span class="sync-result__title">
						{#if syncResult.created.products.length === 0 && syncResult.created.prices.length === 0}
							All plans already in Stripe — nothing to create
						{:else}
							Created {syncResult.created.products.length} product{syncResult.created.products.length !== 1 ? 's' : ''} and {syncResult.created.prices.length} price{syncResult.created.prices.length !== 1 ? 's' : ''}
						{/if}
					</span>
				</div>

				{#if syncResult.envVars.length > 0}
					<div class="env-block">
						<div class="env-block__header">
							<span class="env-block__title">Add to your <code>.env</code> file</span>
							<button class="copy-btn" onclick={copyEnvVars}>
								{#if copied}
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
									Copied
								{:else}
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
									Copy all
								{/if}
							</button>
						</div>
						<div class="env-vars">
							{#each syncResult.envVars as v}
								<div class="env-row" class:env-row--new={v.isNew}>
									<code class="env-key">{v.envVar}</code>
									<span class="env-eq">=</span>
									<code class="env-val">{v.priceId}</code>
									{#if v.isNew}
										<span class="env-new-badge">new</span>
									{/if}
									<button class="env-copy" onclick={() => copyText(`${v.envVar}=${v.priceId}`)} title="Copy">
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Products list -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Products &amp; Prices</h2>
			<div style="display:flex;align-items:center;gap:10px;">
				<label class="archived-toggle">
					<input type="checkbox" bind:checked={showArchived} />
					<span>Show archived</span>
				</label>
				<button class="icon-btn" onclick={load} title="Refresh" disabled={loading}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
				</button>
			</div>
		</div>

		{#if loading}
			<div class="products-skeleton">
				{#each { length: 3 } as _}
					<div class="product-skel">
						<div class="skel" style="width:180px;height:13px;"></div>
						<div class="skel" style="width:80px;height:10px;margin-top:4px;"></div>
					</div>
				{/each}
			</div>
		{:else if visibleProducts.length === 0}
			<div class="empty-state">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true" style="color:var(--text-tertiary)"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
				<p>No products yet</p>
				<span>Use "Sync from config" above to create all plans, or add one manually below.</span>
			</div>
		{:else}
			<div class="products-list">
				{#each visibleProducts as product (product.id)}
					<div class="product-card" class:product-card--archived={!product.active}>
						<!-- Product header row -->
						<div class="product-header">
							<div class="product-meta">
								<span class="product-name">{product.name}</span>
								{#if product.metadata.type}
									<span class="product-type-chip">{product.metadata.type}</span>
								{/if}
								{#if product.metadata.tier}
									<span class="product-type-chip product-type-chip--tier">{product.metadata.tier}</span>
								{/if}
								{#if product.metadata.plan}
									<span class="product-type-chip product-type-chip--tier">{product.metadata.plan}</span>
								{/if}
							</div>
							<div class="product-actions">
								<code class="product-id" title={product.id}>{truncateId(product.id)}</code>
								<button class="id-copy" onclick={() => copyText(product.id)} title="Copy product ID">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
								</button>
								<Badge variant={product.active ? 'success' : 'default'} size="sm" dot={product.active}>
									{product.active ? 'active' : 'archived'}
								</Badge>
								{#if product.active}
									<button
										class="action-btn action-btn--danger"
										onclick={() => archiveProduct(product.id)}
										disabled={archivingProduct === product.id}
									>
										{archivingProduct === product.id ? 'Archiving…' : 'Archive'}
									</button>
								{/if}
							</div>
						</div>

						<!-- Prices table -->
						{#if product.prices.length > 0}
							<table class="prices-table" aria-label="Prices for {product.name}">
								<thead>
									<tr>
										<th>Nickname</th>
										<th>Interval</th>
										<th>Amount</th>
										<th>Price ID</th>
										<th>Status</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{#each product.prices as price (price.id)}
										<tr class:row--archived={!price.active}>
											<td class="td-nickname">{price.nickname ?? '—'}</td>
											<td class="td-interval">{fmtInterval(price.interval)}</td>
											<td class="td-amount">{fmtAmount(price.unit_amount, price.currency)}</td>
											<td class="td-id">
												<div class="id-cell">
													<code>{truncateId(price.id)}</code>
													<button class="id-copy" onclick={() => copyText(price.id)} title="Copy price ID">
														<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
													</button>
												</div>
											</td>
											<td>
												<Badge variant={price.active ? 'success' : 'default'} size="sm">
													{price.active ? 'active' : 'archived'}
												</Badge>
											</td>
											<td class="td-actions">
												{#if price.active}
													<button
														class="action-btn action-btn--danger action-btn--sm"
														onclick={() => archivePrice(price.id, product.id)}
														disabled={archivingPrice === price.id}
													>
														{archivingPrice === price.id ? '…' : 'Archive'}
													</button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<div class="no-prices">No prices yet</div>
						{/if}

						<!-- Add price form -->
						{#if product.active}
							<div class="product-footer">
								{#if addingPriceTo === product.id}
									<div class="add-price-form">
										<input
											class="field-input field-input--sm"
											type="number" min="0.01" step="0.01"
											placeholder="Amount in USD (e.g. 29.00)"
											bind:value={newPrice.amount}
										/>
										<select class="field-select" bind:value={newPrice.interval}>
											<option value="month">Monthly</option>
											<option value="year">Yearly</option>
										</select>
										<input
											class="field-input field-input--sm"
											type="text"
											placeholder="Nickname (optional)"
											bind:value={newPrice.nickname}
										/>
										<Button variant="primary" size="sm" onclick={() => createPrice(product.id)} disabled={savingPrice || !newPrice.amount}>
											{savingPrice ? 'Adding…' : 'Add'}
										</Button>
										<button class="cancel-btn" onclick={() => { addingPriceTo = null; newPrice = { amount: '', interval: 'month', nickname: '' }; }}>
											Cancel
										</button>
									</div>
								{:else}
									<button class="add-price-btn" onclick={() => { addingPriceTo = product.id; newPrice = { amount: '', interval: 'month', nickname: '' }; }}>
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
										Add price
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Create product -->
	<div class="section">
		<div class="section-header">
			<h2 class="section-title">Create product</h2>
			{#if !creatingProduct}
				<Button variant="secondary" size="sm" onclick={() => (creatingProduct = true)}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
					New product
				</Button>
			{/if}
		</div>

		{#if creatingProduct}
			<div class="create-form">
				<div class="form-grid">
					<div class="form-field">
						<label class="field-label" for="prod-name">Name <span class="required">*</span></label>
						<input id="prod-name" class="field-input" type="text" placeholder="e.g. OmniPlot Pro" bind:value={newProduct.name} />
					</div>
					<div class="form-field">
						<label class="field-label" for="prod-type">Type</label>
						<select id="prod-type" class="field-select" bind:value={newProduct.type}>
							<option value="individual">Individual</option>
							<option value="shop">Shop / Team</option>
						</select>
					</div>
					<div class="form-field form-field--full">
						<label class="field-label" for="prod-desc">Description</label>
						<input id="prod-desc" class="field-input" type="text" placeholder="Short description shown in Stripe" bind:value={newProduct.description} />
					</div>
					<div class="form-field">
						<label class="field-label" for="prod-tier">Tier / Plan key <span class="field-hint">(metadata)</span></label>
						<input id="prod-tier" class="field-input" type="text" placeholder="e.g. pro, lite, starter" bind:value={newProduct.tier} />
					</div>
				</div>
				<div class="form-footer">
					<Button variant="primary" size="sm" onclick={createProduct} disabled={savingProduct || !newProduct.name.trim()}>
						{savingProduct ? 'Creating…' : 'Create product'}
					</Button>
					<button class="cancel-btn" onclick={() => { creatingProduct = false; newProduct = { name: '', description: '', type: 'individual', tier: '' }; }}>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<div class="create-hint">
				Manually create a Stripe product outside of the pricing config — useful for one-off, custom, or legacy plans.
			</div>
		{/if}
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
	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.page-title  { font-size: 1.375rem; margin-bottom: 3px; }
	.page-sub    { font-size: 0.875rem; color: var(--text-secondary); }
	.header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
	.stripe-link {
		display: inline-flex; align-items: center; gap: 5px;
		font-size: 0.8125rem; color: var(--text-brand);
		text-decoration: none; padding: 6px 10px;
		border: 1px solid var(--border-default); border-radius: var(--radius-md);
		transition: background 0.12s;
	}
	.stripe-link:hover { background: var(--interactive-hover); }

	/* Error */
	.load-error {
		background: var(--bg-surface); border: 1px solid rgba(255,77,109,0.25);
		border-radius: var(--radius-lg); padding: 16px 20px;
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
	}
	.error-title  { font-size: 0.875rem; font-weight: 600; color: var(--color-danger); margin: 0 0 3px; }
	.error-detail { font-size: 0.8125rem; color: var(--text-secondary); margin: 0; font-family: var(--font-mono); }
	.retry-btn {
		padding: 6px 14px; font-size: 0.8125rem; background: var(--bg-surface-2);
		border: 1px solid var(--border-default); border-radius: var(--radius-md);
		color: var(--text-secondary); cursor: pointer; white-space: nowrap; flex-shrink: 0;
	}
	.retry-btn:hover { background: var(--bg-surface-3); }

	/* Summary */
	.summary-bar {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
	}
	.summary-card {
		background: var(--bg-surface); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg); padding: 14px 16px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.summary-card--skel  { pointer-events: none; }
	.summary-card--muted { opacity: 0.6; }
	.summary-label { font-size: 0.6875rem; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.summary-value { font-family: var(--font-display); font-size: 1.75rem; font-weight: 800; letter-spacing: -0.03em; color: var(--text-primary); line-height: 1; }

	/* Skeleton */
	.skel {
		background: linear-gradient(90deg, var(--bg-surface-2) 25%, var(--bg-surface-3) 50%, var(--bg-surface-2) 75%);
		background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
	}

	/* Sections */
	.section { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); overflow: hidden; }
	.section-header {
		display: flex; align-items: flex-start; justify-content: space-between;
		padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); gap: 12px;
	}
	.section-title { font-size: 0.9375rem; font-weight: 600; margin: 0 0 1px; }
	.section-desc  { font-size: 0.8125rem; color: var(--text-tertiary); margin: 3px 0 0; max-width: 520px; line-height: 1.5; }

	/* Sync plans */
	.sync-plans { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 12px; }
	.sync-plans-label { font-size: 0.75rem; color: var(--text-tertiary); font-family: var(--font-mono); white-space: nowrap; }
	.plan-chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.plan-chip {
		display: inline-flex; align-items: center; padding: 2px 8px;
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: 20px; font-size: 0.75rem; font-weight: 500; color: var(--text-secondary);
	}
	.plan-chip--muted { color: var(--text-tertiary); font-style: italic; }

	/* Sync result */
	.sync-result {
		margin: 0; padding: 14px 16px;
		border-top: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--color-success) 5%, transparent);
	}
	.sync-result__header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
	.sync-result__title  { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); }

	/* Env block */
	.env-block {
		background: var(--bg-base); border: 1px solid var(--border-default);
		border-radius: var(--radius-lg); overflow: hidden;
	}
	.env-block__header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 8px 12px; border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface-2);
	}
	.env-block__title { font-size: 0.8125rem; color: var(--text-secondary); }
	.env-block__title code { font-family: var(--font-mono); font-size: 0.8125rem; background: var(--bg-surface-3); padding: 1px 5px; border-radius: 3px; }
	.copy-btn {
		display: inline-flex; align-items: center; gap: 4px;
		padding: 4px 10px; font-size: 0.75rem; font-weight: 500;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer;
		transition: all 0.12s;
	}
	.copy-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.env-vars { padding: 4px 0; }
	.env-row {
		display: flex; align-items: center; gap: 4px;
		padding: 6px 12px; font-family: var(--font-mono); font-size: 0.8125rem;
		border-top: 1px solid var(--border-subtle);
	}
	.env-row:first-child { border-top: none; }
	.env-row--new { background: color-mix(in srgb, var(--color-success) 5%, transparent); }
	.env-key  { color: var(--text-brand); flex-shrink: 0; }
	.env-eq   { color: var(--text-tertiary); padding: 0 2px; }
	.env-val  { color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.env-new-badge {
		font-size: 0.625rem; font-weight: 700; font-family: var(--font-mono);
		text-transform: uppercase; color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
	}
	.env-copy {
		background: none; border: none; cursor: pointer; padding: 3px; border-radius: 3px;
		color: var(--text-tertiary); transition: color 0.1s, background 0.1s; flex-shrink: 0;
	}
	.env-copy:hover { color: var(--text-primary); background: var(--bg-surface-2); }

	/* Products list */
	.products-skeleton { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
	.product-skel { display: flex; flex-direction: column; gap: 6px; }

	.empty-state {
		display: flex; flex-direction: column; align-items: center; gap: 8px;
		padding: 48px 16px; color: var(--text-tertiary);
	}
	.empty-state p    { font-size: 0.9375rem; font-weight: 500; color: var(--text-secondary); margin: 4px 0 0; }
	.empty-state span { font-size: 0.8125rem; text-align: center; max-width: 340px; }

	.products-list { display: flex; flex-direction: column; }

	.product-card {
		border-top: 1px solid var(--border-subtle);
		transition: background 0.1s;
	}
	.product-card:first-child { border-top: none; }
	.product-card--archived { opacity: 0.55; }

	.product-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 12px 16px; gap: 12px;
	}
	.product-meta  { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.product-name  { font-size: 0.9375rem; font-weight: 600; color: var(--text-primary); }
	.product-type-chip {
		display: inline-flex; align-items: center; padding: 1px 7px;
		background: var(--bg-surface-2); border: 1px solid var(--border-subtle);
		border-radius: 20px; font-size: 0.6875rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary); white-space: nowrap;
	}
	.product-type-chip--tier { color: var(--text-brand); border-color: color-mix(in srgb, var(--color-brand-dim) 40%, transparent); }

	.product-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
	.product-id {
		font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary);
		max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.id-copy {
		background: none; border: none; cursor: pointer; padding: 3px; border-radius: 3px;
		color: var(--text-tertiary); transition: color 0.1s, background 0.1s; flex-shrink: 0;
	}
	.id-copy:hover { color: var(--text-primary); background: var(--bg-surface-2); }

	/* Prices table */
	.prices-table {
		width: 100%; border-collapse: collapse; font-size: 0.8125rem;
		border-top: 1px solid var(--border-subtle);
	}
	.prices-table thead { background: var(--bg-surface-2); }
	.prices-table th {
		padding: 7px 16px; text-align: left; font-size: 0.625rem; font-weight: 600;
		font-family: var(--font-mono); color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.08em;
	}
	.prices-table tbody tr { border-top: 1px solid var(--border-subtle); transition: background 0.1s; }
	.prices-table tbody tr:hover { background: var(--interactive-hover); }
	.prices-table td { padding: 9px 16px; vertical-align: middle; }
	.row--archived { opacity: 0.5; }

	.td-nickname { font-weight: 500; color: var(--text-primary); }
	.td-interval { color: var(--text-secondary); }
	.td-amount   { font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); white-space: nowrap; }
	.td-actions  { text-align: right; }

	.id-cell { display: flex; align-items: center; gap: 4px; }
	.id-cell code { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary); }

	.no-prices { padding: 12px 16px; font-size: 0.8125rem; color: var(--text-tertiary); border-top: 1px solid var(--border-subtle); }

	/* Product footer (add price) */
	.product-footer { padding: 10px 16px; border-top: 1px solid var(--border-subtle); background: var(--bg-surface-2); }
	.add-price-btn {
		display: inline-flex; align-items: center; gap: 5px;
		font-size: 0.8125rem; font-weight: 500; color: var(--text-brand);
		background: none; border: none; cursor: pointer; padding: 3px 0;
		transition: opacity 0.12s;
	}
	.add-price-btn:hover { opacity: 0.75; }

	.add-price-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

	/* Action buttons */
	.action-btn {
		padding: 4px 10px; font-size: 0.75rem; font-weight: 500;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-sm); cursor: pointer; transition: all 0.12s;
		color: var(--text-secondary); white-space: nowrap;
	}
	.action-btn:hover { background: var(--bg-surface-3); color: var(--text-primary); }
	.action-btn--danger       { color: var(--color-danger); border-color: rgba(255,77,109,0.3); }
	.action-btn--danger:hover { background: color-mix(in srgb, var(--color-danger) 8%, transparent); }
	.action-btn--sm           { padding: 3px 8px; font-size: 0.6875rem; }
	.action-btn:disabled      { opacity: 0.5; cursor: not-allowed; }

	.icon-btn {
		display: inline-flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; background: none; border: 1px solid var(--border-default);
		border-radius: var(--radius-md); cursor: pointer; color: var(--text-tertiary);
		transition: all 0.12s;
	}
	.icon-btn:hover    { background: var(--interactive-hover); color: var(--text-primary); }
	.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Archived toggle */
	.archived-toggle {
		display: flex; align-items: center; gap: 6px;
		font-size: 0.8125rem; color: var(--text-secondary); cursor: pointer;
		user-select: none;
	}
	.archived-toggle input { accent-color: var(--color-brand-dim); }

	/* Create form */
	.create-form { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
	.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.form-field { display: flex; flex-direction: column; gap: 5px; }
	.form-field--full { grid-column: 1 / -1; }
	.field-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
	.field-hint  { font-weight: 400; color: var(--text-tertiary); font-size: 0.75rem; }
	.required    { color: var(--color-danger); }
	.field-input, .field-select {
		padding: 7px 10px; background: var(--bg-base); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); font-size: 0.875rem; font-family: var(--font-body);
		color: var(--text-primary); outline: none; transition: border-color 0.12s;
	}
	.field-input:focus, .field-select:focus { border-color: var(--color-brand-dim); }
	.field-input--sm { width: 160px; }
	.field-select { cursor: pointer; }

	.form-footer { display: flex; align-items: center; gap: 8px; }
	.cancel-btn {
		padding: 6px 12px; font-size: 0.8125rem; background: none; border: none;
		color: var(--text-tertiary); cursor: pointer; border-radius: var(--radius-md);
		transition: color 0.12s;
	}
	.cancel-btn:hover { color: var(--text-primary); }

	.create-hint { padding: 14px 16px; font-size: 0.8125rem; color: var(--text-tertiary); }

	@media (max-width: 768px) {
		.billing-page  { padding: 16px; }
		.summary-bar   { grid-template-columns: repeat(2, 1fr); }
		.form-grid     { grid-template-columns: 1fr; }
		.product-header { flex-direction: column; align-items: flex-start; }
	}
</style>
