import { describe, it, expect } from 'vitest';
import { DAY_WINDOW_MS, MONTH_WINDOW_MS, monthKey, usageAfterCut, usageInWindow } from './cuts';

const now = new Date('2026-09-25T12:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const earlier = (ms: number) => new Date(now.getTime() - ms);

describe('usageInWindow', () => {
	it('reads counts inside open windows', () => {
		expect(usageInWindow({ monthlyCount: 4, monthResetAt: later(1000), dailyCount: 2, dayResetAt: later(1000) }, now))
			.toMatchObject({ month: 4, day: 2 });
	});

	it('treats a count whose window ended as 0 (the stale-number bug)', () => {
		expect(usageInWindow({ monthlyCount: 9, monthResetAt: earlier(1000), dailyCount: 5, dayResetAt: earlier(1000) }, now))
			.toEqual({ month: 0, day: 0, monthResetAt: null, dayResetAt: null });
	});

	it('handles missing usage', () => {
		expect(usageInWindow(undefined, now)).toMatchObject({ month: 0, day: 0 });
	});
});

describe('usageAfterCut', () => {
	it('starts fresh windows on the first cut', () => {
		const next = usageAfterCut({ cutCount: 3 }, now);
		expect(next).toMatchObject({ cutCount: 4, monthlyCount: 1, dailyCount: 1, lastCutAt: now });
		expect(next.monthResetAt).toEqual(later(MONTH_WINDOW_MS));
		expect(next.dayResetAt).toEqual(later(DAY_WINDOW_MS));
	});

	it('adds to open windows without moving their end', () => {
		const monthEnd = later(10 * DAY_WINDOW_MS);
		const dayEnd = later(3_600_000);
		const next = usageAfterCut({ cutCount: 7, monthlyCount: 5, monthResetAt: monthEnd, dailyCount: 2, dayResetAt: dayEnd }, now);
		expect(next).toMatchObject({ cutCount: 8, monthlyCount: 6, monthResetAt: monthEnd, dailyCount: 3, dayResetAt: dayEnd });
	});

	it('restarts only the window that expired', () => {
		const monthEnd = later(10 * DAY_WINDOW_MS);
		const next = usageAfterCut({ cutCount: 7, monthlyCount: 5, monthResetAt: monthEnd, dailyCount: 4, dayResetAt: earlier(1) }, now);
		expect(next).toMatchObject({ monthlyCount: 6, monthResetAt: monthEnd, dailyCount: 1, dayResetAt: later(DAY_WINDOW_MS) });
	});
});

describe('monthKey', () => {
	it('uses the UTC calendar month', () => {
		expect(monthKey(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09');
		expect(monthKey(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
	});
});
