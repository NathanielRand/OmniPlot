<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { themeStore } from "$lib/stores";
	import Toast from "$lib/components/ui/Toast.svelte";
	import PricingModal from "$lib/components/ui/PricingModal.svelte";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	onMount(() => {
		themeStore.init();
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<title>OmniPlot — Professional PPF Cutting Software</title>
	<meta
		name="description"
		content="Web-based paint protection film cutting software. No install required. Works with any plotter."
	/>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{@render children()}

<Toast />
<PricingModal />
