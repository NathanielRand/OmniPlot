<script lang="ts">
	// Admin → Patterns → Options. Every zone, vehicle type and category the
	// pattern forms offer, built-in and added, with add / rename / hide / delete.
	// Built-ins live in code and saved patterns use their ids, so they can be
	// renamed, hidden and reset but not deleted; entries you add can be deleted
	// while nothing saved uses them (the server checks).
	import { onMount } from "svelte";
	import { auth } from "$lib/firebase/client";
	import { toastStore, confirmStore, patternOptionsStore, knownCategories, mirrorOf, zoneLabel } from "$lib/stores";
	import {
		EMPTY_OPTIONS, slugify, sanitizePatternOptions, normalizeLabel, normalizeSentence,
		BODY_STYLES, PATTERN_CATEGORIES, PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST,
		PPF_ZONE_GROUP, TINT_ZONE_GROUP,
		type PatternOptionsDoc, type AdminZone, type NonVehicleProject, type BuiltinOverride,
	} from "$lib/patternOptions";

	type Kind = "zones" | "bodyStyles" | "categories";
	type Row = {
		kind: Kind; id: string; label: string; builtin: boolean; hidden: boolean; renamed: boolean;
		group?: string; mirror?: string; shortLabel?: string; description?: string; accent?: string;
	};

	let doc = $state<PatternOptionsDoc>(structuredClone(EMPTY_OPTIONS));
	let loading = $state(true);
	let saving = $state(false);

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	onMount(async () => {
		try {
			const res = await fetch("/api/admin/pattern-options", { headers: await authHeader() });
			if (!res.ok) throw new Error();
			doc = await res.json();
		} catch {
			toastStore.error("Couldn't load options", "Refresh to try again.");
		} finally {
			loading = false;
		}
	});

	/** Validates (same rules as the server), saves the whole document, and pushes it to this tab's pick-lists. */
	async function save(next: PatternOptionsDoc, done: string): Promise<boolean> {
		const checked = sanitizePatternOptions(next);
		if (!checked.ok) { toastStore.error("Can't save", checked.error); return false; }
		saving = true;
		try {
			const res = await fetch("/api/admin/pattern-options", {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(await authHeader()) },
				body: JSON.stringify(checked.doc),
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) { toastStore.error("Can't save", body.error ?? "Please try again."); return false; }
			doc = checked.doc;
			patternOptionsStore.set(checked.doc);
			toastStore.success("Saved", done);
			return true;
		} catch {
			toastStore.error("Can't save", "Please try again.");
			return false;
		} finally {
			saving = false;
		}
	}

	// ─── Rows: built-ins merged with additions ───
	const ovOf = (kind: Kind, id: string): BuiltinOverride | undefined => doc.overrides[kind][id];

	/** "category:<id>" / "project:<type>" — a pick-list zones belong to. */
	type ListKey = string;
	const lists = $derived<{ key: ListKey; label: string }[]>([
		...knownCategories().map((c) => ({ key: `category:${c.value}`, label: `Vehicle · ${c.label}` })),
		{ key: "project:residential", label: "Residential" },
		{ key: "project:commercial", label: "Commercial" },
		{ key: "project:custom", label: "Custom projects" },
	]);
	const builtinListFor = (key: ListKey) =>
		key === "category:ppf" ? PPF_ZONES_LIST : key === "category:window-tint" ? TINT_ZONES_LIST
		: key === "project:residential" ? RESIDENTIAL_ZONES_LIST : key === "project:commercial" ? COMMERCIAL_ZONES_LIST : [];
	const zoneKey = (z: AdminZone): ListKey => (z.category ? `category:${z.category}` : `project:${z.projectType}`);

	function zoneRows(key: ListKey): Row[] {
		const builtin = builtinListFor(key).filter((z) => z.value !== "custom").map((z): Row => ({
			kind: "zones", id: z.value, label: ovOf("zones", z.value)?.label ?? z.label, builtin: true,
			hidden: !!ovOf("zones", z.value)?.hidden, renamed: !!ovOf("zones", z.value)?.label,
			group: PPF_ZONE_GROUP[z.value] ?? TINT_ZONE_GROUP[z.value], mirror: mirrorOf(z.value),
		}));
		const added = doc.zones.filter((z) => zoneKey(z) === key).map((z): Row => ({
			kind: "zones", id: z.id, label: z.label, builtin: false, hidden: !!z.hidden, renamed: false, group: z.group, mirror: z.mirrorOf,
		}));
		return [...builtin, ...added];
	}
	const bodyRows = $derived<Row[]>([
		...BODY_STYLES.map((b): Row => ({
			kind: "bodyStyles", id: b.value, label: ovOf("bodyStyles", b.value)?.label ?? b.label, builtin: true,
			hidden: !!ovOf("bodyStyles", b.value)?.hidden, renamed: !!ovOf("bodyStyles", b.value)?.label,
		})),
		...doc.bodyStyles.map((b): Row => ({ kind: "bodyStyles", id: b.id, label: b.label, builtin: false, hidden: !!b.hidden, renamed: false })),
	]);
	const categoryRows = $derived<Row[]>([
		...PATTERN_CATEGORIES.map((c): Row => {
			const o = ovOf("categories", c.value);
			return {
				kind: "categories", id: c.value, label: o?.label ?? c.label, builtin: true, hidden: !!o?.hidden,
				renamed: !!(o && (o.label || o.shortLabel || o.description || o.accent)),
				shortLabel: o?.shortLabel ?? c.shortLabel, description: o?.description ?? c.description, accent: o?.accent ?? c.accent,
			};
		}),
		...doc.categories.map((c): Row => ({ kind: "categories", id: c.id, label: c.label, builtin: false, hidden: !!c.hidden, renamed: false, shortLabel: c.shortLabel, description: c.description, accent: c.accent })),
	]);

	// ─── Row actions ─────────────────────────────
	const keyOf = (r: Row) => `${r.kind}:${r.id}`;
	let editing = $state<{ key: string; label: string; group: string; shortLabel: string; description: string; accent: string } | null>(null);

	function startEdit(r: Row) {
		editing = { key: keyOf(r), label: r.label, group: r.group && !r.builtin ? r.group : "", shortLabel: r.shortLabel ?? "", description: r.description ?? "", accent: r.accent ?? "#64748b" };
	}
	const editPreview = $derived(editing ? normalizeLabel(editing.label, 60) : "");

	/** A copy of the doc with one entry changed. `patch` is null to delete an added entry / reset a built-in. */
	function withEntry(r: Row, patch: Record<string, unknown> | null): PatternOptionsDoc {
		const next = structuredClone($state.snapshot(doc)) as PatternOptionsDoc;
		if (r.builtin) {
			const cur: BuiltinOverride = { ...(next.overrides[r.kind][r.id] ?? {}) };
			Object.assign(cur, patch ?? {});
			// A name equal to the built-in one isn't an override.
			const base = r.kind === "zones" ? [PPF_ZONES_LIST, TINT_ZONES_LIST, RESIDENTIAL_ZONES_LIST, COMMERCIAL_ZONES_LIST].flat().find((z) => z.value === r.id)?.label
				: r.kind === "bodyStyles" ? BODY_STYLES.find((b) => b.value === r.id)?.label
				: PATTERN_CATEGORIES.find((c) => c.value === r.id)?.label;
			if (normalizeLabel(cur.label, 60) === base) delete cur.label;
			if (!cur.hidden) delete cur.hidden;
			if (patch === null || !Object.keys(cur).length) delete next.overrides[r.kind][r.id];
			else next.overrides[r.kind][r.id] = cur;
			return next;
		}
		const list = next[r.kind] as Array<{ id: string; mirrorOf?: string }>;
		const i = list.findIndex((x) => x.id === r.id);
		if (i < 0) return next;
		if (patch === null) {
			list.splice(i, 1);
			// A zone that mirrored the deleted one loses its partner.
			if (r.kind === "zones") for (const z of next.zones) if (z.mirrorOf === r.id) delete z.mirrorOf;
		} else {
			Object.assign(list[i], patch);
			for (const k of Object.keys(patch)) if (patch[k] === "" || patch[k] === false || patch[k] === undefined) delete (list[i] as Record<string, unknown>)[k];
		}
		return next;
	}

	async function saveEdit(r: Row) {
		if (!editing) return;
		const patch: Record<string, unknown> = { label: editing.label };
		if (r.kind === "zones" && !r.builtin) patch.group = editing.group;
		if (r.kind === "categories") Object.assign(patch, { shortLabel: editing.shortLabel, description: editing.description, accent: editing.accent });
		if (await save(withEntry(r, patch), `Updated “${normalizeLabel(editing.label, 60)}”.`)) editing = null;
	}
	const toggleHidden = (r: Row) => save(withEntry(r, { hidden: !r.hidden }), `${r.label} is now ${r.hidden ? "shown" : "hidden"}.`);
	const resetBuiltin = (r: Row) => save(withEntry(r, null), `Reset “${r.label}” to its default.`);

	async function remove(r: Row) {
		if (r.kind === "categories" && doc.zones.some((z) => z.category === r.id)) {
			toastStore.error("Can't delete", `Delete the zones in “${r.label}” first.`);
			return;
		}
		const ok = await confirmStore.ask({
			title: `Delete “${r.label}”?`,
			message: "This can't be undone. If any saved pattern or vehicle still uses it, the delete is refused — hide it instead.",
			confirmLabel: "Delete", variant: "danger",
		});
		if (ok) await save(withEntry(r, null), `Deleted “${r.label}”.`);
	}

	// ─── Add forms ───────────────────────────────
	let zLabel = $state(""), zList = $state("category:ppf"), zGroup = $state(""), zMirror = $state("");
	const mirrorChoices = $derived(
		zoneRows(zList).filter((r) => !r.hidden && !r.mirror).map((r) => ({ value: r.id, label: r.label })),
	);
	$effect(() => { zList; zMirror = ""; });

	const zoneName = $derived(normalizeLabel(zLabel, 60));
	const zoneId = $derived(slugify(zoneName));
	function zoneCandidate(): AdminZone {
		const [kind, id] = zList.split(":");
		return {
			id: zoneId, label: zoneName,
			...(kind === "category" ? { category: id } : { projectType: id as NonVehicleProject }),
			...(zGroup.trim() ? { group: zGroup.trim() } : {}),
			...(zMirror ? { mirrorOf: zMirror } : {}),
		};
	}
	// Same validation the server runs, so the form never offers what would be refused.
	const zoneError = $derived.by(() => {
		if (!zLabel.trim()) return null;
		const r = sanitizePatternOptions({ ...doc, zones: [...doc.zones, zoneCandidate()] });
		return r.ok ? null : r.error;
	});
	async function addZone() {
		if (!zoneId || zoneError) return;
		if (await save({ ...doc, zones: [...doc.zones, zoneCandidate()] }, `Added zone “${zoneName}”.`)) { zLabel = ""; zGroup = ""; zMirror = ""; }
	}

	let bLabel = $state("");
	const bodyName = $derived(normalizeLabel(bLabel, 40));
	const bodyId = $derived(slugify(bodyName));
	const bodyError = $derived.by(() => {
		if (!bLabel.trim()) return null;
		const r = sanitizePatternOptions({ ...doc, bodyStyles: [...doc.bodyStyles, { id: bodyId, label: bodyName }] });
		return r.ok ? null : r.error;
	});
	async function addBody() {
		if (!bodyId || bodyError) return;
		if (await save({ ...doc, bodyStyles: [...doc.bodyStyles, { id: bodyId, label: bodyName }] }, `Added vehicle type “${bodyName}”.`)) bLabel = "";
	}

	let cLabel = $state(""), cShort = $state(""), cDesc = $state(""), cAccent = $state("#64748b");
	const catName = $derived(normalizeLabel(cLabel, 40));
	const catId = $derived(slugify(catName));
	const catCandidate = $derived({
		id: catId, label: catName, shortLabel: normalizeLabel(cShort, 16) || catName.slice(0, 16).trim(),
		description: normalizeSentence(cDesc, 80), accent: cAccent,
	});
	const catError = $derived.by(() => {
		if (!cLabel.trim()) return null;
		const r = sanitizePatternOptions({ ...doc, categories: [...doc.categories, catCandidate] });
		return r.ok ? null : r.error;
	});
	async function addCategory() {
		if (!catId || catError) return;
		if (await save({ ...doc, categories: [...doc.categories, catCandidate] }, `Added category “${catName}”.`)) { cLabel = ""; cShort = ""; cDesc = ""; }
	}
