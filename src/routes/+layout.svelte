<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { themeStore, patternStore, userStore, shopStore, uiStore } from "$lib/stores";
	import Toast from "$lib/components/ui/Toast.svelte";
	import PricingModal from "$lib/components/ui/PricingModal.svelte";
	import ReportModal from "$lib/components/ui/ReportModal.svelte";
	import UpdateBanner from "$lib/components/ui/UpdateBanner.svelte";
	import { initAuth } from "$lib/firebase/auth";
	import { subscribeToShop } from "$lib/firebase/firestore";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	onMount(() => {
		themeStore.init();
		const unsubPatterns = patternStore.init();
		const unsubAuth = initAuth();

		if (sessionStorage.getItem("omniplot_open_upgrade") === "1") {
			sessionStorage.removeItem("omniplot_open_upgrade");
			uiStore.openPricing();
		}

		return () => { unsubAuth(); unsubPatterns(); };
	});

	// Keep shopStore in sync with the signed-in user's shop
	$effect(() => {
		const shopId = userStore.user?.shopId;
		if (!shopId) {
			shopStore.set(null);
			return;
		}
		const unsub = subscribeToShop(shopId, (s) => shopStore.set(s));
		return unsub;
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
<ReportModal />
<UpdateBanner />
