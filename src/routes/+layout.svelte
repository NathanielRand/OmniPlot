<script lang="ts">
	import "../app.css";
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import { themeStore, patternStore, userStore, shopStore, uiStore, changelogStore, plotterStatusStore } from "$lib/stores";
	import Toast from "$lib/components/ui/Toast.svelte";
	import PricingModal from "$lib/components/ui/PricingModal.svelte";
	import ReportModal from "$lib/components/ui/ReportModal.svelte";
	import UpdateBanner from "$lib/components/ui/UpdateBanner.svelte";
	import MaintenanceBanner from "$lib/components/ui/MaintenanceBanner.svelte";
	import ConfirmModal from "$lib/components/ui/ConfirmModal.svelte";
	import ChangelogModal from "$lib/components/ui/ChangelogModal.svelte";
	import TooltipHost from "$lib/components/ui/TooltipHost.svelte";
	import { initAuth } from "$lib/firebase/auth";
	import { subscribeToShop, subscribeToOrg } from "$lib/firebase/firestore";

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

	// Auto-surface the "what's new" modal once per release, right after we
	// know whether this visitor has unseen releases (init() runs above).
	// Never over a running cut — it waits until the job finishes.
	$effect(() => {
		if (changelogStore.shouldShowModal && userStore.isAuth && plotterStatusStore.current.state !== "cutting") {
			uiStore.openChangelogModal();
		}
	});

	// A reload or full-page navigation mid-cut would cut the plotter off
	// mid-job (USB sends run in this tab). Once SvelteKit sees a new deploy,
	// every link click becomes a full page load — so guard the tab itself.
	$effect(() => {
		if (plotterStatusStore.current.state !== "cutting") return;
		const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
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

	// Team subscription status lives on the shop's org — keep it live too so
	// seat entitlements flip the moment the org's billing changes.
	$effect(() => {
		const orgId = shopStore.shop?.orgId;
		if (!orgId) {
			shopStore.setOrg(null);
			return;
		}
		return subscribeToOrg(orgId, (o) => shopStore.setOrg(o));
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
<MaintenanceBanner />
<ConfirmModal />
<TooltipHost />
