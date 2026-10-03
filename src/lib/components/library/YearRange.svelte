<script lang="ts">
	// Two-handle year slider with typed From / To boxes. The handles walk the years
	// that actually exist (so gaps never produce a dead position); a typed year snaps
	// to the nearest one. Shared by the sidebar Year filter and the vote card.
	interface Props {
		/** Years that can be picked, any order. */
		years: number[];
		from: number;
		to: number;
		onchange: (from: number, to: number) => void;
		label?: string;
		/** One row: From box, track, To box (for wide panels). Default stacks them for a narrow sidebar. */
		inline?: boolean;
		/** Years to mark on the track (e.g. ones already voted for). */
		marked?: number[];
	}
	let { years, from, to, onchange, label = "Year range", inline = false, marked = [] }: Props = $props();

	const list = $derived([...new Set(years)].sort((a, b) => a - b));
	const last = $derived(Math.max(0, list.length - 1));
	const nearest = (n: number) => list.reduce((best, y) => (Math.abs(y - n) < Math.abs(best - n) ? y : best), list[0]);
	const idx = (y: number) => Math.max(0, list.indexOf(nearest(y)));
	const ia = $derived(idx(from));
	const ib = $derived(idx(to));
	const pct = (i: number) => (last ? (i / last) * 100 : 0);

	function slide(which: "lo" | "hi", e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const i = Number(el.value);
		const lo = which === "lo" ? Math.min(i, ib) : ia;
		const hi = which === "hi" ? Math.max(i, ia) : ib;
		el.value = String(which === "lo" ? lo : hi);
		onchange(list[lo], list[hi]);
	}

	function type(which: "lo" | "hi", e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const n = Number(el.value);
		if (!Number.isFinite(n) || el.value === "") { el.value = String(which === "lo" ? from : to); return; }
		const y = nearest(n);
		const lo = which === "lo" ? Math.min(y, to) : from;
		const hi = which === "hi" ? Math.max(y, from) : to;
		el.value = String(which === "lo" ? lo : hi);
		onchange(lo, hi);
	}
</script>

<div class="yr" class:yr--inline={inline} role="group" aria-label={label}>
	<input class="yr__box yr__box--lo" type="number" inputmode="numeric" aria-label="From year" min={list[0]} max={list[last]} value={from} onchange={(e) => type("lo", e)} />
	<span class="yr__dash" aria-hidden="true">–</span>
	<input class="yr__box yr__box--hi" type="number" inputmode="numeric" aria-label="To year" min={list[0]} max={list[last]} value={to} onchange={(e) => type("hi", e)} />
	<div class="yr__track" style="--a:{pct(ia)}%; --b:{pct(ib)}%">
		<div class="yr__rail"></div>
		<div class="yr__fill"></div>
		{#if list.length <= 60}
			{#each list as y, i (y)}<span class="yr__tick" class:yr__tick--in={i >= ia && i <= ib} class:yr__tick--marked={marked.includes(y)} style="left:{pct(i)}%"></span>{/each}
		{/if}
		<input class="yr__thumb" class:yr__thumb--top={ia > last / 2} type="range" min="0" max={last} step="1" value={ia} aria-label="From year" aria-valuetext={String(list[ia])} oninput={(e) => slide("lo", e)} />
		<input class="yr__thumb" type="range" min="0" max={last} step="1" value={ib} aria-label="To year" aria-valuetext={String(list[ib])} oninput={(e) => slide("hi", e)} />
	</div>
	<div class="yr__ends" aria-hidden="true"><span>{list[0]}</span><span>{list[last]}</span></div>
</div>

<style>
	.yr {
		display: grid; align-items: center; gap: 8px;
		grid-template-columns: 1fr auto 1fr;
		grid-template-areas: "lo dash hi" "track track track" "ends ends ends";
	}
	.yr--inline {
		grid-template-columns: auto 1fr auto; gap: 4px 14px;
		grid-template-areas: "lo track hi" ". ends .";
	}
	.yr__box--lo { grid-area: lo; }
	.yr__box--hi { grid-area: hi; }
	.yr__dash { grid-area: dash; color: var(--text-tertiary); }
	.yr--inline .yr__dash { display: none; }
	.yr--inline .yr__box { flex: none; width: 84px; height: 40px; font-size: 1.0625rem; }
	.yr__box {
		min-width: 0; height: 34px; padding: 0 8px; text-align: center;
		font: inherit; font-family: var(--font-mono); font-size: 0.9375rem; font-variant-numeric: tabular-nums;
		color: var(--text-primary); background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
		appearance: textfield; -moz-appearance: textfield;
	}
	.yr__box::-webkit-outer-spin-button, .yr__box::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
	.yr__box:hover { border-color: var(--border-default); }
	.yr__box:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }

	.yr__track { grid-area: track; position: relative; height: 22px; margin: 0 8px; }
	.yr__rail, .yr__fill { position: absolute; top: 9px; height: 4px; border-radius: 99px; }
	.yr__rail { left: 0; right: 0; background: var(--border-default); }
	.yr__fill { left: var(--a); right: calc(100% - var(--b)); background: var(--color-brand-dim); }
	/* Two native sliders stacked; only the thumbs take the pointer. */
	.yr__thumb {
		position: absolute; left: -8px; width: calc(100% + 16px); top: 0; height: 22px; margin: 0;
		background: none; pointer-events: none; appearance: none; -webkit-appearance: none;
	}
	.yr__tick { position: absolute; top: 5px; width: 2px; height: 12px; margin-left: -1px; border-radius: 1px; background: var(--border-default); transform: scaleY(0.5); transition: background 0.12s, transform 0.12s; }
	.yr__tick--in { background: color-mix(in srgb, var(--color-brand-dim) 70%, transparent); transform: scaleY(0.75); }
	.yr__tick--marked { background: var(--color-success); transform: scaleY(1.1); }
	.yr__thumb--top { z-index: 1; }
	.yr__thumb::-webkit-slider-runnable-track { background: none; height: 22px; }
	.yr__thumb::-moz-range-track { background: none; height: 22px; }
	.yr__thumb::-webkit-slider-thumb {
		-webkit-appearance: none; pointer-events: auto; width: 16px; height: 16px; margin-top: 3px;
		border-radius: 50%; background: #fff; border: 2px solid var(--color-brand-dim); cursor: grab;
	}
	.yr__thumb::-moz-range-thumb {
		pointer-events: auto; width: 12px; height: 12px; border-radius: 50%;
		background: #fff; border: 2px solid var(--color-brand-dim); cursor: grab;
	}
	.yr__thumb:focus-visible { outline: none; }
	.yr__thumb:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--color-brand); outline-offset: 2px; }
	.yr__thumb:focus-visible::-moz-range-thumb { outline: 2px solid var(--color-brand); outline-offset: 2px; }
	.yr__ends { grid-area: ends; display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
</style>
