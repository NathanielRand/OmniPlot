<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { auth } from '$lib/firebase/client';
	import { onMount } from 'svelte';
	import { toastStore, confirmStore } from '$lib/stores';

	// ─── Banner state ───────────────────────────────
	interface BannerConfig {
		active:      boolean;
		code:        string;
		message:     string;
		cta:         string;
		ctaHref:     string;
		accentColor: string;
		expiresAt:   number | null;
	}

	let banner         = $state<BannerConfig | null>(null);
	let bannerLoading  = $state(true);
	let promotingCode  = $state<string | null>(null);   // which code row is open
	let savingBanner   = $state(false);
	let deactivatingBanner = $state(false);

	let bf = $state({
		message:     '',
		cta:         'Claim offer',
		ctaHref:     '/pricing',
		accentColor: 'brand',
		expiresAt:   '',
	});

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
	async function authHeaders(): Promise<Record<string, string>> {
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

	async function loadBanner() {
		bannerLoading = true;
		try {
			const res = await fetch('/api/admin/promo-banner', { headers: await authHeaders() });
			if (res.ok) banner = (await res.json()).banner ?? null;
		} catch { /* non-fatal */ } finally {
			bannerLoading = false;
		}
	}

	onMount(() => { load(); loadBanner(); });

	// ─── Promote code as banner ────────────────────
	function openPromoteForm(code: PromoCode) {
		// Pre-fill message from the coupon's discount info
		const discount = fmtDiscount(code.coupon);
		const duration = fmtDuration(code.coupon);
		bf = {
			message:     `Limited time: use ${code.code} for ${discount} ${duration === 'First payment' ? 'on your first month' : duration === 'Forever' ? 'on every payment' : `for ${duration}`}.`,
			cta:         'Claim offer',
			ctaHref:     '/pricing',
			accentColor: 'brand',
			expiresAt:   '',
		};
		promotingCode = code.code;
	}

	async function saveBanner(code: string) {
		savingBanner = true;
		try {
			const res = await fetch('/api/admin/promo-banner', {
				method:  'PUT',
				headers: await authHeaders(),
				body:    JSON.stringify({
					code,
					message:     bf.message,
					cta:         bf.cta,
					ctaHref:     bf.ctaHref,
					accentColor: bf.accentColor,
					expiresAt:   bf.expiresAt || null,
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
			toastStore.success('Banner live', `"${code}" is now the sitewide promo banner.`);
			promotingCode = null;
			await loadBanner();
		} catch (e) {
			toastStore.error('Error', e instanceof Error ? e.message : 'Could not save banner');
		} finally {
			savingBanner = false;
		}
	}

	async function deactivateBanner() {
		const ok = await confirmStore.ask({
			title: 'Remove the sitewide promo banner?',
			confirmLabel: 'Remove banner',
			variant: 'danger',
		});
		if (!ok) return;
		deactivatingBanner = true;
		try {
			const res = await fetch('/api/admin/promo-banner', {
				method:  'DELETE',
				headers: await authHeaders(),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
			banner = null;
			toastStore.success('Banner removed', 'The sitewide promo banner is now hidden.');
		} catch (e) {
			toastStore.error('Error', e instanceof Error ? e.message : 'Could not remove banner');
		} finally {
			deactivatingBanner = false;
		}
	}

	const ACCENT_OPTIONS = [
		{ value: 'brand',   label: 'Brand blue' },
		{ value: 'success', label: 'Green' },
		{ value: 'warning', label: 'Amber' },
		{ value: 'danger',  label: 'Red' },
	];

	function fmtBannerExpiry(ms: number | null) {
		if (!ms) return 'No expiry';
		return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

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
		const times = codes.find((c) => c.id === id)?.times_redeemed;
		const ok = await confirmStore.ask({
			title: `Deactivate "${code}"?`,
			message: 'Users with this code can no longer redeem it.',
			details: times !== undefined ? [{ label: 'Times redeemed so far', value: String(times) }] : undefined,
			confirmLabel: 'Deactivate',
			variant: 'danger',
		});
		if (!ok) return;
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

	<!-- Sitewide Banner Status -->
	<div class="banner-section">
		<div class="banner-section__header">
			<div class="banner-section__title-row">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>
				<span class="banner-section__title">Sitewide Promo Banner</span>
				{#if !bannerLoading}
					{#if banner?.active}
						<Badge variant="success" size="sm">Live</Badge>
					{:else}
						<Badge variant="default" size="sm">Off</Badge>
					{/if}
				{/if}
			</div>
			<p class="banner-section__sub">Promote a coupon code with a banner on all public pages. Hidden from signed-in users.</p>
		</div>

		{#if bannerLoading}
			<div class="banner-loading"><span class="spinner" aria-label="Loading"></span></div>
		{:else if banner?.active}
			<div class="banner-preview">
				<div class="banner-preview__bar" style:background={
					banner.accentColor === 'success' ? '#00a86b' :
					banner.accentColor === 'warning' ? '#d97706' :
					banner.accentColor === 'danger'  ? '#dc2626' : '#0070ff'
				}>
					<span class="banner-preview__message">{banner.message}</span>
					<span class="banner-preview__code">{banner.code}</span>
					<span class="banner-preview__cta">{banner.cta} →</span>
				</div>
				<div class="banner-preview__meta">
					<span>Code: <strong>{banner.code}</strong></span>
					<span>CTA: <strong>{banner.cta}</strong> → <code>{banner.ctaHref}</code></span>
					<span>Expires: <strong>{fmtBannerExpiry(banner.expiresAt)}</strong></span>
				</div>
				<button
					class="deactivate-btn"
					onclick={deactivateBanner}
					disabled={deactivatingBanner}
				>
					{deactivatingBanner ? '…' : 'Remove banner'}
				</button>
			</div>
		{:else}
			<p class="banner-empty">No active promo banner. Click <strong>Promote</strong> on any active coupon code below to create one.</p>
		{/if}
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
						{@const isBannerCode = banner?.active && banner.code === c.code}
						<tr class:row--inactive={!c.active}>
							<td>
								<div class="code-cell">
									<span class="code-pill">{c.code}</span>
									{#if isBannerCode}
										<Badge variant="success" size="sm">Promoted</Badge>
									{/if}
								</div>
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
									<div class="row-actions">
										<button
											class="promote-btn"
											class:promote-btn--active={isBannerCode}
											onclick={() => promotingCode === c.code ? (promotingCode = null) : openPromoteForm(c)}
											aria-label="Promote {c.code} as sitewide banner"
										>
											<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>
											{isBannerCode ? 'Promoted' : 'Promote'}
										</button>
										<button
											class="deactivate-btn"
											onclick={() => deactivate(c.id, c.code)}
											disabled={deactivating === c.id}
											aria-label="Deactivate {c.code}"
										>
											{deactivating === c.id ? '…' : 'Deactivate'}
										</button>
									</div>
								{/if}
							</td>
						</tr>

						<!-- Inline promote form -->
						{#if promotingCode === c.code}
							<tr class="promote-row">
								<td colspan="7">
									<div class="promote-form">
										<div class="promote-form__header">
											<span class="promote-form__title">Configure banner for <strong>{c.code}</strong></span>
											<button class="promote-form__close" onclick={() => promotingCode = null} aria-label="Close">
												<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
											</button>
										</div>

										<div class="promote-form__grid">
											<div class="field field--full">
												<label class="field__label" for="bf-message">Banner message</label>
												<input
													id="bf-message"
													class="field__input"
													type="text"
													placeholder="Limited time: get 30% off your first month"
													bind:value={bf.message}
												/>
											</div>

											<div class="field">
												<label class="field__label" for="bf-cta">CTA button text</label>
												<input
													id="bf-cta"
													class="field__input"
													type="text"
													placeholder="Claim offer"
													bind:value={bf.cta}
												/>
											</div>

											<div class="field">
												<label class="field__label" for="bf-href">CTA link</label>
												<input
													id="bf-href"
													class="field__input"
													type="text"
													placeholder="/pricing"
													bind:value={bf.ctaHref}
												/>
											</div>

											<div class="field">
												<label class="field__label" for="bf-color">Accent color</label>
												<select id="bf-color" class="field__select" bind:value={bf.accentColor}>
													{#each ACCENT_OPTIONS as opt}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
											</div>

											<div class="field">
												<label class="field__label" for="bf-expires">Banner expires <span class="field__hint">(optional)</span></label>
												<input
													id="bf-expires"
													class="field__input"
													type="date"
													bind:value={bf.expiresAt}
												/>
											</div>
										</div>

										<!-- Preview -->
										{#if bf.message}
											<div class="promote-preview" style:background={
												bf.accentColor === 'success' ? '#00a86b' :
												bf.accentColor === 'warning' ? '#d97706' :
												bf.accentColor === 'danger'  ? '#dc2626' : '#0070ff'
											}>
												<span class="promote-preview__msg">{bf.message}</span>
												<span class="promote-preview__code">{c.code}</span>
												<span class="promote-preview__cta">{bf.cta || 'Claim offer'} →</span>
											</div>
										{/if}

										<div class="promote-form__actions">
											<Button onclick={() => saveBanner(c.code)} loading={savingBanner}>
												Make live
											</Button>
											<Button variant="ghost" onclick={() => promotingCode = null}>
												Cancel
											</Button>
										</div>
									</div>
								</td>
							</tr>
						{/if}
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

	/* ─── Banner section ─────────────────── */
	.banner-section {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.banner-section__header { display: flex; flex-direction: column; gap: 4px; }
	.banner-section__title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-primary);
	}
	.banner-section__title { font-size: 0.9375rem; font-weight: 600; }
	.banner-section__sub { font-size: 0.8125rem; color: var(--text-tertiary); margin: 0; }

	.banner-loading { display: flex; align-items: center; padding: 8px 0; }

	.banner-preview { display: flex; flex-direction: column; gap: 10px; }
	.banner-preview__bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px;
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}
	.banner-preview__message { font-size: 0.8125rem; color: #fff; opacity: 0.9; }
	.banner-preview__code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: rgba(255,255,255,0.2);
		padding: 2px 8px;
		border-radius: 99px;
		letter-spacing: 0.05em;
	}
	.banner-preview__cta {
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: rgba(255,255,255,0.15);
		padding: 3px 10px;
		border-radius: 5px;
	}
	.banner-preview__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}
	.banner-preview__meta code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		padding: 1px 5px;
		border-radius: 4px;
		color: var(--text-secondary);
	}
	.banner-empty { font-size: 0.875rem; color: var(--text-tertiary); margin: 0; }

	/* ─── Code cell ───────────────────────── */
	.code-cell { display: flex; align-items: center; gap: 6px; }

	/* ─── Row actions ─────────────────────── */
	.row-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

	.promote-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.06);
		border: 1px solid rgba(0, 112, 255, 0.2);
		border-radius: var(--radius-sm);
		padding: 3px 9px;
		cursor: pointer;
		transition: all 0.12s;
	}
	.promote-btn:hover { background: rgba(0, 112, 255, 0.12); }
	.promote-btn--active { background: rgba(0, 214, 143, 0.08); border-color: rgba(0, 214, 143, 0.3); color: var(--color-success); }

	/* ─── Promote inline form ─────────────── */
	.promote-row td { padding: 0 !important; background: var(--bg-surface-2) !important; border-top: 1px solid var(--border-subtle); }
	.promote-row:hover td { background: var(--bg-surface-2) !important; }

	.promote-form {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.promote-form__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.promote-form__title { font-size: 0.875rem; color: var(--text-secondary); }
	.promote-form__close {
		background: none; border: none; cursor: pointer;
		color: var(--text-tertiary); padding: 2px;
		display: flex; align-items: center;
		transition: color 0.12s;
	}
	.promote-form__close:hover { color: var(--text-primary); }

	.promote-form__grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.promote-preview {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px;
		border-radius: var(--radius-md);
		flex-wrap: wrap;
	}
	.promote-preview__msg  { font-size: 0.8125rem; color: #fff; opacity: 0.9; }
	.promote-preview__code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: rgba(255,255,255,0.2);
		padding: 2px 8px;
		border-radius: 99px;
	}
	.promote-preview__cta {
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: rgba(255,255,255,0.15);
		padding: 3px 10px;
		border-radius: 5px;
	}

	.promote-form__actions { display: flex; gap: 8px; }

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
