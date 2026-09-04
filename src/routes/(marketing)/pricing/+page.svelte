<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { PRICING_PLANS, SHOP_PRICING_PLANS, FAQ_ITEMS } from "$lib/config";

	let billing = $state<"monthly" | "yearly">("monthly");

	const CHECK = "M5 13l4 4L19 7";

	// Amounts are admin-editable (Admin → Products → Plan allowances), stored
	// in Firestore, and fetched live here so the marketing page always shows
	// what checkout will actually charge. Copy (name/description/features)
	// stays in the static config — only price/yearlyPrice/seats are overridden.
	let livePrices = $state<Record<string, { price: number; yearlyPrice: number; seats?: number }> | null>(null);
	onMount(() => {
		fetch("/api/settings/plans")
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (!data) return;
				livePrices = {
					free: data.free, lite: data.lite, pro: data.pro,
					starter: data.shopPlans?.starter, team: data.shopPlans?.team, studio: data.shopPlans?.studio,
				};
			})
			.catch(() => {});
	});

	const plans = $derived(
		PRICING_PLANS.map((p) => ({ ...p, ...(livePrices?.[p.id] ? { price: livePrices[p.id].price, yearlyPrice: livePrices[p.id].yearlyPrice } : {}) })),
	);
	const shopPlans = $derived(
		SHOP_PRICING_PLANS.map((p) => ({
			...p,
			...(livePrices?.[p.id]
				? { price: livePrices[p.id].price, yearlyPrice: livePrices[p.id].yearlyPrice, seats: livePrices[p.id].seats ?? p.seats }
				: {}),
		})),
	);
</script>

<svelte:head>
	<title>Pricing — OmniPlot</title>
	<meta
		name="description"
		content="Free, Lite ($29/mo), and Pro ($79/mo) plans. Start free, no credit card required."
	/>
</svelte:head>

