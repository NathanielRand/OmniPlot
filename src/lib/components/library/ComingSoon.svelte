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
	import { groupYearLabels } from "$lib/utils/vehicleCatalog";
	import YearRange from "./YearRange.svelte";
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
	// The years to vote for: a slider range over the open years (default: all of them).
	let picked = $state<[number, number] | null>(null);
	const lo = $derived(sortedYears[sortedYears.length - 1] ?? 0);
	const hi = $derived(sortedYears[0] ?? 0);
	const range = $derived<[number, number]>(picked ? [Math.max(picked[0], lo), Math.min(picked[1], hi)] : [lo, hi]);
	const ys = $derived(sortedYears.filter((y) => y >= range[0] && y <= range[1]));
	// The whole span selected is just "any year" — one vote, not a list of every year.
	const full = $derived(sortedYears.length > 1 && ys.length === sortedYears.length);
	const rangeOn = $derived(full ? !!mine?.any : ys.length > 0 && ys.every((y) => hasVoted(mine, y)));
	const rangeVotes = $derived(Math.max(0, ...ys.map((y) => votesForYear(record, y))));
	const votedYears = $derived(sortedYears.filter((y) => hasVoted(mine, y)));
	const votedInRange = $derived(ys.filter((y) => votedYears.includes(y)).length);
	// Quick picks: everything, or one generation (clipped to the years still open).
	const presets = $derived([
		{ key: "all", label: "All years", span: "", from: lo, to: hi },
		...(sortedYears.length > 1
			? gens.flatMap((g) => {
					const inG = sortedYears.filter((y) => y >= g.from && y <= g.to);
					return inG.length ? [{ key: g.label, label: g.label, span: inG.length === 1 ? String(inG[0]) : `${inG[inG.length - 1]}–${inG[0]}`, from: inG[inG.length - 1], to: inG[0] }] : [];
				})
			: []),
	]);
	// "2019–2022" reads as its generation name when the range is a whole one.
	const rangeLabel = $derived(groupYearLabels(ys, gens, sortedYears).map((g) => g.label).join(", "));
	const voteWhat = $derived(full ? "any year" : rangeLabel);
	let busy = $state(false);
	let editing = $state(false);
	/** Vote accepted, but my own-votes snapshot hasn't caught up yet. */
	let confirmed = $state(false);
	/** Play the check burst (only right after voting, not when arriving already voted). */
	let burst = $state(false);
	let burstTimer: ReturnType<typeof setTimeout> | undefined;

	// A different make/model starts fresh.
	let lastId: string | undefined;
	$effect(() => { if (id !== lastId) { const first = lastId === undefined; lastId = id; if (first) return; editing = false; confirmed = false; burst = false; picked = null; } });

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
	async function toggleMany(years: number[]) {
		if (busy) return;
		busy = true;
		const on = !years.every((y) => hasVoted(mine, y));
		let ok = true;
		for (const y of years) {
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
		<div class="cs__panel">
			{#if sortedYears.length > 1}
				{#if presets.length > 1}
					<div class="cs__presets" role="group" aria-label="Quick picks">
						{#each presets as p (p.key)}
							<button type="button" class="cs__chip" class:cs__chip--on={range[0] === p.from && range[1] === p.to} onclick={() => (picked = [p.from, p.to])}>
								{p.label}{#if p.span}<span class="cs__chipspan">{p.span}</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
				<YearRange inline years={sortedYears} from={range[0]} to={range[1]} marked={votedYears} onchange={(a, b) => (picked = [a, b])} label="Years to vote for" />
			{/if}
			<div class="cs__foot">
				<p class="cs__sum" aria-live="polite">
					{#if sortedYears.length > 1}
						<b>{ys.length}</b> {ys.length === 1 ? "model year" : "model years"} selected{#if votedInRange > 0} · <span class="cs__ok">{votedInRange} voted</span>{/if}{#if rangeVotes > 0} · {rangeVotes} {rangeVotes === 1 ? "vote" : "votes"} so far{/if}
					{:else}
						Model year <b>{sortedYears[0]}</b>{#if rangeVotes > 0} · {rangeVotes} {rangeVotes === 1 ? "vote" : "votes"} so far{/if}
					{/if}
				</p>
				<div class="cs__btns">
					{#if editing}<button type="button" class="cs__link" onclick={() => (editing = false)}>Done</button>{/if}
					{#if !full}
						<button type="button" class="cs__ghost" class:cs__ghost--on={mine?.any} disabled={busy} aria-pressed={!!mine?.any} onclick={() => toggle()}>
							{mine?.any ? "✓ Any year" : "Any year"}
						</button>
					{/if}
					{#if ys.length}
						<button type="button" class="cs__vote" class:cs__vote--on={rangeOn} disabled={busy} aria-pressed={rangeOn} onclick={() => (full ? toggle() : toggleMany(ys))}>
							{#if busy}<Spinner />{/if}{busy ? "Saving…" : rangeOn ? `✓ Voted — ${voteWhat}` : `Vote for ${voteWhat}`}
						</button>
					{/if}
				</div>
			</div>
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
	.cs__vote { display: inline-block; padding: 9px 16px; font: inherit; font-size: 0.8125rem; font-weight: 600; text-decoration: none; color: #fff; background: var(--color-brand-dim); border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; }
	.cs__vote:hover:not(:disabled) { background: var(--color-brand); }
	.cs__vote--on { color: var(--text-primary); background: color-mix(in srgb, var(--color-success) 14%, transparent); border-color: color-mix(in srgb, var(--color-success) 40%, transparent); }
	.cs__vote:disabled, .cs__ghost:disabled { opacity: 0.6; cursor: wait; }
	.cs--done { padding-block: 12px; }
	.cs__panel { flex: 1 1 100%; display: flex; flex-direction: column; gap: 16px; padding: 16px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.cs__presets { display: flex; flex-wrap: wrap; gap: 6px; }
	.cs__chip { display: inline-flex; align-items: baseline; gap: 8px; padding: 5px 12px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: 99px; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s; }
	.cs__chip:hover { color: var(--text-primary); border-color: var(--border-default); }
	.cs__chip--on { color: #fff; background: var(--color-brand-dim); border-color: var(--color-brand-dim); }
	.cs__chipspan { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 500; opacity: 0.8; }
	.cs__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
	.cs__sum { margin: 0; font-size: 0.8125rem; color: var(--text-tertiary); }
	.cs__sum b { color: var(--text-primary); }
	.cs__ok { color: var(--color-success); }
	.cs__btns { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
	.cs__ghost { padding: 9px 14px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary); background: none; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }
	.cs__ghost:hover:not(:disabled) { color: var(--text-primary); border-color: var(--text-tertiary); }
	.cs__ghost--on { color: var(--text-primary); border-color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
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
