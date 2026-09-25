import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { checkRateLimit, rateLimitedResponse } from '$lib/server/rate-limit';
import { SHOP_PLAN_LIMITS } from '$lib/config';
import { TICKET_TOPICS, TOPIC_LABEL, ticketRef, type TicketTopic } from '$lib/support/tickets';
import { createTicket } from '$lib/server/support/store';
import { runIntake, suggestionsFor } from '$lib/server/support/intake';
import { notifyTicketCreated, requesterLink } from '$lib/server/support/notify';
import type { ShopPlan } from '$lib/types';

const TOPICS = new Set(TICKET_TOPICS.map((t) => t.value));

/** Plan context for triage — resolved server-side so it can't be spoofed. */
async function requesterContext(uid: string | null) {
	if (!uid) return { email: null, name: null, tier: null, shopPlan: null, prioritySupport: false };
	const db = getAdminDb();
	const user = (await db.doc(`users/${uid}`).get()).data() ?? {};
	let shopPlan: ShopPlan | null = null;
	if (user.shopId) {
		shopPlan = ((await db.doc(`shops/${user.shopId}`).get()).data()?.plan ?? null) as ShopPlan | null;
	}
	const prioritySupport =
		user.tier === 'pro' || (!!shopPlan && SHOP_PLAN_LIMITS[shopPlan]?.prioritySupport === true);
	return {
		email: (user.email as string | undefined) ?? null,
		name: (user.displayName as string | undefined) ?? null,
		tier: (user.tier as string | undefined) ?? 'free',
		shopPlan,
		prioritySupport,
	};
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Works signed-out too (locked-out users are a big share of tickets), so
	// throttle per IP to keep the form from being a spam relay.
	const limit = await checkRateLimit(`support:${getClientAddress()}`, { max: 5, windowSeconds: 300 });
	if (!limit.allowed) return rateLimitedResponse(limit);

	let body: { topic?: string; subject?: string; name?: string; email?: string; message?: string; pageUrl?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const uid = await verifyIdToken(request.headers.get('authorization'));
	const ctx = await requesterContext(uid);

	const topic = (TOPICS.has(body.topic as TicketTopic) ? body.topic : 'other') as TicketTopic;
	const email = (ctx.email ?? body.email ?? '').trim().toLowerCase();
	const name = (body.name?.trim() || ctx.name || '').slice(0, 120);
	const message = (body.message ?? '').trim();
	const subject = (body.subject?.trim() || TOPIC_LABEL[topic]).slice(0, 140);

	if (!email || !message) return json({ error: 'Email and message are required.' }, { status: 400 });
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, { status: 400 });
	if (message.length > 5000) return json({ error: 'Messages are limited to 5,000 characters.' }, { status: 400 });

	const intake = runIntake({ topic, subject, message, prioritySupport: ctx.prioritySupport });

	let created;
	try {
		created = await createTicket({
			uid,
			email,
			name,
			topic,
			subject,
			message,
			pageUrl: (body.pageUrl ?? '').slice(0, 500),
			ip: getClientAddress(),
			userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
			tier: ctx.tier,
			shopPlan: ctx.shopPlan,
			tags: intake.tags,
			priority: intake.priority,
		});
	} catch (err) {
		console.error('[support POST] Firestore write failed:', err);
		return json({ error: 'Failed to submit request. Please try again.' }, { status: 500 });
	}

	const suggestions = suggestionsFor(topic, intake.tags);
	await notifyTicketCreated(created.ticket, created.accessKey, suggestions);

	// Relative, so the success screen routes within whatever origin it's on.
	const link = new URL(requesterLink(created.ticket, created.accessKey));

	return json({
		ok: true,
		id: created.ticket.id,
		ref: ticketRef(created.ticket.id),
		link: link.pathname + link.search,
		suggestions,
	});
};
