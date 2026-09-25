<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { auth } from '$lib/firebase/client';
	import { supportStore } from '$lib/stores';
	import {
		PRIORITY_LABEL,
		STATUS_LABEL_ADMIN,
		STATUS_VARIANT,
		TOPIC_LABEL,
		needsAdminAction,
		ticketRef,
		timeAgo,
		type Ticket,
		type TicketStatus,
	} from '$lib/support/tickets';

	type Row = Omit<Ticket, 'messages'> & { messageCount: number; preview: string; lastFrom: string; unread: boolean };
	type View = 'needs_reply' | TicketStatus | 'all';

	const VIEWS: { id: View; label: string; match: (t: Row) => boolean }[] = [
		{ id: 'needs_reply',       label: 'Needs reply',       match: (t) => needsAdminAction(t) },
		{ id: 'awaiting_customer', label: 'Awaiting customer', match: (t) => t.status === 'awaiting_customer' },
		{ id: 'resolved',          label: 'Resolved',          match: (t) => t.status === 'resolved' },
		{ id: 'closed',            label: 'Closed',            match: (t) => t.status === 'closed' },
		{ id: 'all',               label: 'All',               match: () => true },
	];

	const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 } as const;

	let tickets = $state<Row[]>([]);
	let loading = $state(true);
	let query = $state('');

	const view = $derived<View>(
		VIEWS.some((v) => v.id === page.url.searchParams.get('view')) ? (page.url.searchParams.get('view') as View) : 'needs_reply',
	);

	const filtered = $derived.by(() => {
		const v = VIEWS.find((x) => x.id === view)!;
		const q = query.trim().toLowerCase();
		const rows = tickets.filter(
			(t) =>
				v.match(t) &&
				(!q ||
					t.subject.toLowerCase().includes(q) ||
					t.email.toLowerCase().includes(q) ||
					t.name.toLowerCase().includes(q) ||
					ticketRef(t.id).toLowerCase().includes(q.replace(/^#?/, '#')) ||
					t.tags.some((tag) => tag.includes(q))),
		);
		// The reply queue is worked urgent-first, then longest-waiting first;
		// every other view is plain most-recent activity.
		if (view === 'needs_reply') {
			return rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.awaitingSince - b.awaitingSince);
		}
		return rows;
	});

	const stats = $derived({
		needsReply: tickets.filter(needsAdminAction).length,
		urgent:     tickets.filter((t) => needsAdminAction(t) && t.priority === 'urgent').length,
		awaiting:   tickets.filter((t) => t.status === 'awaiting_customer').length,
		overdue:    tickets.filter((t) => needsAdminAction(t) && Date.now() - t.awaitingSince > 24 * 3600_000).length,
	});

	async function load() {
		loading = true;
		try {
			const token = await auth.currentUser?.getIdToken();
			const res = await fetch('/api/admin/support', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
			if (res.ok) tickets = (await res.json()).tickets ?? [];
			supportStore.refreshAdmin();
		} finally {
			loading = false;
		}
	}

	function setView(id: View) {
		const url = new URL(page.url);
		url.searchParams.set('view', id);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function waiting(t: Row): string {
		const h = Math.floor((Date.now() - t.awaitingSince) / 3600_000);
		return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
	}

	onMount(load);
</script>

<svelte:head><title>Support — OmniPlot Admin</title></svelte:head>

<div class="page">
	<div class="page__header">
		<div>
			<h1 class="page__title">Support</h1>
			<p class="page__sub">Customer conversations. Anything waiting over 24h is overdue.</p>
		</div>
		<button class="btn-refresh" onclick={load} disabled={loading}>Refresh</button>
	</div>

	<div class="stats-row">
		<button class="stat-card" onclick={() => setView('needs_reply')}>
			<div class="stat-card__value">{stats.needsReply}</div>
			<div class="stat-card__label">Needs reply</div>
		</button>
		<button class="stat-card" class:stat-card--danger={stats.urgent > 0} onclick={() => setView('needs_reply')}>
			<div class="stat-card__value">{stats.urgent}</div>
			<div class="stat-card__label">Urgent</div>
		</button>
		<button class="stat-card" class:stat-card--warning={stats.overdue > 0} onclick={() => setView('needs_reply')}>
			<div class="stat-card__value">{stats.overdue}</div>
			<div class="stat-card__label">Overdue (&gt;24h)</div>
		</button>
		<button class="stat-card" onclick={() => setView('awaiting_customer')}>
			<div class="stat-card__value">{stats.awaiting}</div>
			<div class="stat-card__label">Awaiting customer</div>
		</button>
	</div>

	<div class="toolbar">
		<div class="filter-tabs" role="tablist">
			{#each VIEWS as v}
				<button role="tab" class="filter-tab" class:filter-tab--active={view === v.id} aria-selected={view === v.id} onclick={() => setView(v.id)}>
					{v.label}
					{#if v.id !== 'all'}<span class="filter-tab__count">{tickets.filter(v.match).length}</span>{/if}
				</button>
			{/each}
		</div>
		<input class="search" type="search" placeholder="Search subject, email, #ref, tag…" bind:value={query} />
	</div>

	{#if loading && tickets.length === 0}
		<div class="state"><span class="spinner" aria-label="Loading…"></span></div>
	{:else if filtered.length === 0}
		<div class="state">{view === 'needs_reply' && !query ? 'Inbox zero — nothing waiting on a reply.' : 'No tickets match.'}</div>
	{:else}
		<ul class="list">
			{#each filtered as t (t.id)}
				<li>
					<a class="row" class:row--unread={t.unread} href="/admin/support/{t.id}">
						<span class="row__prio row__prio--{t.priority}" title="{PRIORITY_LABEL[t.priority]} priority"></span>
						<span class="row__main">
							<span class="row__line">
								<span class="row__subject">{t.subject}</span>
								{#if t.unread}<span class="row__new">new reply</span>{/if}
							</span>
							<span class="row__preview">{t.lastFrom === 'admin' ? 'You: ' : ''}{t.preview}</span>
							<span class="row__meta">
								{ticketRef(t.id)} · {t.name || t.email} · {t.tier ?? 'guest'} · {TOPIC_LABEL[t.topic] ?? t.topic}
								{#each t.tags.slice(0, 3) as tag}<span class="tag">{tag}</span>{/each}
							</span>
						</span>
						<span class="row__side">
							<Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL_ADMIN[t.status]}</Badge>
							<span class="row__time">
								{#if needsAdminAction(t)}
									<span class:overdue={Date.now() - t.awaitingSince > 24 * 3600_000}>waiting {waiting(t)}</span>
								{:else}
									{timeAgo(t.lastActivityAt)}
								{/if}
							</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page { padding: 28px; max-width: 1000px; margin: 0 auto; }
	.page__header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
	.page__title { font-size: 1.375rem; font-weight: 700; margin-bottom: 4px; }
	.page__sub { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }

	.btn-refresh {
		padding: 7px 14px; border-radius: var(--radius-md);
		border: 1px solid var(--border-default); background: transparent;
		color: var(--text-secondary); font-size: 0.8125rem; font-family: var(--font-body); cursor: pointer;
	}
	.btn-refresh:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }

	.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
	.stat-card {
		text-align: left; cursor: pointer; font-family: var(--font-body); color: inherit;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-lg); padding: 16px 20px;
		transition: border-color 0.12s;
	}
	.stat-card:hover { border-color: var(--border-strong); }
	.stat-card--danger  { border-color: color-mix(in srgb, var(--color-danger) 50%, transparent); }
	.stat-card--warning { border-color: color-mix(in srgb, var(--color-warning) 50%, transparent); }
	.stat-card--danger .stat-card__value  { color: var(--text-danger); }
	.stat-card--warning .stat-card__value { color: var(--text-warning); }
	.stat-card__value { font-size: 1.5rem; font-weight: 700; font-family: var(--font-display); margin-bottom: 2px; }
	.stat-card__label { font-size: 0.8125rem; color: var(--text-tertiary); }

	.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
	.filter-tabs {
		display: flex; gap: 2px; flex-wrap: wrap;
		background: var(--bg-surface-2); border: 1px solid var(--border-default);
		border-radius: var(--radius-md); padding: 3px;
	}
	.filter-tab {
		display: flex; align-items: center; gap: 5px;
		padding: 5px 12px; border-radius: 5px; border: none; background: transparent;
		color: var(--text-secondary); font-size: 0.8125rem; font-weight: 500; font-family: var(--font-body);
		cursor: pointer; transition: all 0.12s;
	}
	.filter-tab:hover { color: var(--text-primary); }
	.filter-tab--active { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
	.filter-tab__count {
		font-size: 0.6875rem; font-weight: 600; background: var(--bg-surface-3); color: var(--text-tertiary);
		padding: 1px 5px; border-radius: 99px; min-width: 18px; text-align: center;
	}
	.search {
		flex: 1; min-width: 200px; max-width: 320px;
		padding: 7px 12px; border-radius: var(--radius-md);
		border: 1px solid var(--border-default); background: var(--bg-surface);
		color: var(--text-primary); font-size: 0.8125rem; font-family: var(--font-body);
	}
	.search:focus { outline: none; border-color: var(--color-brand-dim); }

	.list {
		list-style: none; margin: 0; padding: 0;
		border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden;
	}
	.list li + li { border-top: 1px solid var(--border-subtle); }

	.row {
		display: flex; align-items: flex-start; gap: 12px;
		padding: 14px 16px; background: var(--bg-surface-2);
		text-decoration: none; color: inherit; transition: background 0.1s;
	}
	.row:hover { background: var(--interactive-hover); }
	.row--unread { background: var(--bg-surface); }
	.row--unread .row__subject { font-weight: 700; }

	.row__prio { width: 4px; align-self: stretch; border-radius: 2px; flex-shrink: 0; background: transparent; }
	.row__prio--high   { background: var(--color-warning); }
	.row__prio--urgent { background: var(--color-danger); }

	.row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.row__line { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.row__subject { font-size: 0.875rem; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.row__new {
		flex-shrink: 0; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
		padding: 1px 6px; border-radius: 99px; background: var(--color-warning); color: #000;
	}
	.row__preview { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.row__meta { font-size: 0.75rem; color: var(--text-tertiary); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
	.tag {
		font-family: var(--font-mono); font-size: 0.625rem; padding: 1px 6px; border-radius: 99px;
		background: var(--bg-surface-3); border: 1px solid var(--border-default); color: var(--text-secondary);
	}

	.row__side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
	.row__time { font-size: 0.75rem; color: var(--text-tertiary); white-space: nowrap; }
	.overdue { color: var(--text-danger); font-weight: 600; }

	.state { padding: 48px 16px; text-align: center; color: var(--text-tertiary); font-size: 0.9375rem; }
	.spinner {
		display: inline-block; width: 24px; height: 24px;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 768px) {
		.page { padding: 20px 16px; }
		.stats-row { grid-template-columns: repeat(2, 1fr); }
		.search { max-width: none; }
	}
	@media (max-width: 480px) {
		.row { flex-wrap: wrap; }
		.row__side { flex-direction: row; align-items: center; width: 100%; justify-content: space-between; padding-left: 16px; }
	}
</style>
