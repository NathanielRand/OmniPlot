<script lang="ts">
	import { toastStore } from "$lib/stores";
	import type { Toast } from "$lib/types";

	const ICONS: Record<Toast["type"], string> = {
		success: "M5 13l4 4L19 7",
		error: "M6 18L18 6M6 6l12 12",
		warning:
			"M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
		info: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
	};
</script>

<div class="toast-container" aria-live="polite" aria-label="Notifications">
	{#each toastStore.items as toast (toast.id)}
		<div class="toast toast--{toast.type} animate-slide-up" role="alert">
			<div class="toast__icon" aria-hidden="true">
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d={ICONS[toast.type]} />
				</svg>
			</div>
			<div class="toast__body">
				<p class="toast__title">{toast.title}</p>
				{#if toast.message}
					<p class="toast__msg">{toast.message}</p>
				{/if}
			</div>
			{#if toast.action}
				<button class="toast__action" onclick={toast.action.fn}>
					{toast.action.label}
				</button>
			{/if}
			<button
				class="toast__close"
				onclick={() => toastStore.remove(toast.id)}
				aria-label="Dismiss"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
				>
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 8px;
		pointer-events: none;
		max-width: 360px;
		width: 100%;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 11px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		pointer-events: all;
	}

	.toast__icon {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.toast--success .toast__icon {
		color: var(--color-success);
	}
	.toast--error .toast__icon {
		color: var(--color-danger);
	}
	.toast--warning .toast__icon {
		color: var(--color-warning);
	}
	.toast--info .toast__icon {
		color: var(--color-brand-dim);
	}

	.toast__body {
		flex: 1;
		min-width: 0;
	}

	.toast__title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.toast__msg {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 2px;
		line-height: 1.5;
	}

	.toast__action {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-brand-dim);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		white-space: nowrap;
		flex-shrink: 0;
		align-self: center;
	}

	.toast__close {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-sm);
		border: none;
		background: none;
		color: var(--text-tertiary);
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s;
		align-self: flex-start;
		margin-top: -1px;
	}

	.toast__close:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	@media (max-width: 480px) {
		.toast-container {
			bottom: 16px;
			right: 16px;
			left: 16px;
			max-width: none;
		}
	}
</style>
