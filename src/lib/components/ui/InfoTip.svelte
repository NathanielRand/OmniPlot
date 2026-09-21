<script lang="ts">
	import { tooltip } from "$lib/actions/tooltip";
	import type { TooltipSide } from "$lib/stores/tooltipStore.svelte";

	interface Props {
		text: string;
		side?: TooltipSide;
	}

	let { text, side = "top" }: Props = $props();
</script>

<!--
	Small "info" affordance for labels/headings that have nothing else to
	hang a hover target on. Focusable so the tip is reachable by keyboard.
-->
<button type="button" class="info-tip" use:tooltip={{ text, side }} aria-label={text}>
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<circle cx="12" cy="12" r="10" />
		<path d="M12 16v-5" stroke-linecap="round" />
		<circle cx="12" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
	</svg>
</button>

<style>
	.info-tip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin-left: 2px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--text-tertiary);
		cursor: help;
		vertical-align: -2px;
		transition: color 0.12s, background 0.12s;
	}

	.info-tip:hover,
	.info-tip:focus-visible {
		color: var(--color-brand-dim);
		background: var(--interactive-hover);
	}

	.info-tip:focus-visible {
		outline: 2px solid var(--color-brand-dim);
		outline-offset: 1px;
	}
</style>
