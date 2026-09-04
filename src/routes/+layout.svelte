<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { themeStore, patternStore, userStore, shopStore, uiStore, changelogStore } from "$lib/stores";
	import Toast from "$lib/components/ui/Toast.svelte";
	import PricingModal from "$lib/components/ui/PricingModal.svelte";
	import ReportModal from "$lib/components/ui/ReportModal.svelte";
	import UpdateBanner from "$lib/components/ui/UpdateBanner.svelte";
	import ConfirmModal from "$lib/components/ui/ConfirmModal.svelte";
	import ChangelogModal from "$lib/components/ui/ChangelogModal.svelte";
	import { initAuth } from "$lib/firebase/auth";
	import { subscribeToShop } from "$lib/firebase/firestore";

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	onMount(() => {
		themeStore.init();
		changelogStore.init();
		const unsubPatterns = patternStore.init();
		const unsubAuth = initAuth();

		if (sessionStorage.getItem("omniplot_open_upgrade") === "1") {
			sessionStorage.removeItem("omniplot_open_upgrade");
			uiStore.openPricing();
		}

		return () => { unsubAuth(); unsubPatterns(); };
	});

	// Auto-surface the "what's new" modal once, right after we know whether
	// this visitor has unseen releases (init() runs synchronously above).
	$effect(() => {
		if (changelogStore.hasUnseen && userStore.isAuth) {
			uiStore.openChangelogModal();
		}
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
<ConfirmModal />
