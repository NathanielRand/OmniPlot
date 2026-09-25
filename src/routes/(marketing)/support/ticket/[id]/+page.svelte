<script lang="ts">
	import { page } from "$app/state";
	import RequesterTicket from "$lib/components/support/RequesterTicket.svelte";
	import { auth } from "$lib/firebase/client";
	import { hasUserUnread, type Ticket } from "$lib/support/tickets";

	// Guest view, reached from the link in support emails — works without an
	// account (the "I can't sign in" case) via the ticket's access key.
	const key = $derived(page.url.searchParams.get("k") ?? "");

	let ticket = $state<Ticket | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function call(method: "GET" | "POST", payload?: object): Promise<Ticket> {
		const token = await auth.currentUser?.getIdToken().catch(() => null);
		const res = await fetch(`/api/support/tickets/${page.params.id}?k=${encodeURIComponent(key)}`, {
			method,
			headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: payload ? JSON.stringify(payload) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
		return data.ticket;
	}

	$effect(() => {
		page.params.id;
		loading = true;
		call("GET")
			.then((t) => {
				ticket = t;
				if (hasUserUnread(t)) call("POST", { action: "seen" }).catch(() => {});
			})
			.catch(() => (error = "We couldn't find that ticket. The link may be incomplete — try opening it from your email again."))
			.finally(() => (loading = false));
	});
</script>

<svelte:head>
	<title>{ticket?.subject ?? "Support ticket"} — OmniPlot</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page">
	<a class="back" href="/support">← Support</a>

	{#if loading}
		<div class="state"><span class="spinner" aria-label="Loading…"></span></div>
	{:else if error || !ticket}
		<div class="state">
			<p>{error}</p>
			<p><a href="/support">Open a new request</a></p>
		</div>
	{:else}
		<RequesterTicket bind:ticket send={(payload) => call("POST", payload)} />
	{/if}
</div>

<style>
	.page { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; display: flex; flex-direction: column; gap: 16px; }
	.back { font-size: 0.8125rem; color: var(--text-tertiary); text-decoration: none; align-self: flex-start; }
	.back:hover { color: var(--text-primary); }
	.state { padding: 48px 16px; text-align: center; color: var(--text-secondary); }
	.state p { margin: 0 0 8px; }
	.state a { color: var(--text-brand); }
	.spinner {
		display: inline-block; width: 24px; height: 24px;
		border: 2px solid var(--border-default); border-top-color: var(--color-brand);
		border-radius: 50%; animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 600px) { .page { padding: 24px 16px 64px; } }
</style>
