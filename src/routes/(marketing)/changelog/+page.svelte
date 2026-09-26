<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { CHANGELOG, LATEST_VERSION } from "$lib/config";
	import { changelogStore } from "$lib/stores";
	import { onMount } from "svelte";

	// Viewing this page is what clears the "new" badge in the app navs.
	onMount(() => {
		changelogStore.init();
		changelogStore.markSeen();
	});

	const TYPE_VARIANT = {
		feature: "brand",
		fix: "success",
		improvement: "warning",
		breaking: "danger",
	} as const;

	const TYPE_LABEL = {
		feature: "New",
		fix: "Fix",
		improvement: "Improved",
		breaking: "Breaking",
	} as const;
</script>

<svelte:head>
	<title>Changelog — OmniPlot</title>
</svelte:head>

<div class="changelog-page">
	<div class="changelog-header">
		<Badge variant="default">Changelog</Badge>
		<h1 class="changelog-title">What's new in OmniPlot</h1>
		<p class="changelog-sub">Release notes and product updates.</p>
	</div>

	<div class="changelog-feed">
		{#each CHANGELOG as release}
			<section class="release" id="v{release.version}" aria-labelledby="v{release.version}-title">
				<header class="release__meta">
					<div class="release__tags">
						<a class="release__version" href="#v{release.version}">v{release.version}</a>
						{#if release.version === LATEST_VERSION}
							<span class="release__latest">Latest</span>
						{/if}
					</div>
					<h2 class="release__title" id="v{release.version}-title">{release.label}</h2>
					<time class="release__date" datetime={release.date}>
						{new Date(`${release.date}T00:00:00`).toLocaleDateString("en-US", {
							year: "numeric",
							month: "long",
							day: "numeric",
						})}
					</time>
				</header>

				<div class="release__changes">
					{#each release.changes as change}
						<div class="change">
							<Badge
								variant={TYPE_VARIANT[change.type] ?? "default"}
								size="sm"
							>
								{TYPE_LABEL[change.type] ?? change.type}
							</Badge>
							<span class="change__text">{change.text}</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<!-- Roadmap teaser -->
		<div class="roadmap">
			<h2 class="roadmap__title">On the roadmap</h2>
			<div class="roadmap-items">
				{#each [
					["Window tint pattern library expansion", "Q2 2026"],
					["macOS Cut Agent download", "Q2 2026"],
					["Heat shrinkage buffer — add margin to patterns for stretch film installation", "Q3 2026"],
					["Multi-plotter queue — send to multiple cutters in parallel", "Q3 2026"],
					["Offline mode — studio works without internet", "Q4 2026"],
				] as [item, eta]}
					<div class="roadmap-item">
						<div class="roadmap-item__dot" aria-hidden="true"></div>
						<div class="roadmap-item__body">
							<span class="roadmap-item__name">{item}</span>
							<Badge variant="default" size="sm">{eta}</Badge>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.changelog-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 24px 80px;
	}

	.changelog-header {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 48px;
	}

	.changelog-title {
		font-size: clamp(1.75rem, 4vw, 2.25rem);
		letter-spacing: -0.03em;
		margin: 0;
	}
	.changelog-sub {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		margin: 0;
	}

	.changelog-feed {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.release {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 36px 0;
		border-bottom: 1px solid var(--border-subtle);
		/* Clear the sticky marketing header when linked to #v1.2.3 */
		scroll-margin-top: 88px;
	}

	.release:first-child {
		padding-top: 0;
	}

	.release__meta {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.release__tags {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.release__version {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-brand);
		background: var(--color-brand-muted);
		border: 1px solid var(--border-brand);
		border-radius: 999px;
		padding: 2px 9px;
		text-decoration: none;
	}
	.release__version:hover {
		text-decoration: underline;
	}

	.release__latest {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
	}

	.release__title {
		font-size: clamp(1.125rem, 2.4vw, 1.375rem);
		letter-spacing: -0.02em;
		line-height: 1.25;
		margin: 0;
		overflow-wrap: break-word;
	}

	.release__date {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.release:target .release__version {
		background: var(--color-brand-dim);
		color: #fff;
	}

	.release__changes {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* Type badges share one column width so every change's text lines up */
	.change {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr);
		align-items: start;
		gap: 12px;
	}
	.change :global(.badge) {
		justify-self: start;
	}

	.change__text {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.5;
		padding-top: 2px;
	}

	/* Roadmap */
	.roadmap {
		padding: 32px 0;
	}

	.roadmap__title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 20px;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.75rem;
	}

	.roadmap-items {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.roadmap-item {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.roadmap-item__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 2px solid var(--border-strong);
		background: transparent;
		flex-shrink: 0;
	}

	.roadmap-item__body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex: 1;
		gap: 12px;
	}

	.roadmap-item__name {
		font-size: 0.9375rem;
		color: var(--text-secondary);
	}

	@media (max-width: 600px) {
		.changelog-page {
			padding: 40px 16px 64px;
		}
		.release {
			gap: 14px;
			padding: 28px 0;
		}
		.release__changes {
			gap: 18px;
		}
		.change {
			grid-template-columns: minmax(0, 1fr);
			gap: 6px;
		}
		.roadmap-item__body {
			flex-wrap: wrap;
			gap: 4px 12px;
		}
	}
</style>
