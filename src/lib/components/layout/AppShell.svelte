<script lang="ts">
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import Logo from "$lib/components/ui/Logo.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import EarlyAccessBadge from "$lib/components/ui/EarlyAccessBadge.svelte";
	import ThemeToggle from "$lib/components/ui/ThemeToggle.svelte";
	import CreditNoticeBanner from "$lib/components/ui/CreditNoticeBanner.svelte";
	import PlotterStatusBadge from "./PlotterStatusBadge.svelte";
	import { uiStore, userStore, shopStore, agentStore, changelogStore, supportStore, plansStore, platformStore } from "$lib/stores";
	import { APP_NAV, LATEST_VERSION } from "$lib/config";
	import { signOutUser } from "$lib/firebase/auth";
	import { goto } from "$app/navigation";
	import { tooltip } from "$lib/actions/tooltip";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	const currentPath = $derived(page.url.pathname);
	// Admin → Settings → Cut Agent hides the Agent page from the nav.
	const navItems = $derived(APP_NAV.filter((i) => i.href !== "/studio/agent" || platformStore.flags.cutAgent));
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

	// ─── Mobile drawer ────────────────────────
	$effect(() => {
		currentPath;
		uiStore.closeMobileMenu();
	});

	// ─── Support badge ────────────────────────
	// Tickets where support replied or changed status since the user last looked.
	$effect(() => {
		if (!user?.uid) return;
		return supportStore.watch("user");
	});
	const supportCount = $derived(supportStore.userAttention);
	const supportLabel = $derived(
		supportCount ? `${supportCount} support ticket${supportCount === 1 ? "" : "s"} need${supportCount === 1 ? "s" : ""} your attention` : "Support",
	);

	function handleMenuBtnClick() {
		if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
			uiStore.toggleMobileMenu();
		} else {
			uiStore.toggleSidebar();
		}
	}
</script>

<CreditNoticeBanner />

