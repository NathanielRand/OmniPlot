<script lang="ts">
	import { onMount } from "svelte";

	export interface TourStep {
		/** CSS selector for the element to highlight, or null for a centered modal */
		target: string | null;
		title: string;
		body: string;
		/** Which side of the target to place the tooltip card */
		position?: "top" | "bottom" | "left" | "right" | "center";
	}

	interface Props {
		steps: TourStep[];
		open: boolean;
		onclose: () => void;
	}

	let { steps, open, onclose }: Props = $props();

	let stepIdx = $state(0);
	let spotRect = $state<DOMRect | null>(null);

	const step = $derived(steps[stepIdx]);
	const isFirst = $derived(stepIdx === 0);
	const isLast = $derived(stepIdx === steps.length - 1);

	function updateSpotlight() {
		if (!step || !open || !step.target) {
			spotRect = null;
			return;
		}
		const el = document.querySelector(step.target);
		spotRect = el ? el.getBoundingClientRect() : null;
	}

	$effect(() => {
		if (open) {
			stepIdx = 0;
		}
	});

	$effect(() => {
		// Re-derive when stepIdx or open changes
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		stepIdx; open;
		if (typeof requestAnimationFrame !== "undefined") {
			requestAnimationFrame(updateSpotlight);
		}
	});

	// Recalculate on resize
	onMount(() => {
		window.addEventListener("resize", updateSpotlight);
		return () => window.removeEventListener("resize", updateSpotlight);
	});

	function next() {
		if (isLast) { finish(); return; }
		stepIdx++;
	}

	function prev() {
		if (!isFirst) stepIdx--;
	}

	function skip() {
		finish();
	}

	function finish() {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("op-tour-seen", "1");
		}
		onclose();
	}

	// ─── Tooltip positioning ──────────────────────
	const TOOLTIP_W = 320;
	const TOOLTIP_H = 200;
	const PAD = 14;

	const tooltipStyle = $derived.by(() => {
		if (!step) return "";
		const pos = step.position ?? "center";

		if (pos === "center" || !spotRect) {
			return "top:50%;left:50%;transform:translate(-50%,-50%);";
		}

		const sw = typeof window !== "undefined" ? window.innerWidth : 1280;
		const sh = typeof window !== "undefined" ? window.innerHeight : 800;

		let top = 0;
		let left = 0;

		if (pos === "bottom") {
			left = Math.max(PAD, Math.min(sw - TOOLTIP_W - PAD, spotRect.left + spotRect.width / 2 - TOOLTIP_W / 2));
			top = Math.min(sh - TOOLTIP_H - PAD, spotRect.bottom + PAD);
		} else if (pos === "top") {
			left = Math.max(PAD, Math.min(sw - TOOLTIP_W - PAD, spotRect.left + spotRect.width / 2 - TOOLTIP_W / 2));
			top = Math.max(PAD, spotRect.top - TOOLTIP_H - PAD);
		} else if (pos === "left") {
			left = Math.max(PAD, spotRect.left - TOOLTIP_W - PAD);
			top = Math.max(PAD, Math.min(sh - TOOLTIP_H - PAD, spotRect.top + spotRect.height / 2 - TOOLTIP_H / 2));
		} else if (pos === "right") {
			left = Math.min(sw - TOOLTIP_W - PAD, spotRect.right + PAD);
			top = Math.max(PAD, Math.min(sh - TOOLTIP_H - PAD, spotRect.top + spotRect.height / 2 - TOOLTIP_H / 2));
		}

		return `top:${top}px;left:${left}px;`;
	});
</script>

{#if open && step}
	<!-- Click blocker: prevents interaction with the page while touring -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="tour-blocker" onclick={skip}></div>

	<!-- Spotlight cutout (box-shadow creates the darkened overlay) -->
	{#if spotRect}
		<div
			class="tour-spotlight"
			aria-hidden="true"
			style="
				top: {spotRect.top - 6}px;
				left: {spotRect.left - 6}px;
				width: {spotRect.width + 12}px;
				height: {spotRect.height + 12}px;
			"
		></div>
	{:else}
		<!-- No target: dark backdrop directly on blocker -->
		<div class="tour-backdrop" aria-hidden="true"></div>
	{/if}

	<!-- Tooltip card -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="tour-card"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Guided tour step {stepIdx + 1}: {step.title}"
		style={tooltipStyle}
		onclick={(e) => e.stopPropagation()}
	>
		<div class="tour-card__header">
			<div class="tour-card__dots" aria-label="Step {stepIdx + 1} of {steps.length}">
				{#each steps as _, i}
					<span class="tour-dot" class:active={i === stepIdx} aria-hidden="true"></span>
				{/each}
			</div>
			<button class="tour-skip" onclick={skip} aria-label="Skip tour">Skip</button>
		</div>

		<h3 class="tour-card__title">{step.title}</h3>
		<p class="tour-card__body">{step.body}</p>

		<div class="tour-card__footer">
			{#if !isFirst}
				<button class="tour-btn tour-btn--ghost" onclick={prev}>← Back</button>
			{:else}
				<div></div>
			{/if}
			<button class="tour-btn tour-btn--primary" onclick={next}>
				{isLast ? "Finish" : "Next →"}
			</button>
		</div>
	</div>
{/if}

<style>
	/* ── Click blocker ─────────────────────── */
	.tour-blocker {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: transparent;
		cursor: default;
	}

	/* ── Spotlight: box-shadow creates the dark overlay with a "hole" ── */
	.tour-spotlight {
		position: fixed;
		z-index: 1001;
		border-radius: 8px;
		box-shadow:
			0 0 0 9999px rgba(0, 0, 0, 0.6),
			0 0 0 2px var(--color-brand);
		pointer-events: none;
		transition:
			top 0.25s var(--ease-smooth),
			left 0.25s var(--ease-smooth),
			width 0.25s var(--ease-smooth),
			height 0.25s var(--ease-smooth);
	}

	/* ── Backdrop for center steps (no spotlight) ── */
	.tour-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1001;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	/* ── Tooltip card ─────────────────────── */
	.tour-card {
		position: fixed;
		z-index: 1002;
		width: 320px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow:
			var(--shadow-lg),
			0 0 0 1px rgba(0, 229, 255, 0.1);
		padding: 18px;
		animation: tour-in 0.18s var(--ease-smooth);
	}

	@keyframes tour-in {
		from { opacity: 0; transform: translateY(6px) scale(0.97); }
		to   { opacity: 1; transform: translateY(0) scale(1); }
	}

	.tour-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.tour-card__dots {
		display: flex;
		gap: 5px;
		align-items: center;
	}

	.tour-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--border-default);
		transition: background 0.15s, width 0.15s;
	}

	.tour-dot.active {
		width: 16px;
		border-radius: 3px;
		background: var(--color-brand);
	}

	.tour-skip {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		background: none;
		border: none;
		cursor: pointer;
		font-family: var(--font-body);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		transition: color 0.12s, background 0.12s;
	}

	.tour-skip:hover {
		color: var(--text-secondary);
		background: var(--interactive-hover);
	}

	.tour-card__title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 8px;
		line-height: 1.3;
	}

	.tour-card__body {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.55;
		margin: 0 0 16px;
	}

	.tour-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.tour-btn {
		padding: 6px 14px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		border: none;
		transition: opacity 0.12s, background 0.12s;
	}

	.tour-btn--primary {
		background: var(--color-brand);
		color: #000;
	}

	.tour-btn--primary:hover {
		opacity: 0.88;
	}

	.tour-btn--ghost {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-default);
	}

	.tour-btn--ghost:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
</style>
