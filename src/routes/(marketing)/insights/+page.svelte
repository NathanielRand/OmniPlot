<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { INSIGHT_CATEGORIES } from '$lib/config';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	interface Post {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		category: string;
		tags: string[];
		coverImageUrl: string | null;
		author: string;
		readTimeMinutes: number;
		publishedAt: string | null;
	}

	interface Props { data: { posts: Post[] } }
	let { data }: Props = $props();

	const CATEGORY_BADGE: Record<string, 'brand' | 'lite' | 'success' | 'warning'> = {
		'ppf':         'brand',
		'window-tint': 'lite',
		'guides':      'success',
		'vehicles':    'warning',
	};

	const CATEGORY_LABEL: Record<string, string> = {
		'ppf':         'PPF',
		'window-tint': 'Window Tint',
		'guides':      'Guides',
		'vehicles':    'Vehicles',
	};

	// Derive filter state from URL search params so cross-links activate correctly
	const activeCategory = $derived(page.url.searchParams.get('category') ?? 'all');
	const activeTags     = $derived(new Set(page.url.searchParams.getAll('tag')));

	const allTags = $derived(
		[...new Set(data.posts.flatMap((p) => p.tags))].sort()
	);

	const filtered = $derived(
		data.posts.filter((p) => {
			const matchCat = activeCategory === 'all' || p.category === activeCategory;
			const matchTag = activeTags.size === 0 || p.tags.some((t) => activeTags.has(t));
			return matchCat && matchTag;
		})
	);

	function nav(params: URLSearchParams) {
		const qs = params.toString();
		goto(`/insights${qs ? '?' + qs : ''}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function setCategory(cat: string) {
		const params = new URLSearchParams(page.url.searchParams);
		if (cat === 'all') params.delete('category');
		else params.set('category', cat);
		nav(params);
	}

	function toggleTag(tag: string) {
		const params = new URLSearchParams(page.url.searchParams);
		const current = params.getAll('tag');
		params.delete('tag');
		const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
		next.forEach((t) => params.append('tag', t));
		nav(params);
	}

	function clearFilters() {
		goto('/insights', { replaceState: true, noScroll: true, keepFocus: true });
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const COVER_GRADIENT: Record<string, string> = {
		'ppf':         'linear-gradient(135deg, rgba(0,229,255,0.15) 0%, rgba(0,112,255,0.1) 100%)',
		'window-tint': 'linear-gradient(135deg, rgba(167,139,250,0.15) 0%, rgba(109,40,217,0.1) 100%)',
		'guides':      'linear-gradient(135deg, rgba(0,214,143,0.15) 0%, rgba(0,140,94,0.1) 100%)',
		'vehicles':    'linear-gradient(135deg, rgba(255,181,71,0.15) 0%, rgba(220,120,0,0.1) 100%)',
	};
</script>

<svelte:head>
	<title>OmniPlot Insights — PPF & Window Tint Industry Knowledge</title>
	<meta name="description" content="Guides, comparisons, and expert tips for PPF installers and window tint shops. Learn how to cut smarter and grow your business with OmniPlot." />
	<meta property="og:title" content="OmniPlot Insights" />
	<meta property="og:description" content="Industry knowledge for PPF installers and window tint shops." />
</svelte:head>

<!-- ─── Hero ──────────────────────────────────── -->
<section class="insights-hero">
	<div class="insights-hero__inner">
		<Badge variant="brand">Insights</Badge>
		<h1 class="insights-hero__title">Knowledge for the cutting edge</h1>
		<p class="insights-hero__sub">
			Guides, tips, and comparisons for PPF installers and window tint shops. Learn how to cut smarter, reduce waste, and grow your business.
		</p>
	</div>
</section>

<!-- ─── Filters ───────────────────────────────── -->
<div class="insights-filters">
	<div class="insights-filters__inner">
		<!-- Category tabs -->
		<div class="cat-tabs" role="tablist" aria-label="Filter by category">
			<button
				class="cat-tab"
				class:active={activeCategory === 'all'}
				role="tab"
				aria-selected={activeCategory === 'all'}
				onclick={() => setCategory('all')}
			>All</button>
			{#each INSIGHT_CATEGORIES as cat}
				<button
					class="cat-tab"
					class:active={activeCategory === cat.value}
					role="tab"
					aria-selected={activeCategory === cat.value}
					onclick={() => setCategory(cat.value)}
				>{cat.label}</button>
			{/each}
		</div>

		<!-- Tag chips -->
		{#if allTags.length > 0}
			<div class="tag-chips" aria-label="Filter by tag">
				{#each allTags as tag}
					<button
						class="tag-chip"
						class:active={activeTags.has(tag)}
						onclick={() => toggleTag(tag)}
					>{tag}</button>
				{/each}
				{#if activeTags.size > 0}
					<button class="tag-chip tag-chip--clear" onclick={clearFilters}>
						Clear filters
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- ─── Post grid ─────────────────────────────── -->
<section class="insights-grid-section">
	<div class="insights-grid-inner">
		{#if filtered.length === 0}
			<div class="insights-empty">
				<p>No posts yet in this category. Check back soon.</p>
				{#if activeCategory !== 'all' || activeTags.size > 0}
					<button class="insights-empty__reset" onclick={clearFilters}>
						Show all posts
					</button>
				{/if}
			</div>
		{:else}
			<div class="insights-grid">
				{#each filtered as post (post.id)}
					<a href="/insights/{post.slug}" class="post-card">
						<!-- Cover -->
						<div
							class="post-card__cover"
							style:background={post.coverImageUrl ? undefined : COVER_GRADIENT[post.category] ?? COVER_GRADIENT['guides']}
						>
							{#if post.coverImageUrl}
								<img src={post.coverImageUrl} alt="" class="post-card__cover-img" />
							{:else}
								<svg class="post-card__cover-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
									<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
								</svg>
							{/if}
						</div>

						<!-- Content -->
						<div class="post-card__body">
							<div class="post-card__meta">
								<Badge variant={CATEGORY_BADGE[post.category] ?? 'default'} size="sm">
									{CATEGORY_LABEL[post.category] ?? post.category}
								</Badge>
								<span class="post-card__read-time">{post.readTimeMinutes} min read</span>
							</div>
							<h2 class="post-card__title">{post.title}</h2>
							<p class="post-card__excerpt">{post.excerpt}</p>
						</div>

						<!-- Footer -->
						<div class="post-card__footer">
							<span class="post-card__date">{formatDate(post.publishedAt)}</span>
							<span class="post-card__cta">Read more →</span>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</section>

<!-- ─── Bottom CTA ────────────────────────────── -->
<section class="insights-cta">
	<div class="insights-cta__inner">
		<h2 class="insights-cta__title">Ready to cut smarter?</h2>
		<p class="insights-cta__sub">Join hundreds of PPF shops and tint installers using OmniPlot. No install. No lock-in. Start free in 30 seconds.</p>
		<div class="insights-cta__actions">
			<Button variant="primary" size="lg" href="/signup">Start free</Button>
			<Button variant="ghost" size="lg" href="/pricing">See pricing</Button>
		</div>
	</div>
</section>

<style>
	/* ─── Hero ─────────────────────────────────── */
	.insights-hero {
		padding: 72px 24px 48px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.insights-hero__inner {
		max-width: 680px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.insights-hero__title {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 800;
		line-height: 1.1;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.insights-hero__sub {
		font-size: 1.0625rem;
		color: var(--text-secondary);
		line-height: 1.7;
		max-width: 560px;
	}

	/* ─── Filters ──────────────────────────────── */
	.insights-filters {
		position: sticky;
		top: 60px;
		z-index: 10;
		background: var(--bg-base);
		border-bottom: 1px solid var(--border-subtle);
	}

	.insights-filters__inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 12px 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.cat-tabs {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.cat-tab {
		padding: 5px 14px;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius-full, 999px);
		border: 1px solid var(--border-subtle);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}

	.cat-tab:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.cat-tab.active {
		background: var(--color-brand);
		color: #000;
		border-color: transparent;
	}

	.tag-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.tag-chip {
		padding: 3px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: var(--font-mono);
		border-radius: var(--radius-full, 999px);
		border: 1px solid var(--border-subtle);
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}

	.tag-chip:hover { color: var(--text-primary); border-color: var(--border-default); }

	.tag-chip.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
		border-color: var(--border-default);
	}

	.tag-chip--clear {
		color: var(--color-danger);
		border-color: rgba(255,77,109,0.3);
	}

	.tag-chip--clear:hover { background: rgba(255,77,109,0.08); }

	/* ─── Grid ─────────────────────────────────── */
	.insights-grid-section { padding: 40px 24px 64px; }

	.insights-grid-inner {
		max-width: 1200px;
		margin: 0 auto;
	}

	.insights-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 24px;
	}

	/* ─── Post card ────────────────────────────── */
	.post-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
		text-decoration: none;
		transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
	}

	.post-card:hover {
		border-color: var(--border-default);
		box-shadow: 0 4px 24px rgba(0,0,0,0.12);
		transform: translateY(-2px);
	}

	.post-card__cover {
		height: 160px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		flex-shrink: 0;
	}

	.post-card__cover-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.post-card__cover-icon {
		color: var(--text-tertiary);
		opacity: 0.5;
	}

	.post-card__body {
		flex: 1;
		padding: 20px 20px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.post-card__meta {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.post-card__read-time {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
	}

	.post-card__title {
		font-family: var(--font-display);
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.35;
		letter-spacing: -0.01em;
	}

	.post-card__excerpt {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.post-card__footer {
		padding: 12px 20px 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid var(--border-subtle);
	}

	.post-card__date {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.post-card__cta {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-brand);
		transition: gap 0.12s;
	}

	/* ─── Empty state ──────────────────────────── */
	.insights-empty {
		padding: 64px 0;
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.9375rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}

	.insights-empty__reset {
		font-size: 0.875rem;
		color: var(--color-brand);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
	}

	/* ─── Bottom CTA ───────────────────────────── */
	.insights-cta {
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		padding: 64px 24px;
	}

	.insights-cta__inner {
		max-width: 600px;
		margin: 0 auto;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}

	.insights-cta__title {
		font-family: var(--font-display);
		font-size: 1.875rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.insights-cta__sub {
		font-size: 1rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.insights-cta__actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;
		margin-top: 8px;
	}

	/* ─── Responsive ───────────────────────────── */
	@media (max-width: 900px) {
		.insights-grid { grid-template-columns: repeat(2, 1fr); }
	}

	@media (max-width: 560px) {
		.insights-grid { grid-template-columns: 1fr; }
		.insights-hero { padding: 48px 20px 32px; }
	}
</style>
