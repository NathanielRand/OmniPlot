// ─────────────────────────────────────────────
// OmniPlot — PREFILLED SUPPORT RESPONSES + TRIGGERS
// ─────────────────────────────────────────────
// Canned admin replies for the tickets OmniPlot actually gets, and the
// quick-reply starters on the customer side. Each one carries a trigger —
// the status (and tags) the ticket moves to when it's sent — so resolving
// the common cases is "pick, tweak, send" with the workflow handled for you.
// The body is always shown in an editable textarea first; nothing sends as-is.
// The server re-resolves triggers by id, so a tampered client can't pick
// a status the template doesn't allow.

import type { TicketStatus, TicketTopic } from './tickets';

export interface CannedResponse {
	id: string;
	label: string;
	/** Topics this template is most relevant to — floats it to the top of
	 *  the picker for matching tickets, never hides it for others. */
	topics: TicketTopic[];
	/** Tags that also float it to the top (set by intake triggers). */
	tags?: string[];
	/** Status the ticket moves to when sent. */
	setStatus: TicketStatus;
	addTags?: string[];
	body: (name: string) => string;
}

const SIGN = '\n\n— OmniPlot Support';

export const CANNED_RESPONSES: CannedResponse[] = [
	{
		id: 'acknowledge',
		label: 'Acknowledge & investigating',
		topics: ['technical', 'plotter', 'other'],
		setStatus: 'in_progress',
		body: (n) =>
			`Hi ${n},\n\nThanks for reaching out — we've got your message and are looking into it now. We'll update you here as soon as we know more.${SIGN}`,
	},
	{
		id: 'need-more-info',
		label: 'Need more details',
		topics: ['technical', 'plotter', 'patterns', 'other'],
		setStatus: 'awaiting_customer',
		body: (n) =>
			`Hi ${n},\n\nHappy to help. So we can track this down, could you send:\n\n• Your plotter make/model (if cutting is involved)\n• The browser you're using (Chrome, Edge, Safari…)\n• What you expected vs. what happened\n• A screenshot or the pattern name, if you have it\n\nJust reply here with whatever you can.${SIGN}`,
	},
	{
		id: 'plotter-connection',
		label: 'Plotter connection steps',
		topics: ['plotter', 'technical'],
		tags: ['plotter-connection'],
		setStatus: 'awaiting_customer',
		body: (n) =>
			`Hi ${n},\n\nA few things fix most connection issues:\n\n1. Direct USB/serial cutting needs Chrome or Edge on desktop — Safari and Firefox don't support Web Serial.\n2. Close any other cutter software (e.g. the manufacturer's RIP) — only one app can hold the port.\n3. Check the baud rate in Plotters matches your cutter's settings.\n4. If your cutter is on the network or you're on an unsupported browser, install the Cut Agent: https://www.omniplot.app/agent\n\nGive those a try and reply here to let us know how it goes.${SIGN}`,
	},
	{
		id: 'cut-offset',
		label: 'Cut size / offset calibration',
		topics: ['plotter', 'patterns'],
		setStatus: 'awaiting_customer',
		body: (n) =>
			`Hi ${n},\n\nIf cuts are coming out scaled or offset, it's almost always a calibration setting rather than the pattern itself. In Plotters, open your cutter's profile and run a test square — then adjust the steps-per-unit (or X/Y scale) until a 4" square measures exactly 4". Also double-check units (inches vs mm) in Settings.\n\nLet us know the measured size if it's still off and we'll dig in.${SIGN}`,
	},
	{
		id: 'pattern-request-logged',
		label: 'Pattern request logged',
		topics: ['patterns'],
		tags: ['pattern-request'],
		setStatus: 'resolved',
		addTags: ['pattern-logged'],
		body: (n) =>
			`Hi ${n},\n\nThanks for the request — we've added it to our pattern queue. New vehicles are prioritized by demand, and you'll see it in the Library (and the Changelog) once it's published. In the meantime you can upload your own pattern under Library → Upload.\n\nWe'll mark this resolved for now; just reply if you need anything else.${SIGN}`,
	},
	{
		id: 'magic-link',
		label: 'Sign-in help (passwordless)',
		topics: ['account'],
		tags: ['access'],
		setStatus: 'awaiting_customer',
		body: (n) =>
			`Hi ${n},\n\nOmniPlot doesn't use passwords — you can sign in with Google, a one-click email link, or an SMS code at https://www.omniplot.app/login.\n\nIf the email link isn't arriving, check spam/promotions and make sure you're using the same address you signed up with. Links expire after a short time, so request a fresh one right before clicking it. Reply here if you're still stuck and we'll check your account directly.${SIGN}`,
	},
	{
		id: 'session-limit',
		label: 'Signed out on another device',
		topics: ['account'],
		setStatus: 'resolved',
		body: (n) =>
			`Hi ${n},\n\nThat sign-out happens because each OmniPlot seat can be active on one device at a time — signing in somewhere new ends the older session. If several people in your shop need to cut at once, a Shop plan gives each person their own seat.\n\nWe'll mark this resolved, but reply anytime if something else is going on.${SIGN}`,
	},
	{
		id: 'cut-allowance',
		label: 'Cut limit explained',
		topics: ['billing', 'plotter'],
		setStatus: 'resolved',
		body: (n) =>
			`Hi ${n},\n\nYou've reached your plan's cut allowance — the current limits for each plan are listed at https://www.omniplot.app/pricing, and Pro and Shop plans are unlimited. Allowances reset automatically, and you can upgrade anytime from Settings → Billing to keep cutting right away.\n\nMarking this resolved — reply if anything looks off with your count.${SIGN}`,
	},
	{
		id: 'billing-fixed',
		label: 'Billing updated',
		topics: ['billing'],
		tags: ['billing-dispute'],
		setStatus: 'resolved',
		body: (n) =>
			`Hi ${n},\n\nThanks for flagging this — we've looked into your billing and corrected it on our end. You can review your plan, invoices and payment method any time under Settings → Billing.\n\nWe'll mark this resolved; reply here if anything still looks wrong.${SIGN}`,
	},
	{
		id: 'refund-issued',
		label: 'Refund issued',
		topics: ['billing'],
		tags: ['billing-dispute'],
		setStatus: 'resolved',
		addTags: ['refunded'],
		body: (n) =>
			`Hi ${n},\n\nWe've issued a refund to your original payment method — you'll get a confirmation email shortly, and it typically lands within 5–10 business days depending on your bank.\n\nSorry for the trouble, and reply here if you need anything else.${SIGN}`,
	},
	{
		id: 'shop-seats',
		label: 'Shop seats & invites',
		topics: ['account', 'billing'],
		setStatus: 'awaiting_customer',
		body: (n) =>
			`Hi ${n},\n\nShop owners and admins can invite teammates from Settings → Team. Each invite uses one seat on your shop's plan — if you're at your limit, remove an inactive member or upgrade the shop plan. Invite links expire, so resend it if a teammate didn't accept in time.\n\nDoes that get you sorted?${SIGN}`,
	},
	{
		id: 'bug-confirmed',
		label: 'Bug confirmed — escalated',
		topics: ['technical', 'plotter', 'patterns'],
		setStatus: 'in_progress',
		addTags: ['bug-confirmed'],
		body: (n) =>
			`Hi ${n},\n\nThanks for the detail — we've reproduced this and our team is working on a fix. We'll update this ticket as soon as it ships. No need to reply in the meantime.${SIGN}`,
	},
	{
		id: 'fix-shipped',
		label: 'Fix shipped',
		topics: ['technical', 'plotter', 'patterns'],
		tags: ['bug-confirmed'],
		setStatus: 'resolved',
		body: (n) =>
			`Hi ${n},\n\nGood news — the fix for this is now live. Refresh OmniPlot (or restart the Cut Agent if you use it) and you should be all set.\n\nWe'll mark this resolved; reply here if you still see the problem and we'll reopen it.${SIGN}`,
	},
	{
		id: 'feature-logged',
		label: 'Feature request logged',
		topics: ['feature'],
		setStatus: 'resolved',
		addTags: ['feature-logged'],
		body: (n) =>
			`Hi ${n},\n\nGreat suggestion — we've added it to our roadmap list. We can't promise timing, but requests like this directly shape what we build next, and shipped features show up in the Changelog.\n\nThanks for helping make OmniPlot better!${SIGN}`,
	},
	{
		id: 'resolved-closing',
		label: 'Resolved — closing out',
		topics: ['other'],
		setStatus: 'resolved',
		body: (n) =>
			`Hi ${n},\n\nGlad we could help! We're marking this resolved — just reply here if anything else comes up and it'll reopen automatically.${SIGN}`,
	},
];

