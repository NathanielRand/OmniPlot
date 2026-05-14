<script lang="ts">
  import type { Snippet } from 'svelte';
  import AppShell from '$lib/components/layout/AppShell.svelte';

  interface Props { children: Snippet; }
  let { children }: Props = $props();
</script>

<AppShell>
  {@render children()}
</AppShell>
