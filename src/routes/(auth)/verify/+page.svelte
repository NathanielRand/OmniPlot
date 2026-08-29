<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { toastStore, userStore } from "$lib/stores";
	import { completeMagicLinkSignIn, PENDING_INVITE_KEY } from "$lib/firebase/auth";
	import { acceptShopInvite } from "$lib/firebase/firestore";

	let status = $state<"checking" | "success" | "invalid" | "error">("checking");
	let errorMsg = $state("");
	let _handled = false;
	let wasLinkMode = false;

	onMount(async () => {
		wasLinkMode = localStorage.getItem("omniplot_link_mode") === "1";
		try {
			const completed = await completeMagicLinkSignIn();
			if (completed) {
				status = "success";
				if (wasLinkMode) {
					toastStore.success("Email linked", "You can now sign in with this email too.");
				} else {
					toastStore.success("Signed in", "Welcome to OmniPlot!");
				}
				// $effect below handles redirect once auth state settles
			} else {
				status = "invalid";
			}
		} catch (err: unknown) {
			status = "error";
			errorMsg = err instanceof Error ? err.message : "Sign-in failed.";
			toastStore.error(wasLinkMode ? "Couldn't link email" : "Sign-in failed", errorMsg);
		}
	});

	// Wait for userStore to be populated, then handle any pending invite before redirecting
	$effect(() => {
		if (status !== "success") return;
		if (!userStore.isAuth || !userStore.user) return;
		if (_handled) return;
		_handled = true;

		if (wasLinkMode) {
			setTimeout(() => goto("/settings?tab=security", { replaceState: true }), 800);
			return;
		}

		const pendingToken = localStorage.getItem(PENDING_INVITE_KEY);
		if (pendingToken) {
			const { uid, displayName, email } = userStore.user;
			acceptShopInvite(pendingToken, uid, displayName || email, email)
				.then(() => {
					localStorage.removeItem(PENDING_INVITE_KEY);
					toastStore.success("Welcome to the team!", "You've joined the shop.");
				})
				.catch(() => {
					// Non-fatal — invite may have been accepted elsewhere
				})
				.finally(() => {
					setTimeout(() => goto("/studio", { replaceState: true }), 800);
				});
		} else {
			setTimeout(() => goto("/studio", { replaceState: true }), 800);
		}
	});
</script>

<svelte:head><title>Signing in… — OmniPlot</title></svelte:head>

<div class="verify">
	{#if status === "checking"}
		<span class="spinner" aria-label="Verifying…"></span>
		<p class="verify__msg">Verifying your sign-in link…</p>

	{:else if status === "success"}
		<svg class="icon-ok" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
			<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
		</svg>
		<p class="verify__msg">Signed in! Redirecting…</p>

	{:else if status === "invalid"}
		<p class="verify__msg">This link isn't valid or has already been used.</p>
		<a href="/login" class="verify__back">Back to sign in</a>

	{:else}
		<p class="verify__msg verify__msg--error">{errorMsg || "Something went wrong."}</p>
		<a href="/login" class="verify__back">Try again</a>
	{/if}
</div>

<style>
	.verify {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 8px 0;
	}

	.spinner {
		display: block;
		width: 32px;
		height: 32px;
		border: 2px solid var(--border-default);
		border-top-color: var(--color-brand);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.icon-ok { color: var(--color-success); }

	.verify__msg {
		font-size: 0.9375rem;
		color: var(--text-secondary);
		text-align: center;
		margin: 0;
	}
	.verify__msg--error { color: var(--color-danger); }

	.verify__back {
		font-size: 0.875rem;
		color: var(--text-brand);
		text-decoration: none;
		font-weight: 500;
	}
	.verify__back:hover { text-decoration: underline; }
</style>
