// ─────────────────────────────────────────────
// OmniPlot — SUPPORT INTAKE TRIGGERS
// ─────────────────────────────────────────────
// Runs once when a ticket is filed: tags it from what the customer wrote,
// sets priority from urgency + plan, and picks self-serve suggestions for
// the acknowledgement email/screen. Rules are plain regex on purpose — easy
// to read, easy to tune, no surprise auto-closes.

import type { TicketPriority, TicketTopic } from '$lib/support/tickets';

interface Rule {
	tag: string;
	/** Only applies to these topics (any topic when omitted). */
	topics?: TicketTopic[];
	pattern: RegExp;
	priority?: TicketPriority;
}

const RULES: Rule[] = [
	{
		tag: 'billing-dispute',
		pattern: /charged (twice|two times|again|after cancel)|double[- ]?charg|over ?charg|refund|unauthori[sz]ed|didn'?t authori[sz]e|chargeback|dispute/i,
		priority: 'urgent',
	},
	{
		// "Paid but still Free" — the Sep 2026 misrouted-billing symptom.
		tag: 'billing-sync',
		pattern: /(paid|purchased|subscribed|bought|upgraded|active|charged).{0,120}(still|shows?|showing|says|stuck|only).{0,30}free|free plan.{0,80}(paid|purchased|subscribed|charged|active)|(plan|subscription|lite|pro).{0,40}(not|isn'?t|never|didn'?t).{0,15}(activ|show|updat|appl)/is,
		priority: 'high',
	},
	{
		tag: 'access',
		pattern: /(can'?t|cannot|unable to|won'?t let me) (log ?in|sign ?in|access|get in)|locked out|magic link|login link|sms code|verification code/i,
		priority: 'high',
	},
	{
		tag: 'plotter-connection',
		pattern: /(plotter|cutter|machine|agent).{0,40}(not|won'?t|doesn'?t|isn'?t|can'?t|cannot|never).{0,20}(connect|detect|respond|cut|found|show)|web ?serial|com ?port|serial port|baud|offline/i,
	},
	{
		tag: 'cut-quality',
		pattern: /offset|scal(e|ing)|too (big|small)|misalign|off by|tearing|cut(s)? (through|too deep)|blade/i,
	},
	{
		tag: 'pattern-request',
		topics: ['patterns', 'feature', 'other'],
		pattern: /(missing|request|add|need|don'?t see|can'?t find|no) .{0,30}pattern|pattern for (a |the |my )?(19|20)\d\d|\b(19|20)\d\d\b.{0,30}(model|pattern|ppf|tint)/i,
	},
	{
		tag: 'cut-limit',
		pattern: /cut (limit|allowance)|out of cuts|no cuts (left|remaining)|reached .{0,15}limit/i,
	},
	{
		tag: 'cancellation',
		topics: ['billing', 'account', 'other'],
		pattern: /cancel|downgrade|delete (my )?account|close (my )?account/i,
		priority: 'high',
	},
];

const PRIORITY_RANK: Record<TicketPriority, number> = { normal: 0, high: 1, urgent: 2 };

function maxPriority(a: TicketPriority, b: TicketPriority): TicketPriority {
	return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

export function bumpPriority(p: TicketPriority): TicketPriority {
	return p === 'normal' ? 'high' : 'urgent';
}

export interface IntakeResult {
	tags: string[];
	priority: TicketPriority;
}

export function runIntake(input: {
	topic: TicketTopic;
	subject: string;
	message: string;
	/** Paying individual plan (lite/pro) or a shop plan with priority support. */
	prioritySupport: boolean;
}): IntakeResult {
	const text = `${input.subject}\n${input.message}`;
	const tags = new Set<string>();
	let priority: TicketPriority = 'normal';

	for (const rule of RULES) {
		if (rule.topics && !rule.topics.includes(input.topic)) continue;
		if (!rule.pattern.test(text)) continue;
		tags.add(rule.tag);
		if (rule.priority) priority = maxPriority(priority, rule.priority);
	}

	if (input.prioritySupport) {
		tags.add('priority-plan');
		priority = bumpPriority(priority);
	}

	return { tags: [...tags], priority };
}

// ─── Self-serve suggestions ───────────────────
// Shown on the "we got it" screen and in the acknowledgement email — a fair
// share of tickets resolve themselves once the customer sees these.

export interface Suggestion { title: string; body: string; href: string }

const BY_TAG: Record<string, Suggestion> = {
	'billing-sync': {
		title: 'Check your plan',
		body:  "If you just paid, refresh Settings → Billing — activation can take a minute. We'll check your account either way.",
		href:  '/settings?tab=billing',
	},
	'access': {
		title: 'Get a fresh sign-in link',
		body:  'OmniPlot is passwordless — request a new email link or SMS code, and check spam if it doesn\'t arrive.',
		href:  '/login',
	},
	'plotter-connection': {
		title: 'Connecting your plotter',
		body:  'Direct USB cutting needs Chrome or Edge on desktop. On other browsers or network cutters, use the Cut Agent.',
		href:  '/agent',
	},
	'billing-dispute': {
		title: 'Review your invoices',
		body:  'Every charge and invoice PDF is listed under Settings → Billing.',
		href:  '/settings?tab=billing',
	},
	'cut-limit': {
		title: 'Plan allowances',
		body:  'See how many cuts each plan includes and when they reset.',
		href:  '/pricing',
	},
	'pattern-request': {
		title: 'Upload your own pattern',
		body:  'While we add it to the library, you can import your own pattern and cut it today.',
		href:  '/library/upload',
	},
};

const BY_TOPIC: Partial<Record<TicketTopic, Suggestion>> = {
	billing:  BY_TAG['billing-dispute'],
	plotter:  BY_TAG['plotter-connection'],
	account:  BY_TAG['access'],
	feature:  { title: "See what's new", body: 'Your idea might already be shipped — check the latest releases.', href: '/changelog' },
};

export function suggestionsFor(topic: TicketTopic, tags: string[]): Suggestion[] {
	const out: Suggestion[] = [];
	for (const tag of tags) if (BY_TAG[tag] && !out.includes(BY_TAG[tag])) out.push(BY_TAG[tag]);
	const byTopic = BY_TOPIC[topic];
	if (byTopic && !out.includes(byTopic)) out.push(byTopic);
	out.push({ title: 'FAQ', body: 'Quick answers about accounts, billing, patterns and plotters.', href: '/faq' });
	return out.slice(0, 3);
}
