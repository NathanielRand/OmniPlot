<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatDate } from '$lib/utils';
	import { onMount } from 'svelte';
	import { toastStore, confirmStore } from '$lib/stores';
	import { auth } from '$lib/firebase/client';
	import type { InsightPost, InsightCategory } from '$lib/types';

	const CATEGORY_BADGE: Record<InsightCategory, 'brand' | 'lite' | 'success' | 'warning'> = {
		'ppf':         'brand',
		'window-tint': 'lite',
		'guides':      'success',
		'vehicles':    'warning',
	};

	const CATEGORY_LABEL: Record<InsightCategory, string> = {
		'ppf':         'PPF',
		'window-tint': 'Window Tint',
		'guides':      'Guides',
		'vehicles':    'Vehicles',
	};

	let posts        = $state<InsightPost[]>([]);
	let loading      = $state(true);
	let error        = $state<string | null>(null);
	let filterStatus = $state<'all' | 'published' | 'draft'>('all');
	let search       = $state('');
	let deletingId   = $state<string | null>(null);

	async function authHeader(): Promise<Record<string, string>> {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	function deserializePosts(raw: Record<string, unknown>[]): InsightPost[] {
		return raw.map((p) => ({
			...(p as unknown as InsightPost),
			publishedAt: p.publishedAt ? new Date(p.publishedAt as string) : null,
			createdAt:   new Date(p.createdAt as string),
			updatedAt:   new Date(p.updatedAt as string),
		}));
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/insights', { headers: await authHeader() });
			if (!res.ok) throw new Error(await res.text());
			const { posts: raw } = await res.json();
			posts = deserializePosts(raw);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load insights';
		} finally {
			loading = false;
		}
	});

	const filtered = $derived(
		posts.filter((p) => {
			const mStatus = filterStatus === 'all' || p.status === filterStatus;
			const q       = search.toLowerCase();
			const mSearch = !q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q);
			return mStatus && mSearch;
		})
	);

	const counts = $derived({
		total:     posts.length,
		published: posts.filter((p) => p.status === 'published').length,
		draft:     posts.filter((p) => p.status === 'draft').length,
		views:     posts.reduce((sum, p) => sum + (p.viewCount ?? 0), 0),
	});

	async function togglePublish(post: InsightPost) {
		const next = post.status === 'published' ? 'draft' : 'published';
		const nowPublish = next === 'published';
		const publishedAt = nowPublish ? (post.publishedAt ?? new Date()).toISOString() : (post.publishedAt?.toISOString() ?? null);
		try {
			const res = await fetch(`/api/admin/insights/${post.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', ...await authHeader() },
				body: JSON.stringify({ status: next, publishedAt }),
			});
			if (!res.ok) throw new Error(await res.text());
			posts = posts.map((p) =>
				p.id === post.id
					? { ...p, status: next, publishedAt: nowPublish ? (post.publishedAt ?? new Date()) : post.publishedAt }
					: p
			);
			toastStore.success(nowPublish ? 'Post published' : 'Post moved to draft');
		} catch {
			toastStore.error('Failed to update post status');
		}
	}

	async function confirmDelete(post: InsightPost) {
		deletingId = post.id;
		const ok = await confirmStore.ask({
			title: `Delete "${post.title}"?`,
			message: 'This cannot be undone.',
			confirmLabel: 'Delete post',
			variant: 'danger',
		});
		if (!ok) {
			deletingId = null;
			return;
		}
		try {
			const res = await fetch(`/api/admin/insights/${post.id}`, {
				method: 'DELETE',
				headers: await authHeader(),
			});
			if (!res.ok) throw new Error(await res.text());
			posts = posts.filter((p) => p.id !== post.id);
			toastStore.success('Post deleted');
		} catch {
			toastStore.error('Failed to delete post');
		} finally {
			deletingId = null;
		}
	}
</script>

<div class="insights-admin">
	<!-- ─── Header ── -->
	<div class="insights-admin__header">
		<div>
			<h1 class="insights-admin__title">Insights</h1>
			<p class="insights-admin__sub">Manage blog posts and SEO content.</p>
		</div>
		<a href="/admin/insights/new" class="new-post-btn">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			New post
		</a>
	</div>

	<!-- ─── Stats ── -->
	<div class="stats-row">
		<button class="stat-chip" class:active={filterStatus === 'all'} onclick={() => { filterStatus = 'all'; }}>
			All <span class="stat-chip__count">{counts.total}</span>
		</button>
		<button class="stat-chip" class:active={filterStatus === 'published'} onclick={() => { filterStatus = 'published'; }}>
			Published <span class="stat-chip__count">{counts.published}</span>
		</button>
		<button class="stat-chip" class:active={filterStatus === 'draft'} onclick={() => { filterStatus = 'draft'; }}>
			Draft <span class="stat-chip__count">{counts.draft}</span>
		</button>
		<span class="stat-views">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
			{counts.views.toLocaleString()} total views
		</span>

		<div class="insights-admin__search-wrap">
			<svg class="insights-admin__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
			<input
				class="insights-admin__search"
				type="search"
				placeholder="Search posts…"
				bind:value={search}
				aria-label="Search posts"
			/>
		</div>
	</div>

	<!-- ─── Table ── -->
	{#if loading}
		<div class="insights-admin__loading" aria-live="polite">Loading…</div>
	{:else if error}
		<div class="insights-admin__error">{error}</div>
	{:else if filtered.length === 0}
		<div class="insights-admin__empty">
			{#if posts.length === 0}
				<p>No posts yet. <a href="/admin/insights/new">Create your first post →</a></p>
			{:else}
				<p>No posts match your filter.</p>
			{/if}
		</div>
	{:else}
		<div class="table-wrap">
			<table class="posts-table">
				<thead>
					<tr>
						<th>Title</th>
						<th>Category</th>
						<th>Status</th>
						<th>Views</th>
						<th>Tags</th>
						<th>Published</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as post (post.id)}
						<tr class:row--draft={post.status === 'draft'}>
							<td class="td-title">
								<a href="/admin/insights/{post.id}" class="post-link">{post.title}</a>
								<span class="post-excerpt">{post.excerpt.slice(0, 80)}{post.excerpt.length > 80 ? '…' : ''}</span>
							</td>
							<td>
								<Badge variant={CATEGORY_BADGE[post.category as InsightCategory] ?? 'default'} size="sm">
									{CATEGORY_LABEL[post.category as InsightCategory] ?? post.category}
								</Badge>
							</td>
							<td>
								<Badge variant={post.status === 'published' ? 'success' : 'default'} size="sm" dot>
									{post.status}
								</Badge>
							</td>
							<td class="td-views">
								<span class="view-count">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									{(post.viewCount ?? 0).toLocaleString()}
								</span>
							</td>
							<td class="td-tags">
								{#if post.tags.length > 0}
									<span class="tag-preview">{post.tags.slice(0, 2).join(', ')}{post.tags.length > 2 ? ` +${post.tags.length - 2}` : ''}</span>
								{:else}
									<span class="td-none">—</span>
								{/if}
							</td>
							<td class="td-date">
								{#if post.publishedAt}
									{formatDate(post.publishedAt)}
								{:else}
									<span class="td-none">—</span>
								{/if}
							</td>
							<td class="td-actions">
								<a href="/admin/insights/{post.id}" class="action-btn" title="Edit">
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
								</a>
								<button
									class="action-btn"
									class:action-btn--danger={post.status === 'published'}
									title={post.status === 'published' ? 'Unpublish' : 'Publish'}
									onclick={() => togglePublish(post)}
								>
									{#if post.status === 'published'}
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
									{:else}
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
									{/if}
								</button>
								<button
									class="action-btn action-btn--delete"
									title="Delete"
									disabled={deletingId === post.id}
									onclick={() => confirmDelete(post)}
								>
									<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.insights-admin { padding: 28px 32px; }

	.insights-admin__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 24px;
	}

	.insights-admin__title {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.insights-admin__sub {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin-top: 2px;
	}

	.new-post-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		background: var(--color-brand);
		color: #000;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: opacity 0.12s;
		flex-shrink: 0;
	}

	.new-post-btn:hover { opacity: 0.85; }

	/* ─── Stats row ─── */
	.stats-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}

	.stat-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: var(--radius-full, 999px);
		border: 1px solid var(--border-subtle);
		background: transparent;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}

	.stat-chip:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.stat-chip.active { background: var(--bg-surface-3); color: var(--text-primary); border-color: var(--border-default); }

	.stat-chip__count {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.stat-views {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		padding: 0 4px;
	}

	.insights-admin__search-wrap {
		position: relative;
		margin-left: auto;
	}

	.insights-admin__search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.insights-admin__search {
		height: 32px;
		padding: 0 10px 0 30px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--text-primary);
		width: 220px;
		transition: border-color 0.1s;
	}

	.insights-admin__search:focus {
		outline: none;
		border-color: var(--color-brand);
	}

	/* ─── Loading / error / empty ─── */
	.insights-admin__loading,
	.insights-admin__error,
	.insights-admin__empty {
		padding: 48px 0;
		text-align: center;
		font-size: 0.9375rem;
		color: var(--text-tertiary);
	}

	.insights-admin__error { color: var(--color-danger); }

	.insights-admin__empty a {
		color: var(--color-brand);
		text-decoration: underline;
	}

	/* ─── Table ─── */
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
	}

	.posts-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.posts-table th {
		padding: 10px 14px;
		text-align: left;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
		white-space: nowrap;
	}

	.posts-table td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
		color: var(--text-secondary);
	}

	.posts-table tr:last-child td { border-bottom: none; }

	.row--draft td { opacity: 0.7; }

	.td-title {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 240px;
	}

	.post-link {
		color: var(--text-primary);
		font-weight: 500;
		text-decoration: none;
		transition: color 0.1s;
	}

	.post-link:hover { color: var(--color-brand); }

	.post-excerpt {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.td-views { min-width: 72px; }
	.view-count {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
	}
	.td-tags { min-width: 100px; }
	.td-date { min-width: 110px; white-space: nowrap; font-family: var(--font-mono); }
	.td-none { color: var(--text-tertiary); }
	.tag-preview { font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-tertiary); }

	.td-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 100px;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: background 0.1s, color 0.1s;
	}

	.action-btn:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.action-btn--danger:hover { color: var(--color-warning); }
	.action-btn--delete:hover { color: var(--color-danger); background: rgba(255,77,109,0.08); }

	.action-btn:disabled { opacity: 0.4; cursor: default; }

	@media (max-width: 768px) {
		.insights-admin { padding: 20px 16px; }
	}
</style>
