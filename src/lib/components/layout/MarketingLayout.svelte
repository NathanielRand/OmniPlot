<script lang="ts">
	import type { Snippet } from "svelte";
	import Logo from "$lib/components/ui/Logo.svelte";
	import ThemeToggle from "$lib/components/ui/ThemeToggle.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import PromoBanner from "$lib/components/ui/PromoBanner.svelte";
	import { MARKETING_NAV } from "$lib/config";
	import { userStore, shopStore, uiStore } from "$lib/stores";
	import { signOutUser } from "$lib/firebase/auth";
	import { page } from "$app/state";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	let mobileMenuOpen = $state(false);
	const currentPath = $derived(page.url.pathname);
	const user        = $derived(userStore.user);

	const tierVariant = $derived(() => {
		const t = user?.tier ?? "free";
		if (t === "pro" || t === "admin") return "pro" as const;
		if (t === "lite") return "lite" as const;
		return "free" as const;
	});

	const tierLabel = $derived(() => {
		const t = user?.tier ?? "free";
		if (t === "admin") return "Admin";
		return t.charAt(0).toUpperCase() + t.slice(1);
	});

	// ─── Avatar dropdown ──────────────────────────
	let menuOpen  = $state(false);
	let menuRef   = $state<HTMLElement | null>(null);
	let avatarBtn = $state<HTMLButtonElement | null>(null);
	let menuTop   = $state(0);
	let menuRight = $state(0);

	$effect(() => {
		if (!menuOpen) return;
		function handleClick(e: MouseEvent) {
			if (menuRef && !menuRef.contains(e.target as Node)) menuOpen = false;
		}
		window.addEventListener("mousedown", handleClick);
		return () => window.removeEventListener("mousedown", handleClick);
	});

	function openMenu() {
		if (avatarBtn) {
			const rect = avatarBtn.getBoundingClientRect();
			menuTop   = rect.bottom + 8;
			menuRight = window.innerWidth - rect.right;
		}
		menuOpen = !menuOpen;
	}

	function closeMenu() { menuOpen = false; }
</script>

