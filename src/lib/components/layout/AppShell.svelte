<script lang="ts">
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import Logo from "$lib/components/ui/Logo.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import ThemeToggle from "$lib/components/ui/ThemeToggle.svelte";
	import { uiStore, userStore, shopStore } from "$lib/stores";
	import { APP_NAV } from "$lib/config";
	import { signOutUser } from "$lib/firebase/auth";
	import { goto } from "$app/navigation";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	const currentPath = $derived(page.url.pathname);
	const user = $derived(userStore.user);

	const tierVariant = $derived(() => {
		const t = user?.tier ?? "free";
		if (t === "pro" || t === "admin") return "pro";
		if (t === "lite") return "lite";
		return "free";
	});

	const tierLabel = $derived(() => {
		const t = user?.tier ?? "free";
		if (t === "admin") return "Admin";
		return t.charAt(0).toUpperCase() + t.slice(1);
	});

	// ─── Avatar dropdown ──────────────────────
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

<div class="app-shell" class:sidebar-collapsed={!uiStore.sidebarOpen}>
	<!-- ─── Top bar ─────────────────────────── -->
	<header class="topbar">
		<div class="topbar__left">
			<button
				class="topbar__menu-btn"
				onclick={uiStore.toggleSidebar}
				aria-label="Toggle sidebar"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M3 12h18M3 6h18M3 18h18" />
				</svg>
			</button>
			<Logo size={28} />
		</div>

		<nav class="topbar__nav" aria-label="Main navigation">
			{#each APP_NAV as item}
				<a
					href={item.href}
					class="topbar__nav-item"
					class:active={currentPath === item.href ||
						currentPath.startsWith(item.href + "/")}
					aria-current={currentPath === item.href
						? "page"
						: undefined}
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="topbar__right">
			<!-- Plotter status -->
			<div class="plotter-status" title="Plotter connected">
				<span class="plotter-status__dot" aria-hidden="true"></span>
				<span class="plotter-status__label">Ready</span>
			</div>

			<!-- Upgrade CTA for free/lite -->
			{#if user && user.tier !== "pro" && user.tier !== "admin"}
				<button class="upgrade-btn" onclick={uiStore.openPricing}>
					Upgrade
				</button>
			{/if}

			<ThemeToggle />

			<!-- Avatar dropdown -->
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
					{#if user?.photoURL}
						<img src={user.photoURL} alt={user.displayName ?? "Avatar"} class="avatar__img" />
					{:else}
						<span class="avatar__initials" aria-hidden="true">
							{(user?.displayName ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
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
						<!-- Identity header -->
						<div class="user-menu__header">
							<div class="user-menu__avatar">
								{#if user?.photoURL}
									<img src={user.photoURL} alt="" class="user-menu__avatar-img" />
								{:else}
									<span class="user-menu__avatar-initials">
										{(user?.displayName ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
									</span>
								{/if}
							</div>
							<div class="user-menu__identity">
								<span class="user-menu__name">{user?.displayName || "Account"}</span>
								{#if user?.email}
									<span class="user-menu__email">{user.email}</span>
								{/if}
								<div class="user-menu__badges">
									<Badge variant={tierVariant()} size="sm">{tierLabel()}</Badge>
									{#if shopStore.shop}
										<span class="user-menu__shop-chip">
											<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
											{shopStore.shop.name}
										</span>
									{/if}
								</div>
							</div>
						</div>

						<hr class="user-menu__sep" />

						<!-- Nav links -->
						<a href="/studio"   role="menuitem" class="user-menu__item" onclick={closeMenu}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
							Studio
						</a>
						<a href="/library"  role="menuitem" class="user-menu__item" onclick={closeMenu}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>
							Library
						</a>
						<a href="/settings" role="menuitem" class="user-menu__item" onclick={closeMenu}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
							Settings
						</a>

						{#if user && user.tier !== "free" && user.tier !== "admin"}
							<a href="/settings?tab=billing" role="menuitem" class="user-menu__item" onclick={closeMenu}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
								Billing
							</a>
						{/if}

						{#if user?.tier !== "pro" && user?.tier !== "admin"}
							<button role="menuitem" class="user-menu__item user-menu__item--upgrade" onclick={() => { closeMenu(); uiStore.openPricing(); }}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
								Upgrade plan
							</button>
						{/if}

						{#if user?.tier === "admin"}
							<hr class="user-menu__sep" />
							<a href="/admin" role="menuitem" class="user-menu__item user-menu__item--admin" onclick={closeMenu}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
								Admin panel
							</a>
						{/if}

						<button
							role="menuitem"
							class="user-menu__item"
							onclick={() => { closeMenu(); uiStore.openReport(); }}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
							Report an issue
						</button>

						<button role="menuitem" class="user-menu__item" onclick={() => { closeMenu(); goto('/studio'); uiStore.openTour(); }}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
							Take a tour
						</button>

						<hr class="user-menu__sep" />

						<button role="menuitem" class="user-menu__item user-menu__item--danger" onclick={signOutUser}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
							Sign out
						</button>
					</div>
				{/if}
			</div>
		</div>
	</header>

	<!-- ─── Main area ─────────────────────────── -->
	<div class="app-body">
		<!-- Sidebar -->
		<aside class="sidebar" aria-label="Sidebar">
			<nav class="sidebar__nav">
				{#each APP_NAV as item}
					<a
						href={item.href}
						class="sidebar__item"
						class:active={currentPath === item.href ||
							currentPath.startsWith(item.href + "/")}
						aria-current={currentPath === item.href
							? "page"
							: undefined}
						data-tour={item.href === "/library" ? "sidebar-library" : undefined}
					>
						<span class="sidebar__icon" aria-hidden="true">
							{#if item.icon === "scissors"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><circle cx="6" cy="6" r="3" /><circle
										cx="6"
										cy="18"
										r="3"
									/><path
										d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"
									/></svg
								>
							{:else if item.icon === "library"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path
										d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"
									/></svg
								>
							{:else if item.icon === "briefcase"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect
										x="2"
										y="7"
										width="20"
										height="14"
										rx="2"
									/><path
										d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"
									/></svg
								>
							{:else if item.icon === "plotter"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="2" y="8" width="20" height="8" rx="2" /><path
										d="M6 8V4h12v4M6 16v4h12v-4M9 12h.01M13 12h2"
									/></svg
								>
							{:else if item.icon === "terminal"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="2" y="3" width="20" height="14" rx="2" /><path
										d="M8 21h8M12 17v4M6 8l3 3-3 3M11 14h4"
									/></svg
								>
							{:else if item.icon === "settings"}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									><circle cx="12" cy="12" r="3" /><path
										d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
									/></svg
								>
							{/if}
						</span>
						<span class="sidebar__label">{item.label}</span>
					</a>
				{/each}
			</nav>

			<div class="sidebar__footer">
				{#if user && user.tier === "free"}
					<div class="sidebar__upsell">
						<p class="sidebar__upsell-text">
							1 cut / 30 days on Free
						</p>
						<button
							class="sidebar__upsell-btn"
							onclick={uiStore.openPricing}
						>
							Upgrade for more →
						</button>
					</div>
				{/if}
			</div>
		</aside>

		<!-- Page content -->
		<main class="app-main">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.app-shell {
		display: grid;
		grid-template-rows: 52px 1fr;
		height: 100vh;
		overflow: hidden;
		background: var(--bg-base);
	}

	/* ─── Topbar ────── */
	.topbar {
		display: flex;
		align-items: center;
		padding: 0 16px;
		gap: 12px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
		z-index: 50;
		position: relative;
	}

	.topbar__left {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}

	.topbar__menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s;
		flex-shrink: 0;
	}

	.topbar__menu-btn:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}

	.topbar__nav {
		display: flex;
		gap: 2px;
		flex: 1;
	}

	.topbar__nav-item {
		padding: 5px 12px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-tertiary);
		text-decoration: none;
		border-radius: var(--radius-md);
		transition:
			background 0.12s,
			color 0.12s;
		white-space: nowrap;
	}

	.topbar__nav-item:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
	.topbar__nav-item.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
	}

	.topbar__right {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.plotter-status {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
		border-radius: 20px;
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		letter-spacing: 0.05em;
	}

	.plotter-status__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-success);
		animation: pulse-dot 2s ease-in-out infinite;
		flex-shrink: 0;
	}

	.plotter-status__label {
		display: none;
	}

	@media (min-width: 768px) {
		.plotter-status__label {
			display: block;
		}
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
			box-shadow: 0 0 0 0 rgba(0, 214, 143, 0.4);
		}
		50% {
			opacity: 0.8;
			box-shadow: 0 0 0 4px rgba(0, 214, 143, 0);
		}
	}

	.upgrade-btn {
		padding: 5px 12px;
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-body);
		color: var(--color-brand);
		background: rgba(0, 229, 255, 0.08);
		border: 1px solid rgba(0, 229, 255, 0.2);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background 0.15s;
		white-space: nowrap;
	}

	.upgrade-btn:hover {
		background: rgba(0, 229, 255, 0.14);
	}

	/* ─── Avatar button ────── */
	.avatar-wrap { position: relative; }

	.avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		overflow: hidden;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid transparent;
		cursor: pointer;
		flex-shrink: 0;
		transition: border-color 0.15s, opacity 0.15s;
	}
	.avatar:hover { opacity: 0.85; }
	.avatar--open { border-color: var(--color-brand-dim); }
	.avatar__img { width: 100%; height: 100%; object-fit: cover; }
	.avatar__initials {
		font-family: var(--font-display);
		font-size: 0.6875rem;
		font-weight: 700;
		color: #fff;
	}

	/* ─── Dropdown menu ────── */
	.user-menu {
		position: fixed;
		width: 240px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 6px;
		z-index: 500;
		animation: menu-in 0.12s var(--ease-smooth);
	}

	@keyframes menu-in {
		from { opacity: 0; transform: translateY(-4px) scale(0.98); }
		to   { opacity: 1; transform: translateY(0)    scale(1); }
	}

	/* Header identity block */
	.user-menu__header {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 10px 8px;
	}
	.user-menu__avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		flex-shrink: 0;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.user-menu__avatar-img { width: 100%; height: 100%; object-fit: cover; }
	.user-menu__avatar-initials {
		font-family: var(--font-display);
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
	}
	.user-menu__identity { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.user-menu__name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.user-menu__email {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.user-menu__badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.user-menu__shop-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 7px;
		background: var(--bg-surface-3);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		font-size: 0.625rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--text-secondary);
		letter-spacing: 0.04em;
		white-space: nowrap;
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Separator */
	.user-menu__sep { border: none; border-top: 1px solid var(--border-subtle); margin: 4px 0; }

	/* Menu items */
	.user-menu__item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		font-family: var(--font-body);
		font-weight: 500;
		color: var(--text-secondary);
		text-decoration: none;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, color 0.1s;
	}
	.user-menu__item svg { flex-shrink: 0; opacity: 0.7; }
	.user-menu__item:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.user-menu__item:hover svg { opacity: 1; }

	.user-menu__item--upgrade { color: var(--color-brand); }
	.user-menu__item--upgrade svg { opacity: 1; color: var(--color-brand); }
	.user-menu__item--upgrade:hover { background: rgba(0, 229, 255, 0.08); color: var(--color-brand); }

	.user-menu__item--admin { color: var(--color-warning, #ffb547); }
	.user-menu__item--admin svg { opacity: 1; color: var(--color-warning, #ffb547); }
	.user-menu__item--admin:hover { background: color-mix(in srgb, var(--color-warning, #ffb547) 10%, transparent); color: var(--color-warning, #ffb547); }

	.user-menu__item--danger { color: var(--color-danger); }
	.user-menu__item--danger svg { opacity: 1; color: var(--color-danger); }
	.user-menu__item--danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

	/* ─── Body / Sidebar ────── */
	.app-body {
		display: grid;
		grid-template-columns: 200px 1fr;
		overflow: hidden;
		transition: grid-template-columns 0.2s var(--ease-smooth);
	}

	.sidebar-collapsed .app-body {
		grid-template-columns: 0px 1fr;
	}

	.sidebar {
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition: width 0.2s var(--ease-smooth);
	}

	.sidebar__nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 8px;
		flex: 1;
		overflow-y: auto;
	}

	.sidebar__item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-tertiary);
		text-decoration: none;
		transition:
			background 0.12s,
			color 0.12s;
		white-space: nowrap;
		overflow: hidden;
	}

	.sidebar__item:hover {
		background: var(--interactive-hover);
		color: var(--text-primary);
	}
	.sidebar__item.active {
		background: var(--bg-surface-3);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
	}

	.sidebar__icon {
		flex-shrink: 0;
		display: flex;
	}
	.sidebar__label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sidebar__footer {
		padding: 12px 8px;
		border-top: 1px solid var(--border-subtle);
	}

	.sidebar__upsell {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 10px 12px;
	}

	.sidebar__upsell-text {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin-bottom: 6px;
		line-height: 1.4;
	}

	.sidebar__upsell-btn {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-brand);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		font-family: var(--font-body);
	}

	.app-main {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	/* ─── Mobile ────── */
	@media (max-width: 768px) {
		.topbar__nav {
			display: none;
		}

		.app-body {
			grid-template-columns: 1fr;
		}

		.sidebar {
			display: none;
		}

		.sidebar-collapsed .app-body {
			grid-template-columns: 1fr;
		}
	}
</style>
