<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { loadStripe } from '@stripe/stripe-js';
	import type { Stripe, StripeCardElement } from '@stripe/stripe-js';
	import { auth } from '$lib/firebase/client';
	import { toastStore } from '$lib/stores';
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		onclose: () => void;
		onsuccess: () => void;
	}
	let { onclose, onsuccess }: Props = $props();

	let stripe             = $state<Stripe | null>(null);
	let card               = $state<StripeCardElement | null>(null);
	let mountEl            = $state<HTMLDivElement | null>(null);
	let loading            = $state(true);   // initialising Stripe
	let submitting         = $state(false);
	let cardError          = $state('');
	let cardReady          = $state(false);
	let storedClientSecret = $state('');

	onMount(async () => {
		const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string;

		// Fetch the SetupIntent now so we have the stripeAccount before mounting Elements.
		// We need the connected account ID to scope loadStripe() correctly.
		const token = await auth.currentUser?.getIdToken();
		const intentRes = await fetch('/api/billing/setup-intent', {
			method:  'POST',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
		if (!intentRes.ok) {
			const { error } = await intentRes.json();
			cardError = error ?? 'Could not initialise card setup';
			loading = false;
			return;
		}
		const { clientSecret: cs, stripeAccount } = await intentRes.json();
		storedClientSecret = cs;

		stripe = await loadStripe(pk, { stripeAccount });
		if (!stripe || !mountEl) return;

		const elements = stripe.elements({ appearance: buildAppearance() });
		card = elements.create('card', {
			hidePostalCode: true,
			style: {
				base: {
					color:           '#e2e8f0',
					fontFamily:      '"Inter", system-ui, sans-serif',
					fontSize:        '14px',
					fontSmoothing:   'antialiased',
					'::placeholder': { color: '#64748b' },
					iconColor:       '#64748b',
				},
				invalid: { color: '#ff4d6d', iconColor: '#ff4d6d' },
			},
		});

		card.mount(mountEl);
		card.on('ready', () => { loading = false; cardReady = true; });
		card.on('change', (e) => { cardError = e.error?.message ?? ''; });
	});

	onDestroy(() => { card?.destroy(); });

	function buildAppearance() {
		return {
			theme: 'night' as const,
			variables: {
				colorBackground:    '#161b27',
				colorText:          '#e2e8f0',
				colorTextPlaceholder: '#64748b',
				borderRadius:       '8px',
				fontFamily:         '"Inter", system-ui, sans-serif',
				fontSizeBase:       '14px',
			},
		};
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!stripe || !card || submitting || !storedClientSecret) return;

		submitting = true;
		cardError  = '';
		try {
			// Card data goes directly to Stripe — never touches our server
			const { error } = await stripe.confirmCardSetup(storedClientSecret, {
				payment_method: { card },
			});

			if (error) {
				cardError = error.message ?? 'Card setup failed';
				submitting = false;
				return;
			}

			toastStore.success('Card saved!', 'Your payment method has been added.');
			onsuccess();
		} catch (err) {
			cardError = err instanceof Error ? err.message : 'Something went wrong';
			submitting = false;
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="backdrop animate-fade-in" onclick={handleBackdrop} role="dialog" aria-modal="true" aria-label="Add payment method">
	<div class="modal animate-scale-in">
		<button class="modal__close" onclick={onclose} aria-label="Close">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
				<path d="M18 6L6 18M6 6l12 12" />
			</svg>
		</button>

		<div class="modal__header">
			<div class="modal__icon" aria-hidden="true">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
					<rect x="1" y="4" width="22" height="16" rx="2"/>
					<line x1="1" y1="10" x2="23" y2="10"/>
				</svg>
			</div>
			<div>
				<h2 class="modal__title">Add payment method</h2>
				<p class="modal__sub">Your card details are encrypted and sent directly to Stripe.</p>
			</div>
		</div>

		<form onsubmit={handleSubmit}>
			<div class="card-field" class:card-field--loading={loading}>
				{#if loading}
					<div class="card-skeleton" aria-label="Loading card input…">
						<span class="spinner" aria-hidden="true"></span>
					</div>
				{/if}
				<div bind:this={mountEl} class="card-mount" class:hidden={loading}></div>
			</div>

			{#if cardError}
				<p class="card-error" role="alert">{cardError}</p>
			{/if}

			<div class="modal__actions">
				<Button variant="ghost" size="sm" type="button" onclick={onclose}>Cancel</Button>
				<Button variant="primary" size="sm" type="submit" loading={submitting} disabled={!cardReady || submitting}>
					Save card
				</Button>
			</div>
		</form>

		<p class="modal__secure">
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
			</svg>
			Secured by Stripe · We never see your card number
		</p>
	</div>
</div>

<style>
	.backdrop {
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
		padding: 28px;
		width: 100%;
		max-width: 420px;
		position: relative;
	}

	.modal__close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.12s;
	}
	.modal__close:hover { background: var(--bg-surface-3); color: var(--text-primary); }

	.modal__header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 24px;
	}

	.modal__icon {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.modal__title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 3px;
		line-height: 1.2;
	}

	.modal__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
	}

	/* Stripe card element container */
	.card-field {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 12px 14px;
		margin-bottom: 8px;
		min-height: 42px;
		transition: border-color 0.12s;
	}
	.card-field:focus-within { border-color: var(--color-brand-dim); }

	.card-skeleton {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 18px;
	}

	.spinner {
		display: block;
		width: 16px;
		height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.card-mount { width: 100%; }
	.hidden { display: none; }

	.card-error {
		font-size: 0.8125rem;
		color: var(--color-danger);
		margin: 0 0 12px;
	}

	.modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}

	.modal__secure {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 16px;
		margin-bottom: 0;
	}
	.modal__secure svg { flex-shrink: 0; }
</style>
