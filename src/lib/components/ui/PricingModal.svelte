<script lang="ts">
	import { uiStore, userStore, toastStore } from "$lib/stores";
	import { PRICING_PLANS } from "$lib/config";
	import type { PricingPlan } from "$lib/types";
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";

	let billing       = $state<"monthly" | "yearly">("monthly");
	let checkoutPlan  = $state<string | null>(null); // plan.id being loaded

	function closeOnBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) uiStore.closePricing();
	}

	async function startCheckout(plan: PricingPlan) {
		checkoutPlan = plan.id;
		try {
			const token = await auth.currentUser?.getIdToken();
			const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

			// Check for a saved payment method before hitting checkout
			const pmRes = await fetch("/api/billing/payment-methods", { headers: authHeader });
			if (pmRes.ok) {
				const { methods } = await pmRes.json();
				if (!methods?.length) {
					// No card on file — send to settings to add one first, then come back
					uiStore.closePricing();
					const returnTo = encodeURIComponent(window.location.pathname);
					window.location.href = `/settings?tab=billing&addCard=true&returnTo=${returnTo}`;
					return;
				}
			}

			const res = await fetch("/api/billing/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeader },
				body: JSON.stringify({
					type:     "individual",
					tier:     plan.id,
					interval: billing === "yearly" ? "year" : "month",
				}),
			});
			if (!res.ok) throw new Error((await res.json()).error ?? "Checkout failed");
			const { url } = await res.json();
			window.location.href = url;
		} catch (err) {
			toastStore.error("Checkout failed", err instanceof Error ? err.message : "");
			checkoutPlan = null;
		}
	}

	const CHECK = "M5 13l4 4L19 7";
</script>

{#if uiStore.pricingModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop animate-fade-in"
		onclick={closeOnBackdrop}
		role="dialog"
		aria-modal="true"
		aria-label="Upgrade plan"
	>
		<div class="modal animate-scale-in">
			<button
				class="modal__close"
				onclick={uiStore.closePricing}
				aria-label="Close"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg
				>
			</button>

			<div class="modal__header">
				<h2 class="modal__title">Upgrade OmniPlot</h2>
				<p class="modal__sub">
					Professional PPF cutting software. No install required.
				</p>

				<div
					class="billing-toggle"
					role="group"
					aria-label="Billing period"
				>
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

			<div class="plans">
				{#each PRICING_PLANS as plan}
					<div class="plan" class:plan--featured={plan.popular}>
						{#if plan.popular}
							<div class="plan__badge">Most popular</div>
						{/if}

						<div class="plan__tier">{plan.name}</div>

						<div class="plan__price">
							{#if plan.price === 0}
								<span class="plan__amount">$0</span>
								<span class="plan__period">/mo</span>
							{:else}
								<span class="plan__amount">
									${billing === "yearly"
										? plan.yearlyPrice
										: plan.price}
								</span>
								<span class="plan__period">/mo</span>
							{/if}
						</div>

						{#if plan.price > 0 && billing === "yearly"}
							<p class="plan__billing-note">
								Billed ${plan.yearlyPrice * 12}/year
							</p>
						{:else if plan.price > 0}
							<p class="plan__billing-note">Billed monthly</p>
						{:else}
							<p class="plan__billing-note">Free forever</p>
						{/if}

						<p class="plan__desc">{plan.description}</p>

						<ul class="plan__features">
							{#each plan.features as feat}
								<li class="plan__feature">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d={CHECK} /></svg
									>
									{feat}
								</li>
							{/each}
						</ul>

						{#if plan.price === 0}
							<Button variant="secondary" size="md" class="plan__cta" href="/signup">
								Get started free
							</Button>
						{:else if userStore.isAuth}
							<Button
								variant={plan.popular ? "primary" : "secondary"}
								size="md"
								class="plan__cta"
								loading={checkoutPlan === plan.id}
								onclick={() => startCheckout(plan)}
							>
								{plan.id === "pro" ? "Get Pro" : `Get ${plan.name}`}
							</Button>
						{:else}
							<Button
								variant={plan.popular ? "primary" : "secondary"}
								size="md"
								class="plan__cta"
								href="/signup?plan={plan.id}&billing={billing}"
							>
								{plan.id === "pro" ? "Get Pro" : `Get ${plan.name}`}
							</Button>
						{/if}
					</div>
				{/each}
			</div>

			<p class="modal__note">
				Start free, no credit card required. Cancel anytime.
			</p>

			<div class="modal__team-nudge">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
				Running a shop?
				<a href="/pricing#team" class="modal__team-link" onclick={uiStore.closePricing}>
					See team plans from $149/mo →
				</a>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(6px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		padding: 32px;
		width: 100%;
		max-width: 800px;
		max-height: 90vh;
		overflow-y: auto;
		position: relative;
	}

	.modal__close {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s;
	}

	.modal__close:hover {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	.modal__header {
		text-align: center;
		margin-bottom: 28px;
	}
	.modal__title {
		font-size: 1.5rem;
		margin-bottom: 6px;
	}
	.modal__sub {
		font-size: 0.875rem;
		color: var(--text-secondary);
		margin-bottom: 20px;
	}

	.billing-toggle {
		display: inline-flex;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 3px;
		gap: 2px;
	}

	.billing-opt {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		border-radius: 5px;
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

	.plans {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.plan {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		padding: 22px;
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0;
		transition: border-color 0.15s;
	}

	.plan--featured {
		border-color: var(--color-brand-dim);
		background: rgba(0, 112, 255, 0.04);
	}

	.plan__badge {
		position: absolute;
		top: -11px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-brand-dim);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 3px 12px;
		border-radius: 10px;
		white-space: nowrap;
	}

	.plan__tier {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-bottom: 10px;
	}

	.plan__price {
		display: flex;
		align-items: baseline;
		gap: 2px;
		margin-bottom: 2px;
	}

	.plan__amount {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 2rem;
		letter-spacing: -0.03em;
		color: var(--text-primary);
		line-height: 1;
	}

	.plan__period {
		font-size: 0.875rem;
		color: var(--text-tertiary);
	}

	.plan__billing-note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-bottom: 10px;
	}

	.plan__desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 16px;
		line-height: 1.5;
	}

	.plan__features {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 20px;
		flex: 1;
	}

	.plan__feature {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.plan__feature svg {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--color-success);
	}

	:global(.plan__cta) {
		width: 100% !important;
		justify-content: center;
	}

	.modal__note {
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 20px;
	}

	.modal__team-nudge {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding: 12px 16px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		margin-top: 10px;
	}
	.modal__team-nudge svg { flex-shrink: 0; color: var(--color-brand); }
	.modal__team-link {
		color: var(--text-brand);
		text-decoration: none;
		font-weight: 500;
	}
	.modal__team-link:hover { text-decoration: underline; }

	@media (max-width: 640px) {
		.modal {
			padding: 20px;
		}
		.plans {
			grid-template-columns: 1fr;
		}
	}
</style>
