<script lang="ts">
	import type { PlotterDiagnostic } from "$lib/utils/plotter-errors";

	interface Props {
		diagnostic: PlotterDiagnostic | null;
		/** Pass true once the error has been logged to Firestore (auto or manual). */
		reported: boolean;
		onClose: () => void;
		onRetry: () => void;
		onReport: () => void;
	}

	let { diagnostic, reported, onClose, onRetry, onReport }: Props = $props();

	const isOpen = $derived(!!diagnostic);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen && diagnostic}
<!-- overlay -->
<div
	class="diag-overlay"
	role="presentation"
	onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
	<div
		class="diag-panel"
		role="dialog"
		aria-modal="true"
		aria-labelledby="diag-title"
	>
		<!-- Header -->
		<div class="diag-header">
			<div class="diag-header__left">
				<div class="diag-icon" aria-hidden="true">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
						<line x1="12" y1="9" x2="12" y2="13"/>
						<line x1="12" y1="17" x2="12.01" y2="17"/>
					</svg>
				</div>
				<div>
					<h2 class="diag-title" id="diag-title">{diagnostic.title}</h2>
					<span class="diag-code">{diagnostic.code}</span>
				</div>
			</div>
			<button class="diag-close" onclick={onClose} aria-label="Close diagnostic panel">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<!-- Message -->
		<p class="diag-message">{diagnostic.message}</p>

		<!-- Fix steps -->
		<div class="diag-steps">
			<h3 class="diag-steps__heading">How to fix</h3>
			<ol class="diag-steps__list">
				{#each diagnostic.steps as step}
					<li class="diag-step">{step}</li>
				{/each}
			</ol>
		</div>

		<!-- Reported notice (auto-escalated) -->
		{#if diagnostic.escalate && reported}
			<div class="diag-notice diag-notice--reported">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="20 6 9 17 4 12"/>
				</svg>
				We've logged this automatically — our team will investigate.
			</div>
		{/if}

		<!-- Footer -->
		<div class="diag-footer">
			<div class="diag-footer__left">
				{#if !diagnostic.escalate}
					{#if !reported}
						<button class="diag-btn diag-btn--ghost" onclick={onReport}>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>
							</svg>
							Report to OmniPlot
						</button>
					{:else}
						<span class="diag-reported-inline">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12"/>
							</svg>
							Reported — thanks
						</span>
					{/if}
				{/if}
			</div>

			<div class="diag-footer__actions">
				<button class="diag-btn diag-btn--ghost" onclick={onClose}>Close</button>
				<button class="diag-btn diag-btn--primary" onclick={onRetry}>Try again</button>
			</div>
		</div>
	</div>
</div>
{/if}

<style>
	.diag-overlay {
		position: fixed;
		inset: 0;
		z-index: 9000;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		backdrop-filter: blur(2px);
	}

	.diag-panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
		width: 100%;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: 0;
		overflow: hidden;
	}

	/* Header */
	.diag-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 20px 20px 0;
	}

	.diag-header__left {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.diag-icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: rgba(255, 160, 40, 0.12);
		color: var(--color-warning, #ffa028);
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 2px;
	}

	.diag-title {
		font-family: var(--font-display);
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.3;
		margin: 0 0 4px;
	}

	.diag-code {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		letter-spacing: 0.04em;
		background: var(--bg-surface-3);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.diag-close {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		border: none;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.1s, color 0.1s;
	}

	.diag-close:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	/* Message */
	.diag-message {
		margin: 12px 20px 0;
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	/* Steps */
	.diag-steps {
		margin: 16px 20px 0;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 14px 16px;
	}

	.diag-steps__heading {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
		margin: 0 0 10px;
	}

	.diag-steps__list {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.diag-step {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.55;
	}

	/* Notice */
	.diag-notice {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 12px 20px 0;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.diag-notice--reported {
		background: rgba(0, 214, 143, 0.08);
		color: var(--color-success, #00d68f);
		border: 1px solid rgba(0, 214, 143, 0.2);
	}

	/* Footer */
	.diag-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 20px;
		margin-top: 16px;
		border-top: 1px solid var(--border-subtle);
	}

	.diag-footer__left {
		display: flex;
		align-items: center;
	}

	.diag-footer__actions {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}

	.diag-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
		white-space: nowrap;
	}

	.diag-btn--ghost {
		background: transparent;
		color: var(--text-secondary);
		border-color: var(--border-default);
	}

	.diag-btn--ghost:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	.diag-btn--primary {
		background: var(--color-brand);
		color: #000;
		border-color: transparent;
	}

	.diag-btn--primary:hover {
		filter: brightness(1.1);
	}

	.diag-reported-inline {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.8125rem;
		color: var(--color-success, #00d68f);
		font-weight: 500;
	}

	@media (max-width: 560px) {
		.diag-panel { max-width: 100%; }
		.diag-footer { flex-direction: column; align-items: stretch; gap: 10px; }
		.diag-footer__actions { justify-content: flex-end; }
	}
</style>
