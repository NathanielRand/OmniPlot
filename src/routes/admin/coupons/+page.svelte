<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { auth } from '$lib/firebase/client';
	import { onMount } from 'svelte';
	import { toastStore } from '$lib/stores';

	// ─── Types ─────────────────────────────────────
	interface Coupon {
		id: string;
		percent_off: number | null;
		amount_off: number | null;
		currency: string | null;
		duration: 'once' | 'repeating' | 'forever';
		duration_in_months: number | null;
		max_redemptions: number | null;
		times_redeemed: number;
		redeem_by: number | null;
		valid: boolean;
	}
	interface PromoCode {
		id: string;
		code: string;
		active: boolean;
		coupon: Coupon;
		max_redemptions: number | null;
		times_redeemed: number;
		expires_at: number | null;
		created: number;
	}

	// ─── State ─────────────────────────────────────
	let loading   = $state(true);
	let error     = $state<string | null>(null);
	let codes     = $state<PromoCode[]>([]);
	let showForm  = $state(false);
	let saving    = $state(false);
	let deactivating = $state<string | null>(null);

	// Form state
	let f = $state({
		code:           '',
		discountType:   'percent' as 'percent' | 'amount',
		discountValue:  '',
		duration:       'once' as 'once' | 'repeating' | 'forever',
		durationMonths: '3',
		maxRedemptions: '',
		expiresAt:      '',
	});

	// ─── Derived ───────────────────────────────────
	const activeCodes   = $derived(codes.filter(c => c.active));
	const inactiveCodes = $derived(codes.filter(c => !c.active));
	const totalRedeemed = $derived(codes.reduce((sum, c) => sum + c.times_redeemed, 0));

	// ─── Helpers ───────────────────────────────────
	async function authHeaders() {
		const token = await auth.currentUser?.getIdToken();
		return token
			? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
			: { 'Content-Type': 'application/json' };
	}

	function fmtDiscount(coupon: Coupon): string {
		if (coupon.percent_off != null) return `${coupon.percent_off}% off`;
		if (coupon.amount_off  != null)
			return `$${(coupon.amount_off / 100).toFixed(2)} off`;
		return '—';
	}

	function fmtDuration(coupon: Coupon): string {
		if (coupon.duration === 'once')       return 'First payment';
		if (coupon.duration === 'forever')    return 'Forever';
		if (coupon.duration === 'repeating')  return `${coupon.duration_in_months} month${coupon.duration_in_months === 1 ? '' : 's'}`;
		return '—';
	}

	function fmtDate(unix: number | null): string {
		if (!unix) return '—';
		return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function fmtRedemptions(code: PromoCode): string {
		const max = code.max_redemptions ?? code.coupon.max_redemptions;
		return max ? `${code.times_redeemed} / ${max}` : `${code.times_redeemed}`;
	}

	function resetForm() {
		f = { code: '', discountType: 'percent', discountValue: '', duration: 'once', durationMonths: '3', maxRedemptions: '', expiresAt: '' };
	}

	// ─── Load ──────────────────────────────────────
	async function load() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/admin/coupons', { headers: await authHeaders() });
			if (!res.ok) throw new Error((await res.json()).error ?? 'Load failed');
			const d = await res.json();
			codes = d.codes;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load coupons';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// ─── Create ────────────────────────────────────
	async function createCode() {
		if (!f.discountValue || Number(f.discountValue) <= 0) {
			toastStore.error('Validation', 'Enter a valid discount value.');
			return;
		}
		if (f.discountType === 'percent' && Number(f.discountValue) > 100) {
			toastStore.error('Validation', 'Percentage cannot exceed 100.');
			return;
		}
		if (f.duration === 'repeating' && (!f.durationMonths || Number(f.durationMonths) < 1)) {
			toastStore.error('Validation', 'Enter number of months.');
			return;
		}

		saving = true;
		try {
			const res = await fetch('/api/admin/coupons', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({
					code:           f.code.trim().toUpperCase() || undefined,
					discountType:   f.discountType,
					discountValue:  f.discountValue,
					duration:       f.duration,
					durationMonths: f.durationMonths || undefined,
					maxRedemptions: f.maxRedemptions || undefined,
					expiresAt:      f.expiresAt      || undefined,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Create failed');
			const { code: newCode } = await res.json();
			codes = [newCode, ...codes];
			toastStore.success('Created', `Code "${newCode.code}" is active.`);
			resetForm();
			showForm = false;
		} catch (e) {
			toastStore.error('Error', e instanceof Error ? e.message : 'Could not create code');
		} finally {
			saving = false;
		}
	}

	// ─── Deactivate ────────────────────────────────
	async function deactivate(id: string, code: string) {
		if (!confirm(`Deactivate "${code}"? Users with this code can no longer redeem it.`)) return;
		deactivating = id;
		try {
			const res = await fetch('/api/admin/coupons', {
				method: 'PATCH',
				headers: await authHeaders(),
				body: JSON.stringify({ id }),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Deactivate failed');
			codes = codes.map(c => c.id === id ? { ...c, active: false } : c);
			toastStore.success('Deactivated', `"${code}" has been disabled.`);
		} catch (e) {
			toastStore.error('Error', e instanceof Error ? e.message : 'Could not deactivate');
		} finally {
			deactivating = null;
		}
	}
</script>

<div class="coupons-page">

	<!-- Header -->
	<div class="page-header">
		<div class="page-header__left">
			<h1 class="page-title">Coupon Codes</h1>
			<p class="page-sub">Manage Stripe promotion codes for checkout discounts.</p>
		</div>
		<Button onclick={() => { showForm = !showForm; resetForm(); }}>
			{showForm ? 'Cancel' : '+ New code'}
		</Button>
	</div>

	<!-- Stats -->
	<div class="stats-row">
		<div class="stat">
			<span class="stat__value">{activeCodes.length}</span>
			<span class="stat__label">Active codes</span>
		</div>
		<div class="stat">
			<span class="stat__value">{inactiveCodes.length}</span>
			<span class="stat__label">Inactive</span>
		</div>
		<div class="stat">
			<span class="stat__value">{totalRedeemed}</span>
			<span class="stat__label">Total redemptions</span>
		</div>
	</div>

	<!-- Create form -->
	{#if showForm}
		<div class="form-card">
			<h2 class="form-card__title">New promotion code</h2>

			<div class="form-grid">
				<!-- Code -->
				<div class="field field--full">
					<label class="field__label" for="f-code">
						Promo code <span class="field__hint">(leave blank to auto-generate)</span>
					</label>
					<input
						id="f-code"
						class="field__input field__input--mono"
						type="text"
						placeholder="e.g. LAUNCH50"
						bind:value={f.code}
						oninput={() => f.code = f.code.toUpperCase()}
					/>
				</div>

				<!-- Discount type + value -->
				<div class="field">
					<label class="field__label">Discount type</label>
					<div class="radio-row">
						<label class="radio">
							<input type="radio" bind:group={f.discountType} value="percent" />
							<span>Percent off (%)</span>
						</label>
						<label class="radio">
							<input type="radio" bind:group={f.discountType} value="amount" />
							<span>Fixed amount ($)</span>
						</label>
					</div>
				</div>

				<div class="field">
					<label class="field__label" for="f-value">
						{f.discountType === 'percent' ? 'Percent off' : 'Amount off (USD)'}
					</label>
					<div class="input-wrap">
						<span class="input-wrap__prefix">{f.discountType === 'percent' ? '%' : '$'}</span>
						<input
							id="f-value"
							class="field__input field__input--prefixed"
							type="number"
							min="0"
							max={f.discountType === 'percent' ? 100 : undefined}
							step={f.discountType === 'percent' ? 1 : 0.01}
							placeholder={f.discountType === 'percent' ? '50' : '10.00'}
							bind:value={f.discountValue}
						/>
					</div>
				</div>

				<!-- Duration -->
				<div class="field">
					<label class="field__label" for="f-duration">Duration</label>
					<select id="f-duration" class="field__select" bind:value={f.duration}>
						<option value="once">First payment only</option>
						<option value="repeating">Multiple months</option>
						<option value="forever">Forever (all payments)</option>
					</select>
				</div>

				{#if f.duration === 'repeating'}
					<div class="field">
						<label class="field__label" for="f-months">Number of months</label>
						<input
							id="f-months"
							class="field__input"
							type="number"
							min="1"
							placeholder="3"
							bind:value={f.durationMonths}
						/>
					</div>
				{/if}

				<!-- Max redemptions -->
				<div class="field">
					<label class="field__label" for="f-max">
						Max redemptions <span class="field__hint">(optional)</span>
					</label>
					<input
						id="f-max"
						class="field__input"
						type="number"
						min="1"
						placeholder="Unlimited"
						bind:value={f.maxRedemptions}
					/>
				</div>

				<!-- Expiry -->
				<div class="field">
					<label class="field__label" for="f-expires">
						Expires <span class="field__hint">(optional)</span>
					</label>
					<input
						id="f-expires"
						class="field__input"
						type="date"
						bind:value={f.expiresAt}
					/>
				</div>
			</div>

			<!-- Preview -->
			{#if f.discountValue && Number(f.discountValue) > 0}
				<div class="preview">
					<span class="preview__label">Preview:</span>
					<span class="preview__text">
						{f.code.trim() || 'AUTO'}
						&nbsp;→&nbsp;
						{f.discountType === 'percent' ? `${f.discountValue}% off` : `$${Number(f.discountValue).toFixed(2)} off`}
						&nbsp;·&nbsp;
						{f.duration === 'once' ? 'first payment' : f.duration === 'forever' ? 'all payments' : `${f.durationMonths} months`}
						{f.maxRedemptions ? ` · max ${f.maxRedemptions}` : ''}
						{f.expiresAt ? ` · expires ${new Date(f.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
					</span>
				</div>
			{/if}

			<div class="form-card__actions">
				<Button onclick={createCode} loading={saving}>
					Create code
				</Button>
				<Button variant="ghost" onclick={() => { showForm = false; resetForm(); }}>
					Cancel
				</Button>
			</div>
		</div>
	{/if}

	<!-- Table -->
	{#if loading}
		<div class="state-empty">
			<span class="spinner" aria-label="Loading"></span>
		</div>
	{:else if error}
		<div class="state-error">{error}</div>
	{:else if codes.length === 0}
		<div class="state-empty">
			<p class="state-empty__text">No promotion codes yet. Create one above.</p>
		</div>
	{:else}
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Code</th>
						<th>Discount</th>
						<th>Duration</th>
						<th>Redemptions</th>
						<th>Expires</th>
						<th>Status</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each codes as c (c.id)}
						<tr class:row--inactive={!c.active}>
							<td>
								<span class="code-pill">{c.code}</span>
							</td>
							<td class="td-discount">{fmtDiscount(c.coupon)}</td>
							<td class="td-duration">{fmtDuration(c.coupon)}</td>
							<td class="td-mono">{fmtRedemptions(c)}</td>
							<td>{fmtDate(c.expires_at ?? c.coupon.redeem_by)}</td>
							<td>
								{#if c.active}
									<Badge variant="success" size="sm">Active</Badge>
								{:else}
									<Badge variant="default" size="sm">Inactive</Badge>
								{/if}
							</td>
							<td class="td-action">
								{#if c.active}
									<button
										class="deactivate-btn"
										onclick={() => deactivate(c.id, c.code)}
										disabled={deactivating === c.id}
										aria-label="Deactivate {c.code}"
									>
										{deactivating === c.id ? '…' : 'Deactivate'}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.coupons-page {
		padding: 32px;
		max-width: 960px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	/* ─── Header ─────────────────────────── */
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.page-title {
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 4px;
	}
	.page-sub {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	/* ─── Stats ──────────────────────────── */
	.stats-row {
		display: flex;
		gap: 1px;
		background: var(--border-subtle);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 16px 20px;
		background: var(--bg-surface);
	}
	.stat__value {
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		font-family: var(--font-display);
	}
	.stat__label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* ─── Form card ──────────────────────── */
	.form-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.form-card__title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0;
	}
	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.field { display: flex; flex-direction: column; gap: 6px; }
	.field--full { grid-column: 1 / -1; }
	.field__label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.field__hint {
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.field__input, .field__select {
		height: 36px;
		padding: 0 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		color: var(--text-primary);
		font-family: var(--font-body);
		transition: border-color 0.12s;
		width: 100%;
		box-sizing: border-box;
	}
	.field__input:focus, .field__select:focus {
		outline: none;
		border-color: var(--color-brand-dim);
	}
	.field__input--mono { font-family: var(--font-mono); letter-spacing: 0.05em; }

	.input-wrap { position: relative; }
	.input-wrap__prefix {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		pointer-events: none;
	}
	.field__input--prefixed { padding-left: 24px; }

	.radio-row { display: flex; gap: 16px; padding-top: 6px; }
	.radio {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.875rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.radio input { accent-color: var(--color-brand-dim); }

	.preview {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}
	.preview__label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}
	.preview__text {
		font-size: 0.8125rem;
		color: var(--color-brand-dim);
		font-family: var(--font-mono);
	}

	.form-card__actions { display: flex; gap: 8px; }

	/* ─── Table ──────────────────────────── */
	.table-wrap {
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}
	.table thead {
		background: var(--bg-surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.table th {
		padding: 10px 14px;
		text-align: left;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}
	.table td {
		padding: 12px 14px;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border-subtle);
	}
	.table tr:last-child td { border-bottom: none; }
	.table tr { background: var(--bg-surface); transition: background 0.1s; }
	.table tr:hover { background: var(--bg-surface-2); }
	.table tr.row--inactive { opacity: 0.5; }

	.code-pill {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--text-primary);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		padding: 2px 8px;
	}
	.td-discount { font-weight: 600; color: var(--color-success); }
	.td-duration { color: var(--text-tertiary); }
	.td-mono     { font-family: var(--font-mono); }
	.td-action   { text-align: right; }

	.deactivate-btn {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-danger);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 3px 10px;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.deactivate-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
	}
	.deactivate-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ─── Empty / error ──────────────────── */
	.state-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 64px 24px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		background: var(--bg-surface);
	}
	.state-empty__text { font-size: 0.875rem; color: var(--text-tertiary); margin: 0; }
	.state-error {
		padding: 16px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
		font-size: 0.875rem;
		color: var(--color-danger);
	}
	.spinner {
		display: inline-block;
		width: 24px; height: 24px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand-dim);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 640px) {
		.coupons-page { padding: 20px 16px; }
		.form-grid { grid-template-columns: 1fr; }
		.field--full { grid-column: 1; }
	}
</style>
