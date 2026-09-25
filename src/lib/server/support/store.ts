// ─────────────────────────────────────────────
// OmniPlot — SUPPORT TICKET STORE (Firestore, admin SDK only)
// ─────────────────────────────────────────────
// `supportRequests` has no client rules — every read/write goes through the
// API so ownership, guest access keys and internal notes are enforced here.
// Docs written by the original one-way contact form (status 'open', no
// thread) are normalized on read, so they show up in the new inbox as-is.

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '$lib/server/firebase-admin';
import {
	TOPIC_LABEL,
	needsAdminAction,
	needsUserAction,
	type Ticket,
	type TicketActor,
	type TicketMessage,
	type TicketPriority,
	type TicketStatus,
	type TicketTopic,
} from '$lib/support/tickets';

const COLLECTION = 'supportRequests';
const STATUSES: TicketStatus[] = ['new', 'in_progress', 'awaiting_customer', 'resolved', 'closed'];

export class TicketError extends Error {
	constructor(message: string, public status = 400) { super(message); }
}

function col() {
	return getAdminDb().collection(COLLECTION);
}

function toMs(v: unknown): number {
	if (!v) return 0;
	if (typeof v === 'number') return v;
	if (v instanceof Date) return v.getTime();
	if (typeof v === 'string') return new Date(v).getTime() || 0;
	if (typeof (v as { toMillis?: () => number }).toMillis === 'function') return (v as { toMillis: () => number }).toMillis();
	return 0;
}

function normalize(id: string, d: FirebaseFirestore.DocumentData): Ticket {
	const createdAt = toMs(d.createdAt);
	const rawStatus = d.status === 'open' ? 'new' : d.status;
	const status: TicketStatus = STATUSES.includes(rawStatus) ? rawStatus : 'new';
	const lastActivityAt = toMs(d.lastActivityAt) || createdAt;
	return {
		id,
		uid:        d.uid ?? null,
		email:      d.email ?? '',
		name:       d.name ?? '',
		topic:      (d.topic ?? 'other') as TicketTopic,
		subject:    d.subject || d.topicLabel || TOPIC_LABEL[d.topic] || 'Support request',
		message:    d.message ?? '',
		status,
		priority:   (d.priority ?? 'normal') as TicketPriority,
		tags:       d.tags ?? [],
		messages:   (d.messages ?? []) as TicketMessage[],
		pageUrl:    d.pageUrl ?? '',
		tier:       d.tier ?? null,
		shopPlan:   d.shopPlan ?? null,
		createdAt,
		updatedAt:  toMs(d.updatedAt) || lastActivityAt,
		lastActivityAt,
		lastAdminActivityAt: toMs(d.lastAdminActivityAt),
		lastUserActivityAt:  toMs(d.lastUserActivityAt) || createdAt,
		awaitingSince:       toMs(d.awaitingSince) || createdAt,
		userLastSeenAt:      toMs(d.userLastSeenAt),
		adminLastSeenAt:     toMs(d.adminLastSeenAt),
		resolvedAt:          toMs(d.resolvedAt) || null,
	};
}

/** What the requester is allowed to see — no internal notes, no triage
 *  metadata (priority/tags read as "we've labelled you urgent/billing-dispute"). */
export function toRequesterView(t: Ticket): Ticket {
	return {
		...t,
		messages: t.messages.filter((m) => !m.internal),
		tags: [],
		priority: 'normal',
	};
}

// ─── Reads ────────────────────────────────────

export async function getTicket(id: string): Promise<{ ticket: Ticket; accessKey: string } | null> {
	const snap = await col().doc(id).get();
	if (!snap.exists) return null;
	const data = snap.data()!;
	return { ticket: normalize(snap.id, data), accessKey: data.accessKey ?? (await mintAccessKey(id)) };
}

/** Tickets from the old one-way form have no guest key — mint one the first
 *  time we need to email a link, so replies to those guests aren't dead links. */
