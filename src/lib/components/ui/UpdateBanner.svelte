<script lang="ts" module>
	// Read by MaintenanceBanner so the two bottom cards never overlap on phones.
	export const updateCard = $state({ visible: false });
</script>

<script lang="ts">
	import { updated } from "$app/stores";
	import { page } from "$app/state";
	import { LATEST_VERSION } from "$lib/config";
	import { plotterStatusStore } from "$lib/stores";

	// `$updated` becomes true when SvelteKit detects that /_app/version.json
	// on the server has a newer `name` than what is baked into the running bundle.
	// Polling interval is configured via kit.version.pollInterval in svelte.config.js.
	let dismissed = $state(false);
	const visible = $derived($updated && !dismissed);
	$effect(() => { updateCard.visible = visible; });

	// The deploy we'd refresh into — this tab's bundle only knows its own
	// version, so ask the (already updated) server.
	let nextVersion = $state<string | null>(null);
	$effect(() => {
		if (!$updated || nextVersion) return;
		fetch("/api/version", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => { if (typeof d?.version === "string") nextVersion = d.version; })
			.catch(() => {});
	});
	const isNewRelease = $derived(!!nextVersion && nextVersion !== LATEST_VERSION);

	// Never interrupt a running cut: refreshing would stop a USB job mid-send.
	const cutting = $derived(plotterStatusStore.current.state === "cutting");
	const onStudio = $derived(page.url.pathname.startsWith("/studio"));
</script>

{#if visible}
	<div class="update-card" class:update-card--studio={onStudio} role="status" aria-live="polite">
		<div class="update-card__accent"></div>

		<div class="update-card__body">
			<div class="update-card__header">
				<div class="update-card__icon-wrap" aria-hidden="true">
					<svg class="update-card__icon" class:update-card__icon--still={cutting} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
				</div>
				<div class="update-card__copy">
					<p class="update-card__title">
						{isNewRelease ? `OmniPlot v${nextVersion} is ready` : "Update available"}
					</p>
					<p class="update-card__sub">
						{#if cutting}
							Finish your cut first — refreshing now would stop the plotter.
						{:else}
							{isNewRelease ? `You're on v${LATEST_VERSION}.` : "A new version of OmniPlot is ready."} Refresh to update.
						{/if}
					</p>
				</div>
				<button class="update-card__close" onclick={() => (dismissed = true)} aria-label="Dismiss">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- New tab: this tab's bundle predates the release notes, and
			     navigating here would full-reload the tab. -->
			<a
				class="update-card__link"
				href={isNewRelease ? `/changelog#v${nextVersion}` : "/changelog"}
				target="_blank"
				rel="noopener"
			>
				{isNewRelease ? `See what's new in v${nextVersion}` : "See the changelog"}
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>
			</a>

			<button class="update-card__cta" onclick={() => location.reload()} disabled={cutting}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				{cutting ? "Refresh after this cut" : "Refresh now"}
			</button>
		</div>
	</div>
{/if}

<style>
	.update-card {
		position: fixed;
		bottom: 24px;
		left: 24px;
		z-index: 9998;
		width: 300px;
		display: flex;
		border-radius: var(--radius-xl);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		box-shadow: var(--shadow-lg), 0 0 32px rgba(0, 112, 255, 0.12);
		overflow: hidden;
		animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.update-card__accent {
		width: 3px;
		flex-shrink: 0;
		background: linear-gradient(180deg, #00e5ff 0%, #0070ff 100%);
	}

	.update-card__body {
		flex: 1;
		padding: 14px 14px 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.update-card__header {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}

	.update-card__icon-wrap {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		background: rgba(0, 112, 255, 0.12);
		border: 1px solid rgba(0, 112, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-brand-dim);
	}

	.update-card__icon {
		width: 15px;
		height: 15px;
		animation: spin 2.4s linear infinite;
	}

	.update-card__copy {
		flex: 1;
		min-width: 0;
	}

	.update-card__title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.3;
	}

	.update-card__sub {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 2px;
		line-height: 1.4;
	}

	.update-card__close {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-top: -2px;
		margin-right: -2px;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}

	.update-card__close svg {
		width: 11px;
		height: 11px;
	}

	.update-card__close:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	.update-card__cta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		padding: 7px 12px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #fff;
		background: var(--color-brand-dim);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background 0.15s, transform 0.1s;
	}

	.update-card__cta svg {
		width: 13px;
		height: 13px;
	}

	.update-card__cta:hover:not(:disabled) {
		background: #005fe0;
	}

	.update-card__cta:disabled {
		cursor: not-allowed;
		background: var(--bg-surface-3);
		color: var(--text-secondary);
	}

	.update-card__link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		align-self: flex-start;
		margin: -4px 0 -2px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-brand);
		text-decoration: none;
	}
	.update-card__link svg {
		width: 11px;
		height: 11px;
	}
	.update-card__link:hover {
		text-decoration: underline;
	}

	.update-card__icon--still {
		animation: none;
	}

	/* Studio: sit above the fixed metrics bar instead of covering it */
	.update-card--studio {
		bottom: calc(58px + 16px + env(safe-area-inset-bottom, 0px));
	}

	.update-card__cta:active {
		transform: scale(0.98);
	}

	@keyframes slide-up {
		from { transform: translateY(16px); opacity: 0; }
		to   { transform: translateY(0);    opacity: 1; }
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 480px) {
		.update-card {
			left: 16px;
			right: 16px;
			bottom: 16px;
			width: auto;
		}
		.update-card--studio {
			bottom: calc(58px + 12px + env(safe-area-inset-bottom, 0px));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.update-card, .update-card__icon { animation: none; }
	}
</style>
