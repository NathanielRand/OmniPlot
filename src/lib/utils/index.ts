// ─────────────────────────────────────────────
// OmniPlot — GENERAL UTILITIES
// ─────────────────────────────────────────────

// ─── ID generation ────────────────────────────
export function uid(prefix = ""): string {
	return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Formatting ───────────────────────────────
export function formatDimensions(
	w: number,
	h: number,
	unit: "inches" | "mm" = "inches",
): string {
	if (unit === "mm") {
		return `${(w * 25.4).toFixed(1)}mm × ${(h * 25.4).toFixed(1)}mm`;
	}
	return `${w.toFixed(2)}" × ${h.toFixed(2)}"`;
}

export function formatEfficiency(ratio: number): string {
	return `${(ratio * 100).toFixed(1)}%`;
}

export function formatCutTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function formatDate(date: Date | string | null | undefined): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(date));
}

export function formatRelativeTime(
	date: Date | string | null | undefined,
): string {
	if (!date) return "—";
	const d = new Date(date);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	const secs = Math.floor(diff / 1000);
	const mins = Math.floor(secs / 60);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);

	if (secs < 60) return "just now";
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return formatDate(d);
}

export function formatPrice(cents: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(cents / 100);
}

// ─── Clamp ────────────────────────────────────
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ─── Debounce ─────────────────────────────────
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	ms: number,
): T {
	let timer: ReturnType<typeof setTimeout>;
	return ((...args: unknown[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	}) as T;
}

// ─── Deep clone (safe for plain objects) ─────
export function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

// ─── Check tier limits ────────────────────────
import type { UserProfile } from "$lib/types";
import { DEFAULT_PLAN_SETTINGS } from "$lib/plans";
import { usageInWindow } from "$lib/cuts";

// Per-tier cut allowances; `null` means unlimited on that window. Defaults
// come from $lib/plans — the live values come from `/api/settings/plans`
// (admin-editable in Admin → Products, no deploy needed).
export type CutAllowance = { cutsPerMonth: number | null; cutsPerDay: number | null };
export type PlanCutLimits = Record<"free" | "lite" | "pro", CutAllowance>;

const pickCuts = ({ cutsPerMonth, cutsPerDay }: CutAllowance): CutAllowance => ({ cutsPerMonth, cutsPerDay });
export const DEFAULT_CUT_LIMITS: PlanCutLimits = {
	free: pickCuts(DEFAULT_PLAN_SETTINGS.free),
	lite: pickCuts(DEFAULT_PLAN_SETTINGS.lite),
	pro:  pickCuts(DEFAULT_PLAN_SETTINGS.pro),
};

/** Pulls just the cut allowances out of a GET /api/settings/plans response. */
export function cutLimitsFromPlans(plans: Partial<Record<keyof PlanCutLimits, Partial<CutAllowance>>> | null | undefined): PlanCutLimits {
	const pick = (t: keyof PlanCutLimits): CutAllowance => ({
		cutsPerMonth: plans?.[t]?.cutsPerMonth !== undefined ? plans[t]!.cutsPerMonth ?? null : DEFAULT_CUT_LIMITS[t].cutsPerMonth,
		cutsPerDay:   plans?.[t]?.cutsPerDay   !== undefined ? plans[t]!.cutsPerDay   ?? null : DEFAULT_CUT_LIMITS[t].cutsPerDay,
	});
	return { free: pick("free"), lite: pick("lite"), pro: pick("pro") };
}

/**
 * Whether the user can cut right now, and how many cuts are left in the
 * tightest window (`remaining: null` = unlimited). Enforces BOTH the monthly
 * and daily window when a tier has both set, so an admin can configure
 * either (or neither) for any tier without a code change.
 *
 * `teamActive`: the user is a seat on an org/shop with a live subscription,
 * which overrides the individual tier with unlimited cuts.
 */
export function canCut(
	user: Pick<UserProfile, "tier" | "usage">,
	teamActive = false,
	limits: PlanCutLimits = DEFAULT_CUT_LIMITS,
): { allowed: boolean; reason?: string; remaining: number | null } {
	const { tier, usage } = user;
	if (teamActive || tier === "admin") return { allowed: true, remaining: null };

	// Unknown/missing tier is treated as free rather than hard-blocked.
	const planKey: keyof PlanCutLimits = tier === "lite" || tier === "pro" ? tier : "free";
	const planName = planKey.charAt(0).toUpperCase() + planKey.slice(1);
	const { cutsPerMonth, cutsPerDay } = limits[planKey];
	const now = new Date();

	let remaining: number | null = null;
	let blocked: string | undefined;

	const window = usageInWindow(usage, now);

	if (cutsPerMonth !== null) {
		const resetAt = window.monthResetAt;
		const left = Math.max(0, cutsPerMonth - window.month);
		remaining = left;
		if (left === 0) {
			const daysLeft = resetAt ? Math.ceil((resetAt.getTime() - now.getTime()) / 86_400_000) : 0;
			blocked = `${planName} plan: ${cutsPerMonth} cut${cutsPerMonth !== 1 ? "s" : ""} per 30 days.` +
				(daysLeft > 0 ? ` Resets in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.` : "");
		}
	}

	if (cutsPerDay !== null) {
		const resetAt = window.dayResetAt;
		const left = Math.max(0, cutsPerDay - window.day);
		remaining = remaining === null ? left : Math.min(remaining, left);
		if (left === 0 && !blocked) {
			const hoursLeft = resetAt ? Math.ceil((resetAt.getTime() - now.getTime()) / 3_600_000) : 0;
			blocked = `${planName} plan: ${cutsPerDay} cut${cutsPerDay !== 1 ? "s" : ""} per day.` +
				(hoursLeft > 0 ? ` Available in ${hoursLeft}h.` : "");
		}
	}

	return blocked ? { allowed: false, reason: blocked, remaining: 0 } : { allowed: true, remaining };
}

// ─── Slug ─────────────────────────────────────
export function slugify(str: string): string {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

// ─── Truncate ─────────────────────────────────
export function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── Color for canvas items ───────────────────
const ITEM_COLORS = [
	"#00E5FF",
	"#A78BFA",
	"#00D68F",
	"#FFB547",
	"#FF6B9D",
	"#60A5FA",
];

export function getItemColor(index: number): string {
	return ITEM_COLORS[index % ITEM_COLORS.length];
}
