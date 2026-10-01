<script lang="ts">
	import type { Snippet } from "svelte";
	import { monogram } from "$lib/utils/vehicleCatalog";

	// Banner at the top of a make / model / trim page. Uses the make's cover
	// image (or the model's) when there is one, and still looks finished when
	// there isn't.
	interface Props {
		title: string;
		eyebrow?: string;
		logoUrl?: string;
		imageUrl?: string;
		stats?: string[];
		children?: Snippet;
	}
	let { title, eyebrow, logoUrl, imageUrl, stats = [], children }: Props = $props();

	let imgFailed = $state(false);
	let logoFailed = $state(false);
	$effect(() => { imageUrl; imgFailed = false; });
	$effect(() => { logoUrl; logoFailed = false; });
</script>

<header class="hero" class:hero--image={!!imageUrl && !imgFailed}>
	{#if imageUrl && !imgFailed}
		<img class="hero__bg" src={imageUrl} alt="" decoding="async" onerror={() => (imgFailed = true)} />
		<div class="hero__scrim" aria-hidden="true"></div>
	{/if}
	<div class="hero__inner">
		<div class="hero__mark" aria-hidden="true">
			{#if logoUrl && !logoFailed}
				<img src={logoUrl} alt="" decoding="async" onerror={() => (logoFailed = true)} />
			{:else}
				<span>{monogram(eyebrow ?? title)}</span>
			{/if}
		</div>
		<div class="hero__text">
			{#if eyebrow}<div class="hero__eyebrow">{eyebrow}</div>{/if}
			<h2 class="hero__title">{title}</h2>
			{#if stats.length}
				<div class="hero__stats">{#each stats as s, i (i)}<span>{s}</span>{/each}</div>
			{/if}
		</div>
		{#if children}<div class="hero__actions">{@render children()}</div>{/if}
	</div>
</header>

<style>
	.hero {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		background:
			radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--color-brand) 14%, transparent), transparent 60%),
			var(--bg-surface);
	}
	.hero__bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.hero__scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, rgba(8, 12, 20, 0.88), rgba(8, 12, 20, 0.45));
	}
	.hero__inner {
		position: relative;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px 18px;
		flex-wrap: wrap;
	}
	.hero__mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 60px;
		height: 60px;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
		border: 1px solid var(--border-subtle);
		padding: 8px;
	}
	.hero__mark img { max-width: 100%; max-height: 100%; object-fit: contain; }
	.hero__mark span {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.15rem;
		color: var(--color-brand-dim);
	}
	.hero__text { flex: 1 1 200px; min-width: 0; }
	.hero__eyebrow {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.hero__title {
		margin: 2px 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.25rem, 2.6vw, 1.75rem);
		font-weight: 700;
		line-height: 1.15;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.hero__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.hero__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

	.hero--image .hero__eyebrow,
	.hero--image .hero__stats { color: rgba(255, 255, 255, 0.75); }
	.hero--image .hero__title { color: #fff; }

	@media (max-width: 480px) {
		.hero__inner { padding: 14px; gap: 12px; }
		.hero__mark { width: 48px; height: 48px; }
	}
</style>
