<script lang="ts">
	import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
	import { storage } from "$lib/firebase/client";
	import { setVehicleMediaDoc, deleteVehicleMediaDoc } from "$lib/firebase/firestore";
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { toastStore } from "$lib/stores";
	import { buildTree, mediaId, monogram, trimKey } from "$lib/utils/vehicleCatalog";
	import type { VehicleMedia } from "$lib/types";

	// Admin: attach a logo / cover image to each make, an image to each model,
	// and (later) an image to each trim. Rows come from the catalog itself, so
	// every make/model that has patterns is listed whether or not it has art.
	// Files go to Firebase Storage; a pasted URL works too (e.g. art already in
	// the bucket). Nothing here touches patterns.
	let { onclose }: { onclose: () => void } = $props();

	const tree = $derived(
		buildTree(
			patternStore.vehicles
				.filter((v) => (v.projectType ?? "vehicle") === "vehicle" && v.make && v.model)
				.map((v) => ({ v, count: 1 })),
		),
	);

	let open = $state<string | null>(null); // make key expanded
	let busy = $state<string | null>(null); // "<id>:<field>" being uploaded
	let filter = $state("");

	const shownTree = $derived(
		tree.filter((m) => !filter.trim() || `${m.label} ${m.models.map((o) => o.label).join(" ")}`.toLowerCase().includes(filter.trim().toLowerCase())),
	);

	const get = (id: string) => patternStore.media[id];

	async function save(
		id: string,
		base: Pick<VehicleMedia, "kind" | "make" | "model" | "trim">,
		patch: Partial<Pick<VehicleMedia, "logoUrl" | "imageUrl">>,
	) {
		const next: VehicleMedia = { ...base, ...get(id), ...patch, id };
		try {
			if (!next.logoUrl && !next.imageUrl) await deleteVehicleMediaDoc(id);
			else await setVehicleMediaDoc(next);
		} catch {
			toastStore.error("Couldn't save", "Check that you're signed in as an admin and that the vehicleMedia rules are deployed.");
		}
	}

	async function upload(
		id: string,
		base: Pick<VehicleMedia, "kind" | "make" | "model" | "trim">,
		field: "logoUrl" | "imageUrl",
		file: File | undefined,
	) {
		if (!file) return;
		if (!/^image\/(png|jpe?g|webp|svg\+xml|avif)$/.test(file.type)) {
			toastStore.error("Unsupported file", "Use PNG, JPG, WebP, AVIF or SVG.");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			toastStore.error("File too large", "Keep images under 5 MB.");
			return;
		}
		busy = `${id}:${field}`;
		try {
			const ext = file.type === "image/svg+xml" ? "svg" : (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
			const r = ref(storage, `vehicle-media/${id}/${field === "logoUrl" ? "logo" : "image"}-${Date.now()}.${ext}`);
			await uploadBytes(r, file, { contentType: file.type, cacheControl: "public,max-age=31536000" });
			await save(id, base, { [field]: await getDownloadURL(r) });
			toastStore.success("Saved", file.name);
		} catch {
			toastStore.error("Upload failed", "Check the Storage rules allow admin writes to vehicle-media/.");
		} finally {
			busy = null;
		}
	}

	function pasteUrl(id: string, base: Pick<VehicleMedia, "kind" | "make" | "model" | "trim">, field: "logoUrl" | "imageUrl", value: string) {
		const v = value.trim();
		if (v && !/^https:\/\//.test(v)) {
			toastStore.error("Not a link", "Paste a full https:// image URL.");
			return;
		}
		save(id, base, { [field]: v || undefined });
	}
</script>

{#snippet slot(id: string, base: Pick<VehicleMedia, "kind" | "make" | "model" | "trim">, field: "logoUrl" | "imageUrl", label: string)}
	{@const url = get(id)?.[field]}
	<div class="slot">
		<div class="slot__thumb" class:slot__thumb--empty={!url}>
			{#if url}<img src={url} alt="" loading="lazy" />{:else}<span>{label}</span>{/if}
		</div>
		<div class="slot__ctl">
			<label class="slot__btn">
				{busy === `${id}:${field}` ? "Uploading…" : url ? "Replace" : "Upload"}
				<input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/svg+xml" hidden disabled={busy !== null}
					onchange={(e) => { upload(id, base, field, e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
			</label>
			<input class="slot__url" type="url" placeholder="…or paste https:// link" value={url ?? ""}
				onchange={(e) => pasteUrl(id, base, field, e.currentTarget.value)} aria-label="{label} URL" />
			{#if url}<button class="slot__x" onclick={() => save(id, base, { [field]: undefined })} aria-label="Remove {label}">Remove</button>{/if}
		</div>
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="vm-overlay" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="vm" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="vm-title" tabindex="-1">
		<div class="vm__head">
			<div>
				<h2 id="vm-title">Vehicle images</h2>
				<p>Logo and cover image per make, image per model. Anything left blank shows a monogram or silhouette.</p>
			</div>
			<button class="vm__close" onclick={onclose} aria-label="Close">×</button>
		</div>

		<input class="vm__search" type="search" placeholder="Filter makes and models…" bind:value={filter} aria-label="Filter makes and models" />

		<div class="vm__list">
			{#each shownTree as m (m.key)}
				{@const mid = mediaId(m.label)}
				{@const mbase = { kind: "make" as const, make: m.label }}
				<section class="mk">
					<button class="mk__row" onclick={() => (open = open === m.key ? null : m.key)} aria-expanded={open === m.key}>
						<span class="mk__logo">
							{#if get(mid)?.logoUrl}<img src={get(mid)?.logoUrl} alt="" />{:else}{monogram(m.label)}{/if}
						</span>
						<span class="mk__name">{m.label}</span>
						<span class="mk__meta">{m.models.length} {m.models.length === 1 ? "model" : "models"}</span>
						<span class="mk__chev" class:mk__chev--open={open === m.key} aria-hidden="true">›</span>
					</button>

					{#if open === m.key || filter.trim()}
						<div class="mk__body">
							<div class="pair">
								{@render slot(mid, mbase, "logoUrl", "Logo")}
								{@render slot(mid, mbase, "imageUrl", "Cover")}
							</div>

							{#each m.models as o (o.key)}
								{@const oid = mediaId(m.label, o.label)}
								{@const obase = { kind: "model" as const, make: m.label, model: o.label }}
								<div class="md">
									<div class="md__name">{o.label}</div>
									{@render slot(oid, obase, "imageUrl", "Model image")}
									{#if o.trims.some((t) => t.key)}
										<details class="md__trims">
											<summary>{o.trims.filter((t) => t.key).length} trims — optional images</summary>
											{#each o.trims.filter((t) => t.key) as t (t.key)}
												{@const tid = mediaId(m.label, o.label, t.label)}
												<div class="md__trim">
													<div class="md__name md__name--sm">{t.label}</div>
													{@render slot(tid, { kind: "trim", make: m.label, model: o.label, trim: t.label }, "imageUrl", "Trim image")}
												</div>
											{/each}
										</details>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else}
				<p class="vm__empty">No vehicles in the catalog yet.</p>
			{/each}
		</div>
	</div>
</div>

<style>
	.vm-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,.55); display: grid; place-items: center; padding: 16px; }
	.vm { width: min(760px, 100%); max-height: 90dvh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-xl); overflow: hidden; }
	.vm__head { display: flex; justify-content: space-between; gap: 12px; padding: 18px 20px 8px; }
	.vm__head h2 { margin: 0; font-family: var(--font-display); font-size: 1.125rem; }
	.vm__head p { margin: 4px 0 0; font-size: .8125rem; color: var(--text-secondary); }
	.vm__close { width: 32px; height: 32px; flex: none; border-radius: 50%; border: 1px solid var(--border-subtle); background: var(--bg-surface-2); color: var(--text-secondary); font-size: 1.125rem; cursor: pointer; }
	.vm__search { margin: 8px 20px 10px; padding: 8px 12px; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); color: var(--text-primary); font: inherit; font-size: .875rem; }
	.vm__list { overflow-y: auto; padding: 0 20px 20px; display: flex; flex-direction: column; gap: 8px; }
	.vm__empty { color: var(--text-tertiary); text-align: center; padding: 24px; }

	.mk { border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden; }
	.mk__row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--bg-surface-2); border: 0; color: var(--text-primary); font: inherit; cursor: pointer; text-align: left; }
	.mk__logo { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border-radius: 8px; background: var(--bg-surface); border: 1px solid var(--border-subtle); font-family: var(--font-mono); font-size: .6875rem; padding: 3px; }
	.mk__logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
	.mk__name { flex: 1; font-weight: 600; }
	.mk__meta { font-size: .75rem; color: var(--text-tertiary); font-family: var(--font-mono); }
	.mk__chev { transition: transform .15s; color: var(--text-tertiary); }
	.mk__chev--open { transform: rotate(90deg); }
	.mk__body { padding: 12px; display: flex; flex-direction: column; gap: 14px; }

	.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
	.md { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px dashed var(--border-subtle); }
	.md__name { font-weight: 600; font-size: .875rem; }
	.md__name--sm { font-weight: 500; font-size: .8125rem; color: var(--text-secondary); }
	.md__trims { font-size: .8125rem; color: var(--text-secondary); }
	.md__trims summary { cursor: pointer; padding: 4px 0; }
	.md__trim { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 8px 12px; border-left: 2px solid var(--border-subtle); margin-top: 6px; }

	.slot { display: flex; gap: 10px; align-items: center; min-width: 0; }
	.slot__thumb { width: 84px; aspect-ratio: 4/3; flex: none; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); overflow: hidden; }
	.slot__thumb img { width: 100%; height: 100%; object-fit: contain; }
	.slot__thumb--empty { border-style: dashed; }
	.slot__thumb span { font-size: .6875rem; color: var(--text-tertiary); text-align: center; padding: 4px; }
	.slot__ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; flex: 1; }
	.slot__btn, .slot__x { padding: 5px 10px; font-size: .75rem; font-weight: 500; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-surface-2); color: var(--text-primary); cursor: pointer; font-family: inherit; }
	.slot__x { color: var(--text-secondary); }
	.slot__btn:hover, .slot__x:hover { border-color: var(--color-brand-dim); }
	.slot__url { flex: 1 1 140px; min-width: 0; padding: 5px 8px; font-size: .75rem; background: var(--bg-surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary); font-family: inherit; }
</style>