async function mintAccessKey(id: string): Promise<string> {
	const key = randomBytes(24).toString('hex');
	await col().doc(id).update({ accessKey: key });
	return key;
}

/** Matched by uid, with an email fallback so a ticket filed while signed out
 *  (e.g. "I can't log in") still shows up once they're back in. Two queries
 *  and a merge — Firestore has no OR across fields. */
export async function listTicketsForUser(uid: string | null, email: string | null): Promise<Ticket[]> {
	const [byUid, byEmail] = await Promise.all([
		uid ? col().where('uid', '==', uid).get() : null,
		email ? col().where('email', '==', email.toLowerCase()).get() : null,
	]);
	const merged = new Map<string, Ticket>();
	for (const doc of [...(byUid?.docs ?? []), ...(byEmail?.docs ?? [])]) merged.set(doc.id, normalize(doc.id, doc.data()));
	return [...merged.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export async function listAllTickets(limit = 300): Promise<Ticket[]> {
	const snap = await col().orderBy('createdAt', 'desc').limit(limit).get();
	return snap.docs
		.map((doc) => normalize(doc.id, doc.data()))
		.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** Open tickets plus which reminder stages already went out for the current
 *  waiting period — the cron's working set. */
export async function listOpenTicketsForSweep(): Promise<{ ticket: Ticket; remindersSent: string[]; accessKey: string | null }[]> {
	const snap = await col().where('status', 'in', ['new', 'open', 'in_progress', 'awaiting_customer']).get();
	return Promise.all(
		snap.docs.map(async (doc) => ({
			ticket: normalize(doc.id, doc.data()),
			remindersSent: doc.data().remindersSent ?? [],
			accessKey: doc.data().accessKey ?? (await mintAccessKey(doc.id)),
		})),
	);
}

export function ownsTicket(t: Ticket, uid: string, email: string | null): boolean {
	return t.uid === uid || (!!email && t.email === email.toLowerCase());
}

export function accessKeyMatches(expected: string | null, given: string | null): boolean {
	if (!expected || !given) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(given);
	return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Writes ───────────────────────────────────

export interface CreateTicketInput {
	uid: string | null;
	email: string;
	name: string;
	topic: TicketTopic;
	subject: string;
	message: string;
	pageUrl: string;
	ip: string;
	userAgent: string;
	tier: string | null;
	shopPlan: string | null;
	tags: string[];
	priority: TicketPriority;
}

export async function createTicket(input: CreateTicketInput): Promise<{ ticket: Ticket; accessKey: string }> {
	const ref = col().doc();
	const now = Date.now();
	const accessKey = randomBytes(24).toString('hex');
	const data = {
		...input,
		email:      input.email.toLowerCase(),
		topicLabel: TOPIC_LABEL[input.topic] ?? input.topic,
		status:     'new' as TicketStatus,
		messages:   [],
		accessKey,
		remindersSent: [],
		createdAt:  new Date(now),
		updatedAt:  now,
		lastActivityAt:      now,
		lastUserActivityAt:  now,
		lastAdminActivityAt: 0,
		awaitingSince:       now,
		userLastSeenAt:      now,
		adminLastSeenAt:     0,
		resolvedAt:          null,
	};
	await ref.set(data);
	return { ticket: normalize(ref.id, data), accessKey };
}

interface Transition {
	status?: TicketStatus;
	priority?: TicketPriority;
	addTags?: string[];
}

/** Applies a status change + all the bookkeeping that hangs off it: turn
 *  tracking (awaitingSince/reminders reset when the turn flips) and resolvedAt. */
function applyStatus(update: Record<string, unknown>, before: Ticket, next: TicketStatus, now: number) {
	update.status = next;
	const turnBefore = needsAdminAction(before) ? 'admin' : needsUserAction(before) ? 'user' : 'none';
	const turnAfter  = needsAdminAction({ status: next }) ? 'admin' : needsUserAction({ status: next }) ? 'user' : 'none';
	if (turnBefore !== turnAfter) {
		update.awaitingSince = now;
		update.remindersSent = [];
	}
	update.resolvedAt = next === 'resolved' || next === 'closed' ? now : null;
}

/** Appends a message to the thread and moves the ticket along. Runs in a
 *  transaction so a customer reply and an admin reply landing at the same
 *  moment can't clobber each other's status transition. */
export async function addMessage(
	id: string,
	msg: { from: TicketActor; body: string; authorName?: string; authorUid?: string; internal?: boolean },
	transition: Transition = {},
): Promise<Ticket> {
	const ref = col().doc(id);
	return getAdminDb().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) throw new TicketError('Ticket not found', 404);
		const before = normalize(snap.id, snap.data()!);
		const now = Date.now();

		const entry: TicketMessage = { id: randomUUID(), from: msg.from, body: msg.body, at: now };
		if (msg.authorName) entry.authorName = msg.authorName;
		if (msg.authorUid) entry.authorUid = msg.authorUid;
		if (msg.internal) entry.internal = true;

		const update: Record<string, unknown> = {
			messages: [...before.messages, entry],
			updatedAt: now,
		};

		if (!msg.internal) {
			update.lastActivityAt = now;
			if (msg.from === 'user') {
				update.lastUserActivityAt = now;
				update.userLastSeenAt = now;
			} else {
				update.lastAdminActivityAt = now;
				if (msg.from === 'admin') {
					update.adminLastSeenAt = now;
					// A staff reply restarts the overdue clock even when the ticket
					// stays "in progress" (e.g. escalated to engineering) — the
					// digest measures time since staff last spoke, not since filing.
					update.awaitingSince = now;
					update.remindersSent = [];
				}
			}
		}

		if (transition.status && transition.status !== before.status) applyStatus(update, before, transition.status, now);
		if (transition.priority) update.priority = transition.priority;
		if (transition.addTags?.length) update.tags = [...new Set([...before.tags, ...transition.addTags])];

		tx.update(ref, update);
		return normalize(snap.id, { ...snap.data()!, ...update });
	});
}

/** Status change with no reply — logged in the thread as a system entry the
 *  requester can see, and counted as support activity so their badge lights up. */
export async function changeStatus(
	id: string,
	next: TicketStatus,
	by: { actor: 'admin' | 'user' | 'system'; name?: string },
): Promise<Ticket> {
	const who = by.actor === 'user' ? (by.name || 'You') : by.actor === 'admin' ? 'OmniPlot Support' : 'OmniPlot';
	const body = {
		new:               `${who} reopened this ticket.`,
		in_progress:       `${who} is working on this ticket.`,
		awaiting_customer: `${who} is waiting on a reply.`,
		resolved:          `${who} marked this ticket resolved.`,
		closed:            `${who} closed this ticket.`,
	}[next];
	return addMessage(id, { from: by.actor === 'user' ? 'user' : 'system', body, authorName: who }, { status: next });
}

export async function updateTriage(id: string, data: { priority?: TicketPriority; tags?: string[] }): Promise<void> {
	const update: Record<string, unknown> = { updatedAt: Date.now() };
	if (data.priority) update.priority = data.priority;
	if (data.tags) update.tags = [...new Set(data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
	await col().doc(id).update(update);
}

export async function markSeen(id: string, side: 'user' | 'admin'): Promise<void> {
	await col().doc(id).update({ [side === 'user' ? 'userLastSeenAt' : 'adminLastSeenAt']: Date.now() });
}

export async function deleteTicket(id: string): Promise<void> {
	await col().doc(id).delete();
}

export async function recordReminder(id: string, stage: string): Promise<void> {
	await col().doc(id).update({ remindersSent: FieldValue.arrayUnion(stage) });
}
