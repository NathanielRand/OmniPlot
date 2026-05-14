<script lang="ts">
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import Logo from "$lib/components/ui/Logo.svelte";
	import Badge from "$lib/components/ui/Badge.svelte";
	import ThemeToggle from "$lib/components/ui/ThemeToggle.svelte";
	import { uiStore, userStore } from "$lib/stores";
	import { APP_NAV } from "$lib/config";

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

			<!-- Tier badge -->
			{#if user}
				<Badge variant={tierVariant()}>
					{user.tier === "admin" ? "Admin" : user.tier}
				</Badge>
			{/if}

			<!-- Avatar -->
			<button class="avatar" aria-label="Account menu">
				{#if user?.photoURL}
					<img
						src={user.photoURL}
						alt={user.displayName}
						class="avatar__img"
					/>
				{:else}
					<span class="avatar__initials" aria-hidden="true">
						{user?.displayName?.slice(0, 2).toUpperCase() ?? "CC"}
					</span>
				{/if}
			</button>
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

	.avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		overflow: hidden;
		background: linear-gradient(135deg, var(--color-brand-dim), #7b5ea7);
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}

	.avatar:hover {
		opacity: 0.85;
	}
	.avatar__img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar__initials {
		font-family: var(--font-display);
		font-size: 0.6875rem;
		font-weight: 700;
		color: #fff;
	}

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
		overflow: hidden;
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
