<script lang="ts">
	import { BODY_STYLE_PATH, monogram } from "$lib/utils/vehicleCatalog";

	// One card for all three drill-down levels.
	//  make  — logo mark over an optional cover image, monogram when no logo
	//  model — image, body-style silhouette when no image
	//  trim  — text-first; an image slot appears only once one is supplied
	interface Props {
		variant: "make" | "model" | "trim";
		title: string;
		/** Small line above the title (the make on a model tile). */
		eyebrow?: string;
		/** Facts under the title, e.g. ["12 models", "48 patterns"]. */
		meta?: string[];
		logoUrl?: string;
		imageUrl?: string;
		bodyStyle?: string;
		/** Year range chip, e.g. "2018–2024". */
		years?: string;
		onclick: () => void;
		label?: string;
	}

	let { variant, title, eyebrow, meta = [], logoUrl, imageUrl, bodyStyle, years, onclick, label }: Props = $props();

	// A URL that 404s (or hasn't propagated) quietly falls back instead of
	// leaving a broken-image icon in the middle of the grid.
	let imgFailed = $state(false);
	let logoFailed = $state(false);
	$effect(() => { imageUrl; imgFailed = false; });
	$effect(() => { logoUrl; logoFailed = false; });

	const showImage = $derived(!!imageUrl && !imgFailed);
	const showLogo = $derived(!!logoUrl && !logoFailed);
</script>

<button class="tile tile--{variant}" class:tile--has-image={showImage} {onclick} aria-label={label ?? title}>
	{#if variant !== "trim" || showImage}
		<div class="tile__media">
			{#if showImage}
				<img class="tile__img" src={imageUrl} alt="" loading="lazy" decoding="async" onerror={() => (imgFailed = true)} />
				<div class="tile__scrim" aria-hidden="true"></div>
			{:else if variant === "model"}
				<svg class="tile__sil" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d={BODY_STYLE_PATH[bodyStyle ?? "sedan"] ?? BODY_STYLE_PATH.sedan} />
					<ellipse cx="6.5" cy="14" rx="2" ry="1.5" />
					<ellipse cx="17.5" cy="14" rx="2" ry="1.5" />
				</svg>
			{/if}

			{#if variant === "make"}
				<div class="tile__logo">
					{#if showLogo}
						<img src={logoUrl} alt="" loading="lazy" decoding="async" onerror={() => (logoFailed = true)} />
					{:else}
						<span class="tile__mono" aria-hidden="true">{monogram(title)}</span>
					{/if}
				</div>
			{/if}

			{#if years && variant === "model"}<span class="tile__years">{years}</span>{/if}
		</div>
	{/if}

	<div class="tile__body">
		{#if eyebrow}<div class="tile__eyebrow">{eyebrow}</div>{/if}
		<div class="tile__title">{title}</div>
		{#if meta.length || (years && variant !== "model")}
			<div class="tile__meta">
				{#if years && variant !== "model"}<span class="tile__chip">{years}</span>{/if}
				{#each meta as m, i (i)}<span>{m}</span>{/each}
			</div>
		{/if}
	</div>

	<svg class="tile__go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
</button>

<style>
	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		text-align: left;
		min-width: 0;
		padding: 0;
		overflow: hidden;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		color: var(--text-primary);
		font-family: var(--font-body);
		cursor: pointer;
		transition: transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), border-color 0.15s, box-shadow 0.18s, background 0.15s;
	}
	.tile:hover {
		transform: translateY(-3px);
		border-color: color-mix(in srgb, var(--color-brand) 55%, var(--border-default));
		box-shadow: 0 10px 28px -12px color-mix(in srgb, var(--color-brand-dim) 45%, transparent);
	}
	.tile:active { transform: translateY(-1px); }
	.tile:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }

	/* ─── Media region ─── */
	.tile__media {
		position: relative;
		display: grid;
		place-items: center;
		overflow: hidden;
		background:
			radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--color-brand) 10%, transparent), transparent 70%),
			var(--bg-surface-2);
	}
	.tile--make .tile__media { aspect-ratio: 16 / 11; }
	.tile--model .tile__media { aspect-ratio: 16 / 10; }
	.tile--trim .tile__media { aspect-ratio: 16 / 9; }

	.tile__img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.tile:hover .tile__img { transform: scale(1.05); }
	.tile__scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.35), transparent 55%);
		pointer-events: none;
	}
	/* A make with a cover image: tone it down so the logo stays readable. */
	.tile--make.tile--has-image .tile__scrim { background: rgba(8, 12, 20, 0.45); }

	.tile__sil {
		width: 62%;
		height: auto;
		color: var(--color-brand);
		opacity: 0.85;
		transition: transform 0.25s;
	}
	.tile:hover .tile__sil { transform: scale(1.06); }

	.tile__logo {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: clamp(64px, 44%, 112px);
		aspect-ratio: 1;
	}
	.tile__logo img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25));
	}
	.tile__mono {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(1.1rem, 2.4vw, 1.6rem);
		letter-spacing: 0.02em;
		color: #fff;
		background: linear-gradient(135deg, var(--color-brand-dim), var(--color-brand));
		box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--color-brand-dim) 70%, transparent);
	}

	.tile__years {
		position: absolute;
		left: 10px;
		bottom: 10px;
		z-index: 1;
		padding: 2px 8px;
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-primary);
		background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
		backdrop-filter: blur(6px);
		border: 1px solid var(--border-subtle);
	}

	/* ─── Body ─── */
	.tile__body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 38px 13px 14px;
		min-width: 0;
	}
	.tile--trim:not(.tile--has-image) .tile__body {
		padding: 16px 40px 16px 18px;
		border-left: 3px solid var(--color-brand);
	}
	.tile__eyebrow {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.tile__title {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 1rem;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}
	.tile--make .tile__title { font-size: 1.0625rem; }
	.tile__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.tile__meta span + span:not(.tile__chip)::before {
		content: "·";
		margin-right: 10px;
		color: var(--text-tertiary);
	}
	.tile__chip {
		padding: 1px 8px;
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	.tile__go {
		position: absolute;
		right: 12px;
		bottom: 14px;
		color: var(--text-tertiary);
		transition: transform 0.18s, color 0.15s;
	}
	.tile:hover .tile__go { transform: translateX(3px); color: var(--color-brand); }
	.tile--trim:not(.tile--has-image) .tile__go { bottom: 50%; transform: translateY(50%); }
	.tile--trim:not(.tile--has-image):hover .tile__go { transform: translate(3px, 50%); }

	@media (prefers-reduced-motion: reduce) {
		.tile, .tile__img, .tile__sil, .tile__go { transition: none; }
		.tile:hover, .tile:hover .tile__img, .tile:hover .tile__sil { transform: none; }
	}
</style>