</script>

{#snippet rowView(r: Row)}
	<li class:off={r.hidden}>
		{#if editing?.key === keyOf(r)}
			<form class="edit" onsubmit={(e) => { e.preventDefault(); saveEdit(r); }}>
				<label class="f f--grow">Name<input class="in" bind:value={editing.label} maxlength="60" /></label>
				{#if r.kind === "zones" && !r.builtin}
					<label class="f">Library group<input class="in" bind:value={editing.group} maxlength="40" placeholder="optional" /></label>
				{/if}
				{#if r.kind === "categories"}
					<label class="f">Short name<input class="in" bind:value={editing.shortLabel} maxlength="16" /></label>
					<label class="f f--grow">Description<input class="in" bind:value={editing.description} maxlength="80" /></label>
					<label class="f">Color<input class="in in--color" type="color" bind:value={editing.accent} /></label>
				{/if}
				<button class="btn" type="submit" disabled={saving || !editPreview}>Save</button>
				<button class="btn btn--ghost" type="button" onclick={() => (editing = null)}>Cancel</button>
				{#if editPreview && editPreview !== editing.label.trim()}<span class="note">Will be saved as “{editPreview}”.</span>{/if}
			</form>
		{:else}
			{#if r.accent}<span class="dot" style="background:{r.accent}"></span>{/if}
			<span class="name">{r.label}</span>
			<span class="pill" class:pill--added={!r.builtin}>{r.builtin ? "Built-in" : "Added"}</span>
			{#if r.renamed}<span class="pill pill--warn">Customized</span>{/if}
			{#if r.hidden}<span class="pill pill--warn">Hidden</span>{/if}
			{#if r.group}<span class="tag">group: {r.group}</span>{/if}
			{#if r.mirror}<span class="tag">mirrors {zoneLabel(r.mirror, "ppf")}</span>{/if}
			{#if r.description}<span class="tag">{r.description}</span>{/if}
			<span class="acts">
				<button class="link" disabled={saving} onclick={() => startEdit(r)}>Edit</button>
				<button class="link" disabled={saving} onclick={() => toggleHidden(r)}>{r.hidden ? "Show" : "Hide"}</button>
				{#if r.builtin}
					{#if r.renamed}<button class="link" disabled={saving} onclick={() => resetBuiltin(r)}>Reset</button>{/if}
				{:else}
					<button class="link link--danger" disabled={saving} onclick={() => remove(r)}>Delete</button>
				{/if}
			</span>
		{/if}
	</li>
{/snippet}

<div class="om">
	<p class="lead">
		Everything the pattern forms offer, in one place. Add your own, rename any of them, or hide ones you don't want in the pickers.
		Names are saved in Title Case like the built-ins. Built-ins can't be deleted — saved patterns use them — but hiding is
		reversible. Something you added can be deleted while no saved pattern uses it.
	</p>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else}
		<!-- Zones -->
		<section class="card">
			<h2>Zones</h2>
			<p class="note">The pieces a pattern covers — a hood, a door, a storefront window. Each list below is what its pattern type offers.</p>
			<form class="row" onsubmit={(e) => { e.preventDefault(); addZone(); }}>
				<label class="f f--grow">Name<input class="in" bind:value={zLabel} placeholder="e.g. Side Skirt Left" maxlength="60" /></label>
				<label class="f">Add to<select class="in" bind:value={zList}>{#each lists as o (o.key)}<option value={o.key}>{o.label}</option>{/each}</select></label>
				<label class="f">Library group <span class="opt">(optional)</span><input class="in" bind:value={zGroup} placeholder="e.g. Rocker Panels" maxlength="40" /></label>
				<label class="f">Mirrors <span class="opt">(optional)</span>
					<select class="in" bind:value={zMirror}><option value="">— none —</option>{#each mirrorChoices as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select>
				</label>
				<button class="btn" type="submit" disabled={!zoneId || !!zoneError || saving}>Add zone</button>
			</form>
			{#if zoneError}<p class="warn">{zoneError}</p>{:else if zLabel.trim() && zoneName !== zLabel.trim()}<p class="note">Will be saved as “{zoneName}”.</p>{/if}

			{#each lists as l (l.key)}
				{@const rows = zoneRows(l.key)}
				<h3>{l.label} <span class="count">{rows.length}</span></h3>
				{#if rows.length}
					<ul class="items">{#each rows as r (r.id)}{@render rowView(r)}{/each}</ul>
				{:else}
					<p class="muted">No zones yet — new patterns here use “Custom”.</p>
				{/if}
			{/each}
		</section>

		<!-- Vehicle types -->
		<section class="card">
			<h2>Vehicle types <span class="count">{bodyRows.length}</span></h2>
			<p class="note">Body styles for vehicle subjects. New ones show a sedan silhouette in the library.</p>
			<form class="row" onsubmit={(e) => { e.preventDefault(); addBody(); }}>
				<label class="f f--grow">Name<input class="in" bind:value={bLabel} placeholder="e.g. Van" maxlength="40" /></label>
				<button class="btn" type="submit" disabled={!bodyId || !!bodyError || saving}>Add vehicle type</button>
			</form>
			{#if bodyError}<p class="warn">{bodyError}</p>{:else if bLabel.trim() && bodyName !== bLabel.trim()}<p class="note">Will be saved as “{bodyName}”.</p>{/if}
			<ul class="items">{#each bodyRows as r (r.id)}{@render rowView(r)}{/each}</ul>
		</section>

		<!-- Categories -->
		<section class="card">
			<h2>Categories <span class="count">{categoryRows.length}</span></h2>
			<p class="note">Materials a pattern is cut from. A new category starts with a single “Custom” zone; add zones to it above.</p>
			<form class="row" onsubmit={(e) => { e.preventDefault(); addCategory(); }}>
				<label class="f f--grow">Name<input class="in" bind:value={cLabel} placeholder="e.g. Chrome Delete" maxlength="40" /></label>
				<label class="f">Short name<input class="in" bind:value={cShort} placeholder="Chrome" maxlength="16" /></label>
				<label class="f f--grow">Description<input class="in" bind:value={cDesc} placeholder="One short line" maxlength="80" /></label>
				<label class="f">Color<input class="in in--color" type="color" bind:value={cAccent} /></label>
				<button class="btn" type="submit" disabled={!catId || !!catError || saving}>Add category</button>
			</form>
			{#if catError}<p class="warn">{catError}</p>{:else if cLabel.trim() && catName !== cLabel.trim()}<p class="note">Will be saved as “{catName}”.</p>{/if}
			<ul class="items">{#each categoryRows as r (r.id)}{@render rowView(r)}{/each}</ul>
		</section>
	{/if}
</div>

<style>
	.om { display: flex; flex-direction: column; gap: 16px; max-width: 1100px; }
	.lead { margin: 0; font-size: 0.875rem; line-height: 1.55; color: var(--text-secondary); }
	.card { padding: 16px 18px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 10px; }
	h2 { margin: 0; font-size: 1.0625rem; }
	h3 { margin: 10px 0 0; font-size: 0.8125rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
	.count { font-family: var(--font-mono); font-size: 0.6875rem; padding: 1px 7px; border-radius: 99px; background: var(--bg-surface-3); color: var(--text-secondary); text-transform: none; letter-spacing: 0; }
	.note, .muted { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); }
	.warn { margin: 0; font-size: 0.8125rem; color: var(--color-warning); }
	.row, .edit { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
	.edit { flex: 1; }
	.f { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); min-width: 150px; }
	.f--grow { flex: 1 1 200px; }
	.opt { font-weight: 400; color: var(--text-tertiary); }
	.in { padding: 7px 9px; font: inherit; font-size: 0.8125rem; font-weight: 400; color: var(--text-primary); background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-md); min-width: 0; }
	.in--color { padding: 2px; height: 33px; width: 56px; min-width: 56px; }
	.btn { padding: 8px 14px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: #0a0a0a; background: var(--color-brand); border: none; border-radius: var(--radius-md); cursor: pointer; }
	.btn--ghost { color: var(--text-primary); background: var(--bg-surface-3); }
	.btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.items li { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; padding: 7px 2px; border-top: 1px solid var(--border-subtle); font-size: 0.875rem; }
	.items li.off .name { color: var(--text-tertiary); text-decoration: line-through; }
	.name { font-weight: 600; }
	.tag { font-size: 0.75rem; color: var(--text-tertiary); }
	.pill { font-size: 0.6875rem; font-weight: 600; padding: 1px 7px; border-radius: 99px; background: var(--bg-surface-3); color: var(--text-secondary); }
	.pill--added { background: color-mix(in srgb, var(--color-brand) 16%, transparent); color: var(--text-primary); }
	.pill--warn { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--text-primary); }
	.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
	.acts { margin-left: auto; display: inline-flex; gap: 12px; }
	.link { background: none; border: none; padding: 0; font: inherit; font-size: 0.8125rem; color: var(--text-brand, var(--color-brand)); cursor: pointer; }
	.link:hover { text-decoration: underline; }
	.link--danger { color: var(--color-error, #ef4444); }
	.link:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
