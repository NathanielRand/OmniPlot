<script lang="ts">
	import { onMount } from "svelte";
	import { tooltipStore } from "$lib/stores/tooltipStore.svelte";

	const GAP = 8;
	const PAD = 10;

	let tipEl = $state<HTMLDivElement | null>(null);
	let size = $state({ w: 0, h: 0 });

	// Re-measure whenever the tooltip (re)appears or its text changes length.
	$effect(() => {
		tooltipStore.visible;
		tooltipStore.text;
		if (tooltipStore.visible && tipEl) {
			const r = tipEl.getBoundingClientRect();
			if (r.width !== size.w || r.height !== size.h) size = { w: r.width, h: r.height };
		} else if (!tooltipStore.visible && (size.w || size.h)) {
			size = { w: 0, h: 0 };
		}
	});

	const style = $derived.by(() => {
		const rect = tooltipStore.rect;
		if (!rect || !tooltipStore.visible) return "";

		const sw = typeof window !== "undefined" ? window.innerWidth : 1280;
		const sh = typeof window !== "undefined" ? window.innerHeight : 800;
		const { w, h } = size;

		let side = tooltipStore.side;
		if (side === "top" && rect.top - h - GAP < PAD) side = "bottom";
		else if (side === "bottom" && rect.bottom + h + GAP > sh - PAD) side = "top";
		else if (side === "left" && rect.left - w - GAP < PAD) side = "right";
		else if (side === "right" && rect.right + w + GAP > sw - PAD) side = "left";

		let top: number;
		let left: number;
		if (side === "top") {
			top = rect.top - h - GAP;
			left = rect.left + rect.width / 2 - w / 2;
		} else if (side === "bottom") {
			top = rect.bottom + GAP;
			left = rect.left + rect.width / 2 - w / 2;
		} else if (side === "left") {
			top = rect.top + rect.height / 2 - h / 2;
			left = rect.left - w - GAP;
		} else {
			top = rect.top + rect.height / 2 - h / 2;
			left = rect.right + GAP;
		}

		left = Math.max(PAD, Math.min(sw - w - PAD, left));
		top = Math.max(PAD, Math.min(sh - h - PAD, top));

		return `top:${top}px;left:${left}px;`;
	});

	// A tooltip anchored to a hover target becomes stale the moment the page
	// scrolls or resizes underneath it — hide rather than chase it around.
	onMount(() => {
		const dismiss = () => tooltipStore.hide();
		window.addEventListener("scroll", dismiss, { capture: true, passive: true });
		window.addEventListener("resize", dismiss);
		return () => {
			window.removeEventListener("scroll", dismiss, true);
			window.removeEventListener("resize", dismiss);
		};
	});
</script>

{#if tooltipStore.visible && tooltipStore.rect}
	<div
		class="op-tooltip"
		class:op-tooltip--ready={size.w > 0}
		role="tooltip"
		bind:this={tipEl}
		style={style}
	>
		{tooltipStore.text}
	</div>
{/if}

<style>
	.op-tooltip {
		position: fixed;
		z-index: 10000;
		max-width: 240px;
		width: max-content;
		padding: 6px 10px;
		background: var(--bg-surface-2);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.4;
		pointer-events: none;
		opacity: 0;
		transform: scale(0.96);
		transition: opacity 0.08s var(--ease-smooth), transform 0.08s var(--ease-smooth);
	}

	.op-tooltip--ready {
		opacity: 1;
		transform: scale(1);
	}

	@media (max-width: 640px) {
		.op-tooltip {
			max-width: min(280px, calc(100vw - 2 * 10px));
			font-size: 0.8125rem;
		}
	}
</style>
