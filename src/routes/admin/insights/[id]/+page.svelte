<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { toastStore } from '$lib/stores';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/firebase/client';
	import { INSIGHT_CATEGORIES } from '$lib/config';
	import type { InsightPost, InsightCategory } from '$lib/types';

	// ─── Route param ──────────────────────────────
	const postId   = $derived(page.params.id ?? '');
	const isNew    = $derived(postId === 'new');

	// ─── Form state ───────────────────────────────
	let title           = $state('');
	let slug            = $state('');
	let category        = $state<InsightCategory>('guides');
	let tagsInput       = $state('');
	let excerpt         = $state('');
	let content         = $state('');
	let coverImageUrl   = $state('');
	let author          = $state('OmniPlot');
	let metaTitle       = $state('');
	let metaDescription = $state('');

	// ─── UI state ─────────────────────────────────
	let loading      = $state(true);
	let saving       = $state(false);
	let activeTab    = $state<'write' | 'preview'>('write');
	let slugEdited   = $state(false);
	let existingPost = $state<InsightPost | null>(null);

	// ─── Read time (auto-calculated) ──────────────
	const readTimeMinutes = $derived(() => {
		const text = content.replace(/<[^>]+>/g, ' ');
		const words = text.trim().split(/\s+/).filter(Boolean).length;
		return Math.max(1, Math.ceil(words / 200));
	});

	// ─── Tags (parsed from comma-sep input) ───────
	const tags = $derived(
		tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
	);

	// ─── Slug auto-generation ─────────────────────
	function slugify(s: string): string {
		return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	$effect(() => {
		if (!slugEdited) {
			slug = slugify(title);
		}
	});

	async function authHeader() {
		const token = await auth.currentUser?.getIdToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	// ─── Load existing post ───────────────────────
	onMount(async () => {
		if (isNew) {
			loading = false;
			return;
		}
		try {
			const res = await fetch('/api/admin/insights', { headers: await authHeader() });
			if (!res.ok) throw new Error(await res.text());
			const { posts } = await res.json();
			const found = posts.find((p: { id: string }) => p.id === postId);
			if (!found) {
				toastStore.error('Post not found');
				goto('/admin/insights');
				return;
			}
			existingPost    = { ...found, publishedAt: found.publishedAt ? new Date(found.publishedAt) : null, createdAt: new Date(found.createdAt), updatedAt: new Date(found.updatedAt) };
			title           = found.title;
			slug            = found.slug;
			slugEdited      = true;
			category        = found.category;
			tagsInput       = found.tags.join(', ');
			excerpt         = found.excerpt;
			content         = found.content;
			coverImageUrl   = found.coverImageUrl ?? '';
			author          = found.author;
			metaTitle       = found.metaTitle ?? '';
			metaDescription = found.metaDescription ?? '';
		} catch {
			toastStore.error('Failed to load post');
		} finally {
			loading = false;
		}
	});

	// ─── Validation ───────────────────────────────
	function validate(): string | null {
		if (!title.trim())   return 'Title is required.';
		if (!slug.trim())    return 'Slug is required.';
		if (!excerpt.trim()) return 'Excerpt is required.';
		if (!content.trim()) return 'Content is required.';
		return null;
	}

	// ─── Save ─────────────────────────────────────
	async function save(publish: boolean) {
		const err = validate();
		if (err) { toastStore.error(err); return; }

		saving = true;
		try {
			const status = publish ? 'published' : 'draft';
			const data = {
				slug:            slug.trim(),
				title:           title.trim(),
				excerpt:         excerpt.trim(),
				content:         content.trim(),
				category,
				tags,
				status,
				coverImageUrl:   coverImageUrl.trim() || null,
				author:          author.trim() || 'OmniPlot',
				readTimeMinutes: readTimeMinutes(),
				metaTitle:       metaTitle.trim() || null,
				metaDescription: metaDescription.trim() || null,
				publishedAt: publish
					? (existingPost?.publishedAt ?? new Date())
					: (existingPost?.publishedAt ?? null),
			} satisfies Omit<InsightPost, 'id' | 'createdAt' | 'updatedAt'>;

			if (isNew) {
				const res = await fetch('/api/admin/insights', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...await authHeader() },
					body: JSON.stringify({ ...data, publishedAt: data.publishedAt instanceof Date ? data.publishedAt.toISOString() : data.publishedAt }),
				});
				if (!res.ok) throw new Error(await res.text());
				const { id: newId } = await res.json();
				toastStore.success(publish ? 'Post published' : 'Draft saved');
				goto(`/admin/insights/${newId}`);
			} else {
				const res = await fetch(`/api/admin/insights/${postId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', ...await authHeader() },
					body: JSON.stringify({ ...data, publishedAt: data.publishedAt instanceof Date ? data.publishedAt.toISOString() : data.publishedAt }),
				});
				if (!res.ok) throw new Error(await res.text());
				existingPost = existingPost
					? { ...existingPost, ...data, updatedAt: new Date() }
					: null;
				toastStore.success(publish ? 'Post published' : 'Draft saved');
			}
		} catch {
			toastStore.error('Failed to save post');
		} finally {
			saving = false;
		}
	}

	const CATEGORY_BADGE: Record<InsightCategory, 'brand' | 'lite' | 'success' | 'warning'> = {
		'ppf':         'brand',
		'window-tint': 'lite',
		'guides':      'success',
		'vehicles':    'warning',
	};

	const isPublished = $derived(existingPost?.status === 'published');
	const pageTitle   = $derived(isNew ? 'New post' : (title || 'Edit post'));
</script>

<div class="editor">
	<!-- ─── Header ── -->
	<div class="editor__header">
		<div class="editor__breadcrumb">
			<a href="/admin/insights" class="editor__breadcrumb-link">Insights</a>
			<span class="editor__breadcrumb-sep" aria-hidden="true">/</span>
			<span class="editor__breadcrumb-page">{pageTitle}</span>
		</div>
		<div class="editor__header-actions">
			{#if !isNew}
				<Badge variant={isPublished ? 'success' : 'default'} dot>
					{isPublished ? 'Published' : 'Draft'}
				</Badge>
				{#if isPublished}
					<a href="/insights/{slug}" target="_blank" rel="noopener" class="view-link">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
						View live
					</a>
				{/if}
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="editor__loading">Loading…</div>
	{:else}
		<div class="editor__body">
			<!-- ─── Main column ── -->
			<div class="editor__main">
				<!-- Title -->
				<div class="field">
					<input
						class="field__title-input"
						type="text"
						placeholder="Post title…"
						bind:value={title}
						aria-label="Post title"
					/>
				</div>

				<!-- Slug -->
				<div class="field field--row">
					<label class="field__label" for="slug">Slug</label>
					<div class="field__slug-wrap">
						<span class="field__slug-prefix">omniplot.app/insights/</span>
						<input
							id="slug"
							class="field__slug-input"
							type="text"
							bind:value={slug}
							oninput={() => { slugEdited = true; }}
							aria-label="URL slug"
						/>
					</div>
				</div>

				<!-- Excerpt -->
				<div class="field">
					<label class="field__label" for="excerpt">Excerpt <span class="field__hint">(shown in cards and meta description fallback)</span></label>
					<textarea
						id="excerpt"
						class="field__textarea field__textarea--sm"
						placeholder="A short summary of this post…"
						rows="2"
						bind:value={excerpt}
					></textarea>
				</div>

				<!-- Content + preview tabs -->
				<div class="field">
					<div class="tab-row">
						<button
							class="tab-btn"
							class:active={activeTab === 'write'}
							onclick={() => { activeTab = 'write'; }}
						>Write (HTML)</button>
						<button
							class="tab-btn"
							class:active={activeTab === 'preview'}
							onclick={() => { activeTab = 'preview'; }}
						>Preview</button>
						<span class="field__hint tab-row__read-time">{readTimeMinutes()} min read</span>
					</div>

					{#if activeTab === 'write'}
						<textarea
							class="field__textarea field__textarea--content"
							placeholder="<p>Write your article content in HTML…</p>"
							rows="24"
							bind:value={content}
							aria-label="Article content (HTML)"
						></textarea>
					{:else}
						<div class="content-preview prose">
							{#if content.trim()}
								{@html content}
							{:else}
								<p class="preview-empty">Nothing to preview yet. Switch to Write and add content.</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- SEO overrides -->
				<details class="seo-section">
					<summary class="seo-section__toggle">SEO overrides (optional)</summary>
					<div class="seo-section__fields">
						<div class="field">
							<label class="field__label" for="meta-title">Meta title <span class="field__hint">(leave blank to use post title)</span></label>
							<input id="meta-title" class="field__input" type="text" placeholder="Custom page title for search engines…" bind:value={metaTitle} />
						</div>
						<div class="field">
							<label class="field__label" for="meta-desc">Meta description <span class="field__hint">(leave blank to use excerpt)</span></label>
							<textarea id="meta-desc" class="field__textarea field__textarea--sm" rows="2" placeholder="Custom description for search results…" bind:value={metaDescription}></textarea>
						</div>
					</div>
				</details>
			</div>

			<!-- ─── Sidebar ── -->
			<aside class="editor__sidebar">
				<!-- Stats card (existing posts only) -->
				{#if !isNew && existingPost}
					<div class="sidebar-card sidebar-card--stats">
						<h3 class="sidebar-card__title">Stats</h3>
						<div class="sidebar-stat">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
							<span class="sidebar-stat__value">{(existingPost.viewCount ?? 0).toLocaleString()}</span>
							<span class="sidebar-stat__label">views</span>
						</div>
					</div>
				{/if}

			<!-- Publish card -->
				<div class="sidebar-card">
					<h3 class="sidebar-card__title">Publish</h3>
					<div class="sidebar-card__actions">
						<Button variant="secondary" size="sm" onclick={() => save(false)} disabled={saving}>
							{saving ? 'Saving…' : 'Save draft'}
						</Button>
						<Button variant="primary" size="sm" onclick={() => save(true)} disabled={saving}>
							{saving ? 'Saving…' : isPublished ? 'Update' : 'Publish'}
						</Button>
					</div>
					{#if !isNew && isPublished}
						<button
							class="sidebar-card__unpublish"
							onclick={() => save(false)}
							disabled={saving}
						>Move to draft</button>
					{/if}
				</div>

				<!-- Category -->
				<div class="sidebar-card">
					<h3 class="sidebar-card__title">Category</h3>
					<div class="cat-select-group">
						{#each INSIGHT_CATEGORIES as cat}
							<label class="cat-option" class:selected={category === cat.value}>
								<input type="radio" name="category" value={cat.value} bind:group={category} class="sr-only" />
								<Badge variant={CATEGORY_BADGE[cat.value]} size="sm">{cat.label}</Badge>
							</label>
						{/each}
					</div>
				</div>

				<!-- Tags -->
				<div class="sidebar-card">
					<h3 class="sidebar-card__title">Tags</h3>
					<input
						class="field__input"
						type="text"
						placeholder="ppf, film, roland…"
						bind:value={tagsInput}
						aria-label="Tags (comma-separated)"
					/>
					{#if tags.length > 0}
						<div class="tag-chips">
							{#each tags as tag}
								<span class="tag-chip">{tag}</span>
							{/each}
						</div>
					{/if}
					<p class="field__hint">Comma-separated. Used for filtering.</p>
				</div>

				<!-- Author & Cover -->
				<div class="sidebar-card">
					<h3 class="sidebar-card__title">Details</h3>
					<div class="field">
						<label class="field__label" for="author">Author</label>
						<input id="author" class="field__input" type="text" bind:value={author} placeholder="OmniPlot" />
					</div>
					<div class="field">
						<label class="field__label" for="cover">Cover image URL</label>
						<input id="cover" class="field__input" type="url" bind:value={coverImageUrl} placeholder="https://…" />
						{#if coverImageUrl}
							<img src={coverImageUrl} alt="Cover preview" class="cover-preview" />
						{/if}
					</div>
				</div>
			</aside>
		</div>
	{/if}
</div>

<style>
	.editor { padding: 24px 32px; }

	/* ─── Header ─── */
	.editor__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 24px;
	}

	.editor__breadcrumb {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.editor__breadcrumb-link {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
	}

	.editor__breadcrumb-link:hover { color: var(--text-primary); }
	.editor__breadcrumb-sep        { opacity: 0.4; }
	.editor__breadcrumb-page       { color: var(--text-primary); font-weight: 500; }

	.editor__header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.view-link {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.1s;
	}

	.view-link:hover { color: var(--color-brand); }

	.editor__loading {
		padding: 64px 0;
		text-align: center;
		color: var(--text-tertiary);
	}

	/* ─── Body layout ─── */
	.editor__body {
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 32px;
		align-items: start;
	}

	.editor__main {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	/* ─── Fields ─── */
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field--row {
		flex-direction: column;
	}

	.field__label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.field__hint {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.field__title-input {
		width: 100%;
		font-family: var(--font-display);
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--text-primary);
		background: transparent;
		border: none;
		border-bottom: 2px solid var(--border-subtle);
		padding: 8px 0;
		outline: none;
		transition: border-color 0.15s;
		letter-spacing: -0.02em;
	}

	.field__title-input:focus { border-bottom-color: var(--color-brand); }
	.field__title-input::placeholder { color: var(--text-tertiary); }

	.field__slug-wrap {
		display: flex;
		align-items: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color 0.1s;
	}

	.field__slug-wrap:focus-within { border-color: var(--color-brand); }

	.field__slug-prefix {
		padding: 7px 10px;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		background: var(--bg-surface-3);
		border-right: 1px solid var(--border-subtle);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.field__slug-input {
		flex: 1;
		padding: 7px 10px;
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: var(--text-primary);
		background: transparent;
		border: none;
		outline: none;
		min-width: 0;
	}

	.field__input {
		width: 100%;
		padding: 7px 10px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.1s;
	}

	.field__input:focus { border-color: var(--color-brand); }

	.field__textarea {
		width: 100%;
		padding: 10px 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		resize: vertical;
		line-height: 1.6;
		transition: border-color 0.1s;
	}

	.field__textarea:focus { border-color: var(--color-brand); }

	.field__textarea--sm     { min-height: 64px; }
	.field__textarea--content {
		min-height: 520px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.7;
	}

	/* ─── Write/Preview tabs ─── */
	.tab-row {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 8px;
	}

	.tab-btn {
		padding: 5px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}

	.tab-btn:hover  { background: var(--interactive-hover); color: var(--text-primary); }
	.tab-btn.active { background: var(--bg-surface-3); color: var(--text-primary); border-color: var(--border-default); }

	.tab-row__read-time { margin-left: auto; }

	.content-preview {
		min-height: 520px;
		padding: 20px 24px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.preview-empty { color: var(--text-tertiary); font-size: 0.875rem; }

	/* ─── Prose (reuse from public page) ─── */
	:global(.content-preview h1),
	:global(.content-preview h2),
	:global(.content-preview h3) {
		font-family: var(--font-display); font-weight: 700; color: var(--text-primary);
		letter-spacing: -0.01em; margin: 1.5em 0 0.5em; line-height: 1.3;
	}
	:global(.content-preview h2) { font-size: 1.375rem; }
	:global(.content-preview h3) { font-size: 1.125rem; }
	:global(.content-preview p)  { font-size: 0.9375rem; line-height: 1.7; color: var(--text-secondary); margin: 0.75em 0; }
	:global(.content-preview a)  { color: var(--color-brand); }
	:global(.content-preview ul),
	:global(.content-preview ol) { padding-left: 1.5em; margin: 0.75em 0; }
	:global(.content-preview li) { color: var(--text-secondary); line-height: 1.65; }
	:global(.content-preview strong) { color: var(--text-primary); }
	:global(.content-preview code) {
		font-family: var(--font-mono); font-size: 0.875em;
		background: var(--bg-surface-3); border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm); padding: 1px 5px; color: var(--color-brand);
	}

	/* ─── SEO section ─── */
	.seo-section {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.seo-section__toggle {
		padding: 12px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		list-style: none;
	}

	.seo-section__toggle::-webkit-details-marker { display: none; }
	.seo-section__toggle::before { content: '▸ '; color: var(--text-tertiary); }
	details[open] .seo-section__toggle::before { content: '▾ '; }

	.seo-section__fields {
		padding: 0 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	/* ─── Sidebar ─── */
	.editor__sidebar {
		position: sticky;
		top: 80px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.sidebar-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sidebar-card__title {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		font-weight: 600;
	}

	.sidebar-card--stats { gap: 8px; }

	.sidebar-stat {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-tertiary);
	}

	.sidebar-stat__value {
		font-family: var(--font-mono);
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.sidebar-stat__label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.sidebar-card__actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.sidebar-card__unpublish {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		text-align: left;
		transition: color 0.1s;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.sidebar-card__unpublish:hover { color: var(--color-warning); }

	/* ─── Category radio group ─── */
	.cat-select-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.cat-option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: 1px solid transparent;
		transition: background 0.1s, border-color 0.1s;
	}

	.cat-option:hover  { background: var(--interactive-hover); }
	.cat-option.selected { background: var(--bg-surface-3); border-color: var(--border-default); }

	.sr-only {
		position: absolute; width: 1px; height: 1px;
		padding: 0; margin: -1px; overflow: hidden;
		clip: rect(0,0,0,0); white-space: nowrap; border: 0;
	}

	/* ─── Tag chips ─── */
	.tag-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.tag-chip {
		padding: 2px 8px;
		font-size: 0.6875rem;
		font-family: var(--font-mono);
		background: var(--bg-surface-3);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full, 999px);
		color: var(--text-secondary);
	}

	.cover-preview {
		width: 100%;
		height: 100px;
		object-fit: cover;
		border-radius: var(--radius-md);
		margin-top: 4px;
	}

	@media (max-width: 900px) {
		.editor__body { grid-template-columns: 1fr; }
		.editor__sidebar { position: static; }
	}

	@media (max-width: 768px) {
		.editor { padding: 20px 16px; }
	}
</style>
