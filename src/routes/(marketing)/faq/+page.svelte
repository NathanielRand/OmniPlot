<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import { FAQ_ITEMS } from "$lib/config";

	let openItems = $state<Set<string>>(new Set());
	let search = $state("");

	function toggle(key: string) {
		const s = new Set(openItems);
		s.has(key) ? s.delete(key) : s.add(key);
		openItems = s;
	}

	const filtered = $derived(
		search.trim()
			? FAQ_ITEMS.map((cat) => ({
					...cat,
					items: cat.items.filter(
						(item) =>
							item.q
								.toLowerCase()
								.includes(search.toLowerCase()) ||
							item.a.toLowerCase().includes(search.toLowerCase()),
					),
				})).filter((cat) => cat.items.length > 0)
			: FAQ_ITEMS,
	);
</script>

<svelte:head>
	<title>FAQ — OmniPlot</title>
	<meta
		name="description"
		content="Frequently asked questions about OmniPlot PPF cutting software."
	/>
</svelte:head>

<div class="faq-page">
	<div class="faq-header">
		<Badge variant="default">FAQ</Badge>
		<h1 class="faq-title">Frequently asked questions</h1>
		<p class="faq-sub">
			Can't find what you're looking for? <a
				href="mailto:support@omniplot.app"
				class="faq-link">Email support →</a
			>
		</p>

		<div class="faq-search-wrap">
			<svg
				class="faq-search-icon"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
				><circle cx="11" cy="11" r="8" /><path
					d="M21 21l-4.35-4.35"
				/></svg
			>
			<input
				type="search"
				class="faq-search"
				placeholder="Search questions…"
				bind:value={search}
				aria-label="Search FAQ"
			/>
		</div>
	</div>

	<div class="faq-body">
		{#each filtered as category}
			<div class="faq-category">
				<h2 class="faq-category-title">{category.category}</h2>
				<div class="faq-list">
					{#each category.items as item}
						{@const key = `${category.category}::${item.q}`}
						{@const open = openItems.has(key)}
						<div class="faq-item" class:open>
							<button
								class="faq-item__btn"
								onclick={() => toggle(key)}
								aria-expanded={open}
								aria-controls="faq-answer-{key}"
							>
								<span class="faq-item__q">{item.q}</span>
								<span
									class="faq-item__chevron"
									aria-hidden="true"
								>
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M6 9l6 6 6-6" />
									</svg>
								</span>
							</button>
							{#if open}
								<div
									class="faq-item__answer"
									id="faq-answer-{key}"
									role="region"
								>
									<p class="faq-item__a">{item.a}</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}

		{#if filtered.length === 0}
			<div class="faq-empty">
				<p class="faq-empty__title">No results for "{search}"</p>
				<p class="faq-empty__sub">
					Try a different search or <a
						href="mailto:support@clearcut.app"
						class="faq-link">contact support</a
					>.
				</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.faq-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 64px 24px 80px;
	}

	.faq-header {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		margin-bottom: 48px;
	}

	.faq-title {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		letter-spacing: -0.03em;
		margin: 0;
	}
	.faq-sub {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.faq-link {
		color: var(--text-brand);
		text-decoration: none;
	}
	.faq-link:hover {
		text-decoration: underline;
	}

	.faq-search-wrap {
		position: relative;
		width: 100%;
		max-width: 420px;
		margin-top: 4px;
	}

	.faq-search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.faq-search {
		width: 100%;
		padding: 10px 14px 10px 36px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		font-size: 0.9375rem;
		font-family: var(--font-body);
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.12s;
	}

	.faq-search:focus {
		border-color: var(--color-brand-dim);
	}
	.faq-search::placeholder {
		color: var(--text-tertiary);
	}

	/* Body */
	.faq-body {
		display: flex;
		flex-direction: column;
		gap: 40px;
	}

	.faq-category-title {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 12px;
	}

	.faq-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.faq-item {
		border-bottom: 1px solid var(--border-subtle);
	}

	.faq-item:first-child {
		border-top: 1px solid var(--border-subtle);
	}

	.faq-item__btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		padding: 18px 0;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: color 0.12s;
	}

	.faq-item__btn:hover {
		color: var(--text-brand);
	}
	.faq-item.open .faq-item__btn {
		color: var(--text-brand);
	}

	.faq-item__q {
		font-size: 1rem;
		font-weight: 500;
		color: inherit;
		line-height: 1.4;
		flex: 1;
	}

	.faq-item__chevron {
		flex-shrink: 0;
		color: var(--text-tertiary);
		transition: transform 0.2s var(--ease-smooth);
	}

	.faq-item.open .faq-item__chevron {
		transform: rotate(180deg);
	}

	.faq-item__answer {
		padding-bottom: 18px;
		animation: slide-down 0.2s ease;
	}

	@keyframes slide-down {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.faq-item__a {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.7;
	}

	.faq-empty {
		text-align: center;
		padding: 48px 0;
		color: var(--text-tertiary);
	}

	.faq-empty__title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 6px;
	}
	.faq-empty__sub {
		font-size: 0.875rem;
	}
</style>
