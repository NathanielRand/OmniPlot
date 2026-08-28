<script lang="ts">
	import { uiStore } from '$lib/stores';
	import Button from '$lib/components/ui/Button.svelte';

	const STORAGE_KEY = 'op-early-access-ack';

	let acknowledged = $state(false);

	export function shouldShow(): boolean {
		if (typeof localStorage === 'undefined') return false;
		return !localStorage.getItem(STORAGE_KEY);
	}

	function accept() {
		if (!acknowledged) return;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, '1');
		}
		uiStore.closeEarlyAccessModal();
	}
</script>

{#if uiStore.earlyAccessModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop animate-fade-in" role="dialog" aria-modal="true" aria-label="Early access disclosure">
		<div class="modal animate-scale-in">
			<div class="modal__header">
				<span class="modal__eyebrow">Early Access</span>
				<h2 class="modal__title">You're using an early access product</h2>
				<p class="modal__sub">
					OmniPlot is in early access. Features are still being refined, and you may
					encounter bugs, incomplete functionality, or occasional downtime. We're actively
					improving the product based on feedback — thanks for being an early user.
				</p>
			</div>

			<label class="ack">
				<input type="checkbox" bind:checked={acknowledged} />
				<span>I understand OmniPlot is in early access and accept the above.</span>
			</label>

			<div class="modal__actions">
				<Button variant="primary" size="sm" disabled={!acknowledged} onclick={accept}>
					Continue to dashboard
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(6px);
		z-index: 1100;
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
		max-width: 440px;
		max-height: 90vh;
		overflow-y: auto;
	}

	.modal__header { margin-bottom: 18px; }
	.modal__eyebrow {
		display: inline-block;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-brand, var(--color-brand-dim));
		margin-bottom: 8px;
	}
	.modal__title { font-size: 1.0625rem; font-weight: 700; margin: 0 0 8px; }
	.modal__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.ack {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 12px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
		font-size: 0.8125rem;
		color: var(--text-primary);
		cursor: pointer;
		margin-bottom: 18px;
	}
	.ack input {
		margin-top: 2px;
		flex-shrink: 0;
	}

	.modal__actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
