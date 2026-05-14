<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		variant?:
			| "default"
			| "brand"
			| "success"
			| "warning"
			| "danger"
			| "info"
			| "pro"
			| "lite"
			| "free";
		size?: "sm" | "md";
		dot?: boolean;
		class?: string;
		children: Snippet;
	}

	let {
		variant = "default",
		size = "sm",
		dot = false,
		class: cls = "",
		children,
	}: Props = $props();
</script>

<span class="badge badge--{variant} badge--{size} {cls}">
	{#if dot}<span class="badge__dot" aria-hidden="true"></span>{/if}
	{@render children()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-mono);
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border-radius: 4px;
		border: 1px solid transparent;
		white-space: nowrap;
	}

	.badge--sm {
		font-size: 0.6875rem;
		padding: 2px 7px;
	}
	.badge--md {
		font-size: 0.75rem;
		padding: 3px 9px;
	}

	.badge--default {
		background: var(--bg-surface-3);
		color: var(--text-secondary);
		border-color: var(--border-default);
	}

	.badge--brand {
		background: rgba(0, 229, 255, 0.1);
		color: var(--color-brand);
		border-color: rgba(0, 229, 255, 0.2);
	}

	.badge--success {
		background: rgba(0, 214, 143, 0.1);
		color: var(--color-success);
		border-color: rgba(0, 214, 143, 0.2);
	}

	.badge--warning {
		background: rgba(255, 181, 71, 0.1);
		color: var(--color-warning);
		border-color: rgba(255, 181, 71, 0.2);
	}

	.badge--danger {
		background: rgba(255, 77, 109, 0.1);
		color: var(--color-danger);
		border-color: rgba(255, 77, 109, 0.2);
	}

	.badge--info {
		background: rgba(0, 112, 255, 0.1);
		color: var(--color-brand-dim);
		border-color: rgba(0, 112, 255, 0.2);
	}

	.badge--pro {
		background: rgba(0, 112, 255, 0.12);
		color: #60a5ff;
		border-color: rgba(0, 112, 255, 0.25);
	}

	.badge--lite {
		background: rgba(167, 139, 250, 0.12);
		color: #a78bfa;
		border-color: rgba(167, 139, 250, 0.25);
	}

	.badge--free {
		background: var(--bg-surface-3);
		color: var(--text-tertiary);
		border-color: var(--border-subtle);
	}

	.badge__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}
</style>
