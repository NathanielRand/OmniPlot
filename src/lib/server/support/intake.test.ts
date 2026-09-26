import { describe, expect, it } from 'vitest';
import { runIntake, suggestionsFor } from './intake';
import { hasUserUnread, needsAdminAction, needsUserAction, userAttentionCount, type Ticket } from '$lib/support/tickets';
import { cannedById, sortCanned } from '$lib/support/responses';

const base = { topic: 'other' as const, subject: '', prioritySupport: false };

describe('runIntake', () => {
	it('flags double charges as an urgent billing dispute', () => {
		const r = runIntake({ ...base, topic: 'billing', message: 'I was charged twice this month' });
		expect(r.tags).toContain('billing-dispute');
		expect(r.priority).toBe('urgent');
	});

	it('flags lockouts as high priority access issues', () => {
		const r = runIntake({ ...base, topic: 'account', message: "I can't log in, the magic link never arrives" });
		expect(r.tags).toContain('access');
		expect(r.priority).toBe('high');
	});

	it('tags plotter connection problems without escalating', () => {
		const r = runIntake({ ...base, topic: 'plotter', message: "My Graphtec cutter won't connect in Chrome" });
		expect(r.tags).toContain('plotter-connection');
		expect(r.priority).toBe('normal');
	});

	it('detects vehicle pattern requests only on relevant topics', () => {
		expect(runIntake({ ...base, topic: 'patterns', message: 'Need a pattern for 2025 Rivian R2' }).tags).toContain('pattern-request');
		expect(runIntake({ ...base, topic: 'billing', message: 'Need a pattern for 2025 Rivian R2' }).tags).not.toContain('pattern-request');
	});

	it('bumps priority one level for priority-support plans, capped at urgent', () => {
		expect(runIntake({ ...base, message: 'hello', prioritySupport: true }).priority).toBe('high');
		expect(runIntake({ ...base, message: 'locked out', prioritySupport: true }).priority).toBe('urgent');
		expect(runIntake({ ...base, message: 'refund please', prioritySupport: true }).priority).toBe('urgent');
	});

	it('leaves ordinary questions normal and untagged', () => {
		const r = runIntake({ ...base, topic: 'feature', message: 'Could you add a dark mode for the studio?' });
		expect(r).toEqual({ tags: [], priority: 'normal' });
	});
});

describe('paid-but-still-free tickets', () => {
	const sample = `I purchased the Lite subscription, and I confirmed in Stripe that my subscription is active and paid. However, when I log into my OmniPlot account, the account still shows "Free Plan" under Settings → Billing.`;

	it('tags the misrouted-billing symptom as high priority billing-sync', () => {
		const r = runIntake({ ...base, topic: 'billing', subject: 'Lite plan not active', message: sample });
		expect(r.tags).toContain('billing-sync');
		expect(r.priority).toBe('high');
	});

	it('floats the incident + credit template up (after pinned) and names their plan', () => {
		const [first] = sortCanned('billing', ['billing-sync']).filter((c) => !c.pinned);
		expect(first.id).toBe('incident-fixed-credit');
		expect(first.offerCredit).toEqual({ months: 1, reason: 'service_issue' });
		expect(first.body('Sam', { planName: 'Lite' })).toContain('your Lite plan is active');
		expect(first.body('Sam', {})).toContain('your subscription is active');
	});

	it('tags the same symptom written in Spanish', () => {
		const r = runIntake({
			...base, topic: 'billing', subject: 'Plan Lite',
			message: 'Pagué la suscripción Lite pero mi cuenta sigue apareciendo como plan gratis.',
		});
		expect(r.tags).toContain('billing-sync');
	});
});

describe('suggestionsFor', () => {
	it('puts tag-specific help first and always ends with the FAQ within three items', () => {
		const s = suggestionsFor('plotter', ['plotter-connection']);
		expect(s[0].href).toBe('/agent');
		expect(s.at(-1)!.href).toBe('/faq');
		expect(s.length).toBeLessThanOrEqual(3);
	});
});

describe('turn tracking', () => {
	const t = (over: Partial<Ticket>) => ({ status: 'new', lastAdminActivityAt: 0, userLastSeenAt: 0, ...over }) as Ticket;

	it('assigns whose turn it is by status', () => {
		expect(needsAdminAction(t({ status: 'new' }))).toBe(true);
		expect(needsAdminAction(t({ status: 'in_progress' }))).toBe(true);
		expect(needsUserAction(t({ status: 'awaiting_customer' }))).toBe(true);
		expect(needsAdminAction(t({ status: 'resolved' }))).toBe(false);
		expect(needsUserAction(t({ status: 'resolved' }))).toBe(false);
	});

	it('counts a status change the user has not seen as needing attention', () => {
		const resolvedUnseen = t({ status: 'resolved', lastAdminActivityAt: 200, userLastSeenAt: 100 });
		const resolvedSeen = t({ status: 'resolved', lastAdminActivityAt: 200, userLastSeenAt: 300 });
		expect(hasUserUnread(resolvedUnseen)).toBe(true);
		expect(userAttentionCount([resolvedUnseen, resolvedSeen, t({ status: 'awaiting_customer', userLastSeenAt: 999 })])).toBe(2);
	});
});

describe('sortCanned', () => {
	it('floats tag + topic matches above everything but pinned templates', () => {
		const sorted = sortCanned('plotter', ['plotter-connection']).filter((c) => !c.pinned);
		expect(sorted[0].id).toBe('plotter-connection');
	});

	it('always puts the generic "our bug + month on us" template first, on any ticket', () => {
		for (const topic of ['technical', 'plotter', 'billing', 'other', 'feature']) {
			expect(sortCanned(topic, [])[0].id).toBe('our-bug-credit');
		}
	});

	it('only promises a free month when one will be applied', () => {
		const t = sortCanned('other', [])[0];
		expect(t.body('Ana', { freeMonth: true })).toContain('your next month is free');
		expect(t.body('Ana', { freeMonth: false })).not.toContain('free');
		expect(cannedById('incident-fixed-credit')!.body('Ana', {})).not.toContain('next month is free');
	});
});
