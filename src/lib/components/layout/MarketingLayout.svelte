<script lang="ts">
	import type { Snippet } from "svelte";
	import Logo from "$lib/components/ui/Logo.svelte";
	import ThemeToggle from "$lib/components/ui/ThemeToggle.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { MARKETING_NAV } from "$lib/config";
	import { page } from "$app/state";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	let mobileMenuOpen = $state(false);
	const currentPath = $derived(page.url.pathname);
</script>

<div class="marketing-shell">
	<!-- ─── Header ─── -->
	<header class="mkt-header">
		<div class="mkt-header__inner">
			<Logo size={30} />

			<nav class="mkt-header__nav" aria-label="Marketing navigation">
				{#each MARKETING_NAV as item}
					<a
						href={item.href}
						class="mkt-nav-link"
						class:active={currentPath === item.href}>{item.label}</a
					>
				{/each}
			</nav>

			<div class="mkt-header__actions">
				<ThemeToggle />
				<Button variant="ghost" size="sm" href="/login">Sign in</Button>
				<Button variant="primary" size="sm" href="/signup"
					>Start free</Button
				>
			</div>

			<button
				class="mkt-header__hamburger"
				onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
				aria-label="Toggle menu"
				aria-expanded={mobileMenuOpen}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					{#if mobileMenuOpen}
						<path d="M18 6L6 18M6 6l12 12" />
					{:else}
						<path d="M3 12h18M3 6h18M3 18h18" />
					{/if}
				</svg>
			</button>
		</div>

		<!-- Mobile menu -->
		{#if mobileMenuOpen}
			<div class="mkt-mobile-menu animate-slide-down">
				{#each MARKETING_NAV as item}
					<a
						href={item.href}
						class="mkt-mobile-link"
						onclick={() => (mobileMenuOpen = false)}
					>
						{item.label}
					</a>
				{/each}
				<div class="mkt-mobile-actions">
					<Button variant="secondary" size="sm" href="/login"
						>Sign in</Button
					>
					<Button variant="primary" size="sm" href="/signup"
						>Start free</Button
					>
				</div>
			</div>
		{/if}
	</header>

	<!-- ─── Content ─── -->
	<main class="mkt-main">
		{@render children()}
	</main>

	<!-- ─── Footer ─── -->
	<footer class="mkt-footer">
		<div class="mkt-footer__inner">
			<div class="mkt-footer__brand">
				<Logo size={26} />
				<p class="mkt-footer__tagline">
					Professional PPF cutting software.<br />No install required.
				</p>
			</div>

			<div class="mkt-footer__links">
				<div class="mkt-footer__col">
					<h4 class="mkt-footer__col-title">Product</h4>
					<a href="/#features" class="mkt-footer__link">Features</a>
					<a href="/pricing" class="mkt-footer__link">Pricing</a>
					<a href="/changelog" class="mkt-footer__link">Changelog</a>
					<a href="/faq" class="mkt-footer__link">FAQ</a>
				</div>
				<div class="mkt-footer__col">
					<h4 class="mkt-footer__col-title">Company</h4>
					<a href="/about" class="mkt-footer__link">About</a>
					<a href="/support" class="mkt-footer__link">Support</a>
					<a href="/privacy" class="mkt-footer__link">Privacy</a>
					<a href="/terms" class="mkt-footer__link">Terms</a>
				</div>
				<div class="mkt-footer__col">
					<h4 class="mkt-footer__col-title">Compare</h4>
					<a href="/#vs-yink" class="mkt-footer__link">vs YINK</a>
					<a href="/#vs-digitcut" class="mkt-footer__link"
						>vs DigitCut</a
					>
					<a href="/#vs-procut" class="mkt-footer__link">vs ProCut</a>
				</div>
			</div>
		</div>

		<div class="mkt-footer__bottom">
			<p class="mkt-footer__copy">
				© {new Date().getFullYear()} OmniPlot. All rights reserved.
			</p>
			<div class="mkt-footer__bottom-links">
				<a href="/privacy" class="mkt-footer__link">Privacy</a>
				<a href="/terms" class="mkt-footer__link">Terms</a>
			</div>
		</div>
	</footer>
</div>

<style>
	.marketing-shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.mkt-header {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(var(--bg-surface), 0.85);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}

	.mkt-header__inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
		height: 60px;
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.mkt-header__nav {
		display: flex;
		gap: 4px;
		flex: 1;
		margin-left: 24px;
	}

	.mkt-nav-link {
		padding: 5px 12px;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition:
			background 0.12s,
			color 0.12s;
	}

	.mkt-nav-link:hover {
		color: var(--text-primary);
		background: var(--interactive-hover);
	}
	.mkt-nav-link.active {
		color: var(--text-primary);
	}

	.mkt-header__actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}

	.mkt-header__hamburger {
		display: none;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-default);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.mkt-mobile-menu {
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		padding: 16px 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.mkt-mobile-link {
		padding: 10px 12px;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--text-secondary);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition: background 0.12s;
	}

	.mkt-mobile-link:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	.mkt-mobile-actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--border-subtle);
	}

	/* Main */
	.mkt-main {
		flex: 1;
	}

	/* Footer */
	.mkt-footer {
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
		margin-top: auto;
	}

	.mkt-footer__inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 48px 24px 32px;
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: 48px;
	}

	.mkt-footer__tagline {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin-top: 12px;
		line-height: 1.6;
	}

	.mkt-footer__links {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 32px;
	}

	.mkt-footer__col {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mkt-footer__col-title {
		font-family: var(--font-display);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		margin-bottom: 2px;
	}

	.mkt-footer__link {
		font-size: 0.875rem;
		color: var(--text-secondary);
		text-decoration: none;
		transition: color 0.12s;
	}

	.mkt-footer__link:hover {
		color: var(--text-primary);
	}

	.mkt-footer__bottom {
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px 24px;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.mkt-footer__copy {
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.mkt-footer__bottom-links {
		display: flex;
		gap: 16px;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.mkt-header__nav {
			display: none;
		}
		.mkt-header__actions {
			display: none;
		}
		.mkt-header__hamburger {
			display: flex;
		}

		.mkt-footer__inner {
			grid-template-columns: 1fr;
			gap: 32px;
		}
		.mkt-footer__links {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.mkt-footer__links {
			grid-template-columns: 1fr;
		}
		.mkt-footer__bottom {
			flex-direction: column;
			text-align: center;
		}
	}
</style>
