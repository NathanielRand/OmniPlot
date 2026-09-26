<script lang="ts" module>
	import type { PatternCategory, PatternUploadSource, PatternGeometryStats, PatternZone, ProjectType, UserPatternStatus } from "$lib/types";

	/** Mirrors serializeUserPattern() in $lib/server/user-patterns. */
	export interface AdminPatternRow {
		id: string;
		ownerId: string;
		name: string;
		status: UserPatternStatus;
		submitToCommunity: boolean;
		isPublished: boolean;
		projectType: ProjectType;
		patternName: string | null;
		propertyLabel: string | null;
		address: string | null;
		make: string;
		models: string[];
		years: string[];
		bodyStyle: string | null;
		category: PatternCategory;
		zones: PatternZone[];
		customZoneLabels: string[];
		coverage: string;
		widthInches: number;
		heightInches: number;
		notes: string | null;
		rejectionReason: string | null;
		source: PatternUploadSource | null;
		batchId: string | null;
		tierAtUpload: string | null;
		geometry: PatternGeometryStats | null;
		editCount: number | null;
		createdAt: string | null;
		updatedAt: string | null;
		usage: { cuts: number; lastCutAt: string | null };
		moderation: { flagged: boolean; flagReason: string | null; note: string | null; updatedBy: string | null; updatedAt: string | null } | null;
		svgPath?: string;
		owner?: { uid: string; name: string; email: string; tier: string };
	}

	export const INPUT_LABELS: Record<string, string> = {
		"svg-file":        "SVG file",
		"svg-paste":       "Pasted SVG code",
		"path-paste":      "Pasted path data",
		"image-vectorize": "Image → Vectorize",
		"image-cutout":    "Image → Cutout",
		"image-trace":     "Image → Trace",
		"unknown":         "Unknown",
	};
	export const FLOW_LABELS: Record<string, string> = {
		"single":           "Single pattern",
		"multi-individual": "Multi · one file each",
		"multi-extract":    "Multi · split from one file",
	};
	export const STATUS_VARIANT: Record<string, "default" | "warning" | "success" | "danger"> = {
		private: "default", pending: "warning", approved: "success", rejected: "danger",
	};

	export function subjectLabel(p: Pick<AdminPatternRow, "projectType" | "make" | "models" | "years" | "patternName" | "propertyLabel" | "address">): string {
		if (p.projectType === "custom") return p.patternName || p.models[0] || "Custom";
		if (p.projectType === "residential" || p.projectType === "commercial") return p.propertyLabel || p.address || p.models[0] || p.projectType;
		return [p.years.join(", "), p.make, p.models.join(" / ")].filter(Boolean).join(" ") || "—";
	}

	export function fmtBytes(n: number | undefined | null): string {
		if (!n) return "—";
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import PatternPreview from "$lib/components/ui/PatternPreview.svelte";
	import { auth } from "$lib/firebase/client";
	import { confirmStore, toastStore } from "$lib/stores";
	import { categoryLabel, zoneLabel } from "$lib/stores/patternStore.svelte";
	import { formatDate, formatRelativeTime } from "$lib/utils";

	// Admin view of one private pattern: preview, everything we know about
	// how it was made and used, and moderation (flag / internal note / delete).
	interface Props {
		pattern: AdminPatternRow;
		/** Show "Uploaded by" with a link to the account (off inside the Users drawer). */
		showOwner?: boolean;
		onchange?: (p: AdminPatternRow) => void;
		ondelete?: (id: string) => void;
	}
	let { pattern, showOwner = false, onchange, ondelete }: Props = $props();

	let full    = $state<AdminPatternRow | null>(null);
	let loading = $state(false);
	let busy    = $state<string | null>(null);
	let flagReason = $state("");
	let note       = $state("");
	let flagFormOpen = $state(false);
	let deleteFormOpen = $state(false);
	let deleteReason   = $state("");

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	// Rows from the stats list come without the path — fetch the full doc.
	$effect(() => {
		const id = pattern.id;
		note = pattern.moderation?.note ?? "";
		flagFormOpen = false;
		flagReason = "";
		deleteFormOpen = false;
		deleteReason = "";
		if (pattern.svgPath !== undefined) { full = pattern; return; }
		full = null;
		loading = true;
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/admin/user-patterns/${id}`, { headers: await authHeaders() });
				const data = await res.json();
				if (!res.ok) throw new Error(data.error ?? "Could not load pattern");
				if (!cancelled) {
					full = { ...pattern, ...data.pattern, owner: pattern.owner };
					note = full!.moderation?.note ?? "";
				}
			} catch (e) {
				if (!cancelled) toastStore.error("Couldn't load pattern", e instanceof Error ? e.message : "");
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => { cancelled = true; };
	});

	const p = $derived(full ?? pattern);
	const zoneNames = $derived(p.zones.map((z, i) => zoneLabel(z, p.category, p.projectType, p.customZoneLabels[i])));

	async function patchModeration(body: Record<string, unknown>, label: string) {
		busy = label;
		try {
			const res = await fetch(`/api/admin/user-patterns/${p.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...(await authHeaders()) },
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Update failed");
			const next = { ...p, moderation: data.moderation };
			full = next;
			onchange?.(next);
			return true;
		} catch (e) {
			toastStore.error("Update failed", e instanceof Error ? e.message : "");
			return false;
		} finally {
			busy = null;
		}
	}

	async function flag() {
		if (await patchModeration({ flagged: true, flagReason }, "flag")) {
			flagFormOpen = false;
			toastStore.success("Pattern flagged");
		}
	}
	async function unflag() {
		if (await patchModeration({ flagged: false }, "flag")) toastStore.success("Flag cleared");
	}
	async function saveNote() {
		if (await patchModeration({ note }, "note")) toastStore.success("Note saved");
	}

	async function remove() {
		const reason = deleteReason.trim();
		if (!reason) return;
		const ok = await confirmStore.ask({
			title: `Delete "${p.name}"?`,
			message: "It's removed from the user's library right away and they aren't notified. A copy is kept in the admin audit log so it can be restored.",
			variant: "danger",
			confirmLabel: "Delete pattern",
			details: [{ label: "Reason", value: reason }],
		});
		if (!ok) return;
		busy = "delete";
		try {
			const res = await fetch(`/api/admin/user-patterns/${p.id}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json", ...(await authHeaders()) },
				body: JSON.stringify({ reason }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error ?? "Delete failed");
			toastStore.success("Pattern deleted");
			ondelete?.(p.id);
		} catch (e) {
			toastStore.error("Delete failed", e instanceof Error ? e.message : "");
		} finally {
			busy = null;
		}
	}
</script>

<div class="api">
	<div class="api__preview">
		{#if p.svgPath !== undefined}
			<PatternPreview svgPath={p.svgPath} label={p.name} widthInches={p.widthInches} heightInches={p.heightInches}/>
		{:else if loading}
			<div class="api__skel"></div>
		{/if}
	</div>

	<div class="api__head">
		<div class="api__title">{p.name || "Untitled"}</div>
		<div class="api__badges">
			<Badge variant={STATUS_VARIANT[p.status] ?? "default"} size="sm">{p.status}</Badge>
			{#if p.moderation?.flagged}<Badge variant="danger" size="sm" dot>flagged</Badge>{/if}
		</div>
	</div>

	{#if p.moderation?.flagged}
		<p class="api__flag">
			Flagged{p.moderation.updatedBy ? ` by ${p.moderation.updatedBy}` : ""}{p.moderation.updatedAt ? ` · ${formatRelativeTime(new Date(p.moderation.updatedAt))}` : ""}{p.moderation.flagReason ? `: ${p.moderation.flagReason}` : ""}
		</p>
	{/if}

	<dl class="api__grid">
		{#if showOwner && p.owner}
			<dt>Uploaded by</dt>
			<dd>{p.owner.name} <span class="api__muted">· {p.owner.tier}</span> <a class="api__link" href="/admin/users?uid={p.owner.uid}">Open account</a></dd>
		{/if}
		<dt>Subject</dt><dd>{subjectLabel(p)} <span class="api__muted">· {p.projectType}</span></dd>
		<dt>Category</dt><dd>{categoryLabel(p.category)} · {p.coverage}</dd>
		<dt>Zones</dt><dd>{zoneNames.join(", ") || "—"}</dd>
		<dt>Size</dt><dd class="api__mono">{p.widthInches.toFixed(2)} × {p.heightInches.toFixed(2)} in</dd>
		<dt>Complexity</dt>
		<dd class="api__mono">{p.geometry ? `${p.geometry.subpaths} outline${p.geometry.subpaths === 1 ? "" : "s"} · ${p.geometry.commands.toLocaleString()} cmds · ${fmtBytes(p.geometry.pathBytes)}` : "—"}</dd>
		<dt>Uploaded</dt><dd>{p.createdAt ? formatDate(p.createdAt) : "—"}{p.tierAtUpload ? ` · on ${p.tierAtUpload}` : ""}</dd>
		<dt>Edits</dt><dd>{p.editCount ?? "—"}{p.updatedAt && p.updatedAt !== p.createdAt ? ` · last ${formatRelativeTime(new Date(p.updatedAt))}` : ""}</dd>
		<dt>Cut</dt><dd>{p.usage.cuts ? `${p.usage.cuts} job${p.usage.cuts === 1 ? "" : "s"} · last ${formatRelativeTime(new Date(p.usage.lastCutAt!))}` : "Never"}</dd>
		<dt>Imported</dt>
		<dd>
			{#if p.source}
				{INPUT_LABELS[p.source.input] ?? p.source.input}{p.source.fromPdf ? " (from PDF)" : ""} · {FLOW_LABELS[p.source.flow] ?? p.source.flow}{p.source.batchSize && p.source.batchSize > 1 ? ` (${p.source.batchSize} pieces)` : ""}
				{#if p.source.fileName}<div class="api__muted api__file">{p.source.fileName} · {fmtBytes(p.source.fileBytes)}</div>{/if}
			{:else}
				<span class="api__muted">Not tracked (uploaded before tracking)</span>
			{/if}
		</dd>
		{#if p.notes}<dt>User notes</dt><dd class="api__pre">{p.notes}</dd>{/if}
		{#if p.rejectionReason}<dt>Rejected</dt><dd>{p.rejectionReason}</dd>{/if}
		<dt>ID</dt><dd class="api__mono api__muted">{p.id}</dd>
	</dl>

	<div class="api__section">
		<label class="api__label" for="api-note-{p.id}">Internal note</label>
		<textarea id="api-note-{p.id}" class="api__input" rows="2" bind:value={note} placeholder="Only admins see this"></textarea>
		<button class="api__btn" onclick={saveNote} disabled={busy !== null || note === (p.moderation?.note ?? "")}>{busy === "note" ? "Saving…" : "Save note"}</button>
	</div>

	<div class="api__section api__actions">
		{#if p.moderation?.flagged}
			<button class="api__btn" onclick={unflag} disabled={busy !== null}>{busy === "flag" ? "…" : "Clear flag"}</button>
		{:else if flagFormOpen}
			<input class="api__input" bind:value={flagReason} placeholder="Why? (optional)" maxlength="500"/>
			<div class="api__row">
				<button class="api__btn api__btn--warn" onclick={flag} disabled={busy !== null}>{busy === "flag" ? "…" : "Flag"}</button>
				<button class="api__btn" onclick={() => (flagFormOpen = false)}>Cancel</button>
			</div>
		{:else}
			<button class="api__btn" onclick={() => (flagFormOpen = true)} disabled={busy !== null}>Flag for review</button>
		{/if}
		{#if !p.isPublished && !deleteFormOpen}
			<button class="api__btn api__btn--danger" onclick={() => (deleteFormOpen = true)} disabled={busy !== null}>Delete pattern</button>
		{/if}
		{#if deleteFormOpen}
			<input class="api__input" bind:value={deleteReason} placeholder="Reason for deleting (required, internal)" maxlength="500"/>
			<div class="api__row">
				<button class="api__btn api__btn--danger-solid" onclick={remove} disabled={busy !== null || !deleteReason.trim()}>{busy === "delete" ? "Deleting…" : "Delete"}</button>
				<button class="api__btn" onclick={() => { deleteFormOpen = false; deleteReason = ""; }}>Cancel</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.api { display: flex; flex-direction: column; gap: 12px; font-size: 0.8125rem; }
	.api__preview { border-radius: var(--radius-lg); overflow: hidden; background: var(--bg-surface-2); }
	.api__skel { height: 200px; }
	.api__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.api__title { font-weight: 600; font-size: 0.9375rem; color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }
	.api__badges { display: flex; gap: 4px; flex-shrink: 0; }
	.api__flag { margin: 0; padding: 8px 10px; border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--text-danger); font-size: 0.75rem; }

	.api__grid { display: grid; grid-template-columns: 88px 1fr; gap: 6px 10px; margin: 0; }
	.api__grid dt { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); padding-top: 2px; }
	.api__grid dd { margin: 0; color: var(--text-secondary); min-width: 0; overflow-wrap: anywhere; }
	.api__mono  { font-family: var(--font-mono); font-size: 0.75rem; }
	.api__muted { color: var(--text-tertiary); }
	.api__file  { font-size: 0.75rem; margin-top: 2px; }
	.api__pre   { white-space: pre-wrap; }
	.api__link  { color: var(--text-brand); text-decoration: none; margin-left: 4px; }
	.api__link:hover { text-decoration: underline; }

	.api__section { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
	.api__label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.api__input {
		padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-default);
		background: var(--bg-surface); color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body); resize: vertical;
	}
	.api__actions { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
	.api__actions .api__input { flex: 1 1 100%; }
	.api__row { display: flex; gap: 6px; }
	.api__btn {
		padding: 6px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-default);
		background: transparent; color: var(--text-secondary); font-size: 0.8125rem; font-weight: 500;
		font-family: var(--font-body); cursor: pointer; align-self: flex-start;
	}
	.api__btn:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }
	.api__btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.api__btn--warn   { border-color: var(--color-warning); color: var(--text-warning); }
	.api__btn--danger { border-color: var(--color-danger); color: var(--text-danger); margin-left: auto; }
	.api__btn--danger-solid { background: var(--color-danger); border-color: transparent; color: #fff; }
	.api__btn--danger-solid:hover:not(:disabled) { background: var(--color-danger); color: #fff; opacity: 0.85; }
</style>
