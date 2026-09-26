// ─────────────────────────────────────────────
// OmniPlot — CUT USAGE WINDOWS (shared client + server)
// ─────────────────────────────────────────────
// A user's allowance is measured in rolling windows that start with their
// first cut after the previous window expired: 30 days and 24 hours. The
// user doc stores the count and the window's end; a count whose window has
// ended is stale and reads as 0. Every screen that shows "cuts this period"
// goes through `usageInWindow` so none of them show a stale number.

export const MONTH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface CutUsageFields {
	cutCount: number;
	lastCutAt: Date | null;
	monthlyCount: number;
	monthResetAt: Date | null;
	dailyCount: number;
	dayResetAt: Date | null;
	/** Completed cuts per calendar month (UTC), "YYYY-MM" → count. */
	byMonth?: Record<string, number>;
}

/** Cuts in the current 30-day and 24-hour windows (0 once a window ended). */
export function usageInWindow(
	usage: Partial<Pick<CutUsageFields, 'monthlyCount' | 'monthResetAt' | 'dailyCount' | 'dayResetAt'>> | null | undefined,
	now: Date = new Date(),
): { month: number; day: number; monthResetAt: Date | null; dayResetAt: Date | null } {
	const monthResetAt = usage?.monthResetAt ? new Date(usage.monthResetAt) : null;
	const dayResetAt = usage?.dayResetAt ? new Date(usage.dayResetAt) : null;
	const monthOpen = !!monthResetAt && now < monthResetAt;
	const dayOpen = !!dayResetAt && now < dayResetAt;
	return {
		month: monthOpen ? usage?.monthlyCount ?? 0 : 0,
		day: dayOpen ? usage?.dailyCount ?? 0 : 0,
		monthResetAt: monthOpen ? monthResetAt : null,
		dayResetAt: dayOpen ? dayResetAt : null,
	};
}

/** The usage fields after one more completed cut at `now`. */
export function usageAfterCut(
	usage: Partial<CutUsageFields> | null | undefined,
	now: Date,
): Omit<CutUsageFields, 'byMonth'> {
	const current = usageInWindow(usage, now);
	return {
		cutCount: (usage?.cutCount ?? 0) + 1,
		lastCutAt: now,
		monthlyCount: current.month + 1,
		monthResetAt: current.monthResetAt ?? new Date(now.getTime() + MONTH_WINDOW_MS),
		dailyCount: current.day + 1,
		dayResetAt: current.dayResetAt ?? new Date(now.getTime() + DAY_WINDOW_MS),
	};
}

/** UTC calendar keys used by the per-month and per-day counters. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