<div class="app-shell" class:sidebar-collapsed={!uiStore.sidebarOpen}>
	<!-- ─── Top bar ─────────────────────────── -->
	<header class="topbar">
		<div class="topbar__left">
			<button
				class="topbar__menu-btn"
				onclick={handleMenuBtnClick}
				aria-label="Toggle navigation"
				aria-expanded={uiStore.mobileMenuOpen}
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
			<div class="topbar__brand">
				<Logo size={28} />
				<EarlyAccessBadge />
			</div>
		</div>

		<nav class="topbar__nav" aria-label="Main navigation">
			{#each navItems as item}
				<a
					href={item.href}
					class="topbar__nav-item"
					class:active={currentPath === item.href}
					aria-current={currentPath === item.href
						? "page"
						: undefined}
				>
					{item.label}
					{#if item.href === "/studio/agent" && agentStore.needsUpdate}
						<span class="nav-update-dot" use:tooltip={"Agent update available"} aria-label="Update available"></span>
					{/if}
				</a>
			{/each}
		</nav>

		<div class="topbar__right">
			<!-- Plotter status + Connect -->
			<PlotterStatusBadge variant="topbar" />

			<!-- Upgrade CTA for free/lite -->
			{#if user && user.tier !== "pro" && user.tier !== "admin"}
				<button class="upgrade-btn" onclick={uiStore.openPricing}>
					Upgrade
				</button>
			{/if}

			<!-- What's new — badge stays until the changelog page is viewed -->
			<a
				href="/changelog#v{LATEST_VERSION}"
				class="whats-new"
				class:whats-new--new={changelogStore.hasUnseen}
				aria-label={changelogStore.hasUnseen ? `What's new — v${LATEST_VERSION} (new)` : "What's new"}
				use:tooltip={changelogStore.hasUnseen ? `New in v${LATEST_VERSION} — see what changed` : "What's new"}
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-5 3.6L16.8 20 12 16.6 7.2 20 9 13.6 4 10l6.1-1.2z"/></svg>
				{#if changelogStore.hasUnseen}
					<span class="whats-new__badge">v{LATEST_VERSION}</span>
				{/if}
			</a>

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
					use:tooltip={supportCount ? supportLabel : undefined}
				>
					{#if user?.photoURL}
						<img src={user.photoURL} alt={user.displayName ?? "Avatar"} class="avatar__img" />
					{:else}
						<span class="avatar__initials" aria-hidden="true">
							{(user?.displayName ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
						</span>
					{/if}
				</button>
				{#if supportCount}
					<span class="avatar__alert" aria-hidden="true"></span>
				{/if}

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

						<a href="/support/tickets" role="menuitem" class="user-menu__item" onclick={closeMenu}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
							Support tickets
							{#if supportCount}<span class="user-menu__count" aria-label={supportLabel}>{supportCount}</span>{/if}
						</a>

						<a href="/changelog#v{LATEST_VERSION}" role="menuitem" class="user-menu__item" onclick={closeMenu}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 10l-5 3.6L16.8 20 12 16.6 7.2 20 9 13.6 4 10l6.1-1.2z"/></svg>
							What's new
							{#if changelogStore.hasUnseen}<span class="user-menu__new">v{LATEST_VERSION}</span>{/if}
						</a>

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
		<!-- Mobile drawer backdrop -->
		{#if uiStore.mobileMenuOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="sidebar-backdrop animate-fade-in" onclick={uiStore.closeMobileMenu}></div>
		{/if}

		<!-- Sidebar -->
		<aside class="sidebar" class:sidebar--mobile-open={uiStore.mobileMenuOpen} aria-label="Sidebar">
			<button
				class="sidebar__collapse-btn"
				onclick={uiStore.toggleSidebar}
				aria-label={uiStore.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
				use:tooltip={uiStore.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="sidebar__collapse-icon"
					class:sidebar__collapse-icon--flipped={!uiStore.sidebarOpen}
					aria-hidden="true"
				>
					<path d="M15 18l-6-6 6-6" />
				</svg>
			</button>

			<div class="sidebar__plotter" class:sidebar__plotter--collapsed={!uiStore.sidebarOpen}>
				<PlotterStatusBadge variant="sidebar" collapsed={!uiStore.sidebarOpen && !uiStore.mobileMenuOpen} onnavigate={uiStore.closeMobileMenu} />
			</div>

			<nav class="sidebar__nav">
				{#each navItems as item}
					<a
						href={item.href}
						class="sidebar__item"
						class:active={currentPath === item.href}
						aria-current={currentPath === item.href ? "page" : undefined}
						data-tour={item.href === "/library" ? "sidebar-library" : undefined}
						use:tooltip={!uiStore.sidebarOpen ? item.label : undefined}
						onclick={uiStore.closeMobileMenu}
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
						{#if item.href === "/studio/agent" && agentStore.needsUpdate}
							<span class="sidebar__update-badge" use:tooltip={"Agent update available"} aria-label="Update available">Update</span>
						{/if}
					</a>
				{/each}
			</nav>

			<div class="sidebar__footer">
				<a
					href="/support/tickets"
					class="sidebar__item"
					class:active={currentPath.startsWith("/support/tickets")}
					aria-label={supportLabel}
					use:tooltip={!uiStore.sidebarOpen ? supportLabel : undefined}
					onclick={uiStore.closeMobileMenu}
				>
					<span class="sidebar__icon" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
						{#if supportCount}<span class="sidebar__icon-dot"></span>{/if}
					</span>
					<span class="sidebar__label">Support</span>
					{#if supportCount}
						<span class="sidebar__count-badge">{supportCount}</span>
					{/if}
				</a>

				<a
					href="/changelog"
					class="sidebar__item sidebar__item--changelog"
					class:active={currentPath === "/changelog"}
					use:tooltip={!uiStore.sidebarOpen ? (changelogStore.hasUnseen ? `Changelog — new: v${LATEST_VERSION}` : "Changelog") : undefined}
					onclick={uiStore.closeMobileMenu}
				>
					<span class="sidebar__icon" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/><path d="M4 4v16h16"/></svg>
						{#if changelogStore.hasUnseen}<span class="sidebar__icon-dot sidebar__icon-dot--brand"></span>{/if}
					</span>
					<span class="sidebar__label">Changelog</span>
					{#if changelogStore.hasUnseen}
						<span class="sidebar__version-badge" use:tooltip={`New version: v${LATEST_VERSION}`}>v{LATEST_VERSION}</span>
					{/if}
				</a>

				{#if user && user.tier === "free"}
					<div class="sidebar__upsell" class:sidebar__upsell--hidden={!uiStore.sidebarOpen}>
						<p class="sidebar__upsell-text">
							{plansStore.fill("{{free.Cuts}}")} on Free
						</p>
						<button class="sidebar__upsell-btn" onclick={uiStore.openPricing}>
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
		height: 100dvh;
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

	.topbar__brand {
		display: flex;
		flex-direction: column;
		gap: 1px;
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

	/* Update dot shown next to "Agent" in topbar when a new version is available */
	.nav-update-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-warning, #f59e0b);
		margin-left: 4px;
		flex-shrink: 0;
		vertical-align: middle;
		animation: update-pulse 2s ease-in-out infinite;
	}

	@keyframes update-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.topbar__right {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
		flex-shrink: 0;
	}

	.whats-new {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 8px;
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		text-decoration: none;
		transition: background 0.12s, color 0.12s;
		flex-shrink: 0;
	}
	.whats-new:hover { background: var(--interactive-hover); color: var(--text-primary); }
	.whats-new--new { color: var(--text-brand); }
	.whats-new__badge {
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 0.625rem;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--color-brand-muted);
		color: var(--text-brand);
		border: 1px solid var(--border-brand);
		white-space: nowrap;
	}
	.user-menu__new {
		margin-left: auto;
		padding: 0 6px;
		border-radius: 999px;
		font-size: 0.625rem;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--color-brand-muted);
		color: var(--text-brand);
		border: 1px solid var(--border-brand);
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
		transition: grid-template-columns 0.22s var(--ease-smooth);
	}

	.sidebar-collapsed .app-body {
		grid-template-columns: 52px 1fr;
	}

	.sidebar {
		position: relative;
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		overflow: visible;
		width: 200px;
		transition: width 0.22s var(--ease-smooth);
	}

	.sidebar-collapsed .sidebar {
		width: 52px;
	}

	.sidebar__plotter { padding: 10px 8px 0; }
	.sidebar__plotter--collapsed { padding: 10px 0 0; }

	.sidebar__nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 8px;
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.sidebar__item {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 10px;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-tertiary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		transition: background 0.12s, color 0.12s, padding 0.22s;
	}

	.sidebar-collapsed .sidebar__item {
		padding: 9px;
		justify-content: center;
		gap: 0;
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
		position: relative;
	}

	/* Support "needs your attention" — the count pill shows when expanded,
	   the icon dot carries the signal when the sidebar is collapsed. */
	.sidebar__count-badge {
		flex-shrink: 0;
		min-width: 18px;
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 700;
		font-family: var(--font-mono);
		text-align: center;
		background: var(--color-warning, #f59e0b);
		color: #000;
		transition: opacity 0.15s;
	}
	.sidebar-collapsed .sidebar__count-badge { opacity: 0; pointer-events: none; }

	.sidebar__icon-dot {
		display: none;
		position: absolute;
		top: -2px;
		right: -3px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-warning, #f59e0b);
		box-shadow: 0 0 0 2px var(--bg-surface);
	}
	.sidebar-collapsed .sidebar__icon-dot { display: block; }
	.sidebar__icon-dot--brand { background: var(--color-brand); }

	.avatar__alert {
		position: absolute;
		top: -1px;
		right: -1px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--color-warning, #f59e0b);
		box-shadow: 0 0 0 2px var(--bg-surface);
		pointer-events: none;
	}

	.user-menu__count {
		margin-left: auto;
		min-width: 18px;
		padding: 0 6px;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 700;
		font-family: var(--font-mono);
		text-align: center;
		background: var(--color-warning, #f59e0b);
		color: #000;
	}

	.sidebar__label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 1;
		max-width: 140px;
		transition: opacity 0.15s, max-width 0.22s;
	}

	.sidebar-collapsed .sidebar__label {
		opacity: 0;
		max-width: 0;
		pointer-events: none;
	}

	/* "Update" pill badge */
	.sidebar__update-badge {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		background: var(--color-warning, #f59e0b);
		color: #000;
		animation: update-pulse 2s ease-in-out infinite;
		transition: opacity 0.15s;
	}

	.sidebar-collapsed .sidebar__update-badge {
		opacity: 0;
		pointer-events: none;
	}

	/* Changelog "new version" pill — brand-colored, distinct from the
	   warning-colored agent update badge above. */
	.sidebar__version-badge {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		font-family: var(--font-mono);
		background: var(--color-brand-muted);
		color: var(--text-brand);
		border: 1px solid var(--border-brand);
		transition: opacity 0.15s;
	}

	.sidebar-collapsed .sidebar__version-badge {
		opacity: 0;
		pointer-events: none;
	}

	.sidebar__item--changelog {
		margin-bottom: 4px;
	}

	.sidebar__footer {
		padding: 8px 8px 10px;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sidebar__upsell {
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 10px 12px;
		overflow: hidden;
		transition: opacity 0.15s, max-height 0.22s, padding 0.22s, margin 0.22s;
		max-height: 120px;
		opacity: 1;
	}

	.sidebar__upsell--hidden {
		opacity: 0;
		max-height: 0;
		padding-top: 0;
		padding-bottom: 0;
		pointer-events: none;
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

	/* ─── Collapse toggle button ─── */
	/* Floats halfway down the sidebar's right border, straddling it — mirrors
	   the same collapse-toggle treatment used on the Studio settings panel. */
	.sidebar__collapse-btn {
		position: absolute;
		top: 50%;
		right: -13px;
		transform: translateY(-50%);
		z-index: 6;
		width: 26px;
		height: 46px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 8px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface-2);
		color: var(--text-secondary);
		cursor: pointer;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}

	.sidebar__collapse-btn:hover {
		background: var(--color-brand);
		color: var(--bg-surface);
		border-color: var(--color-brand);
	}

	.sidebar__collapse-icon {
		flex-shrink: 0;
		transition: transform 0.22s var(--ease-smooth);
	}

	.sidebar__collapse-icon--flipped {
		transform: rotate(180deg);
	}

	.app-main {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	/* ─── Mobile ────── */
	.sidebar-backdrop {
		display: none;
	}

	@media (max-width: 768px) {
		.topbar__nav { display: none; }

		.app-body {
			grid-template-columns: 1fr;
			position: relative;
		}

		.sidebar-collapsed .app-body { grid-template-columns: 1fr; }

		/* Sidebar becomes a slide-in drawer instead of a persistent column */
		.sidebar {
			position: fixed;
			top: 52px;
			bottom: 0;
			left: 0;
			width: 240px;
			max-width: 82vw;
			z-index: 400;
			transform: translateX(-100%);
			transition: transform 0.22s var(--ease-smooth);
			box-shadow: var(--shadow-lg);
		}

		.sidebar-collapsed .sidebar {
			width: 240px;
		}

		.sidebar--mobile-open {
			transform: translateX(0);
		}

		.sidebar__collapse-btn {
			display: none;
		}

		.sidebar-collapsed .sidebar__label,
		.sidebar-collapsed .sidebar__version-badge,
		.sidebar-collapsed .sidebar__update-badge,
		.sidebar-collapsed .sidebar__count-badge {
			opacity: 1;
			max-width: 140px;
			pointer-events: auto;
		}
		.sidebar-collapsed .sidebar__icon-dot { display: none; }
		/* The drawer is always full-width, whatever the desktop collapse state */
		.sidebar-collapsed .sidebar__item { padding: 12px 10px; justify-content: flex-start; gap: 9px; }
		.sidebar__upsell--hidden {
			opacity: 1;
			max-height: 120px;
			padding-top: 10px;
			padding-bottom: 10px;
			pointer-events: auto;
		}
		.sidebar__plotter--collapsed { padding: 10px 8px 0; }

		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 52px 0 0 0;
			background: rgba(0, 0, 0, 0.45);
			z-index: 390;
		}

		/* Touch targets need more room on mobile */
		.sidebar__item {
			padding: 12px 10px;
			font-size: 0.875rem;
		}

		.topbar {
			padding: 0 12px;
		}

		.topbar__brand :global(.early-access-badge) {
			display: none;
		}

		.user-menu {
			width: calc(100vw - 24px);
			max-width: 320px;
		}
	}

	@media (max-width: 480px) {
		.upgrade-btn {
			padding: 5px 9px;
			font-size: 0.6875rem;
		}
		.topbar { gap: 8px; }
		.topbar__right { gap: 6px; }
	}
	@media (max-width: 640px) {
		/* Badge text → dot; the drawer and avatar menu show the version */
		.whats-new__badge {
			position: absolute;
			top: 3px;
			right: 3px;
			width: 8px;
			height: 8px;
			padding: 0;
			font-size: 0;
			border: none;
			background: var(--color-brand);
			box-shadow: 0 0 0 2px var(--bg-surface);
		}
	}
	/* Small phones: Upgrade lives in the drawer + avatar menu; icon-only logo */
	@media (max-width: 400px) {
		.upgrade-btn { display: none; }
		.topbar__brand :global(.wordmark) { display: none; }
	}
</style>
