// ─────────────────────────────────────────────
// OmniPlot — SUPPORT TICKETS (shared client + server)
// ─────────────────────────────────────────────
// Types, labels and the pure "whose turn is it" derivations that drive the
// nav badges on both sides. Kept out of $lib/server so the ticket pages and
// AppShell/admin layout can use the same rules the API and cron use.

export type TicketStatus = 'new' | 'in_progress' | 'awaiting_customer' | 'resolved' | 'closed';
export type TicketPriority = 'normal' | 'high' | 'urgent';
export type TicketActor = 'user' | 'admin' | 'system';
export type TicketLinkBasis = 'email' | 'phone' | 'admin';

export type TicketTopic = 'account' | 'billing' | 'patterns' | 'plotter' | 'technical' | 'feature' | 'other';

export const TICKET_TOPICS: { value: TicketTopic; label: string }[] = [
	{ value: 'account',   label: 'Account & Login' },
	{ value: 'billing',   label: 'Billing & Subscription' },
	{ value: 'patterns',  label: 'Patterns & Library' },
	{ value: 'plotter',   label: 'Plotter & Cutting' },
	{ value: 'technical', label: 'Technical Issue' },
	{ value: 'feature',   label: 'Feature Request' },
	{ value: 'other',     label: 'Other' },
];

export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(
	TICKET_TOPICS.map((t) => [t.value, t.label]),
);

export interface TicketMessage {
	id: string;
	from: TicketActor;
	body: string;
	/** Display name for admin/system entries ("OmniPlot Support"), or the
	 *  requester's name for user entries. */
	authorName?: string;
	authorUid?: string;
	/** Admin-only note — stripped before a ticket is ever sent to the requester. */
	internal?: boolean;
	at: number;
}

export interface Ticket {
	id: string;
	uid: string | null;
	/** How `uid` got set: 'session' = filed while signed in; 'manual' = an
	 *  admin linked a legacy/guest ticket to an account (see `linkBasis`). */
	linkMethod: 'session' | 'manual' | null;
	/** Why staff picked that account: same email, a phone number that matched
	 *  it, or chosen by hand. Null unless `linkMethod` is 'manual'. */
	linkBasis: TicketLinkBasis | null;
	email: string;
	/** Phone the requester gave on the form (as typed/E.164), '' when none. */
	phone: string;
	name: string;
	topic: TicketTopic;
	subject: string;
	message: string;
	status: TicketStatus;
	priority: TicketPriority;
	tags: string[];
	messages: TicketMessage[];
	pageUrl: string;
	tier: string | null;
	shopPlan: string | null;
	createdAt: number;
	updatedAt: number;
	lastActivityAt: number;
	/** Last reply/status change the requester should see (drives their unread dot). */
	lastAdminActivityAt: number;
	/** Last reply from the requester (drives the admin unread styling). */
	lastUserActivityAt: number;
	/** When the current "someone owes a reply" period started — the reminder
	 *  cron measures from here, and it resets every time the turn flips. */
	awaitingSince: number;
	userLastSeenAt: number;
	adminLastSeenAt: number;
	resolvedAt: number | null;
	/** Set when staff marked this ticket a duplicate of another ticket from the
	 *  same requester. A duplicate is resolved and locked: no replies, status
	 *  changes or credits, so the same issue can't be resolved twice. */
	duplicateOf: string | null;
	/** Tickets marked as duplicates of this one. */
	duplicates: string[];
	/** Staff-only English translations of what the customer wrote, keyed by
	 *  'subject', 'original' or a message id. Never sent to the requester. */
	translations: Record<string, TicketTranslation>;
}

export interface TicketTranslation {
	/** Source language in English, e.g. "Spanish". */
	language: string;
	english: string;
}

/** A translation that actually differs from the source (not English, and
 *  not text whose language couldn't be told). */
export function isForeign(t: TicketTranslation | undefined): t is TicketTranslation {
	const lang = t?.language.trim().toLowerCase();
	return !!lang && lang !== 'english' && lang !== 'unknown';
}

/** What the customer wrote that can be translated: subject, original request,
 *  and their thread replies (staff messages are already English). */
export function translatableParts(t: Pick<Ticket, 'subject' | 'message' | 'messages'>): { id: string; text: string }[] {
	return [
		{ id: 'subject', text: t.subject },
		{ id: 'original', text: t.message },
		...t.messages.filter((m) => m.from === 'user' && !m.internal).map((m) => ({ id: m.id, text: m.body })),
	].filter((p) => p.text.trim());
}

export const STATUS_LABEL_ADMIN: Record<TicketStatus, string> = {
	new:               'New',
	in_progress:       'In progress',
	awaiting_customer: 'Awaiting customer',
	resolved:          'Resolved',
	closed:            'Closed',
};

// Requester-facing wording — "Awaiting customer" reads as an accusation from
// the other side of the counter.
export const STATUS_LABEL_USER: Record<TicketStatus, string> = {
	new:               'Received',
	in_progress:       'In progress',
	awaiting_customer: 'Needs your reply',
	resolved:          'Resolved',
	closed:            'Closed',
};

export const STATUS_VARIANT: Record<TicketStatus, 'info' | 'brand' | 'warning' | 'success' | 'default'> = {
	new:               'info',
	in_progress:       'brand',
	awaiting_customer: 'warning',
	resolved:          'success',
	closed:            'default',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
	normal: 'Normal',
	high:   'High',
	urgent: 'Urgent',
};

/** Short human reference for subjects and conversations ("#K3F9QA"). */
export function ticketRef(id: string): string {
	return `#${id.slice(0, 6).toUpperCase()}`;
}

/** Locked duplicates only take internal notes (and staff can undo the mark). */
export function isDuplicate(t: Pick<Ticket, 'duplicateOf'>): boolean {
	return !!t.duplicateOf;
}

export function isOpen(t: Pick<Ticket, 'status'>): boolean {
	return t.status !== 'resolved' && t.status !== 'closed';
}

/** Staff owes the next move — a fresh ticket, or one they've picked up
 *  (or the customer replied to) but not answered yet. */
export function needsAdminAction(t: Pick<Ticket, 'status'>): boolean {
	return t.status === 'new' || t.status === 'in_progress';
}

/** The requester owes the next move — support replied and is waiting. */
export function needsUserAction(t: Pick<Ticket, 'status'>): boolean {
	return t.status === 'awaiting_customer';
}

/** Something happened on the support side (reply or status change) since the
 *  requester last opened the ticket — e.g. it was marked resolved. */
export function hasUserUnread(t: Pick<Ticket, 'lastAdminActivityAt' | 'userLastSeenAt'>): boolean {
	return t.lastAdminActivityAt > t.userLastSeenAt;
}

export function hasAdminUnread(t: Pick<Ticket, 'lastUserActivityAt' | 'adminLastSeenAt'>): boolean {
	return t.lastUserActivityAt > t.adminLastSeenAt;
}

/** The number on the requester's Support nav badge. */
export function userAttentionCount(tickets: Ticket[]): number {
	return tickets.filter((t) => needsUserAction(t) || hasUserUnread(t)).length;
}

export function timeAgo(ms: number): string {
	const diff = Date.now() - ms;
	const min = Math.round(diff / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 30) return `${day}d ago`;
	return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
