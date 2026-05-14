<script lang="ts">
  import type { Snippet } from 'svelte';
  import MarketingLayout from '$lib/components/layout/MarketingLayout.svelte';
  interface Props { children: Snippet; }
  let { children }: Props = $props();
</script>

<MarketingLayout>
  {@render children()}
</MarketingLayout>
