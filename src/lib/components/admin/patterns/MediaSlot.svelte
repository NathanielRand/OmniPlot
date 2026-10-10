<script lang="ts">
	// One image slot (make logo, make cover, model image, trim image, project image).
	// Shows what's assigned right now, so Replace is always a deliberate act, and
	// warns before the same file is reused somewhere else.
	import { patternStore } from "$lib/stores/patternStore.svelte";
	import { toastStore, confirmStore } from "$lib/stores";
	import { uploadMedia, removeMedia, setImageFocus, MEDIA_TYPES, type MediaField } from "$lib/admin/vehicleMedia";
	import { targetId, focusPosition, type MediaTarget } from "$lib/utils/vehicleCatalog";

	interface Props {
		target: MediaTarget;
		field: MediaField;
		label: string;
		/** Small grey line under the label — what this image is used for. */
		hint?: string;
		/** Hide the "paste a link" affordance (compact rows). */
		compact?: boolean;
	}
	let { target, field, label, hint, compact = false }: Props = $props();

	const id = $derived(targetId(target));
	const url = $derived(patternStore.media[id]?.[field]);
	const stored = $derived(!!patternStore.media[id]?.[field === "logoUrl" ? "logoPath" : "imagePath"]);

	const savedFocus = $derived(field === "imageUrl" ? patternStore.media[id]?.imageFocus : undefined);

	// Focus point: click or drag on the full image to choose what stays centered when
	// the library crops it to a tile or banner. The previews show the crops live.
	let picking = $state(false);
	let draft = $state({ x: 50, y: 50 });
	let dragging = false;
	function startPick() {
		draft = savedFocus ? { ...savedFocus } : { x: 50, y: 50 };
		picking = !picking;
	}
	function pick(e: PointerEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const c = (n: number) => Math.min(100, Math.max(0, Math.round(n)));
		draft = { x: c(((e.clientX - r.left) / r.width) * 100), y: c(((e.clientY - r.top) / r.height) * 100) };
	}
	async function saveFocus(next: { x: number; y: number } | null) {
		busy = true;
		const r = await setImageFocus(target, next);
		busy = false;
		if (r.ok) { picking = false; toastStore.success(next ? "Focus saved" : "Focus reset", label); }
		else toastStore.error("Couldn't save focus", r.error);
	}

	let busy = $state(false);
	let dup = $state<{ file: File; of: string } | null>(null);
	let linking = $state(false);
	let link = $state("");

	/** Putting a new image over a live one deletes the old file, so say so first. */
	async function okToReplace(what: string): Promise<boolean> {
		if (!url) return true;
		return confirmStore.ask({
			title: `Replace the ${label}?`,
			message: `${what} replaces the image customers see now.${stored ? " The old file is deleted." : ""}`,
			confirmLabel: "Replace image",
		});
	}

	async function send(file: File, force = false) {
		if (!force && !(await okToReplace(file.name))) return;
		busy = true;
		dup = null;
		const r = await uploadMedia(target, field, { file, force });
		busy = false;
		if (r.ok) {
			toastStore.success(r.unchanged ? "Already set" : "Saved", `${label} — ${file.name}`);
		} else if (r.duplicate) {
			dup = { file, of: r.duplicate.label };
		} else {
			toastStore.error("Upload failed", r.error);
		}
	}

	async function sendLink() {
		if (!(await okToReplace("This link"))) return;
		busy = true;
		const r = await uploadMedia(target, field, { url: link });
		busy = false;
		if (r.ok) { linking = false; link = ""; toastStore.success("Saved", label); }
		else toastStore.error("Couldn't save link", r.error);
	}

	async function clear() {
		const ok = await confirmStore.ask({
			title: `Remove the ${label}?`,
			message: `Customers go back to the fallback image.${stored ? " The uploaded file is deleted." : ""}`,
			variant: "danger",
			confirmLabel: "Remove image",
		});
		if (!ok) return;
		busy = true;
		const r = await removeMedia(target, field);
		busy = false;
		if (r.ok) toastStore.success("Removed", label);
		else toastStore.error("Couldn't remove", r.error);
	}
</script>

