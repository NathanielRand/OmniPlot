// ─────────────────────────────────────────────
// OmniPlot — SUPPORT TICKETS (shared client + server)
// ─────────────────────────────────────────────
// Types, labels and the pure "whose turn is it" derivations that drive the
// nav badges on both sides. Kept out of $lib/server so the ticket pages and
// AppShell/admin layout can use the same rules the API and cron use.

export type TicketStatus = 'new' | 'in_progress' | 'awaiting_customer' | 'resolved' | 'closed';
export type TicketPriority = 'normal' | 'high' | 'urgent';
export type TicketActor = 'user' | 'admin' | 'system';

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
	 *  admin linked a legacy/guest ticket to the account with the same email. */
	linkMethod: 'session' | 'manual' | null;
	email: string;
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
