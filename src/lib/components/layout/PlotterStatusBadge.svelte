<script lang="ts">
	import { goto } from "$app/navigation";
	import { plotterStatusStore } from "$lib/stores";
	import { tooltip } from "$lib/actions/tooltip";

	// Plotter connection status + Connect/View CTA for the app shell.
	// "topbar": compact pill. "sidebar": card that shrinks to an icon when
	// the sidebar is collapsed.
	interface Props {
		variant: "topbar" | "sidebar";
		collapsed?: boolean;
		onnavigate?: () => void;
	}
	let { variant, collapsed = false, onnavigate }: Props = $props();

	const s = $derived(plotterStatusStore.current);
	const live = $derived(s.state === "connected" || s.state === "cutting");
	const summary = $derived(`${s.name ?? "No plotter"} · ${s.detail}`);

	// The Studio opens its Plotter tab on ?panel=plotter (and strips it).
	function openPlotter() {
		onnavigate?.();
		goto("/studio?panel=plotter");
	}
</script>

{#snippet connIcon(size: number)}
	{#if s.connType === "usb-serial"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h9M4 15h9"/><path d="M13 6h4l3 3v6l-3 3h-4"/><path d="M9 6V4M9 20v-2"/></svg>
	{:else if s.connType === "cut-agent"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M12 7.5h6M12 16.5h6"/></svg>
	{:else if s.connType === "network"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16.5a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
	{:else if s.connType === "download"}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>
	{:else}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8V4h12v4M6 16v4h12v-4"/></svg>
	{/if}
{/snippet}

{#if variant === "topbar"}
	<div class="psb psb--top psb--{s.tone}" role="status" aria-live="polite" aria-label="Plotter: {summary}">
		<button class="psb__main" onclick={openPlotter} use:tooltip={summary}>
			<span class="psb__dot" aria-hidden="true"></span>
			<span class="psb__name">{s.name ?? "No plotter"}</span>
			<span class="psb__detail">{s.detail}</span>
		</button>
		{#if !live}
			<button class="psb__cta" onclick={openPlotter}>Connect</button>
		{/if}
	</div>
{:else if collapsed}
	<button class="psb psb--icon psb--{s.tone}" onclick={openPlotter} use:tooltip={`${summary} — ${live ? "open plotter settings" : "connect"}`} aria-label="Plotter: {summary}">
		<span class="psb__medallion psb__medallion--{s.connType ?? 'none'}">{@render connIcon(14)}</span>
		<span class="psb__dot psb__dot--corner" aria-hidden="true"></span>
	</button>
{:else}
	<div class="psb psb--card psb--{s.tone}" role="status" aria-live="polite">
		<div class="psb__row">
			<span class="psb__medallion psb__medallion--{s.connType ?? 'none'}">{@render connIcon(13)}</span>
			<span class="psb__text">
				<span class="psb__name">{s.name ?? "No plotter"}</span>
				<span class="psb__detail"><span class="psb__dot" aria-hidden="true"></span>{s.detail}</span>
			</span>
		</div>
		<button class="psb__cta psb__cta--block" class:psb__cta--primary={!live} onclick={openPlotter}>
			{live ? "Plotter settings" : "Connect plotter"}
		</button>
	</div>
{/if}

<style>
	.psb__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-tertiary); display: inline-block; }
	.psb--ok .psb__dot      { background: var(--color-success); }
	.psb--warn .psb__dot    { background: var(--color-warning); }
	.psb--error .psb__dot   { background: var(--color-danger); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-danger) 25%, transparent); }
	.psb--cutting .psb__dot { background: var(--color-brand); animation: psb-pulse 1.1s ease-in-out infinite; }
	@keyframes psb-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
	@media (prefers-reduced-motion: reduce) { .psb--cutting .psb__dot { animation: none; } }

	.psb__name { font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.psb__detail { color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.psb--cutting .psb__detail { color: var(--color-brand); font-weight: 600; }
	.psb--error .psb__detail   { color: var(--color-danger); }

	.psb__cta {
		flex-shrink: 0; padding: 4px 10px; font-size: 0.6875rem; font-weight: 600; font-family: var(--font-body);
		border-radius: 999px; border: 1px solid var(--border-default); background: var(--bg-surface-3);
		color: var(--text-secondary); cursor: pointer; white-space: nowrap;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.psb__cta:hover, .psb__cta--primary { background: var(--color-brand); color: var(--bg-surface); border-color: var(--color-brand); }
	.psb__cta--primary:hover { opacity: 0.88; }

	/* ── Top bar pill ── */
	.psb--top {
		display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 4px 0 2px;
		border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--bg-surface-2);
		min-width: 0; max-width: 300px;
	}
	.psb--top .psb__main {
		display: flex; align-items: center; gap: 6px; min-width: 0; height: 100%; padding: 0 6px 0 9px;
		border: none; background: none; cursor: pointer; font-family: var(--font-body); font-size: 0.75rem;
		border-radius: 999px;
	}
	.psb--top .psb__main:hover .psb__name { color: var(--text-brand); }
	.psb--top .psb__name { max-width: 120px; }
	.psb--top .psb__detail { font-size: 0.6875rem; max-width: 130px; }
	.psb--top .psb__detail::before { content: "·"; margin-right: 6px; color: var(--text-tertiary); }

	/* ── Sidebar card ── */
	.psb--card {
		display: flex; flex-direction: column; gap: 8px; padding: 10px;
		border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-surface-2);
	}
	.psb__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.psb__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; font-size: 0.75rem; }
	.psb--card .psb__detail { display: flex; align-items: center; gap: 5px; font-size: 0.6875rem; }
	.psb--card .psb__dot { width: 6px; height: 6px; }
	.psb__cta--block { width: 100%; padding: 6px 10px; border-radius: var(--radius-md); font-size: 0.75rem; }

	.psb__medallion {
		display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
		border-radius: 7px; flex-shrink: 0; background: var(--bg-surface-3); color: var(--text-secondary);
	}
	.psb__medallion--usb-serial { background: rgba(96, 165, 250, 0.14); color: #60a5fa; }
	.psb__medallion--cut-agent  { background: rgba(52, 211, 153, 0.14); color: #34d399; }
	.psb__medallion--network    { background: rgba(251, 191, 36, 0.14); color: #fbbf24; }
	.psb__medallion--download   { background: rgba(148, 163, 184, 0.14); color: #94a3b8; }

	/* ── Collapsed sidebar icon ── */
	.psb--icon {
		position: relative; display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; margin: 0 auto; padding: 0; border: none; background: none;
		border-radius: var(--radius-md); cursor: pointer;
	}
	.psb--icon:hover { background: var(--interactive-hover); }
	.psb__dot--corner { position: absolute; top: 3px; right: 3px; box-shadow: 0 0 0 2px var(--bg-surface); }

	/* Narrow top bars: dot + Connect only (the sidebar card has the detail). */
	@media (max-width: 1100px) { .psb--top .psb__detail { display: none; } }
	@media (max-width: 640px) {
		.psb--top { border: none; background: none; max-width: none; }
		.psb--top .psb__name { display: none; }
		.psb--top .psb__main { padding: 0 6px; }
	}
</style>
