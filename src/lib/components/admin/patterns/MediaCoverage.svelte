<script lang="ts">
	// Media coverage: every make and model in the catalog (and every residential /
	// commercial / custom project) with what image it has, so gaps are obvious and
	// can be filled in place. Replaces the old standalone "Vehicle images" modal.
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { buildTree, entriesUnder, makeKey, modelKey, targetId, type MediaTarget } from "$lib/utils/vehicleCatalog";
	import { projectTypeMeta, subjectName } from "$lib/admin/patternForms";
	import type { VehicleEntry } from "$lib/types";
	import MediaSlot from "./MediaSlot.svelte";

	let { onOpen }: { onOpen: (subjectId: string) => void } = $props();

	let search = $state("");
	let missingOnly = $state(false);
	let openKey = $state<string | null>(null);

	const vehicles = $derived(patternStore.vehicles.filter((v) => (v.projectType ?? "vehicle") === "vehicle" && v.make && v.model));
	const projects = $derived(patternStore.vehicles.filter((v) => (v.projectType ?? "vehicle") !== "vehicle"));
	const tree = $derived(buildTree(vehicles.map((v) => ({ v, count: 1 }))));

	const has = (t: MediaTarget, f: "logoUrl" | "imageUrl") => !!patternStore.media[targetId(t)]?.[f];
	const makeT = (label: string): MediaTarget => ({ kind: "make", make: label });
	const modelT = (make: string, model: string): MediaTarget => ({ kind: "model", make, model });
	const projT = (v: VehicleEntry): MediaTarget => ({ kind: "subject", projectType: v.projectType ?? "custom", label: v.propertyLabel || v.model || v.address || "" });

	const q = $derived(search.trim().toLowerCase());
	const makes = $derived(
		tree
			.map((m) => {
				const makeMatches = !q || m.label.toLowerCase().includes(q);
				const models = m.models.filter(
					(o) => (makeMatches || `${m.label} ${o.label}`.toLowerCase().includes(q)) && (!missingOnly || !has(modelT(m.label, o.label), "imageUrl")),
				);
				const missingMake = !has(makeT(m.label), "logoUrl");
				const missingModels = m.models.filter((o) => !has(modelT(m.label, o.label), "imageUrl")).length;
				const visible = (makeMatches || models.length > 0) && (!missingOnly || missingMake || models.length > 0);
				return { m, models, missingMake, missingModels, visible };
			})
			.filter((x) => x.visible),
	);
	const shownProjects = $derived(
		projects.filter((v) => (!q || subjectName(v).toLowerCase().includes(q)) && (!missingOnly || !has(projT(v), "imageUrl"))),
	);

	const stats = $derived.by(() => {
		const allModels = tree.flatMap((m) => m.models.map((o) => has(modelT(m.label, o.label), "imageUrl")));
		return {
			makes: tree.length,
			logos: tree.filter((m) => has(makeT(m.label), "logoUrl")).length,
			models: allModels.length,
			modelImgs: allModels.filter(Boolean).length,
			projects: projects.length,
			projectImgs: projects.filter((v) => has(projT(v), "imageUrl")).length,
		};
	});

	function openFirst(make: string, model?: string) {
		const rows = entriesUnder(vehicles.map((v) => ({ v })), { make: makeKey(make), model: model ? modelKey(model) : undefined });
		if (rows[0]) onOpen(rows[0].v.id);
	}
	const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
</script>

