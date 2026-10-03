<script lang="ts">
	import Spinner from "$lib/components/ui/Spinner.svelte";
	// "No patterns yet" for a make/model an admin has listed ahead of its patterns,
	// with a vote that feeds the same demand record the request form does.
	// Voting is one step: pick, the check lands, the count ticks up, and the options
	// fold away into an "already voted" summary (with a way to change it).
	import { fly } from "svelte/transition";
	import VoteSummary from "./VoteSummary.svelte";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { userStore } from "$lib/stores";
	import { demandId, hasVoted, votesForYear } from "$lib/utils/demand";
	import { yearOptions, genSpan } from "$lib/utils/vehicleCatalog";
	import type { Generation } from "$lib/types";

	interface Props {
		make: string;
		model: string;
		/** Model years that have no patterns yet (what a vote can name). */
		years: number[];
		/** Nothing at all is available for what's on screen — otherwise this is a slim notice. */
		allSoon: boolean;
		/** How the admin grouped this model's years — a generation votes as one button. */
		gens?: Generation[];
	}
	let { make, model, years, allSoon, gens = [] }: Props = $props();

	const id = $derived(demandId({ projectType: "vehicle", make, model }));
	const record = $derived(patternStore.requests.find((r) => r.id === id));
	const mine = $derived(patternStore.myVotes[id]);
	const signedIn = $derived(!!userStore.user);
	const sortedYears = $derived([...years].sort((a, b) => b - a));
	// Year buttons: one per generation (all its open years), then single years.
	const options = $derived(
		yearOptions(sortedYears.map((year) => ({ v: { year } })), gens).map((o) => ({ ...o, ys: sortedYears.filter((y) => y >= o.from && y <= o.to) })),
	);
	const optOn = (ys: number[]) => ys.length > 0 && ys.every((y) => hasVoted(mine, y));
	const optVotes = (ys: number[]) => Math.max(0, ...ys.map((y) => votesForYear(record, y)));
	let busy = $state(false);
	let editing = $state(false);
	/** Vote accepted, but my own-votes snapshot hasn't caught up yet. */
	let confirmed = $state(false);
	/** Play the check burst (only right after voting, not when arriving already voted). */
	let burst = $state(false);
	let burstTimer: ReturnType<typeof setTimeout> | undefined;

	// A different make/model starts fresh.
	let lastId: string | undefined;
	$effect(() => { if (id !== lastId) { const first = lastId === undefined; lastId = id; if (first) return; editing = false; confirmed = false; burst = false; } });

	const voted = $derived(hasVoted(mine) || confirmed);
	const folded = $derived(voted && !editing);
	const wanted = $derived(record?.votes ?? 0);
	// Flair only when the number goes UP while you watch (not on first paint or a drop).
	let seen: { id: string; n: number } | undefined;
	let bumped = $state(false);
	let bumpTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const n = wanted, key = id;
		if (seen && seen.id === key && n > seen.n) {
			bumped = true;
			clearTimeout(bumpTimer);
			bumpTimer = setTimeout(() => (bumped = false), 1400);
		}
		seen = { id: key, n };
	});

	async function toggle(year?: number) {
		if (busy) return;
		busy = true;
		// The any-year button is only "on" for an any-year vote; specific years only count their own.
		const on = year ? !hasVoted(mine, year) : !mine?.any;
		const ok = await patternStore.vote({ projectType: "vehicle", make, model, year }, on);
		busy = false;
		if (!ok) return;
		if (on) {
			confirmed = true; editing = false; burst = true;
			clearTimeout(burstTimer);
			burstTimer = setTimeout(() => (burst = false), 1600);
		} else if (!hasVoted(mine) || !year) { confirmed = false; }
	}

	/** A generation: vote (or withdraw) every year it still lacks, one request each. */
	async function toggleMany(ys: number[]) {
		if (busy) return;
		busy = true;
		const on = !optOn(ys);
		let ok = true;
		for (const y of ys) {
			if (hasVoted(mine, y) === on) continue;
			ok = (await patternStore.vote({ projectType: "vehicle", make, model, year: y }, on)) && ok;
		}
		busy = false;
		if (!ok) return;
		if (on) {
			confirmed = true; editing = false; burst = true;
			clearTimeout(burstTimer);
			burstTimer = setTimeout(() => (burst = false), 1600);
		} else if (!hasVoted(mine)) { confirmed = false; }
	}

	async function withdraw() {
		if (busy) return;
		busy = true;
		const ok = await patternStore.vote({ projectType: "vehicle", make, model }, false);
		busy = false;
		if (ok) { confirmed = false; editing = false; burst = false; }
	}
</script>

