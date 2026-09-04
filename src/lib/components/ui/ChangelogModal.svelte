<script lang="ts">
	import { uiStore, changelogStore } from "$lib/stores";
	import { LATEST_VERSION } from "$lib/config";
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";

	function dismiss() {
		changelogStore.markSeen();
		uiStore.closeChangelogModal();
	}
</script>

{#if uiStore.changelogModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="backdrop animate-fade-in" role="dialog" aria-modal="true" aria-label="What's new">
		<div class="modal animate-scale-in">
			<div class="modal__header">
				<Badge variant="brand" size="sm">v{LATEST_VERSION}</Badge>
				<h2 class="modal__title">You're updated to v{LATEST_VERSION}</h2>
				<p class="modal__sub">
					{#if changelogStore.unseenReleases.length > 1}
						Here's what shipped across the last {changelogStore.unseenReleases.length} releases.
					{:else}
						Here's what shipped in this release.
					{/if}
				</p>
			</div>

			<div class="releases">
				{#each changelogStore.unseenReleases as release}
					<div class="release">
						<div class="release__version">v{release.version}</div>
						<ul class="release__changes">
							{#each release.changes.slice(0, 4) as change}
								<li>{change.text}</li>
							{/each}
							{#if release.changes.length > 4}
								<li class="release__more">+{release.changes.length - 4} more</li>
							{/if}
						</ul>
					</div>
				{/each}
			</div>

			<div class="modal__actions">
				<a href="/changelog" class="modal__link" onclick={dismiss}>View full changelog →</a>
				<Button variant="primary" size="sm" onclick={dismiss}>Got it</Button>
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
		max-width: 480px;
		max-height: 85vh;
		overflow-y: auto;
	}

	.modal__header { margin-bottom: 18px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
	.modal__title { font-size: 1.0625rem; font-weight: 700; margin: 0; }
	.modal__sub {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.releases {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-height: 320px;
		overflow-y: auto;
		margin-bottom: 20px;
		padding-right: 4px;
	}

	.release {
		padding: 12px 14px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		background: var(--bg-surface-2);
	}

	.release__version {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.release__changes {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.release__changes li {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
		padding-left: 14px;
		position: relative;
	}

	.release__changes li::before {
		content: "";
		position: absolute;
		left: 0;
		top: 8px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--text-tertiary);
	}

	.release__more {
		color: var(--text-tertiary);
		font-style: italic;
	}

	.modal__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.modal__link {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-brand, var(--color-brand-dim));
		text-decoration: none;
	}
	.modal__link:hover { text-decoration: underline; }

	@media (max-width: 480px) {
		.modal { padding: 20px; }
		.modal__actions { flex-direction: column-reverse; align-items: stretch; }
		.modal__link { text-align: center; }
	}
</style>
