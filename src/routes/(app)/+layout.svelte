<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import { userStore, cutJobStore } from '$lib/stores';

  interface Props { children: Snippet; }
  let { children }: Props = $props();

  // Redirect unauthenticated users to login once Firebase resolves auth state.
  // Initialize the job store when auth resolves so all app pages share one subscription.
  $effect(() => {
    if (userStore.loading) return;
    if (!userStore.isAuth) {
      cutJobStore.cleanup();
      goto('/login', { replaceState: true });
    } else if (userStore.user?.uid) {
      cutJobStore.init(userStore.user.uid);
    }
  });
</script>

{#if userStore.loading}
  <div class="auth-gate" aria-label="Loading">
    <span class="auth-gate__spinner"></span>
  </div>
{:else if userStore.isAuth}
  <AppShell>
    {@render children()}
  </AppShell>
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
</style>