<div class="slot" class:slot--compact={compact}>
	<div class="slot__thumb" class:slot__thumb--empty={!url}>
		{#if url}<img src={url} alt="{label}" loading="lazy" style:object-position={focusPosition(savedFocus)} />{:else}<span>None</span>{/if}
	</div>
	<div class="slot__body">
		<div class="slot__label">{label}</div>
		{#if hint}<div class="slot__hint">{hint}</div>{/if}
		<div class="slot__btns">
			<label class="b" class:b--off={busy}>
				{busy ? "Working…" : url ? "Replace" : "Upload"}
				<input type="file" accept={MEDIA_TYPES} hidden disabled={busy}
					onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) send(f); }} />
			</label>
			{#if !compact}<button class="b" disabled={busy} onclick={() => (linking = !linking)}>Link</button>{/if}
			{#if url && field === "imageUrl"}<button class="b" class:b--on={picking} disabled={busy} onclick={startPick}>Focus</button>{/if}
			{#if url}<button class="b b--danger" disabled={busy} onclick={clear}>Remove</button>{/if}
		</div>
		{#if url && !stored}<div class="slot__hint">External link</div>{/if}
		{#if picking && url}
			<div class="focus">
				<div class="focus__pick" role="presentation"
					onpointerdown={(e) => { dragging = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pick(e); }}
					onpointermove={(e) => dragging && pick(e)}
					onpointerup={() => (dragging = false)}
					onpointercancel={() => (dragging = false)}>
					<img src={url} alt="" draggable="false" />
					<span class="focus__dot" style:left="{draft.x}%" style:top="{draft.y}%"></span>
				</div>
				<div class="focus__prev">
					<div class="focus__crop" style:aspect-ratio="16 / 9"><img src={url} alt="" style:object-position="{draft.x}% {draft.y}%" /></div>
					<div class="focus__crop" style:aspect-ratio="16 / 10"><img src={url} alt="" style:object-position="{draft.x}% {draft.y}%" /></div>
				</div>
				<div class="slot__hint">Click or drag to choose what stays centered · {draft.x}% / {draft.y}%</div>
				<div class="slot__btns">
					<button class="b" disabled={busy} onclick={() => saveFocus(draft)}>Save focus</button>
					{#if savedFocus}<button class="b" disabled={busy} onclick={() => saveFocus(null)}>Reset</button>{/if}
					<button class="b" disabled={busy} onclick={() => (picking = false)}>Cancel</button>
				</div>
			</div>
		{/if}
		{#if linking}
			<form class="slot__link" onsubmit={(e) => { e.preventDefault(); sendLink(); }}>
				<input type="url" placeholder="https://…" bind:value={link} aria-label="{label} URL" />
				<button class="b" disabled={busy || !link.trim()}>Save</button>
			</form>
		{/if}
		{#if dup}
			<div class="slot__dup" role="alert">
				This exact file is already used for <strong>{dup.of}</strong>.
				<button class="b" onclick={() => send(dup!.file, true)}>Use it here too</button>
				<button class="b" onclick={() => (dup = null)}>Cancel</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.slot { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
	.slot__thumb { width: 84px; height: 56px; flex-shrink: 0; display: grid; place-items: center; overflow: hidden; background: var(--bg-surface-2); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
	.slot--compact .slot__thumb { width: 56px; height: 38px; }
	.slot__thumb img { width: 100%; height: 100%; object-fit: contain; }
	.slot__thumb--empty { border-style: dashed; color: var(--text-tertiary); font-size: 0.6875rem; }
	.slot__body { min-width: 0; display: flex; flex-direction: column; gap: 3px; flex: 1; }
	.slot__label { font-size: 0.8125rem; font-weight: 600; }
	.slot__hint { font-size: 0.6875rem; color: var(--text-tertiary); }
	.slot__btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
	.b { padding: 3px 10px; font: inherit; font-size: 0.6875rem; font-weight: 600; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); cursor: pointer; }
	.b:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-3); }
	.b:disabled, .b--off { opacity: 0.5; cursor: not-allowed; }
	.b--danger { color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 40%, transparent); }
	.b--on { color: var(--text-primary); background: var(--bg-surface-3); }
	.focus { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
	.focus__pick { position: relative; touch-action: none; cursor: crosshair; border: 1px solid var(--border-default); border-radius: var(--radius-md); overflow: hidden; line-height: 0; }
	.focus__pick img { display: block; width: 100%; height: auto; user-select: none; }
	.focus__dot { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid #fff; background: color-mix(in srgb, var(--color-brand) 70%, transparent); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6); pointer-events: none; }
	.focus__prev { display: flex; gap: 6px; }
	.focus__crop { flex: 1; min-width: 0; overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface-2); }
	.focus__crop img { display: block; width: 100%; height: 100%; object-fit: cover; }
	.slot__link { display: flex; gap: 6px; margin-top: 4px; }
	.slot__link input { flex: 1; min-width: 0; padding: 4px 8px; font: inherit; font-size: 0.75rem; background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
	.slot__dup { margin-top: 4px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.75rem; color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 9%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); border-radius: var(--radius-md); }
</style>
