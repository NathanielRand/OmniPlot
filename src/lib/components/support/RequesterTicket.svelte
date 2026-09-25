<script lang="ts">
	import Badge from "$lib/components/ui/Badge.svelte";
	import TicketThread from "./TicketThread.svelte";
	import { REPLY_STARTERS, type ReplyIntent } from "$lib/support/responses";
	import {
		STATUS_LABEL_USER,
		STATUS_VARIANT,
		TOPIC_LABEL,
		needsAdminAction,
		needsUserAction,
		ticketRef,
		type Ticket,
	} from "$lib/support/tickets";

	interface Props {
		ticket: Ticket;
		/** Performs a requester action against the API and returns the updated ticket. */
		send: (payload: { action: "reply" | "resolve"; body?: string; intent?: ReplyIntent }) => Promise<Ticket>;
	}
	let { ticket = $bindable(), send }: Props = $props();

	let body = $state("");
	let intent = $state<ReplyIntent>("info");
	let busy = $state(false);
	let error = $state<string | null>(null);
	let sentNote = $state<string | null>(null);

	const closed = $derived(ticket.status === "closed");
	const resolved = $derived(ticket.status === "resolved");

	function applyStarter(s: (typeof REPLY_STARTERS)[number]) {
		body = s.body;
		intent = s.intent;
		sentNote = null;
	}

	async function run(payload: Parameters<Props["send"]>[0], note: string) {
		busy = true;
		error = null;
		sentNote = null;
		try {
			ticket = await send(payload);
			sentNote = note;
			body = "";
			intent = "info";
		} catch (err) {
			error = err instanceof Error ? err.message : "Something went wrong. Please try again.";
		} finally {
			busy = false;
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!body.trim()) return;
		run(
			{ action: "reply", body, intent },
			intent === "resolved" ? "Thanks! We've marked this resolved." : resolved ? "Sent — we've reopened your ticket." : "Message sent.",
		);
	}
</script>

<div class="rt">
	<header class="rt__head">
		<div class="rt__title-wrap">
			<h1 class="rt__title">{ticket.subject}</h1>
			<p class="rt__meta">
				{ticketRef(ticket.id)} · {TOPIC_LABEL[ticket.topic] ?? "Support"} · Opened
				{new Date(ticket.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
			</p>
		</div>
		<Badge variant={STATUS_VARIANT[ticket.status]} size="md">{STATUS_LABEL_USER[ticket.status]}</Badge>
	</header>

	{#if needsUserAction(ticket)}
		<div class="rt__banner rt__banner--action" role="status">
			We replied and need a bit more from you — take a look below.
		</div>
	{:else if needsAdminAction(ticket)}
		<div class="rt__banner" role="status">
			We've got your message and will reply here — usually within one business day. We'll email you too.
		</div>
	{:else if resolved}
		<div class="rt__banner rt__banner--done" role="status">
			This ticket is resolved. Still need help? Reply below and it reopens automatically.
		</div>
	{/if}

	<TicketThread {ticket} viewer="user" />

	{#if closed}
		<p class="rt__closed">
			This ticket is closed. Need more help? <a href="/support">Open a new request</a>.
		</p>
	{:else}
		<form class="rt__composer" onsubmit={submit}>
			<div class="rt__starters" role="group" aria-label="Quick replies">
				{#each REPLY_STARTERS as s}
					{#if !(resolved && s.intent === "resolved")}
						<button
							type="button"
							class="chip"
							class:chip--active={body === s.body}
							onclick={() => applyStarter(s)}
						>{s.label}</button>
					{/if}
				{/each}
			</div>

			<label class="sr-only" for="rt-body">Your message</label>
			<textarea
				id="rt-body"
				class="rt__input"
				rows="5"
				maxlength="5000"
				placeholder={resolved ? "Reply to reopen this ticket…" : "Write a reply…"}
				bind:value={body}
			></textarea>

			{#if intent === "resolved"}
				<p class="rt__hint">Sending this will mark your ticket resolved.</p>
			{:else if intent === "still_broken"}
				<p class="rt__hint">We'll bump this up so it gets looked at first.</p>
			{/if}

			{#if error}<p class="rt__error" role="alert">{error}</p>{/if}
			{#if sentNote}<p class="rt__ok" role="status">{sentNote}</p>{/if}

			<div class="rt__actions">
				{#if !resolved}
					<button
						type="button"
						class="btn btn--ghost"
						disabled={busy}
						onclick={() => run({ action: "resolve" }, "Marked resolved — thanks for letting us know.")}
					>Mark resolved</button>
				{/if}
				<button type="submit" class="btn btn--primary" disabled={busy || !body.trim()}>
					{busy ? "Sending…" : "Send"}
				</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.rt { display: flex; flex-direction: column; gap: 20px; }

	.rt__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.rt__title-wrap { min-width: 0; }
	.rt__title {
		margin: 0;
		font-size: 1.375rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.rt__meta {
		margin: 4px 0 0;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
	}

	.rt__banner {
		padding: 12px 14px;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-default);
	}
	.rt__banner--action {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--color-warning) 10%, transparent);
		border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
	}
	.rt__banner--done {
		background: color-mix(in srgb, var(--color-success) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
	}

	.rt__composer {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 20px;
		border-top: 1px solid var(--border-subtle);
	}
	.rt__starters { display: flex; flex-wrap: wrap; gap: 6px; }

	.chip {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-default);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: var(--font-body);
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.chip:hover { border-color: var(--color-brand-dim); color: var(--text-primary); }
	.chip--active { border-color: var(--color-brand-dim); color: var(--text-brand); background: var(--color-brand-muted); }

	.rt__input {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font: inherit;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--text-primary);
		resize: vertical;
		min-height: 120px;
	}
	.rt__input:focus {
		outline: none;
		border-color: var(--color-brand-dim);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand) 10%, transparent);
	}

	.rt__hint { margin: 0; font-size: 0.8125rem; color: var(--text-tertiary); }
	.rt__error { margin: 0; font-size: 0.875rem; color: var(--text-danger); }
	.rt__ok { margin: 0; font-size: 0.875rem; color: var(--text-success); }

	.rt__actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }

	.btn {
		padding: 9px 18px;
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		transition: opacity 0.12s, background 0.12s;
	}
	.btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.btn--primary { background: var(--color-brand-dim); color: #fff; border: none; }
	.btn--primary:hover:not(:disabled) { opacity: 0.85; }
	.btn--ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-default); }
	.btn--ghost:hover:not(:disabled) { background: var(--interactive-hover); color: var(--text-primary); }

	.rt__closed {
		margin: 0;
		padding-top: 20px;
		border-top: 1px solid var(--border-subtle);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.rt__closed a { color: var(--text-brand); }

	.sr-only {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
	}

	@media (max-width: 600px) {
		.rt__head { flex-direction: column; }
	}
</style>