<div class="marketing-shell">
	<!-- ─── Promo banner (public only, hidden for authed users) ─── -->
	<PromoBanner />

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

				{#if userStore.loading}
					<!-- Prevent flash: render nothing until auth resolves -->
					<div class="auth-placeholder" aria-hidden="true"></div>
				{:else if user}
					<!-- Authenticated: avatar dropdown -->
					<div class="avatar-wrap" bind:this={menuRef}>
						<button
							class="avatar"
							class:avatar--open={menuOpen}
							aria-label="Account menu"
							aria-expanded={menuOpen}
							aria-haspopup="menu"
							bind:this={avatarBtn}
							onclick={openMenu}
						>
							{#if user.photoURL}
								<img src={user.photoURL} alt={user.displayName ?? "Avatar"} class="avatar__img" />
							{:else}
								<span class="avatar__initials" aria-hidden="true">
									{(user.displayName ?? user.email ?? "?").slice(0, 2).toUpperCase()}
								</span>
							{/if}
						</button>

						{#if menuOpen}
							<div
								class="user-menu"
								role="menu"
								style:top="{menuTop}px"
								style:right="{menuRight}px"
							>
								<div class="user-menu__header">
									<div class="user-menu__avatar">
										{#if user.photoURL}
											<img src={user.photoURL} alt="" class="user-menu__avatar-img" />
										{:else}
											<span class="user-menu__avatar-initials">
												{(user.displayName ?? user.email ?? "?").slice(0, 2).toUpperCase()}
											</span>
										{/if}
									</div>
									<div class="user-menu__identity">
										<span class="user-menu__name">{user.displayName || "Account"}</span>
										{#if user.email}
											<span class="user-menu__email">{user.email}</span>
										{/if}
										<div class="user-menu__badges">
											<Badge variant={tierVariant()} size="sm">{tierLabel()}</Badge>
											{#if shopStore.shop}
												<span class="user-menu__shop-chip">{shopStore.shop.name}</span>
											{/if}
										</div>
									</div>
								</div>

								<hr class="user-menu__sep" />

								<a href="/studio"   role="menuitem" class="user-menu__item" onclick={closeMenu}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
									Studio
								</a>
								<a href="/settings" role="menuitem" class="user-menu__item" onclick={closeMenu}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
									Settings
								</a>

								{#if user.tier !== "free" && user.tier !== "admin"}
									<a href="/settings?tab=billing" role="menuitem" class="user-menu__item" onclick={closeMenu}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
										Billing
									</a>
								{/if}

								{#if user.tier !== "pro" && user.tier !== "admin"}
									<button role="menuitem" class="user-menu__item user-menu__item--upgrade" onclick={() => { closeMenu(); uiStore.openPricing(); }}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
										Upgrade plan
									</button>
								{/if}

								{#if user.tier === "admin"}
									<hr class="user-menu__sep" />
									<a href="/admin" role="menuitem" class="user-menu__item user-menu__item--admin" onclick={closeMenu}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
										Admin panel
									</a>
								{/if}

								<hr class="user-menu__sep" />

								<button role="menuitem" class="user-menu__item user-menu__item--danger" onclick={signOutUser}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
									Sign out
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<!-- Guest: sign-in / start free -->
					<Button variant="ghost" size="sm" href="/login">Sign in</Button>
					<Button variant="primary" size="sm" href="/signup">Start free</Button>
				{/if}
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
					<a href="/insights" class="mkt-footer__link">Insights</a>
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

	/* auth placeholder keeps layout stable while loading */
	.auth-placeholder { width: 60px; height: 30px; }

	/* ─── Avatar ───────────────────────────── */
	.avatar-wrap { position: relative; }

	.avatar {
		width: 32px; height: 32px; border-radius: 50%; overflow: hidden;
		background: var(--color-brand);
		display: flex; align-items: center; justify-content: center;
		border: 2px solid transparent; cursor: pointer; flex-shrink: 0;
		transition: border-color 0.15s, opacity 0.15s;
	}
	.avatar:hover    { opacity: 0.85; }
	.avatar--open    { border-color: var(--color-brand); }
	.avatar__img     { width: 100%; height: 100%; object-fit: cover; }
	.avatar__initials {
		font-family: var(--font-display);
		font-size: 0.6875rem;
		font-weight: 700;
		color: #fff;
	}

	/* ─── User menu ────────────────────────── */
	.user-menu {
		position: fixed; width: 240px;
		background: var(--bg-surface); border: 1px solid var(--border-default);
		border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
		padding: 6px; z-index: 500;
		animation: menu-in 0.12s var(--ease-smooth, ease);
	}
	@keyframes menu-in {
		from { opacity: 0; transform: translateY(-4px) scale(0.98); }
		to   { opacity: 1; transform: translateY(0) scale(1); }
	}

	.user-menu__header { display: flex; align-items: flex-start; gap: 10px; padding: 10px 10px 8px; }
	.user-menu__avatar {
		width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
		background: var(--color-brand);
		display: flex; align-items: center; justify-content: center; overflow: hidden;
	}
	.user-menu__avatar-img      { width: 100%; height: 100%; object-fit: cover; }
	.user-menu__avatar-initials { font-family: var(--font-display); font-size: 0.75rem; font-weight: 700; color: #fff; }
	.user-menu__identity  { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.user-menu__name      { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.user-menu__email     { font-size: 0.6875rem; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.user-menu__badges    { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
	.user-menu__shop-chip {
		display: inline-flex; align-items: center; gap: 3px;
		padding: 2px 7px; background: var(--bg-surface-3); border: 1px solid var(--border-default);
		border-radius: 10px; font-size: 0.625rem; font-weight: 600; font-family: var(--font-mono);
		color: var(--text-secondary); white-space: nowrap;
	}
	.user-menu__sep { border: none; border-top: 1px solid var(--border-subtle); margin: 4px 0; }

	.user-menu__item {
		display: flex; align-items: center; gap: 8px; width: 100%;
		padding: 7px 10px; border-radius: var(--radius-sm);
		font-size: 0.8125rem; font-family: var(--font-body); font-weight: 500;
		color: var(--text-secondary); text-decoration: none;
		background: none; border: none; cursor: pointer; text-align: left;
		transition: background 0.1s, color 0.1s;
	}
	.user-menu__item svg { flex-shrink: 0; opacity: 0.7; }
	.user-menu__item:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.user-menu__item:hover svg { opacity: 1; }
	.user-menu__item--upgrade       { color: var(--color-brand-dim); }
	.user-menu__item--upgrade svg   { opacity: 1; }
	.user-menu__item--upgrade:hover { background: rgba(0,112,255,0.07); }
	.user-menu__item--admin         { color: var(--color-danger); }
	.user-menu__item--admin svg     { opacity: 1; }
	.user-menu__item--admin:hover   { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
	.user-menu__item--danger        { color: var(--color-danger); }
	.user-menu__item--danger svg    { opacity: 1; }
	.user-menu__item--danger:hover  { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

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
