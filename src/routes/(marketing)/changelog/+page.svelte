<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { CHANGELOG } from "$lib/config";

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
			<div class="release">
				<div class="release__meta">
					<div class="release__version">v{release.version}</div>
					<div class="release__date">
						{new Date(release.date).toLocaleDateString("en-US", {
							year: "numeric",
							month: "long",
							day: "numeric",
						})}
					</div>
					{#if release.label}
						<Badge variant="brand" size="sm">{release.label}</Badge>
					{/if}
				</div>

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
			</div>
		{/each}

		<!-- Roadmap teaser -->
		<div class="roadmap">
			<h2 class="roadmap__title">On the roadmap</h2>
			<div class="roadmap-items">
				{#each [
					["Cut Agent: port auto-detection UI in studio", "Q2 2026"],
					["Window tint pattern library expansion", "Q2 2026"],
					["Multi-plotter queue — send to multiple cutters in parallel", "Q3 2026"],
					["Agent status ping in studio — live connected/disconnected indicator", "Q3 2026"],
					["Mobile cut agent companion app", "Q3 2026"],
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
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 24px;
		padding: 32px 0;
		border-bottom: 1px solid var(--border-subtle);
	}

	.release:first-child {
		padding-top: 0;
	}

	.release__meta {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 2px;
	}

	.release__version {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: 0.05em;
	}

	.release__date {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.release__changes {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.change {
		display: flex;
		align-items: flex-start;
		gap: 10px;
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
		.release {
			grid-template-columns: 1fr;
			gap: 12px;
		}
	}
</style>