<div class="cs" class:cs--slim={!allSoon} class:cs--done={folded}>
	<div class="cs__text">
		<h3 class="cs__title">{allSoon ? "No patterns available yet" : `Not available yet for ${sortedYears.length === 1 ? sortedYears[0] : "some years"}`}</h3>
		<p class="cs__sub">
			{#if folded}
				We're adding new patterns every day. We'll move this one up the list.
			{:else if allSoon}
				{make} {model} is coming soon. We're adding new patterns every day — vote and we'll move it up the list.
			{:else}
				We're adding new patterns every day. Vote for the years you need and we'll move them up the list.
			{/if}
		</p>
		{#if wanted > 0}
			<p class="cs__count" aria-live="polite">
				<span class="cs__num" class:cs__num--bump={bumped}>{#key wanted}<b in:fly={{ y: 12, duration: 340 }}>{wanted}</b>{/key}</span>
				<span>{wanted === 1 ? "person wants" : "people want"} the {model}</span>
			</p>
		{/if}
	</div>

	{#if !signedIn}
		<a class="cs__vote" href="/login">Sign in to vote</a>
	{:else if folded}
		<VoteSummary {mine} {burst} {busy} {gens} available={sortedYears} onChange={() => (editing = true)} onRemove={withdraw} />
	{:else}
		<div class="cs__actions">
			<button class="cs__vote" class:cs__vote--on={mine?.any} disabled={busy} aria-pressed={!!mine?.any} onclick={() => toggle()}>
				{#if busy}<Spinner />{/if}{busy ? "Saving…" : mine?.any ? "✓ You voted — any year" : mine ? "I want any year" : "I want this — any year"}
			</button>
			{#if options.length > 1 || (options.length === 1 && !allSoon)}
				<div class="cs__years" role="group" aria-label="Vote for specific years">
					{#each options as o (o.key)}
						<button class="cs__year" class:cs__year--on={optOn(o.ys)} disabled={busy} aria-pressed={optOn(o.ys)} title={o.isGen ? `${genSpan(o)}` : undefined} onclick={() => (o.isGen ? toggleMany(o.ys) : toggle(o.from))}>
							<span class="cs__yname">{o.label}</span>{#if o.isGen}<span class="cs__yspan">{genSpan(o)}</span>{/if}{#if optVotes(o.ys) > 0}<span class="cs__yvotes">{optVotes(o.ys)}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
			{#if editing}<button class="cs__link" onclick={() => (editing = false)}>Done</button>{/if}
		</div>
	{/if}
</div>

<style>
	.cs { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 24px; padding: 28px 24px; background: var(--bg-surface); border: 1px dashed var(--border-default); border-radius: var(--radius-lg); }
	.cs--slim { padding: 14px 16px; }
	.cs__text { min-width: 0; flex: 1 1 280px; }
	.cs__title { margin: 0 0 4px; font-size: 1.0625rem; }
	.cs--slim .cs__title { font-size: 0.9375rem; }
	.cs__sub { margin: 0; font-size: 0.875rem; color: var(--text-secondary); }
	.cs__count { margin: 8px 0 0; font-size: 0.8125rem; color: var(--text-tertiary); }
	.cs__count b { color: var(--text-primary); }
	.cs__actions { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
	.cs__vote { display: inline-block; padding: 9px 16px; font: inherit; font-size: 0.8125rem; font-weight: 600; text-decoration: none; color: #fff; background: var(--color-brand-dim); border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
	.cs__vote:hover:not(:disabled) { background: var(--color-brand); }
	.cs__vote--on { color: var(--text-primary); background: color-mix(in srgb, var(--color-success) 14%, transparent); border-color: color-mix(in srgb, var(--color-success) 40%, transparent); }
	.cs__vote:disabled, .cs__year:disabled { opacity: 0.6; cursor: wait; }
	.cs__years { display: flex; flex-wrap: wrap; gap: 10px; }
	.cs__year { display: inline-flex; align-items: center; gap: 14px; padding: 9px 20px; font: inherit; font-size: 1.125rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.cs__yname { margin-right: 4px; }
	.cs__yspan, .cs__yvotes { font-family: var(--font-mono); font-size: 1rem; font-weight: 500; color: var(--text-tertiary); }
	.cs__yvotes { padding-left: 12px; border-left: 1px solid var(--border-default); }
	.cs__year--on { color: var(--text-primary); border-color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
	.cs--done { padding-block: 12px; }
	.cs__count { display: flex; align-items: center; gap: 10px; }
	.cs__num { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 2.1em; height: 1.9em; padding: 0 0.6em; overflow: hidden; font-family: var(--font-mono); font-size: 0.875rem; color: var(--text-primary); background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: 99px; transition: color .3s, background .3s, border-color .3s; }
	.cs__num b { line-height: 1; font-variant-numeric: tabular-nums; }
	.cs__num--bump { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); border-color: color-mix(in srgb, var(--color-success) 55%, transparent); animation: cs-num-pop 620ms cubic-bezier(.2,1.5,.4,1), cs-ring 900ms ease-out; }
	@keyframes cs-num-pop { 0% { transform: scale(0.85); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
	@keyframes cs-ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 55%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
	.cs__link { padding: 0; font: inherit; font-size: 0.75rem; color: var(--text-brand); background: none; border: none; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
	.cs__link:disabled { opacity: 0.6; cursor: wait; }
	@media (prefers-reduced-motion: reduce) {
		.cs__num--bump { animation: none; }
	}
</style>
