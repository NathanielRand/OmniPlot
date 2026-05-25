<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Logo from '$lib/components/ui/Logo.svelte';
  import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { ADMIN_NAV } from '$lib/config';
  import { userStore, shopStore } from '$lib/stores';
  import { signOutUser } from '$lib/firebase/auth';

  interface Props { children: Snippet; }
  let { children }: Props = $props();

  const currentPath = $derived(page.url.pathname);
  const user        = $derived(userStore.user);

  $effect(() => {
    if (!userStore.loading && !userStore.isAdmin) {
      goto('/studio', { replaceState: true });
    }
  });

  const NAV_ICONS: Record<string, string> = {
    'layout-dashboard': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    'users':            'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    'vector-bezier':    'M3 3l4 4 10-10 4 4-10 10-4-4zM3 17v4h4l10-10-4-4L3 17z',
    'chart-bar':        'M18 20V10M12 20V4M6 20v-6',
    'package':          'M16.5 9.4L7.55 4.24M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
    'receipt':          'M4 2h16a1 1 0 011 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 011-1zM8 9h8M8 13h6',
    'tag':              'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
    'settings':         'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  };

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
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
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

{#if userStore.loading}
  <div class="auth-gate" aria-label="Loading">
    <span class="auth-gate__spinner"></span>
  </div>
{:else if userStore.isAdmin}
<div class="admin-shell">
  <!-- Sidebar -->
  <aside class="admin-sidebar">
    <div class="admin-sidebar__header">
      <Logo size={26} />
      <Badge variant="danger" size="sm">Admin</Badge>
    </div>

    <nav class="admin-nav" aria-label="Admin navigation">
      {#each ADMIN_NAV as item}
        <a
          href={item.href}
          class="admin-nav-item"
          class:active={currentPath === item.href || (item.href !== '/admin' && currentPath.startsWith(item.href))}
          aria-current={currentPath === item.href ? 'page' : undefined}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={NAV_ICONS[item.icon] ?? ''} />
          </svg>
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="admin-sidebar__footer">
      <a href="/" class="admin-back-link">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Back to app
      </a>
    </div>
  </aside>

  <!-- Main -->
  <div class="admin-main">
    <header class="admin-topbar">
      <div class="admin-topbar__breadcrumb">
        <span class="admin-topbar__section">Admin</span>
        <span class="admin-topbar__sep" aria-hidden="true">/</span>
        <span class="admin-topbar__page">{currentPath.split('/').pop() || 'Overview'}</span>
      </div>
      <div class="admin-topbar__right">
        <ThemeToggle />
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
                {(user?.displayName ?? user?.email ?? "A").slice(0, 2).toUpperCase()}
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
                  {#if user?.photoURL}
                    <img src={user.photoURL} alt="" class="user-menu__avatar-img" />
                  {:else}
                    <span class="user-menu__avatar-initials">
                      {(user?.displayName ?? user?.email ?? "A").slice(0, 2).toUpperCase()}
                    </span>
                  {/if}
                </div>
                <div class="user-menu__identity">
                  <span class="user-menu__name">{user?.displayName || "Admin"}</span>
                  {#if user?.email}
                    <span class="user-menu__email">{user.email}</span>
                  {/if}
                  <div class="user-menu__badges">
                    <Badge variant="danger" size="sm">Admin</Badge>
                    {#if shopStore.shop}
                      <span class="user-menu__shop-chip">{shopStore.shop.name}</span>
                    {/if}
                  </div>
                </div>
              </div>

              <hr class="user-menu__sep" />

              <a href="/studio"   role="menuitem" class="user-menu__item" onclick={closeMenu}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>
                Back to Studio
              </a>
              <a href="/settings" role="menuitem" class="user-menu__item" onclick={closeMenu}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                Settings
              </a>

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

    <div class="admin-content">
      {@render children()}
    </div>
  </div>
</div>
{/if}

<style>
  .auth-gate {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: var(--bg-base);
  }
  .auth-gate__spinner {
    width: 28px;
    height: 28px;
    border: 2px solid var(--border-default);
    border-top-color: var(--color-brand);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .admin-shell {
    display: grid;
    grid-template-columns: 220px 1fr;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-base);
  }

  .admin-sidebar {
    background: var(--bg-surface);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .admin-sidebar__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .admin-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 8px;
    overflow-y: auto;
  }

  .admin-nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-tertiary);
    text-decoration: none;
    transition: background 0.12s, color 0.12s;
  }

  .admin-nav-item:hover  { background: var(--interactive-hover); color: var(--text-primary); }
  .admin-nav-item.active { background: var(--bg-surface-3); color: var(--text-primary); }

  .admin-sidebar__footer {
    padding: 12px 8px;
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .admin-back-link {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.8125rem; color: var(--text-tertiary);
    text-decoration: none; padding: 6px 10px;
    border-radius: var(--radius-md);
    transition: color 0.12s, background 0.12s;
  }

  .admin-back-link:hover { color: var(--text-primary); background: var(--interactive-hover); }

  .admin-main { display: flex; flex-direction: column; overflow: hidden; }

  .admin-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 52px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .admin-topbar__breadcrumb {
    display: flex; align-items: center; gap: 8px;
    font-size: 0.875rem;
  }

  .admin-topbar__section { color: var(--text-tertiary); }
  .admin-topbar__sep     { color: var(--text-tertiary); opacity: 0.4; }
  .admin-topbar__page    { color: var(--text-primary); font-weight: 500; text-transform: capitalize; }

  .admin-topbar__right { display: flex; align-items: center; gap: 10px; }

  /* ─── Avatar dropdown ────── */
  .avatar-wrap { position: relative; }

  .avatar {
    width: 30px; height: 30px; border-radius: 50%; overflow: hidden;
    background: var(--color-danger);
    display: flex; align-items: center; justify-content: center;
    border: 2px solid transparent; cursor: pointer; flex-shrink: 0;
    transition: border-color 0.15s, opacity 0.15s;
  }
  .avatar:hover     { opacity: 0.85; }
  .avatar--open     { border-color: var(--color-danger); }
  .avatar__img      { width: 100%; height: 100%; object-fit: cover; }
  .avatar__initials { font-family: var(--font-display); font-size: 0.6875rem; font-weight: 700; color: #fff; }

  .user-menu {
    position: fixed; width: 240px;
    background: var(--bg-surface); border: 1px solid var(--border-default);
    border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
    padding: 6px; z-index: 500;
    animation: menu-in 0.12s var(--ease-smooth);
  }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }

  .user-menu__header { display: flex; align-items: flex-start; gap: 10px; padding: 10px 10px 8px; }
  .user-menu__avatar {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    background: var(--color-danger);
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
  .user-menu__item svg  { flex-shrink: 0; opacity: 0.7; }
  .user-menu__item:hover { background: var(--interactive-hover); color: var(--text-primary); }
  .user-menu__item:hover svg { opacity: 1; }
  .user-menu__item--danger       { color: var(--color-danger); }
  .user-menu__item--danger svg   { opacity: 1; color: var(--color-danger); }
  .user-menu__item--danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }

  .admin-content { flex: 1; overflow-y: auto; }

  @media (max-width: 768px) {
    .admin-shell { grid-template-columns: 1fr; }
    .admin-sidebar { display: none; }
  }
</style>
