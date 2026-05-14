<script lang="ts">
  import type { Snippet } from 'svelte';
  import Logo from '$lib/components/ui/Logo.svelte';
  import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
  interface Props { children: Snippet; }
  let { children }: Props = $props();
</script>

<div class="auth-shell">
  <header class="auth-header">
    <Logo size={28} />
    <ThemeToggle />
  </header>

  <main class="auth-main">
    <div class="auth-card">
      {@render children()}
    </div>
  </main>

  <footer class="auth-footer">
    <a href="/privacy" class="auth-footer-link">Privacy</a>
    <a href="/terms"   class="auth-footer-link">Terms</a>
    <a href="/faq"     class="auth-footer-link">FAQ</a>
  </footer>
</div>

<style>
  .auth-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-base);
  }

  .auth-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
  }

  .auth-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
  }

  .auth-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-2xl);
    padding: 36px;
    width: 100%;
    max-width: 420px;
    box-shadow: var(--shadow-lg);
  }

  .auth-footer {
    padding: 16px 24px;
    display: flex;
    justify-content: center;
    gap: 20px;
    border-top: 1px solid var(--border-subtle);
  }

  .auth-footer-link {
    font-size: 0.8125rem;
    color: var(--text-tertiary);
    text-decoration: none;
    transition: color 0.12s;
  }

  .auth-footer-link:hover { color: var(--text-primary); }
</style>
