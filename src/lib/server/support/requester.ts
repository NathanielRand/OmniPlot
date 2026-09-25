// ─────────────────────────────────────────────
// OmniPlot — REQUESTER-SIDE TICKET ACTIONS
// ─────────────────────────────────────────────
// Shared by the signed-in endpoint and the guest (access-key) endpoint so a
// reply behaves identically either way. The reply-starter intent is the
// trigger: "That fixed it" resolves, "Still not working" reopens + escalates.

import type { ReplyIntent } from '$lib/support/responses';
import type { Ticket } from '$lib/support/tickets';
import { addMessage, changeStatus, markSeen, toRequesterView, TicketError } from './store';
import { bumpPriority } from './intake';
import { notifyCustomerReply } from './notify';

const INTENTS: ReplyIntent[] = ['resolved', 'still_broken', 'info'];
const MAX_BODY = 5000;

export async function handleRequesterAction(
	ticket: Ticket,
	accessKey: string | null,
	payload: { action?: string; body?: string; intent?: string },
	author: { uid: string | null; name: string },
): Promise<Ticket> {
	switch (payload.action) {
		case 'seen': {
			await markSeen(ticket.id, 'user');
			return toRequesterView({ ...ticket, userLastSeenAt: Date.now() });
		}

		case 'resolve': {
			if (ticket.status === 'resolved' || ticket.status === 'closed') return toRequesterView(ticket);
			return toRequesterView(await changeStatus(ticket.id, 'resolved', { actor: 'user', name: author.name }));
		}

		case 'reply': {
			const body = payload.body?.trim() ?? '';
			if (!body) throw new TicketError('Write a message before sending.');
			if (body.length > MAX_BODY) throw new TicketError(`Messages are limited to ${MAX_BODY} characters.`);
			if (ticket.status === 'closed') throw new TicketError('This ticket is closed — please open a new request.', 409);

			const intent: ReplyIntent = INTENTS.includes(payload.intent as ReplyIntent) ? (payload.intent as ReplyIntent) : 'info';
			const reopened = ticket.status === 'resolved' && intent !== 'resolved';

			const updated = await addMessage(
				ticket.id,
				{ from: 'user', body, authorName: ticket.name || undefined, authorUid: author.uid ?? undefined },
				intent === 'resolved'
					? { status: 'resolved' }
					: intent === 'still_broken'
						? { status: 'in_progress', priority: bumpPriority(ticket.priority), addTags: ['still-broken'] }
						// A reply on a ticket nobody has picked up yet leaves it "new".
						: { status: ticket.status === 'new' ? 'new' : 'in_progress' },
			);

			// "That fixed it" closes the loop on its own — no need to page staff.
			if (intent !== 'resolved') await notifyCustomerReply(updated, accessKey, body, reopened);
			return toRequesterView(updated);
		}

		default:
			throw new TicketError('Unknown action');
	}
}
