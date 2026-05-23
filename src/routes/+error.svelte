<script lang="ts">
	import { page } from "$app/stores";
	import Button from "$lib/components/ui/Button.svelte";
</script>

<svelte:head>
	<title>{$page.status} — OmniPlot</title>
</svelte:head>

<div class="error-page">
	<div class="error-card">
		<div class="error-code">{$page.status}</div>
		<h1 class="error-title">
			{#if $page.status === 404}
				Page not found
			{:else if $page.status === 403}
				Access denied
			{:else if $page.status === 500}
				Something went wrong
			{:else}
				Unexpected error
			{/if}
		</h1>
		<p class="error-desc">
			{#if $page.status === 404}
				The page you're looking for doesn't exist or has been moved.
			{:else if $page.status === 403}
				You don't have permission to view this page.
			{:else}
				{$page.error?.message ?? "An unexpected error occurred. Please try again."}
			{/if}
		</p>
		<div class="error-actions">
			<Button variant="primary" size="sm" href="/">Go home</Button>
			<Button variant="ghost" size="sm" onclick={() => history.back()}>Go back</Button>
		</div>
	</div>
</div>

<style>
	.error-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: var(--bg-base);
	}

	.error-card {
		text-align: center;
		max-width: 420px;
	}

	.error-code {
		font-family: var(--font-mono);
		font-size: 5rem;
		font-weight: 800;
		line-height: 1;
		color: var(--border-default);
		margin-bottom: 16px;
		letter-spacing: -0.05em;
	}

	.error-title {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 10px;
		color: var(--text-primary);
	}

	.error-desc {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 28px;
	}

	.error-actions {
		display: flex;
		gap: 8px;
		justify-content: center;
	}
</style>
