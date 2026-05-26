<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { APP_URL } from '$lib/config';

	interface RelatedPost {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		category: string;
		coverImageUrl: string | null;
		readTimeMinutes: number;
		publishedAt: string | null;
	}

	interface Post {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		content: string;
		category: string;
		tags: string[];
		coverImageUrl: string | null;
		author: string;
		readTimeMinutes: number;
		metaTitle: string | null;
		metaDescription: string | null;
		publishedAt: string | null;
	}

	interface Props { data: { post: Post; related: RelatedPost[] } }
	let { data }: Props = $props();

	const { post, related } = $derived(data);

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

	// Per-category CTA config — headline, body, bullets, and UTM slug
	const CATEGORY_CTA: Record<string, {
		heading: string;
		body: string;
		bullets: string[];
		ref: string;
		signupLabel: string;
	}> = {
		'ppf': {
			heading:     'Cut PPF like a pro.',
			body:        'OmniPlot gives PPF shops browser-based cutting with professionally measured templates for every panel.',
			bullets:     ['12,400+ PPF patterns', 'Works with Roland, Graphtec & more', 'Auto-nesting saves film on every job'],
			ref:         'insight-ppf',
			signupLabel: 'Start cutting PPF free',
		},
		'window-tint': {
			heading:     'Maximize your tint film.',
			body:        'Every piece nested automatically. Every vehicle measured. Every plotter supported.',
			bullets:     ['Full window tint pattern library', 'Auto-nesting optimizer built in', 'Browser-based — no install ever'],
			ref:         'insight-tint',
			signupLabel: 'Start cutting tint free',
		},
		'guides': {
			heading:     'See it in action.',
			body:        'OmniPlot runs in any browser on any device. Plotter-agnostic, cloud-synced, and built for real shops.',
			bullets:     ['No install, no drivers, no lock-in', 'Any plotter via HPGL export', 'Free tier — no credit card needed'],
			ref:         'insight-guide',
			signupLabel: 'Try OmniPlot free',
		},
		'vehicles': {
			heading:     'Find your vehicle\'s patterns.',
			body:        'Professionally measured PPF and tint templates for every major make and model. New vehicles added weekly.',
			bullets:     ['PPF + tint zones in one library', 'Vehicle requests fulfilled in days', 'Works with your existing plotter'],
			ref:         'insight-vehicle',
			signupLabel: 'Search your vehicle free',
		},
	};

	const COVER_GRADIENT: Record<string, string> = {
		'ppf':         'linear-gradient(135deg, rgba(0,229,255,0.12) 0%, rgba(0,112,255,0.08) 100%)',
		'window-tint': 'linear-gradient(135deg, rgba(167,139,250,0.12) 0%, rgba(109,40,217,0.08) 100%)',
		'guides':      'linear-gradient(135deg, rgba(0,214,143,0.12) 0%, rgba(0,140,94,0.08) 100%)',
		'vehicles':    'linear-gradient(135deg, rgba(255,181,71,0.12) 0%, rgba(220,120,0,0.08) 100%)',
	};

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}

	const canonicalUrl   = $derived(`${APP_URL}/insights/${post.slug}`);
	const metaTitle      = $derived(post.metaTitle       ?? `${post.title} — OmniPlot Insights`);
	const metaDesc       = $derived(post.metaDescription ?? post.excerpt);
	const cta            = $derived(CATEGORY_CTA[post.category] ?? CATEGORY_CTA['guides']);
	const signupUrl      = $derived(`/signup?ref=${cta.ref}`);
	const badgeVariant   = $derived(CATEGORY_BADGE[post.category] ?? 'default');
	const categoryLabel  = $derived(CATEGORY_LABEL[post.category] ?? post.category);
</script>

