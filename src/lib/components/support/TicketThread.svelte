<script lang="ts">
	import type { Ticket, TicketMessage } from "$lib/support/tickets";

	interface Props {
		ticket: Ticket;
		/** Whose screen this is — their own messages sit on the right. */
		viewer: "user" | "admin";
	}
	let { ticket, viewer }: Props = $props();

	// The original request is stored on the ticket itself, not in messages[] —
	// fold it in as the first entry so the thread reads top to bottom.
	const entries = $derived<TicketMessage[]>([
		{ id: "original", from: "user", body: ticket.message, authorName: ticket.name, at: ticket.createdAt },
		...[...ticket.messages].sort((a, b) => a.at - b.at),
	]);

	function authorLabel(m: TicketMessage): string {
		if (m.from === "user") return viewer === "user" ? "You" : m.authorName || ticket.name || ticket.email;
		if (m.internal) return `${m.authorName ?? "Staff"} · internal note`;
		return viewer === "admin" ? m.authorName ?? "Support" : "OmniPlot Support";
	}

	function fmt(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	}

	function isMine(m: TicketMessage): boolean {
		return viewer === "user" ? m.from === "user" : m.from === "admin";
	}
</script>

<ol class="thread" aria-label="Conversation">
	{#each entries as m (m.id)}
		{#if m.from === "system"}
			<li class="thread__system">
				<span>{m.body}</span>
				<time datetime={new Date(m.at).toISOString()}>{fmt(m.at)}</time>
			</li>
		{:else}
			<li
				class="msg"
				class:msg--mine={isMine(m)}
				class:msg--support={m.from === "admin" && !m.internal}
				class:msg--internal={m.internal}
			>
				<div class="msg__meta">
					<span class="msg__author">{authorLabel(m)}</span>
					<time datetime={new Date(m.at).toISOString()}>{fmt(m.at)}</time>
				</div>
				<p class="msg__body">{m.body}</p>
			</li>
		{/if}
	{/each}
</ol>

<style>
	.thread {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.msg {
		max-width: min(640px, 88%);
		padding: 12px 14px;
		border-radius: var(--radius-lg);
		background: var(--bg-surface-2);
		border: 1px solid var(--border-subtle);
	}
	.msg--mine { margin-left: auto; }
	.msg--support {
		background: var(--color-brand-muted);
		border-color: var(--border-brand);
	}
	.msg--internal {
		background: color-mix(in srgb, var(--color-warning) 8%, transparent);
		border: 1px dashed color-mix(in srgb, var(--color-warning) 45%, transparent);
	}

	.msg__meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 4px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.msg__author {
		font-weight: 600;
		color: var(--text-secondary);
	}
	.msg--internal .msg__author { color: var(--text-warning); }

	.msg__body {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--text-primary);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.thread__system {
		display: flex;
		justify-content: center;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		padding: 2px 0;
	}
	.thread__system time { opacity: 0.7; }

	@media (max-width: 600px) {
		.msg { max-width: 100%; }
	}
</style>
