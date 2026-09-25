<script lang="ts">
	import { platformStore } from "$lib/stores";

	// Admin → Settings → Maintenance mode. Floats over the page rather than
	// pushing layout, and can be dismissed for the rest of the tab session.
	const DISMISS_KEY = "omniplot_maintenance_dismissed";

	let dismissed = $state(false);
	$effect(() => {
		try { dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { /* storage blocked */ }
	});

	function dismiss() {
		dismissed = true;
		try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage blocked */ }
	}
</script>

{#if platformStore.flags.maintenanceMode && !dismissed}
	<div class="maintenance" role="status" aria-live="polite">
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
		<span>We're doing some maintenance — parts of OmniPlot may be slow or briefly unavailable.</span>
		<button class="maintenance__close" onclick={dismiss} aria-label="Dismiss maintenance notice">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
		</button>
	</div>
{/if}

<style>
	.maintenance {
		position: fixed;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 9999;
		width: max-content;
		max-width: calc(100vw - 32px);
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px 9px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-surface-2);
		border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 45%, transparent);
		box-shadow: var(--shadow-lg);
		color: var(--text-primary);
		font-size: 0.8125rem;
		line-height: 1.4;
	}
	.maintenance > svg { flex-shrink: 0; color: var(--color-warning, #f59e0b); }
	.maintenance__close {
		all: unset;
		flex-shrink: 0;
		display: flex;
		padding: 4px;
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.maintenance__close:hover { color: var(--text-primary); background: var(--interactive-hover); }
	.maintenance__close:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
</style>
