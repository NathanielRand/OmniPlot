<script lang="ts">
	// "No patterns yet" for a make/model an admin has listed ahead of its patterns,
	// with a vote that feeds the same demand record the request form does.
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { userStore } from "$lib/stores";
	import { demandId, hasVoted, votesForYear } from "$lib/utils/demand";

	interface Props {
		make: string;
		model: string;
		/** Model years that have no patterns yet (what a vote can name). */
		years: number[];
		/** Nothing at all is available for what's on screen — otherwise this is a slim notice. */
		allSoon: boolean;
	}
	let { make, model, years, allSoon }: Props = $props();

	const id = $derived(demandId({ projectType: "vehicle", make, model }));
	const record = $derived(patternStore.requests.find((r) => r.id === id));
	const mine = $derived(patternStore.myVotes[id]);
	const signedIn = $derived(!!userStore.user);
	const sortedYears = $derived([...years].sort((a, b) => b - a));
	let busy = $state(false);

	async function toggle(year?: number) {
		if (busy) return;
		busy = true;
		// The any-year button is only "on" for an any-year vote; specific years only count their own.
		const on = year ? !hasVoted(mine, year) : !mine?.any;
		await patternStore.vote({ projectType: "vehicle", make, model, year }, on);
		busy = false;
	}

	const wanted = $derived(record?.votes ?? 0);
</script>

<div class="cs" class:cs--slim={!allSoon}>
	<div class="cs__text">
		<h3 class="cs__title">{allSoon ? "No patterns available yet" : `Not available yet for ${sortedYears.length === 1 ? sortedYears[0] : "some years"}`}</h3>
		<p class="cs__sub">
			{#if allSoon}
				{make} {model} is coming soon. We're adding new patterns every day — vote and we'll move it up the list.
			{:else}
				We're adding new patterns every day. Vote for the years you need and we'll move them up the list.
			{/if}
		</p>
		{#if wanted > 0}<p class="cs__count"><b>{wanted}</b> {wanted === 1 ? "person wants" : "people want"} the {model}</p>{/if}
	</div>

	{#if signedIn}
		<div class="cs__actions">
			<button class="cs__vote" class:cs__vote--on={mine?.any} disabled={busy} aria-pressed={!!mine?.any} onclick={() => toggle()}>
				{mine?.any ? "✓ You voted — any year" : mine ? "I want any year" : "I want this — any year"}
			</button>
			{#if sortedYears.length > 1 || (sortedYears.length === 1 && !allSoon)}
				<div class="cs__years" role="group" aria-label="Vote for specific years">
					{#each sortedYears as y (y)}
						<button class="cs__year" class:cs__year--on={hasVoted(mine, y)} disabled={busy} aria-pressed={hasVoted(mine, y)} onclick={() => toggle(y)}>
							{y}{#if votesForYear(record, y) > 0} <span>{votesForYear(record, y)}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<a class="cs__vote" href="/login">Sign in to vote</a>
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
	.cs__years { display: flex; flex-wrap: wrap; gap: 6px; }
	.cs__year { padding: 3px 10px; font: inherit; font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: 99px; cursor: pointer; }
	.cs__year span { font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary); }
	.cs__year--on { color: var(--text-primary); border-color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
</style>
