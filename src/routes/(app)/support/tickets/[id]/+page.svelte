<script lang="ts">
	import { page } from "$app/state";
	import RequesterTicket from "$lib/components/support/RequesterTicket.svelte";
	import { auth } from "$lib/firebase/client";
	import { supportStore } from "$lib/stores";
	import { hasUserUnread, type Ticket } from "$lib/support/tickets";

	let ticket = $state<Ticket | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function call(method: "GET" | "POST", payload?: object): Promise<Ticket> {
		const token = await auth.currentUser?.getIdToken();
		const res = await fetch(`/api/support/tickets/${page.params.id}`, {
			method,
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: payload ? JSON.stringify(payload) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
		return data.ticket;
	}

	async function send(payload: object): Promise<Ticket> {
		const updated = await call("POST", payload);
		supportStore.refreshUser();
		return updated;
	}

	$effect(() => {
		page.params.id;
		loading = true;
		error = null;
		call("GET")
			.then(async (t) => {
				ticket = t;
				// Opening the ticket is what clears its unread dot / nav badge.
				if (hasUserUnread(t)) {
					await call("POST", { action: "seen" }).catch(() => {});
					supportStore.refreshUser();
				}
			})
			.catch((err) => (error = err.message))
			.finally(() => (loading = false));
	});
</script>

<svelte:head><title>{ticket?.subject ?? "Support ticket"} — OmniPlot</title></svelte:head>

<div class="page">
	<a class="back" href="/support/tickets">← All tickets</a>

	{#if loading}
		<div class="state"><span class="spinner" aria-label="Loading…"></span></div>
	{:else if error || !ticket}
		<div class="state">{error ?? "Ticket not found."}</div>
	{:else}
		<RequesterTicket bind:ticket {send} />
	{/if}
</div>

<style>
	.page { max-width: 820px; margin: 0 auto; padding: 24px 24px 64px; display: flex; flex-direction: column; gap: 16px; }
	.back { font-size: 0.8125rem; color: var(--text-tertiary); text-decoration: none; align-self: flex-start; }
	.back:hover { color: var(--text-primary); }
	.state { padding: 48px 16px; text-align: center; color: var(--text-secondary); }
	.spinner {
		display: inline-block; width: 24px; height: 24px;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 600px) { .page { padding: 16px 16px 48px; } }
</style>
