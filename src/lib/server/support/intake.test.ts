import { describe, expect, it } from 'vitest';
import { runIntake, suggestionsFor } from './intake';
import { hasUserUnread, needsAdminAction, needsUserAction, userAttentionCount, type Ticket } from '$lib/support/tickets';
import { sortCanned } from '$lib/support/responses';

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
	it('floats tag + topic matches above everything else', () => {
		const sorted = sortCanned('plotter', ['plotter-connection']);
		expect(sorted[0].id).toBe('plotter-connection');
	});
});
