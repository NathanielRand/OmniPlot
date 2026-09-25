<script lang="ts">
	import { fitPattern } from "$lib/actions/fitPattern";

	// Draws a pattern at its real proportions (widthInches × heightInches —
	// the same stretch the cutter applies), zoomed to fit the frame.
	interface Props {
		svgPath: string;
		/** Accessible label; omit for decorative thumbnails. */
		label?: string;
		/** Real-world size. Also shown as a caption under large previews. */
		widthInches?: number;
		heightInches?: number;
		size?: "thumb" | "large";
	}
	let { svgPath, label, widthInches, heightInches, size = "large" }: Props = $props();

	const empty = $derived(!svgPath.trim());
</script>

<figure class="pp pp--{size}">
	<div class="pp__frame">
		<svg
			viewBox="0 0 100 100"
			preserveAspectRatio="xMidYMid meet"
			class:pp__svg--hidden={empty}
			role={label && !empty ? "img" : undefined}
			aria-label={label && !empty ? label : undefined}
			aria-hidden={label && !empty ? undefined : "true"}
		>
			<path
				use:fitPattern={{ w: widthInches, h: heightInches, d: svgPath, legacyStroke: false }}
				d={svgPath}
				class="pp__path"
				stroke-width={size === "thumb" ? 1.5 : 2}
				stroke-linejoin="round"
			/>
		</svg>
		{#if empty}
			<span class="pp__empty">No outline</span>
		{/if}
	</div>
	{#if size === "large" && widthInches && heightInches}
		<figcaption class="pp__caption">{widthInches}" × {heightInches}"</figcaption>
	{/if}
</figure>

<style>
	.pp { margin: 0; display: flex; flex-direction: column; gap: 6px; }
	.pp__frame {
		position: relative;
		display: flex; align-items: center; justify-content: center;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		/* faint grid so the outline reads as a cut shape */
		background-image:
			linear-gradient(var(--border-subtle) 1px, transparent 1px),
			linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
		background-size: 16px 16px;
	}
	.pp--large .pp__frame { height: 220px; padding: 12px; }
	.pp--thumb .pp__frame { width: 44px; height: 44px; padding: 4px; background-image: none; }
	.pp__frame svg { width: 100%; height: 100%; overflow: visible; }
	.pp__path { fill: color-mix(in srgb, var(--color-brand) 10%, transparent); stroke: var(--color-brand); }
	.pp__svg--hidden { visibility: hidden; }
	.pp__empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-tertiary); text-align: center; }
	.pp--thumb .pp__empty { font-size: 0.5625rem; }
	.pp__caption { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); text-align: center; }
</style>
