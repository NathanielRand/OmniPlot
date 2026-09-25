// ─────────────────────────────────────────────
// OmniPlot — SUPPORT NOTIFICATIONS
// ─────────────────────────────────────────────
// Who gets emailed when. Everything here is best-effort: a failed email is
// logged, never surfaced as a failed reply — the message is already saved on
// the ticket and visible (and badged) in the app.

import {
	sendTicketReceivedEmail,
	sendTicketReplyEmail,
	sendTicketStatusEmail,
	sendTicketNudgeEmail,
	sendAdminTicketEmail,
	type SupportEmailTicket,
} from '$lib/server/email';
import { TOPIC_LABEL, ticketRef, type Ticket } from '$lib/support/tickets';
import type { Suggestion } from './intake';

const ORIGIN = 'https://www.omniplot.app';

/** Account-holders go to the in-app thread (sign-in required); guests get a
 *  keyed link that works without an account — the "I can't sign in" case. */
export function requesterLink(t: Ticket, accessKey: string | null): string {
	if (t.uid) return `${ORIGIN}/support/tickets/${t.id}`;
	return `${ORIGIN}/support/ticket/${t.id}?k=${accessKey ?? ''}`;
}

export function adminLink(t: Ticket): string {
	return `${ORIGIN}/admin/support/${t.id}`;
}

function toEmail(t: Ticket, accessKey: string | null): SupportEmailTicket {
	return {
		ref:        ticketRef(t.id),
		subject:    t.subject,
		name:       t.name,
		email:      t.email,
		topicLabel: TOPIC_LABEL[t.topic] ?? t.topic,
		link:       requesterLink(t, accessKey),
	};
}

async function attempt(label: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
	} catch (err) {
		console.error(`[support/notify] ${label} failed:`, err);
	}
}

export async function notifyTicketCreated(t: Ticket, accessKey: string, suggestions: Suggestion[]): Promise<void> {
	await Promise.all([
		attempt('ack to requester', () => sendTicketReceivedEmail(toEmail(t, accessKey), suggestions)),
		attempt('new-ticket to staff', () =>
			sendAdminTicketEmail({ ...toEmail(t, accessKey), priority: t.priority, tags: t.tags, tier: t.tier }, 'new', t.message, adminLink(t)),
		),
	]);
}

export async function notifyAdminReply(t: Ticket, accessKey: string | null, body: string): Promise<void> {
	if (!t.email) return;
	await attempt('reply to requester', () => sendTicketReplyEmail(toEmail(t, accessKey), body, t.status));
}

export async function notifyStatusChange(t: Ticket, accessKey: string | null, auto = false): Promise<void> {
	if (!t.email || (t.status !== 'resolved' && t.status !== 'closed')) return;
	await attempt('status to requester', () => sendTicketStatusEmail(toEmail(t, accessKey), t.status as 'resolved' | 'closed', auto));
}

export async function notifyCustomerReply(t: Ticket, accessKey: string | null, body: string, reopened: boolean): Promise<void> {
	await attempt('customer reply to staff', () =>
		sendAdminTicketEmail(
			{ ...toEmail(t, accessKey), priority: t.priority, tags: t.tags, tier: t.tier },
			reopened ? 'reopened' : 'reply',
			body,
			adminLink(t),
		),
	);
}

export async function notifyNudge(t: Ticket, accessKey: string | null): Promise<void> {
	await attempt('nudge to requester', () => sendTicketNudgeEmail(toEmail(t, accessKey)));
}
