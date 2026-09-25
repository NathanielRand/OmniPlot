<script lang="ts">
	import { onMount } from "svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import { auth } from "$lib/firebase/client";
	import { supportStore } from "$lib/stores";
	import {
		STATUS_LABEL_USER,
		STATUS_VARIANT,
		TOPIC_LABEL,
		hasUserUnread,
		isOpen,
		needsUserAction,
		ticketRef,
		timeAgo,
		type Ticket,
	} from "$lib/support/tickets";

	let tickets = $state<Ticket[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showClosed = $state(false);

	const open = $derived(tickets.filter(isOpen));
	const done = $derived(tickets.filter((t) => !isOpen(t)));

	async function load() {
		loading = true;
		error = null;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch("/api/support/tickets", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Could not load tickets.");
			tickets = data.tickets;
			supportStore.refreshUser();
		} catch (err) {
			error = err instanceof Error ? err.message : "Could not load tickets.";
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head><title>Support tickets — OmniPlot</title></svelte:head>

<div class="page">
	<header class="page__head">
		<div>
			<h1 class="page__title">Support</h1>
			<p class="page__sub">Your conversations with the OmniPlot team.</p>
		</div>
		<a class="btn-new" href="/support">New request</a>
	</header>

	{#if loading}
		<div class="state"><span class="spinner" aria-label="Loading…"></span></div>
	{:else if error}
		<div class="state state--error">{error} <button class="link" onclick={load}>Retry</button></div>
	{:else if tickets.length === 0}
		<div class="state">
			<p>No support requests yet.</p>
			<p class="state__hint">Stuck on a cut, a pattern or your plan? <a href="/support">Chat with support</a> — we reply within one business day.</p>
		</div>
	{:else}
		{#snippet row(t: Ticket)}
			{@const attention = needsUserAction(t) || hasUserUnread(t)}
			<li>
				<a class="ticket" class:ticket--attention={attention} href="/support/tickets/{t.id}">
					<span class="ticket__dot" aria-hidden="true" class:ticket__dot--on={attention}></span>
					<span class="ticket__main">
						<span class="ticket__subject">{t.subject}</span>
						<span class="ticket__meta">{ticketRef(t.id)} · {TOPIC_LABEL[t.topic] ?? "Support"} · updated {timeAgo(t.lastActivityAt)}</span>
					</span>
					<Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL_USER[t.status]}</Badge>
				</a>
			</li>
		{/snippet}

		<section>
			<h2 class="section-title">Open <span class="count">{open.length}</span></h2>
			{#if open.length}
				<ul class="list">{#each open as t (t.id)}{@render row(t)}{/each}</ul>
			{:else}
				<p class="empty">Nothing open — you're all caught up.</p>
			{/if}
		</section>

		{#if done.length}
			<section>
				<button class="section-toggle" onclick={() => (showClosed = !showClosed)} aria-expanded={showClosed}>
					Resolved & closed <span class="count">{done.length}</span>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" class:flip={showClosed}><path d="M6 9l6 6 6-6"/></svg>
				</button>
				{#if showClosed}
					<ul class="list">{#each done as t (t.id)}{@render row(t)}{/each}</ul>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.page { max-width: 820px; margin: 0 auto; padding: 32px 24px 64px; display: flex; flex-direction: column; gap: 28px; }
	.page__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
	.page__title { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
	.page__sub { margin: 4px 0 0; font-size: 0.875rem; color: var(--text-tertiary); }

	.btn-new {
		padding: 9px 16px; border-radius: var(--radius-md);
		background: var(--color-brand-dim); color: #fff;
		font-size: 0.875rem; font-weight: 600; text-decoration: none;
	}
	.btn-new:hover { opacity: 0.85; }

	.section-title, .section-toggle {
		display: flex; align-items: center; gap: 8px;
		margin: 0 0 10px; padding: 0;
		font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
		color: var(--text-tertiary); background: none; border: none; font-family: var(--font-body);
	}
	.section-toggle { cursor: pointer; }
	.section-toggle:hover { color: var(--text-secondary); }
	.flip { transform: rotate(180deg); }
	.count { font-family: var(--font-mono); font-weight: 500; }

	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }

	.ticket {
		display: flex; align-items: center; gap: 12px;
		padding: 14px 16px;
		background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
		text-decoration: none; color: inherit;
		transition: border-color 0.12s;
	}
	.ticket:hover { border-color: var(--border-strong); }
	.ticket--attention { border-color: color-mix(in srgb, var(--color-warning) 45%, transparent); }

	.ticket__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: transparent; }
	.ticket__dot--on { background: var(--color-warning); }

	.ticket__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.ticket__subject {
		font-size: 0.9375rem; font-weight: 600; color: var(--text-primary);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.ticket__meta { font-size: 0.75rem; color: var(--text-tertiary); }

	.empty { margin: 0; font-size: 0.875rem; color: var(--text-tertiary); }

	.state { padding: 48px 16px; text-align: center; color: var(--text-secondary); font-size: 0.9375rem; }
	.state p { margin: 0 0 6px; }
	.state__hint { font-size: 0.875rem; color: var(--text-tertiary); }
	.state a, .link { color: var(--text-brand); background: none; border: none; cursor: pointer; font: inherit; padding: 0; }
	.state--error { color: var(--text-danger); }

	.spinner {
		display: inline-block; width: 24px; height: 24px;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 600px) {
		.page { padding: 20px 16px 48px; }
		.ticket { padding: 12px; }
	}
</style>