<svelte:head>
	<title>{metaTitle}</title>
	<meta name="description" content={metaDesc} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:title"       content={metaTitle} />
	<meta property="og:description" content={metaDesc} />
	<meta property="og:url"         content={canonicalUrl} />
	<meta property="og:type"        content="article" />
	{#if post.coverImageUrl}
		<meta property="og:image" content={post.coverImageUrl} />
	{/if}
	<meta name="article:published_time" content={post.publishedAt ?? ''} />
</svelte:head>

<!-- ─── Breadcrumb ────────────────────────────── -->
<nav class="breadcrumb" aria-label="Breadcrumb">
	<div class="breadcrumb__inner">
		<a href="/insights" class="breadcrumb__link">Insights</a>
		<span class="breadcrumb__sep" aria-hidden="true">/</span>
		<a href="/insights?category={post.category}" class="breadcrumb__link">{categoryLabel}</a>
		<span class="breadcrumb__sep" aria-hidden="true">/</span>
		<span class="breadcrumb__current" aria-current="page">{post.title}</span>
	</div>
</nav>

<!-- ─── Article layout ───────────────────────── -->
<div class="article-layout">
	<div class="article-layout__inner">

		<!-- ─── Main column ── -->
		<article class="article-main">

			<!-- Hero header -->
			<header class="article-header">
				{#if post.coverImageUrl}
					<img src={post.coverImageUrl} alt="" class="article-header__cover" />
				{/if}
				<div class="article-header__meta">
					<Badge variant={badgeVariant}>{categoryLabel}</Badge>
					<span class="article-header__dot" aria-hidden="true">·</span>
					<span class="article-header__read-time">{post.readTimeMinutes} min read</span>
				</div>
				<h1 class="article-header__title">{post.title}</h1>
				<p class="article-header__excerpt">{post.excerpt}</p>
				<div class="article-header__byline">
					<span class="article-header__author">By {post.author}</span>
					{#if post.publishedAt}
						<span class="article-header__dot" aria-hidden="true">·</span>
						<time datetime={post.publishedAt} class="article-header__date">
							{formatDate(post.publishedAt)}
						</time>
					{/if}
				</div>
				{#if post.tags.length > 0}
					<div class="article-header__tags">
						{#each post.tags as tag}
							<a href="/insights?tag={tag}" class="article-tag">{tag}</a>
						{/each}
					</div>
				{/if}
			</header>

			<!-- Body content -->
			<div class="article-body prose">
				{@html post.content}
			</div>

			<!-- ─── Inline CTA (after article body) ── -->
			<div class="inline-cta">
				<div class="inline-cta__left">
					<p class="inline-cta__heading">{cta.heading}</p>
					<p class="inline-cta__body">{cta.body}</p>
					<ul class="inline-cta__bullets">
						{#each cta.bullets as bullet}
							<li>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
								{bullet}
							</li>
						{/each}
					</ul>
					<div class="inline-cta__actions">
						<Button variant="primary" size="sm" href={signupUrl}>{cta.signupLabel}</Button>
						<a href="/pricing" class="inline-cta__secondary">See pricing →</a>
					</div>
				</div>
			</div>

			<!-- ─── Continue reading ── -->
			{#if related.length > 0}
				<section class="continue-reading" aria-label="Continue reading">
					<h2 class="continue-reading__title">Continue reading</h2>
					<div class="continue-reading__grid">
						{#each related as rel (rel.id)}
							<a href="/insights/{rel.slug}" class="cr-card">
								<div
									class="cr-card__cover"
									style:background={rel.coverImageUrl ? undefined : COVER_GRADIENT[rel.category] ?? COVER_GRADIENT['guides']}
								>
									{#if rel.coverImageUrl}
										<img src={rel.coverImageUrl} alt="" class="cr-card__cover-img" />
									{:else}
										<svg class="cr-card__cover-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
											<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
										</svg>
									{/if}
								</div>
								<div class="cr-card__body">
									<div class="cr-card__meta">
										<Badge variant={CATEGORY_BADGE[rel.category] ?? 'default'} size="sm">
											{CATEGORY_LABEL[rel.category] ?? rel.category}
										</Badge>
										<span class="cr-card__read-time">{rel.readTimeMinutes} min</span>
									</div>
									<h3 class="cr-card__title">{rel.title}</h3>
									<p class="cr-card__excerpt">{rel.excerpt}</p>
								</div>
							</a>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Back link -->
			<a href="/insights" class="article-back">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
				Back to Insights
			</a>
		</article>

		<!-- ─── Sidebar ── -->
		<aside class="article-sidebar">

			<!-- Sticky signup CTA -->
			<div class="sidebar-cta">
				<div class="sidebar-cta__eyebrow">Try OmniPlot</div>
				<h3 class="sidebar-cta__title">Start cutting smarter</h3>
				<p class="sidebar-cta__body">Browser-based PPF & window tint cutting. Works with any plotter. No install ever.</p>
				<ul class="sidebar-cta__bullets">
					{#each cta.bullets as bullet}
						<li>
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
							{bullet}
						</li>
					{/each}
				</ul>
				<Button variant="primary" size="sm" href={signupUrl}>{cta.signupLabel}</Button>
				<a href="/pricing" class="sidebar-cta__pricing-link">See all plans →</a>
			</div>

			<!-- Related posts -->
			{#if related.length > 0}
				<div class="sidebar-related">
					<h3 class="sidebar-related__title">More in {categoryLabel}</h3>
					<div class="sidebar-related__list">
						{#each related as rel (rel.id)}
							<a href="/insights/{rel.slug}" class="related-post">
								<Badge variant={CATEGORY_BADGE[rel.category] ?? 'default'} size="sm">
									{CATEGORY_LABEL[rel.category] ?? rel.category}
								</Badge>
								<span class="related-post__title">{rel.title}</span>
								<span class="related-post__meta">{rel.readTimeMinutes} min read</span>
							</a>
						{/each}
					</div>
					<a href="/insights?category={post.category}" class="sidebar-related__more">
						See all {categoryLabel} articles →
					</a>
				</div>
			{/if}

		</aside>
	</div>
</div>

<!-- ─── Bottom CTA banner ─────────────────────── -->
<section class="bottom-cta">
	<div class="bottom-cta__inner">
		<div class="bottom-cta__text">
			<h2 class="bottom-cta__title">Ready to cut smarter?</h2>
			<p class="bottom-cta__sub">Join PPF shops and tint installers already using OmniPlot. Works with your plotter. Free to start.</p>
		</div>
		<div class="bottom-cta__actions">
			<Button variant="primary" size="lg" href={signupUrl}>{cta.signupLabel}</Button>
			<Button variant="ghost" size="lg" href="/pricing">See pricing</Button>
		</div>
	</div>
</section>

<style>
	/* ─── Breadcrumb ───────────────────────────── */
	.breadcrumb {
		border-bottom: 1px solid var(--border-subtle);
		padding: 12px 24px;
	}

	.breadcrumb__inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		flex-wrap: wrap;
	}

	.breadcrumb__link {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
	}

	.breadcrumb__link:hover { color: var(--text-primary); }
	.breadcrumb__sep        { opacity: 0.4; }
	.breadcrumb__current    {
		color: var(--text-primary);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 260px;
	}

	/* ─── Layout ───────────────────────────────── */
	.article-layout { padding: 48px 24px 64px; }

	.article-layout__inner {
		max-width: 1200px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1fr 300px;
		gap: 64px;
		align-items: start;
	}

	/* ─── Article header ───────────────────────── */
	.article-header {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 40px;
		padding-bottom: 32px;
		border-bottom: 1px solid var(--border-subtle);
	}

	.article-header__cover {
		width: 100%;
		max-height: 400px;
		object-fit: cover;
		border-radius: var(--radius-lg);
		margin-bottom: 8px;
	}

	.article-header__meta {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.article-header__dot     { color: var(--text-tertiary); }
	.article-header__read-time {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
	}

	.article-header__title {
		font-family: var(--font-display);
		font-size: clamp(1.625rem, 3.5vw, 2.5rem);
		font-weight: 800;
		line-height: 1.2;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}

	.article-header__excerpt {
		font-size: 1.0625rem;
		color: var(--text-secondary);
		line-height: 1.65;
	}

	.article-header__byline {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.article-header__author { font-weight: 500; }

	.article-header__tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.article-tag {
		padding: 2px 10px;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full, 999px);
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s, border-color 0.1s;
	}

	.article-tag:hover { color: var(--text-primary); border-color: var(--border-default); }

	/* ─── Prose body ───────────────────────────── */
	:global(.prose h1),
	:global(.prose h2),
	:global(.prose h3),
	:global(.prose h4) {
		font-family: var(--font-display);
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		margin: 2em 0 0.6em;
		line-height: 1.3;
	}
	:global(.prose h2) { font-size: 1.5rem; }
	:global(.prose h3) { font-size: 1.25rem; }
	:global(.prose p)  { font-size: 1rem; line-height: 1.75; color: var(--text-secondary); margin: 1em 0; }
	:global(.prose a)  { color: var(--color-brand); text-decoration: underline; text-underline-offset: 3px; }
	:global(.prose a:hover) { opacity: 0.8; }
	:global(.prose ul),
	:global(.prose ol) { padding-left: 1.5em; margin: 1em 0; display: flex; flex-direction: column; gap: 4px; }
	:global(.prose li) { font-size: 1rem; line-height: 1.7; color: var(--text-secondary); }
	:global(.prose blockquote) {
		border-left: 3px solid var(--color-brand);
		padding: 8px 0 8px 20px;
		margin: 24px 0;
		color: var(--text-secondary);
		font-style: italic;
	}
	:global(.prose code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		padding: 1px 5px;
		color: var(--color-brand);
	}
	:global(.prose pre) {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 20px;
		overflow-x: auto;
		margin: 20px 0;
	}
	:global(.prose pre code) { background: none; border: none; padding: 0; font-size: 0.875rem; color: var(--text-primary); }
	:global(.prose hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 32px 0; }
	:global(.prose img) { max-width: 100%; border-radius: var(--radius-md); margin: 20px 0; }
	:global(.prose strong) { color: var(--text-primary); font-weight: 600; }

	/* ─── Inline CTA ───────────────────────────── */
	.inline-cta {
		margin: 48px 0 40px;
		padding: 28px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-left: 3px solid var(--color-brand);
		border-radius: var(--radius-lg);
	}

	.inline-cta__heading {
		font-family: var(--font-display);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 6px;
	}

	.inline-cta__body {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		margin: 0 0 14px;
		line-height: 1.55;
	}

	.inline-cta__bullets {
		list-style: none;
		padding: 0;
		margin: 0 0 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.inline-cta__bullets li {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}

	.inline-cta__bullets li svg { color: var(--color-success); flex-shrink: 0; }

	.inline-cta__actions {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}

	.inline-cta__secondary {
		font-size: 0.875rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
	}

	.inline-cta__secondary:hover { color: var(--text-primary); }

	/* ─── Continue reading ─────────────────────── */
	.continue-reading {
		margin-top: 40px;
		padding-top: 40px;
		border-top: 1px solid var(--border-subtle);
	}

	.continue-reading__title {
		font-family: var(--font-display);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 20px;
		letter-spacing: -0.01em;
	}

	.continue-reading__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 16px;
	}

	.cr-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		overflow: hidden;
		text-decoration: none;
		transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
	}

	.cr-card:hover {
		border-color: var(--border-default);
		box-shadow: 0 4px 16px rgba(0,0,0,0.1);
		transform: translateY(-2px);
	}

	.cr-card__cover {
		height: 110px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		flex-shrink: 0;
	}

	.cr-card__cover-img  { width: 100%; height: 100%; object-fit: cover; }
	.cr-card__cover-icon { color: var(--text-tertiary); opacity: 0.4; }

	.cr-card__body { padding: 14px; display: flex; flex-direction: column; gap: 8px; }

	.cr-card__meta {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.cr-card__read-time { font-size: 0.6875rem; color: var(--text-tertiary); font-family: var(--font-mono); }

	.cr-card__title {
		font-family: var(--font-display);
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.35;
		letter-spacing: -0.01em;
	}

	.cr-card__excerpt {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.55;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* ─── Back link ────────────────────────────── */
	.article-back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.875rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
		margin-top: 32px;
	}

	.article-back:hover { color: var(--text-primary); }

	/* ─── Sidebar ──────────────────────────────── */
	.article-sidebar {
		position: sticky;
		top: 80px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.sidebar-cta {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.sidebar-cta__eyebrow {
		font-size: 0.6875rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-brand);
		font-weight: 600;
	}

	.sidebar-cta__title {
		font-family: var(--font-display);
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		margin: 0;
	}

	.sidebar-cta__body {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.sidebar-cta__bullets {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.sidebar-cta__bullets li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.sidebar-cta__bullets li svg { color: var(--color-success); flex-shrink: 0; }

	.sidebar-cta__pricing-link {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
	}

	.sidebar-cta__pricing-link:hover { color: var(--text-primary); }

	.sidebar-related__title {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-tertiary);
		font-weight: 600;
		margin-bottom: 10px;
	}

	.sidebar-related__list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.related-post {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: background 0.1s;
	}

	.related-post:hover { background: var(--interactive-hover); }

	.related-post__title {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.related-post__meta {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		font-family: var(--font-mono);
	}

	.sidebar-related__more {
		display: block;
		margin-top: 10px;
		padding: 0 12px;
		font-size: 0.8125rem;
		color: var(--color-brand);
		text-decoration: none;
		transition: opacity 0.1s;
	}

	.sidebar-related__more:hover { opacity: 0.8; }

	/* ─── Bottom CTA banner ────────────────────── */
	.bottom-cta {
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		padding: 56px 24px;
	}

	.bottom-cta__inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 32px;
		flex-wrap: wrap;
	}

	.bottom-cta__title {
		font-family: var(--font-display);
		font-size: 1.625rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.02em;
		margin: 0 0 6px;
	}

	.bottom-cta__sub {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		margin: 0;
		max-width: 480px;
		line-height: 1.6;
	}

	.bottom-cta__actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	/* ─── Responsive ───────────────────────────── */
	@media (max-width: 900px) {
		.article-layout__inner {
			grid-template-columns: 1fr;
			gap: 40px;
		}
		.article-sidebar { position: static; }
		.bottom-cta__inner { flex-direction: column; align-items: flex-start; }
	}

	@media (max-width: 560px) {
		.article-layout { padding: 32px 20px 48px; }
		.continue-reading__grid { grid-template-columns: 1fr; }
	}
</style>