<div class="pricing-page">
	<div class="pricing-header">
		<Badge variant="default">Pricing</Badge>
		<h1 class="pricing-title">Simple, honest pricing.</h1>
		<p class="pricing-sub">
			Start free. Upgrade when you're ready. Cancel anytime.
		</p>

		<div class="billing-toggle" role="group" aria-label="Billing period">
			<button
				class="billing-opt"
				class:active={billing === "monthly"}
				onclick={() => (billing = "monthly")}>Monthly</button
			>
			<button
				class="billing-opt"
				class:active={billing === "yearly"}
				onclick={() => (billing = "yearly")}
			>
				Yearly
				<Badge variant="success" size="sm">Save 20%</Badge>
			</button>
		</div>
	</div>

	<div class="plans-label">Individual plans — 1 seat per account</div>
	<div class="plans-row">
		{#each plans as plan}
			<div class="plan-card" class:plan-card--featured={plan.popular}>
				{#if plan.popular}
					<div class="plan-card__badge">Most popular</div>
				{/if}

				<div class="plan-card__tier">{plan.name}</div>

				<div class="plan-card__price">
					<span class="plan-card__amount">
						${billing === "yearly" && plan.price > 0
							? plan.yearlyPrice
							: plan.price}
					</span>
					<span class="plan-card__period">/mo</span>
				</div>

				{#if plan.price > 0}
					<p class="plan-card__billing">
						{billing === "yearly"
							? `Billed $${plan.yearlyPrice * 12}/year`
							: "Billed monthly, cancel anytime"}
					</p>
				{:else}
					<p class="plan-card__billing">Free forever</p>
				{/if}

				<p class="plan-card__desc">{plan.description}</p>

				<Button
					variant={plan.popular ? "primary" : "secondary"}
					size="lg"
					href={plan.price === 0
						? "/signup"
						: `/signup?plan=${plan.id}&billing=${billing}`}
					class="plan-card__cta"
				>
					{#if plan.price === 0}Get started free
					{:else if plan.id === "pro"}Get Pro
					{:else}Get {plan.name}
					{/if}
				</Button>

				<ul class="plan-card__features">
					{#each plan.features as feat}
						<li class="plan-card__feature">
							<svg
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d={CHECK} />
							</svg>
							{feat}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<p class="pricing-note">
		Start free, no credit card required · Prices in USD · All plans include HPGL export
	</p>

	<!-- Shop / Team plans -->
	<div class="team-section">
		<div class="team-section__header">
			<h2 class="team-section__title">Built for shops with multiple techs</h2>
			<p class="team-section__sub">
				One subscription covers your whole crew. Every tech gets their own login — no sharing passwords, no sharing sessions.
			</p>
		</div>

		<div class="shop-plans-row">
			{#each shopPlans as plan}
				<div class="shop-plan-card" class:shop-plan-card--featured={plan.popular}>
					{#if plan.popular}
						<div class="shop-plan-card__badge">Most popular</div>
					{/if}

					<div class="shop-plan-card__top">
						<span class="shop-plan-card__name">{plan.name}</span>
						<span class="shop-plan-card__seats">{plan.seats} seats</span>
					</div>

					<div class="shop-plan-card__price">
						<span class="shop-plan-card__amount">
							${billing === "yearly" ? plan.yearlyPrice : plan.price}
						</span>
						<span class="shop-plan-card__period">/mo</span>
					</div>

					{#if billing === "yearly"}
						<p class="shop-plan-card__billing">Billed ${plan.yearlyPrice * 12}/year</p>
					{:else}
						<p class="shop-plan-card__billing">Billed monthly, cancel anytime</p>
					{/if}

					<p class="shop-plan-card__desc">{plan.description}</p>

					<Button
						variant={plan.popular ? "primary" : "secondary"}
						size="md"
						href="/settings?tab=team"
						class="shop-plan-card__cta"
					>
						Get {plan.name}
					</Button>

					<ul class="shop-plan-card__features">
						{#each plan.features as feat}
							<li class="shop-plan-card__feature">
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d={CHECK} />
								</svg>
								{feat}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>

		<p class="team-note">
			Need more than 25 seats?
			<a href="/support" class="team-note__link">Contact us for enterprise pricing →</a>
		</p>
	</div>

	<!-- Feature comparison table -->
	<div class="compare-section">
		<h2 class="compare-title">Full feature comparison</h2>
		<div class="compare-wrap">
			<table class="compare-table" aria-label="Feature comparison">
				<thead>
					<tr>
						<th>Feature</th>
						<th>Free</th>
						<th class="th-featured">Lite</th>
						<th>Pro</th>
					</tr>
				</thead>
				<tbody>
					{#each [["Cuts per day", "1 / 30 days", "1 / day", "Unlimited"], ["Seats", "1", "1", "1"], ["Pattern library", "✓", "✓", "✓"], ["HPGL / SVG export", "✓", "✓", "✓"], ["DXF export", "—", "✓", "✓"], ["PDF export", "—", "—", "✓"], ["Auto-nesting", "Preview only", "✓", "✓"], ["Web Serial control", "—", "✓", "✓"], ["Job history", "—", "90 days", "Unlimited"], ["Custom pattern upload", "—", "—", "✓"], ["AI pattern assist", "—", "—", "✓"], ["Priority support", "—", "—", "✓"]] as row}
						<tr>
							<td class="td-feature">{row[0]}</td>
							<td
								class:td-check={row[1] === "✓"}
								class:td-muted={row[1] === "—"}>{row[1]}</td
							>
							<td
								class="td-featured"
								class:td-check={row[2] === "✓"}
								class:td-muted={row[2] === "—"}>{row[2]}</td
							>
							<td
								class:td-check={row[3] === "✓"}
								class:td-muted={row[3] === "—"}>{row[3]}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- FAQ mini -->
	<div class="pricing-faq">
		<h2 class="compare-title">Common questions</h2>
		<div class="faq-grid">
			{#each FAQ_ITEMS[2].items as item}
				<div class="faq-item">
					<h3 class="faq-q">{item.q}</h3>
					<p class="faq-a">{item.a}</p>
				</div>
			{/each}
		</div>
		<p class="faq-more">
			More questions? <a href="/faq" class="faq-link"
				>See the full FAQ →</a
			>
		</p>
	</div>
</div>

<style>
	.pricing-page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 64px 24px 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 48px;
	}

	.pricing-header {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	.pricing-title {
		font-size: clamp(2rem, 5vw, 2.75rem);
		letter-spacing: -0.03em;
		margin: 0;
	}
	.pricing-sub {
		font-size: 1rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.billing-toggle {
		display: inline-flex;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px;
		gap: 2px;
		margin-top: 4px;
	}

	.billing-opt {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
		font-size: 0.875rem;
		font-weight: 500;
		font-family: var(--font-body);
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.billing-opt.active {
		background: var(--bg-surface);
		color: var(--text-primary);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.plans-label {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-tertiary);
		align-self: flex-start;
	}

	.plans-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		width: 100%;
		align-items: start;
	}

	.plan-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		padding: 28px;
		position: relative;
		display: flex;
		flex-direction: column;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.plan-card:hover {
		border-color: var(--border-strong);
		box-shadow: var(--shadow-md);
	}

	.plan-card--featured {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.04);
		box-shadow:
			0 0 0 1px rgba(0, 112, 255, 0.2),
			var(--shadow-md);
	}

	.plan-card__badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-brand-dim);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 4px 14px;
		border-radius: 12px;
		white-space: nowrap;
	}

	.plan-card__tier {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-bottom: 12px;
	}

	.plan-card__price {
		display: flex;
		align-items: baseline;
		gap: 2px;
		margin-bottom: 4px;
	}

	.plan-card__amount {
		font-family: var(--font-display);
		font-size: 2.5rem;
		font-weight: 800;
		letter-spacing: -0.04em;
		color: var(--text-primary);
		line-height: 1;
	}

	.plan-card__period {
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}
	.plan-card__billing {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 8px;
	}
	.plan-card__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 20px;
		line-height: 1.5;
	}

	:global(.plan-card__cta) {
		width: 100% !important;
		justify-content: center;
		margin-bottom: 24px;
	}

	.plan-card__features {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.plan-card__feature {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.plan-card__feature svg {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-success);
	}

	.pricing-note {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-align: center;
	}

	/* Compare table */
	.compare-section {
		width: 100%;
	}
	.compare-title {
		font-size: 1.375rem;
		margin-bottom: 20px;
		text-align: center;
	}

	.compare-wrap {
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		overflow: hidden;
		overflow-x: auto;
	}

	.compare-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		min-width: 480px;
	}

	.compare-table thead {
		background: var(--bg-surface-2);
	}

	.compare-table th {
		padding: 12px 20px;
		text-align: center;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.compare-table th:first-child {
		text-align: left;
	}
	.th-featured {
		background: rgba(0, 112, 255, 0.06);
		color: var(--text-primary);
	}

	.compare-table tbody tr {
		border-top: 1px solid var(--border-subtle);
	}
	.compare-table tbody tr:hover {
		background: var(--interactive-hover);
	}
	.compare-table td {
		padding: 11px 20px;
		text-align: center;
		color: var(--text-secondary);
	}

	.td-feature {
		text-align: left;
		color: var(--text-primary);
		font-weight: 500;
	}
	.td-featured {
		background: rgba(0, 112, 255, 0.03);
	}
	.td-check {
		color: var(--color-success);
		font-weight: 600;
	}
	.td-muted {
		color: var(--text-tertiary);
		opacity: 0.5;
	}

	/* FAQ */
	.pricing-faq {
		width: 100%;
	}

	.faq-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 20px;
		margin-bottom: 20px;
	}

	.faq-item {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 20px;
	}

	.faq-q {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 8px;
		line-height: 1.4;
	}
	.faq-a {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.faq-more {
		text-align: center;
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}
	.faq-link {
		color: var(--text-brand);
		text-decoration: none;
	}
	.faq-link:hover {
		text-decoration: underline;
	}

	/* ─── Team / Shop plans ─── */
	.team-section {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 32px;
	}

	.team-section__header {
		text-align: center;
		max-width: 560px;
	}
	.team-section__title {
		font-size: clamp(1.5rem, 3vw, 2rem);
		letter-spacing: -0.025em;
		margin: 0 0 10px;
	}
	.team-section__sub {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.shop-plans-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		width: 100%;
	}

	.shop-plan-card {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 24px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		gap: 0;
	}

	.shop-plan-card--featured {
		border-color: var(--color-brand-dim);
		background: linear-gradient(
			135deg,
			rgba(var(--color-brand-rgb, 99, 102, 241), 0.06) 0%,
			var(--bg-surface-2) 60%
		);
	}

	.shop-plan-card__badge {
		position: absolute;
		top: -11px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-brand-dim);
		color: #fff;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 3px 12px;
		border-radius: 999px;
		white-space: nowrap;
	}

	.shop-plan-card__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.shop-plan-card__name {
		font-size: 1.0625rem;
		font-weight: 700;
	}
	.shop-plan-card__seats {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-brand);
		background: rgba(var(--color-brand-rgb, 99, 102, 241), 0.1);
		padding: 2px 9px;
		border-radius: 999px;
	}

	.shop-plan-card__price {
		display: flex;
		align-items: baseline;
		gap: 2px;
		margin-bottom: 4px;
	}
	.shop-plan-card__amount {
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.shop-plan-card__period {
		font-size: 0.9375rem;
		color: var(--text-tertiary);
	}

	.shop-plan-card__billing {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0 0 8px;
	}

	.shop-plan-card__desc {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin: 0 0 18px;
		line-height: 1.5;
	}

	:global(.shop-plan-card__cta) {
		width: 100% !important;
		justify-content: center;
		margin-bottom: 20px;
	}

	.shop-plan-card__features {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.shop-plan-card__feature {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.shop-plan-card__feature svg {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-success);
	}

	.team-note {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		text-align: center;
		margin: 0;
	}
	.team-note__link {
		color: var(--text-brand);
		text-decoration: none;
		font-weight: 500;
	}
	.team-note__link:hover { text-decoration: underline; }

	@media (max-width: 768px) {
		.plans-row {
			grid-template-columns: 1fr;
		}
		.shop-plans-row {
			grid-template-columns: 1fr;
		}
		.faq-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
