<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
		size?: "xs" | "sm" | "md" | "lg";
		href?: string;
		type?: "button" | "submit" | "reset";
		disabled?: boolean;
		loading?: boolean;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
		[key: string]: unknown;
	}

	let {
		variant = "primary",
		size = "md",
		href,
		type = "button",
		disabled = false,
		loading = false,
		class: cls = "",
		onclick,
		children,
		...rest
	}: Props = $props();

	const isDisabled = $derived(disabled || loading);
</script>

{#if href}
	<a
		{href}
		class="btn btn--{variant} btn--{size} {cls}"
		class:btn--disabled={isDisabled}
		aria-disabled={isDisabled}
		{...rest}
	>
		{#if loading}
			<span class="btn__spinner" aria-hidden="true"></span>
		{/if}
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class="btn btn--{variant} btn--{size} {cls}"
		disabled={isDisabled}
		{onclick}
		{...rest}
	>
		{#if loading}
			<span class="btn__spinner" aria-hidden="true"></span>
		{/if}
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-family: var(--font-body);
		font-weight: 500;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			opacity 0.15s,
			transform 0.1s;
		white-space: nowrap;
		position: relative;
		user-select: none;
	}

	.btn:active:not(.btn--disabled) {
		transform: scale(0.98);
	}

	/* Sizes */
	.btn--xs {
		font-size: 0.75rem;
		padding: 4px 10px;
	}
	.btn--sm {
		font-size: 0.8125rem;
		padding: 6px 14px;
	}
	.btn--md {
		font-size: 0.875rem;
		padding: 8px 18px;
	}
	.btn--lg {
		font-size: 0.9375rem;
		padding: 11px 24px;
		border-radius: var(--radius-lg);
	}

	/* Variants */
	.btn--primary {
		background: var(--color-brand-dim);
		color: #fff;
		border-color: var(--color-brand-dim);
	}
	.btn--primary:hover:not(.btn--disabled) {
		background: #005fe0;
		border-color: #005fe0;
	}

	.btn--secondary {
		background: var(--bg-surface-2);
		color: var(--text-primary);
		border-color: var(--border-default);
	}
	.btn--secondary:hover:not(.btn--disabled) {
		background: var(--bg-surface-3);
		border-color: var(--border-strong);
	}

	.btn--ghost {
		background: transparent;
		color: var(--text-secondary);
		border-color: transparent;
	}
	.btn--ghost:hover:not(.btn--disabled) {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	.btn--danger {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.25);
	}
	.btn--danger:hover:not(.btn--disabled) {
		background: rgba(255, 77, 109, 0.18);
	}

	.btn--success {
		background: rgba(0, 214, 143, 0.1);
		color: var(--color-success);
		border-color: rgba(0, 214, 143, 0.25);
	}
	.btn--success:hover:not(.btn--disabled) {
		background: rgba(0, 214, 143, 0.18);
	}

	/* Disabled */
	.btn--disabled {
		opacity: 0.45;
		cursor: not-allowed;
		pointer-events: none;
	}

	/* Spinner */
	.btn__spinner {
		display: inline-block;
		width: 13px;
		height: 13px;
		border: 1.5px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
		opacity: 0.7;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
