import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import {
	addMessage,
	changeStatus,
	deleteTicket,
	getTicket,
	listTicketsForUser,
	markSeen,
	updateTriage,
	TicketError,
} from '$lib/server/support/store';
import { notifyAdminReply, notifyStatusChange } from '$lib/server/support/notify';
import { cannedById } from '$lib/support/responses';
import type { Ticket, TicketPriority, TicketStatus } from '$lib/support/tickets';

const STATUSES: TicketStatus[] = ['new', 'in_progress', 'awaiting_customer', 'resolved', 'closed'];
const PRIORITIES: TicketPriority[] = ['normal', 'high', 'urgent'];

function toMs(v: unknown): number | null {
	if (!v) return null;
	if (typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
	if (v instanceof Date) return v.getTime();
	return typeof v === 'number' ? v : null;
}

/** Everything a non-technical admin needs to resolve the ticket without
 *  opening three other admin pages: plan + billing state, shop, their other
 *  tickets, and anything they (or the server) reported recently. */
async function customerContext(t: Ticket) {
	const db = getAdminDb();
	let uid = t.uid;
	if (!uid && t.email) {
		const match = await db.collection('users').where('email', '==', t.email).limit(1).get();
		uid = match.docs[0]?.id ?? null;
	}
	if (!uid) {
		const others = await listTicketsForUser(null, t.email || null);
		return { account: null, related: others.filter((o) => o.id !== t.id).map(slim), reports: [], errors: [] };
	}

	const [userSnap, related, reportsSnap, errorsSnap] = await Promise.all([
		db.doc(`users/${uid}`).get(),
		listTicketsForUser(uid, t.email),
		db.collection('reports').where('uid', '==', uid).limit(20).get(),
		db.collection('errorLogs').where('uid', '==', uid).limit(20).get(),
	]);
	const u = userSnap.data() ?? {};
	const shop = u.shopId ? (await db.doc(`shops/${u.shopId}`).get()).data() : null;

	return {
		account: {
			uid,
			displayName: u.displayName ?? '',
			email: u.email ?? '',
			tier: u.tier ?? 'free',
			createdAt: toMs(u.createdAt),
			subscriptionStatus: u.subscription?.status ?? null,
			cancelAtPeriodEnd: !!u.subscription?.cancelAtPeriodEnd,
			pausedCollection: !!u.subscription?.pausedCollection,
			currentPeriodEnd: toMs(u.subscription?.currentPeriodEnd),
			stripeCustomerId: u.subscription?.stripeCustomerId ?? shop?.stripeCustomerId ?? null,
			cutCount: u.usage?.cutCount ?? 0,
			lastCutAt: toMs(u.usage?.lastCutAt),
			shop: shop ? { name: shop.name ?? '', plan: shop.plan ?? null, role: u.shopRole ?? null, status: shop.subscriptionStatus ?? null } : null,
		},
		related: related.filter((o) => o.id !== t.id).map(slim),
		reports: reportsSnap.docs
			.map((d) => ({ id: d.id, title: d.data().title ?? '', type: d.data().type ?? 'bug', status: d.data().status ?? 'open', createdAt: toMs(d.data().createdAt) ?? 0 }))
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 5),
		errors: errorsSnap.docs
			.map((d) => ({ id: d.id, route: d.data().route ?? '', message: String(d.data().message ?? '').slice(0, 160), count: d.data().occurrenceCount ?? 1, lastSeenAt: toMs(d.data().lastSeenAt) ?? 0 }))
			.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
			.slice(0, 5),
	};
}

function slim(t: Ticket) {
	return { id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt };
}

export const GET: RequestHandler = async ({ request, params }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

	const found = await getTicket(params.id);
	if (!found) return json({ error: 'Ticket not found' }, { status: 404 });

	try {
		const [context] = await Promise.all([customerContext(found.ticket), markSeen(params.id, 'admin')]);
		return json({ ticket: found.ticket, context });
	} catch (err) {
		console.error('[admin/support/id GET]', err);
		return json({ ticket: found.ticket, context: null });
	}
};

export const POST: RequestHandler = async ({ request, params }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

	const payload = await request.json().catch(() => ({}));
	const found = await getTicket(params.id);
	if (!found) return json({ error: 'Ticket not found' }, { status: 404 });
	const { ticket, accessKey } = found;

	try {
		switch (payload.action) {
			// Reply to the customer. The status to land in comes from the form
			// (pre-filled by the chosen canned response's trigger); the canned
			// response's tags are resolved server-side by id.
			case 'reply': {
				const body = String(payload.body ?? '').trim();
				if (!body) return json({ error: 'Write a reply before sending.' }, { status: 400 });
				const canned = cannedById(payload.cannedId);
				const status: TicketStatus = STATUSES.includes(payload.status) ? payload.status : canned?.setStatus ?? 'awaiting_customer';
				const updated = await addMessage(
					ticket.id,
					{ from: 'admin', body, authorName: admin.name, authorUid: admin.uid },
					{ status, addTags: canned?.addTags },
				);
				await notifyAdminReply(updated, accessKey, body);
				return json({ ticket: updated });
			}

			case 'note': {
				const body = String(payload.body ?? '').trim();
				if (!body) return json({ error: 'Write a note first.' }, { status: 400 });
				const updated = await addMessage(ticket.id, { from: 'admin', body, authorName: admin.name, authorUid: admin.uid, internal: true });
				return json({ ticket: updated });
			}

			case 'status': {
				if (!STATUSES.includes(payload.status)) return json({ error: 'Invalid status' }, { status: 400 });
				if (payload.status === ticket.status) return json({ ticket });
				const updated = await changeStatus(ticket.id, payload.status, { actor: 'admin' });
				if (payload.notify !== false) await notifyStatusChange(updated, accessKey);
				return json({ ticket: updated });
			}

			case 'triage': {
				const priority = PRIORITIES.includes(payload.priority) ? payload.priority : undefined;
				const tags = Array.isArray(payload.tags) ? payload.tags.map(String) : undefined;
				await updateTriage(ticket.id, { priority, tags });
				return json({ ticket: (await getTicket(ticket.id))!.ticket });
			}

			default:
				return json({ error: 'Unknown action' }, { status: 400 });
		}
	} catch (err) {
		if (err instanceof TicketError) return json({ error: err.message }, { status: err.status });
		console.error('[admin/support/id POST]', err);
		return json({ error: 'Something went wrong.' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	await deleteTicket(params.id);
	return json({ ok: true });
};
