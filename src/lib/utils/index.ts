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

export function canCut(user: UserProfile): {
	allowed: boolean;
	reason?: string;
} {
	const { tier, usage } = user;
	const now = new Date();

	if (tier === "pro" || tier === "admin") return { allowed: true };

	if (tier === "free") {
		const resetAt = usage.monthResetAt
			? new Date(usage.monthResetAt)
			: null;
		const sameMonth = resetAt && now < resetAt;
		if (sameMonth && usage.monthlyCount >= 1) {
			const daysLeft = Math.ceil(
				(resetAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
			);
			return {
				allowed: false,
				reason: `Free tier: 1 cut per 30 days. Resets in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.`,
			};
		}
		return { allowed: true };
	}

	if (tier === "lite") {
		const lastCut = usage.lastCutAt ? new Date(usage.lastCutAt) : null;
		if (lastCut) {
			const hoursAgo =
				(now.getTime() - lastCut.getTime()) / (1000 * 60 * 60);
			if (hoursAgo < 24) {
				const hoursLeft = Math.ceil(24 - hoursAgo);
				return {
					allowed: false,
					reason: `Lite tier: 1 cut per day. Available in ${hoursLeft}h.`,
				};
			}
		}
		return { allowed: true };
	}

	return { allowed: false, reason: "Unknown tier." };
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
