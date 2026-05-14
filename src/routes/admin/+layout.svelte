<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import Logo from '$lib/components/ui/Logo.svelte';
  import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { ADMIN_NAV } from '$lib/config';

  interface Props { children: Snippet; }
  let { children }: Props = $props();

  const currentPath = $derived(page.url.pathname);

  const NAV_ICONS: Record<string, string> = {
    'layout-dashboard': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    'users':            'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    'vector-bezier':    'M3 3l4 4 10-10 4 4-10 10-4-4zM3 17v4h4l10-10-4-4L3 17z',
    'chart-bar':        'M18 20V10M12 20V4M6 20v-6',
    'settings':         'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  };
</script>

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
        <div class="admin-avatar" aria-label="Admin user">A</div>
      </div>
    </header>

    <div class="admin-content">
      {@render children()}
    </div>
  </div>
</div>

<style>
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

  .admin-avatar {
    width: 30px; height: 30px;
    border-radius: 50%;
    background: var(--color-danger);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-size: 0.75rem; font-weight: 700; color: #fff;
  }

  .admin-content { flex: 1; overflow-y: auto; }

  @media (max-width: 768px) {
    .admin-shell { grid-template-columns: 1fr; }
    .admin-sidebar { display: none; }
  }
</style>
