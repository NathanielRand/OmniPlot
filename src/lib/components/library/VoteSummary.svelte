<script lang="ts">
	// "Already voted" — the locked-in state of a vote, shared by the coming-soon panel
	// and the request modal so a vote reads the same wherever it was cast.
	import type { MyVote } from "$lib/utils/demand";
	import { groupYearLabels } from "$lib/utils/vehicleCatalog";
	import type { Generation } from "$lib/types";

	interface Props {
		mine: MyVote | undefined;
		/** Play the check burst (right after voting, not when arriving already voted). */
		burst?: boolean;
		busy?: boolean;
		onChange?: () => void;
		onRemove?: () => void;
		/** The model's generations, and the years a vote could name — a fully voted generation reads as its name. */
		gens?: Generation[];
		available?: number[];
	}
	let { mine, burst = false, busy = false, onChange, onRemove, gens = [], available }: Props = $props();

	const label = $derived(
		mine?.any ? "any year" : mine?.years.length ? groupYearLabels(mine.years, gens, available).map((g) => g.label).join(", ") : "",
	);
</script>

<div class="vs" role="status">
	<span class="vs__check" class:vs__check--burst={burst} aria-hidden="true">
		<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path class="tick" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
	</span>
	<div class="vs__text">
		<strong>Already voted{label ? ` — ${label}` : ""}</strong>
		{#if onChange || onRemove}
			<span class="vs__actions">
				{#if onChange}<button type="button" class="vs__link" disabled={busy} onclick={onChange}>Change</button>{/if}
				{#if onChange && onRemove}<span aria-hidden="true">·</span>{/if}
				{#if onRemove}<button type="button" class="vs__link" disabled={busy} onclick={onRemove}>Remove vote</button>{/if}
			</span>
		{/if}
	</div>
</div>

<style>
	.vs { display: flex; align-items: center; gap: 12px; }
	.vs__check { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); border: 1px solid color-mix(in srgb, var(--color-success) 40%, transparent); border-radius: 50%; }
	.vs__check--burst { animation: vs-pop 520ms cubic-bezier(.2,1.4,.4,1); }
	.vs__check--burst .tick { stroke-dasharray: 24; stroke-dashoffset: 24; animation: vs-draw 380ms 140ms ease-out forwards; }
	.vs__text { display: flex; flex-direction: column; gap: 2px; font-size: 0.875rem; }
	.vs__actions { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-tertiary); }
	.vs__link { padding: 0; font: inherit; font-size: 0.75rem; color: var(--text-brand); background: none; border: none; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
	.vs__link:disabled { opacity: 0.6; cursor: wait; }
	@keyframes vs-pop { 0% { transform: scale(0.6); } 60% { transform: scale(1.12); } 100% { transform: scale(1); } }
	@keyframes vs-draw { to { stroke-dashoffset: 0; } }
	@media (prefers-reduced-motion: reduce) {
		.vs__check--burst, .vs__check--burst .tick { animation: none; stroke-dashoffset: 0; }
	}
</style>
