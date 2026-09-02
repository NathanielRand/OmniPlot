<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { FEATURES, SOLUTIONS_NAV } from "$lib/config";
</script>

<svelte:head>
	<title>Features — OmniPlot</title>
	<meta
		name="description"
		content="Every OmniPlot feature in depth: universal plotter support, auto-nesting, plotter diagnostics, pattern library, and more — for vehicle, residential, commercial, and custom cutting jobs."
	/>
	<link rel="canonical" href="https://omniplot.app/features" />
</svelte:head>

<div class="features-page">
	<div class="features-header">
		<Badge variant="default">Features</Badge>
		<h1 class="features-title">Everything OmniPlot does, in depth</h1>
		<p class="features-sub">
			One browser-based platform for every plottable material — PPF, window
			tint, vinyl, apparel, gaskets, signage, and more. Built for vehicle,
			residential, commercial, and custom cutting shops alike.
		</p>
	</div>

	<div class="features-list">
		{#each FEATURES as feat, i}
			<div class="feature-row" class:feature-row--reverse={i % 2 === 1}>
				<div class="feature-row__icon" aria-hidden="true">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d={feat.icon} />
					</svg>
				</div>
				<div class="feature-row__body">
					<h2 class="feature-row__title">{feat.title}</h2>
					<p class="feature-row__desc">{feat.desc}</p>
					<p class="feature-row__detail">{feat.detail}</p>
				</div>
			</div>
		{/each}
	</div>

	<div class="features-solutions">
		<h2 class="features-solutions__title">See it for your kind of work</h2>
		<div class="features-solutions__grid">
			{#each SOLUTIONS_NAV as sol}
				<a href={sol.href} class="features-solutions__card">
					{sol.label}
					<span aria-hidden="true">→</span>
				</a>
			{/each}
		</div>
	</div>

	<div class="features-cta-block">
		<h2>Ready to cut smarter?</h2>
		<Button variant="primary" size="lg" href="/signup">Start free</Button>
	</div>
</div>

<style>
	.features-page {
		max-width: 880px;
		margin: 0 auto;
		padding: 64px 24px 96px;
	}

	.features-header {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		margin-bottom: 64px;
	}

	.features-title {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.15;
		max-width: 640px;
	}

	.features-sub {
		color: var(--text-muted);
		max-width: 560px;
		font-size: 1.05rem;
		line-height: 1.6;
	}

	.features-list {
		display: flex;
		flex-direction: column;
		gap: 48px;
	}

	.feature-row {
		display: grid;
		grid-template-columns: 64px 1fr;
		gap: 24px;
		align-items: start;
	}

	.feature-row__icon {
		width: 56px;
		height: 56px;
		border-radius: var(--radius-lg, 12px);
		background: var(--bg-subtle, rgba(0, 229, 255, 0.08));
		color: var(--color-brand);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.feature-row__title {
		font-size: 1.35rem;
		font-weight: 700;
		margin-bottom: 8px;
	}

	.feature-row__desc {
		font-weight: 600;
		margin-bottom: 8px;
	}

	.feature-row__detail {
		color: var(--text-muted);
		line-height: 1.6;
	}

	.features-solutions {
		margin-top: 96px;
		text-align: center;
	}

	.features-solutions__title {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 24px;
	}

	.features-solutions__grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
	}

	.features-solutions__card {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 20px;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg, 12px);
		font-weight: 600;
		text-decoration: none;
		color: var(--text-primary, inherit);
		transition: border-color 0.2s, transform 0.2s;
	}

	.features-solutions__card:hover {
		border-color: var(--color-brand);
		transform: translateY(-2px);
	}

	.features-cta-block {
		margin-top: 96px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
	}

	.features-cta-block h2 {
		font-size: 1.75rem;
		font-weight: 700;
	}

	@media (max-width: 640px) {
		.feature-row {
			grid-template-columns: 1fr;
		}
		.features-solutions__grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