export function cannedById(id: string | null | undefined): CannedResponse | undefined {
	return id ? CANNED_RESPONSES.find((c) => c.id === id) : undefined;
}

/** Topic/tag matches first, everything else after — the admin never hits a
 *  dead end on an off-template ticket. */
export function sortCanned(topic: string, tags: string[]): CannedResponse[] {
	const score = (c: CannedResponse) =>
		(c.tags?.some((t) => tags.includes(t)) ? 0 : 2) + (c.topics.includes(topic as TicketTopic) ? 0 : 1);
	return [...CANNED_RESPONSES].sort((a, b) => score(a) - score(b));
}

// ─── Customer-side reply starters ────────────
// Each starter's `intent` is the trigger the server applies — "resolved"
// closes the loop without an admin touching it; "still_broken" reopens and
// bumps priority, since a failed fix is the most frustrating support moment.

export type ReplyIntent = 'resolved' | 'still_broken' | 'info';

export interface ReplyStarter {
	id: string;
	label: string;
	intent: ReplyIntent;
	body: string;
}

export const REPLY_STARTERS: ReplyStarter[] = [
	{ id: 'fixed',   label: 'That fixed it',        intent: 'resolved',     body: 'Thanks — that fixed it!' },
	{ id: 'still',   label: 'Still not working',    intent: 'still_broken', body: "It's still not working. Here's what I'm seeing:\n\n" },
	{ id: 'details', label: 'Here are the details', intent: 'info',         body: "Here's the information you asked for:\n\n" },
	{ id: 'update',  label: 'Any update?',          intent: 'info',         body: 'Just checking in — is there any update on this?' },
];
