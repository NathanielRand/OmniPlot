<script lang="ts">
	// The imagery for the subject selected in the Catalog: what the library shows
	// for its make / model / trim (or, for a residential / commercial / custom
	// project, its one image). Sits beside the subject's patterns so a subject,
	// its patterns and its pictures are managed as one unit.
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { makeKey, modelKey, trimKey, targetId, generationOf, genSpan, type MediaTarget } from "$lib/utils/vehicleCatalog";
	import { subjectName } from "$lib/admin/patternForms";
	import type { VehicleEntry } from "$lib/types";
	import MediaSlot from "./MediaSlot.svelte";

	let { subject }: { subject: VehicleEntry } = $props();

	const isVehicle = $derived((subject.projectType ?? "vehicle") === "vehicle");
	const make = $derived(subject.make?.trim() ?? "");
	const model = $derived(subject.model?.trim() ?? "");
	const trim = $derived(subject.trim?.trim() ?? "");

	const projectLabel = $derived(subject.propertyLabel || subject.model || subject.address || "");
	const projectTarget = $derived<MediaTarget>({ kind: "subject", projectType: subject.projectType ?? "custom", label: projectLabel });

	const makeTarget = $derived<MediaTarget>({ kind: "make", make });
	const modelTarget = $derived<MediaTarget>({ kind: "model", make, model });
	const trimTarget = $derived<MediaTarget>({ kind: "trim", make, model, trim });
	// A year inside an admin-set generation can also carry that generation's image.
	const gen = $derived(isVehicle && make && model ? generationOf(subject.year, patternStore.media[targetId(modelTarget)]?.generations ?? []) : undefined);
	const genTarget = $derived<MediaTarget>({ kind: "generation", make, model, generation: gen?.label ?? "" });
	const yearTarget = $derived<MediaTarget>({ kind: "year", make, model, year: subject.year });

	// How many catalog entries (years / trims) share each image.
	const sameMake = $derived(patternStore.vehicles.filter((v) => makeKey(v.make) === makeKey(make)).length);
	const sameModel = $derived(patternStore.vehicles.filter((v) => makeKey(v.make) === makeKey(make) && modelKey(v.model) === modelKey(model)).length);
	const sameTrim = $derived(patternStore.vehicles.filter((v) => makeKey(v.make) === makeKey(make) && modelKey(v.model) === modelKey(model) && trimKey(v.trim) === trimKey(trim)).length);

	const slots = $derived(
		isVehicle
			? ([make, model, trim].filter(Boolean).length ? [
				...(make ? [{ t: makeTarget, f: "logoUrl" as const, label: `${make} logo`, hint: `Shown on the ${make} tile · shared by ${sameMake} entries` }] : []),
				...(make ? [{ t: makeTarget, f: "imageUrl" as const, label: `${make} cover`, hint: "Banner / fallback behind the make's models" }] : []),
				...(make && model ? [{ t: modelTarget, f: "imageUrl" as const, label: `${model} image`, hint: `Shown on the ${model} tile · shared by ${sameModel} entries` }] : []),
				...(make && model && trim ? [{ t: trimTarget, f: "imageUrl" as const, label: `${trim} image`, hint: `Only the ${trim} trim · shared by ${sameTrim} entries` }] : []),
				...(gen ? [{ t: genTarget, f: "imageUrl" as const, label: `${gen.label} image`, hint: `Every ${model} ${genSpan(gen)} — used instead of the ${model} image`, optional: true }] : []),
				...(make && model && subject.year ? [{ t: yearTarget, f: "imageUrl" as const, label: `${subject.year} image`, hint: `Optional · just the ${subject.year} ${model}. Without one it uses ${gen ? `the ${gen.label} image` : `the ${model} image`}`, optional: true }] : []),
			] : [])
			: projectLabel
				? [{ t: projectTarget, f: "imageUrl" as const, label: `${projectLabel} image`, hint: "Shown on this project's card in the library" }]
				: [],
	);
	// Generation and year images are optional extras — they never make the count look unfinished.
	const required = $derived(slots.filter((s) => !("optional" in s && s.optional)));
	const filled = $derived(required.filter((s) => patternStore.media[targetId(s.t)]?.[s.f]).length);
	let open = $state(true);
</script>

<section class="sm" aria-label="Images for {subjectName(subject)}">
	<button class="sm__head" aria-expanded={open} onclick={() => (open = !open)}>
		<span class="sm__title">Images &amp; logos</span>
		<span class="sm__count" class:sm__count--done={filled === required.length && required.length > 0}>{filled}/{required.length} set</span>
		<svg class="sm__chev" class:sm__chev--open={open} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
	</button>
	{#if open}
		{#if slots.length === 0}
			<p class="sm__none">Add a {isVehicle ? "make and model" : "project name"} to this subject to attach images.</p>
		{:else}
			<div class="sm__grid">
				{#each slots as s (targetId(s.t) + s.f)}
					<MediaSlot target={s.t} field={s.f} label={s.label} hint={s.hint} />
				{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.sm { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.sm__head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; font: inherit; color: inherit; background: none; border: none; cursor: pointer; text-align: left; }
	.sm__title { font-size: 0.8125rem; font-weight: 600; }
	.sm__count { margin-left: auto; font-size: 0.6875rem; color: var(--color-warning); }
	.sm__count--done { color: var(--color-success); }
	.sm__chev { color: var(--text-tertiary); transition: transform 0.15s; }
	.sm__chev--open { transform: rotate(180deg); }
	.sm__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px 20px; padding: 4px 14px 14px; }
	.sm__none { margin: 0; padding: 4px 14px 14px; font-size: 0.8125rem; color: var(--text-tertiary); }
</style>