<div class="mc">
	<div class="mc__stats">
		<div class="st"><span class="st__v">{stats.logos}<span class="st__of"> / {stats.makes}</span></span><span class="st__l">make logos</span><span class="bar"><i style="width:{pct(stats.logos, stats.makes)}%"></i></span></div>
		<div class="st"><span class="st__v">{stats.modelImgs}<span class="st__of"> / {stats.models}</span></span><span class="st__l">model images</span><span class="bar"><i style="width:{pct(stats.modelImgs, stats.models)}%"></i></span></div>
		<div class="st"><span class="st__v">{stats.projectImgs}<span class="st__of"> / {stats.projects}</span></span><span class="st__l">project images</span><span class="bar"><i style="width:{pct(stats.projectImgs, stats.projects)}%"></i></span></div>
	</div>

	<div class="mc__tools">
		<input class="in" type="search" placeholder="Search makes, models, projects…" bind:value={search} aria-label="Search media" />
		<label class="check"><input type="checkbox" bind:checked={missingOnly} /> Missing images only</label>
	</div>

	{#if patternStore.loading}
		<p class="empty">Loading the catalog…</p>
	{/if}

	<ul class="list">
		{#each makes as { m, models, missingMake, missingModels } (m.key)}
			{@const isOpen = openKey === m.key || !!q}
			<li class="make">
				<div class="row row--make">
					<button class="row__main" aria-expanded={isOpen} onclick={() => (openKey = openKey === m.key ? null : m.key)}>
						<span class="mini">{#if has(makeT(m.label), "logoUrl")}<img src={patternStore.media[targetId(makeT(m.label))].logoUrl} alt="" loading="lazy" />{:else}<i>—</i>{/if}</span>
						<span class="name">{m.label}</span>
						<span class="chips">
							<span class="chip" class:chip--ok={!missingMake}>{missingMake ? "no logo" : "logo"}</span>
							<span class="chip" class:chip--ok={missingModels === 0}>{m.models.length - missingModels}/{m.models.length} models</span>
						</span>
					</button>
					<button class="link" onclick={() => openFirst(m.label)}>Open in catalog</button>
				</div>
				{#if isOpen}
					<div class="make__body">
						<div class="make__slots">
							<MediaSlot target={makeT(m.label)} field="logoUrl" label="{m.label} logo" hint="Make tile" compact />
							<MediaSlot target={makeT(m.label)} field="imageUrl" label="{m.label} cover" hint="Make banner" compact />
						</div>
						<ul class="models">
							{#each models as o (o.key)}
								<li class="row row--model">
									<MediaSlot target={modelT(m.label, o.label)} field="imageUrl" label={o.label} hint="{o.entries} entr{o.entries === 1 ? 'y' : 'ies'} · {o.count} pattern{o.count === 1 ? '' : 's'}" compact />
									<button class="link" onclick={() => openFirst(m.label, o.label)}>Open</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</li>
		{:else}
			{#if !patternStore.loading}<li class="empty">{missingOnly ? "Every make and model has an image." : "No makes match."}</li>{/if}
		{/each}
	</ul>

	{#if shownProjects.length}
		<h3 class="sec">Residential, commercial &amp; custom projects</h3>
		<ul class="list">
			{#each shownProjects as v (v.id)}
				<li class="row row--model">
					<MediaSlot target={projT(v)} field="imageUrl" label={subjectName(v)} hint={projectTypeMeta(v.projectType).label} compact />
					<button class="link" onclick={() => onOpen(v.id)}>Open</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.mc { display: flex; flex-direction: column; gap: 14px; }
	.mc__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
	.st { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.st__v { font-size: 1.25rem; font-weight: 700; }
	.st__of { font-size: 0.8125rem; font-weight: 500; color: var(--text-tertiary); }
	.st__l { font-size: 0.75rem; color: var(--text-secondary); }
	.bar { height: 4px; margin-top: 6px; background: var(--bg-surface-3); border-radius: 99px; overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--color-success); }
	.mc__tools { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
	.in { flex: 1; min-width: 200px; max-width: 360px; padding: 7px 10px; font: inherit; font-size: 0.8125rem; color: var(--text-primary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); outline: none; }
	.in:focus { border-color: var(--color-brand-dim); }
	.check { display: flex; gap: 6px; align-items: center; font-size: 0.8125rem; color: var(--text-secondary); }
	.list, .models { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.make { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); }
	.row { display: flex; align-items: center; gap: 10px; }
	.row--make { padding: 4px 12px 4px 4px; }
	.row__main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px; font: inherit; color: inherit; background: none; border: none; cursor: pointer; text-align: left; }
	.mini { width: 40px; height: 28px; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-tertiary); font-size: 0.6875rem; }
	.mini img { width: 100%; height: 100%; object-fit: contain; }
	.mini i { font-style: normal; }
	.name { font-size: 0.875rem; font-weight: 600; }
	.chips { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
	.chip { padding: 1px 8px; font-size: 0.6875rem; border-radius: 99px; color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
	.chip--ok { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
	.make__body { padding: 4px 14px 14px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 12px; }
	.make__slots { display: flex; flex-wrap: wrap; gap: 14px 28px; padding-top: 12px; }
	.row--model { justify-content: space-between; padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
	.make__body .row--model { background: var(--bg-base); }
	.row--model :global(.slot) { flex: 1; }
	.link { padding: 0; font: inherit; font-size: 0.75rem; color: var(--text-brand, var(--color-brand)); background: none; border: none; cursor: pointer; white-space: nowrap; }
	.link:hover { text-decoration: underline; }
	.sec { margin: 8px 0 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
	.empty { padding: 28px 14px; text-align: center; font-size: 0.8125rem; color: var(--text-tertiary); }
</style>
