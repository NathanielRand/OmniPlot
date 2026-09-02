<script lang="ts">
	// Native-UI replacement for window.confirm(). Mounted once in the root
	// layout; renders whatever request confirmStore.ask() currently has
	// pending and resolves it via confirmStore.resolve(true/false).
	import { confirmStore } from "$lib/stores";
	import Button from "$lib/components/ui/Button.svelte";

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) confirmStore.resolve(false);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") confirmStore.resolve(false);
	}
</script>

<svelte:window onkeydown={confirmStore.pending ? handleKeydown : undefined} />

{#if confirmStore.pending}
	{@const opt = confirmStore.pending.options}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop animate-fade-in" onclick={handleBackdrop} role="presentation">
		<div
			class="modal animate-scale-in"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-modal-title"
			aria-describedby={opt.message ? "confirm-modal-message" : undefined}
		>
			<div class="modal__header">
				<div class="modal__icon" class:modal__icon--danger={opt.variant === "danger"} aria-hidden="true">
					{#if opt.variant === "danger"}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					{:else}
						<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
					{/if}
				</div>
				<div>
					<h2 id="confirm-modal-title" class="modal__title">{opt.title}</h2>
					{#if opt.message}
						<p id="confirm-modal-message" class="modal__sub">{opt.message}</p>
					{/if}
				</div>
			</div>

			{#if opt.details?.length}
				<div class="confirm-details">
					{#each opt.details as d (d.label)}
						<div class="confirm-detail-row">
							<span class="confirm-detail-label">{d.label}</span>
							<span class="confirm-detail-value">{d.value}</span>
						</div>
					{/each}
				</div>
			{/if}

			<div class="modal__actions">
				<Button variant="ghost" size="sm" onclick={() => confirmStore.resolve(false)}>
					{opt.cancelLabel ?? "Cancel"}
				</Button>
				<Button
					variant={opt.variant === "danger" ? "danger" : "primary"}
					size="sm"
					autofocus
					onclick={() => confirmStore.resolve(true)}
				>
					{opt.confirmLabel ?? "Confirm"}
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
		z-index: 2000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-2xl);
		padding: 26px;
		width: 100%;
		max-width: 400px;
	}

	.modal__header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 18px;
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
		color: var(--color-brand-dim);
		flex-shrink: 0;
	}
	.modal__icon--danger {
		background: color-mix(in srgb, var(--color-danger) 12%, var(--bg-surface-2));
		border-color: color-mix(in srgb, var(--color-danger) 30%, var(--border-default));
		color: var(--color-danger);
	}

	.modal__title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 4px;
		line-height: 1.3;
		color: var(--text-primary);
	}

	.modal__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.45;
	}

	.confirm-details {
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: var(--border-subtle);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		margin-bottom: 20px;
	}
	.confirm-detail-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		background: var(--bg-surface-2);
	}
	.confirm-detail-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.confirm-detail-value {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 22px;
	}

	.animate-fade-in {
		animation: fade-in 0.15s ease-out;
	}
	.animate-scale-in {
		animation: scale-in 0.15s ease-out;
	}
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@keyframes scale-in {
		from { opacity: 0; transform: scale(0.96); }
		to { opacity: 1; transform: scale(1); }
	}
</style>
