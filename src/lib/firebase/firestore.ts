// ─────────────────────────────────────────────
// OmniPlot — FIRESTORE HELPERS
// ─────────────────────────────────────────────
import {
	collection,
	doc,
	getDoc,
	getDocs,
	setDoc,
	updateDoc,
	deleteDoc,
	writeBatch,
	query,
	where,
	orderBy,
	limit,
	onSnapshot,
	serverTimestamp,
	increment,
	deleteField,
	Timestamp,
	type DocumentData,
	type QueryConstraint,
	type Unsubscribe,
} from "firebase/firestore";
import { db, auth } from "./client";
import type {
	UserProfile,
	Vehicle,
	Pattern,
	CutJob,
	AdminStats,
	VehicleEntry,
	PatternRequest,
	Shop,
	ShopMember,
	ShopInvite,
	ShopRole,
	Organization,
	OrgMember,
	Group,
	GroupMember,
	PlotterDevice,
	InsightPost,
	PlotterErrorReport,
	UserPattern,
	PatternAdjustmentRequest,
} from "$lib/types";

// ─── Collection refs ──────────────────────────
export const Collections = {
	USERS: "users",
	VEHICLES: "vehicles",
	PATTERNS: "patterns",
	REQUESTS: "requests",
	JOBS: "jobs",
	STATS: "stats",
	PLOTTERS: "plotters",
	SHOPS: "shops",
	SHOP_INVITES: "shopInvites",
	ORGS: "orgs",
	INSIGHTS: "insights",
	PLOTTER_ERRORS: "plotterErrors",
	USER_PATTERNS: "userPatterns",
	PATTERN_ADJUSTMENTS: "patternAdjustments",
} as const;

// ─── Authenticated server-route helper ────────
// Shop/org mutations went through direct client Firestore writes, gated
// only by security rules that can't express escalation/last-owner/seat
// invariants. Those mutations now go through Admin-SDK server routes;
// this is the shared fetch wrapper for calling them.
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const token = await auth.currentUser?.getIdToken();
	const res = await fetch(path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init.headers ?? {}),
		},
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? "Request failed");
	}
	return res;
}

// ─── Converters ───────────────────────────────
function fromTimestamp(val: unknown): Date {
	if (val instanceof Timestamp) return val.toDate();
	if (val instanceof Date) return val;
	// Server routes serialize dates as ISO strings over JSON.
	if (typeof val === "string") {
		const d = new Date(val);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return new Date();
}

export function toUserProfile(id: string, data: DocumentData): UserProfile {
	return {
		uid: id,
		email: data.email ?? "",
		billingEmail: data.billingEmail ?? data.email ?? null,
		displayName: data.displayName ?? "",
		photoURL: data.photoURL ?? null,
		phone: data.phone ?? null,
		tier: data.tier ?? "free",
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
		usage: {
			cutCount: data.usage?.cutCount ?? 0,
			lastCutAt: data.usage?.lastCutAt
				? fromTimestamp(data.usage.lastCutAt)
				: null,
			monthlyCount: data.usage?.monthlyCount ?? 0,
			monthResetAt: fromTimestamp(data.usage?.monthResetAt),
			dailyCount: data.usage?.dailyCount ?? 0,
			dayResetAt: data.usage?.dayResetAt
				? fromTimestamp(data.usage.dayResetAt)
				: null,
		},
		subscription: {
			stripeCustomerId:     data.subscription?.stripeCustomerId     ?? null,
			stripePriceId:        data.subscription?.stripePriceId        ?? null,
			stripeSubscriptionId: data.subscription?.stripeSubscriptionId ?? null,
			status:               data.subscription?.status               ?? null,
			pausedCollection:     data.subscription?.pausedCollection     ?? false,
			cancelAtPeriodEnd:    data.subscription?.cancelAtPeriodEnd    ?? false,
			currentPeriodEnd: data.subscription?.currentPeriodEnd
				? fromTimestamp(data.subscription.currentPeriodEnd)
				: null,
			trialEnd: data.subscription?.trialEnd
				? fromTimestamp(data.subscription.trialEnd)
				: null,
		},
		preferences: {
			theme: data.preferences?.theme ?? "dark",
			defaultPlotter: data.preferences?.defaultPlotter ?? null,
			defaultMaterial: data.preferences?.defaultMaterial ?? null,
			units: data.preferences?.units ?? "inches",
			autoNest: data.preferences?.autoNest ?? true,
		},
		activeSessionId: data.activeSessionId ?? null,
		shopId: data.shopId ?? null,
		shopRole: data.shopRole ?? null,
	};
}

export function toVehicle(id: string, data: DocumentData): Vehicle {
	return {
		id,
		projectType: data.projectType ?? "vehicle",
		make: data.make,
		model: data.model,
		year: data.year,
		variant: data.variant,
		bodyStyle: data.bodyStyle,
		address: data.address,
		propertyLabel: data.propertyLabel,
		patternCount: data.patternCount ?? 0,
		thumbnailUrl: data.thumbnailUrl,
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
		isPublished: data.isPublished ?? true,
		tags: data.tags ?? [],
	};
}

export function toPattern(id: string, data: DocumentData): Pattern {
	return {
		id,
		vehicleId: data.vehicleId ?? "",
		projectType: data.projectType ?? "vehicle",
		category: data.category ?? "ppf",
		zone: data.zone,
		name: data.name ?? "",
		coverage: data.coverage ?? "full",
		svgPath: data.svgPath ?? "",
		svgUrl: data.svgUrl,
		widthInches: data.widthInches ?? 0,
		heightInches: data.heightInches ?? 0,
		revision: data.revision ?? "",
		notes: data.notes,
		isPublished: data.isPublished ?? true,
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
	};
}

// ─── User queries ─────────────────────────────
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
	const snap = await getDoc(doc(db, Collections.USERS, uid));
	if (!snap.exists()) return null;
	return toUserProfile(snap.id, snap.data());
}

export async function createUserProfile(
	uid: string,
	data: Partial<UserProfile>,
): Promise<void> {
	await setDoc(doc(db, Collections.USERS, uid), {
		...data,
		// Default the receipt email to whatever email the auth provider gave us
		// (Google or magic-link); phone-only signups start with none until the user adds one.
		billingEmail: data.billingEmail ?? data.email ?? null,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
		tier: "free",
		usage: {
			cutCount: 0,
			lastCutAt: null,
			monthlyCount: 0,
			monthResetAt: serverTimestamp(),
			dailyCount: 0,
			dayResetAt: null,
		},
		subscription: {
			stripeCustomerId: null,
			stripePriceId: null,
			status: null,
			currentPeriodEnd: null,
			trialEnd: null,
		},
		preferences: {
			theme: "dark",
			defaultPlotter: null,
			defaultMaterial: null,
			units: "inches",
			autoNest: true,
		},
		shopId: null,
		shopRole: null,
	});
}

export async function updateUserProfile(
	uid: string,
	data: Partial<UserProfile>,
): Promise<void> {
	await updateDoc(doc(db, Collections.USERS, uid), {
		...data,
		updatedAt: serverTimestamp(),
	});
}

export function subscribeToUser(
	uid: string,
	callback: (user: UserProfile | null) => void,
) {
	return onSnapshot(doc(db, Collections.USERS, uid), (snap) => {
		callback(snap.exists() ? toUserProfile(snap.id, snap.data()) : null);
	});
}

// ─── Vehicle queries ──────────────────────────
export async function getVehicles(
	constraints: QueryConstraint[] = [],
): Promise<Vehicle[]> {
	const q = query(collection(db, Collections.VEHICLES), ...constraints);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toVehicle(d.id, d.data()));
}

export async function searchVehicles(term: string): Promise<Vehicle[]> {
	// Basic: get all published, filter client-side (for MVP)
	// Production: use Algolia or Typesense
	const q = query(
		collection(db, Collections.VEHICLES),
		where("isPublished", "==", true),
		orderBy("make"),
		limit(100),
	);
	const snap = await getDocs(q);
	const all = snap.docs.map((d) => toVehicle(d.id, d.data()));
	const lower = term.toLowerCase();
	return all.filter(
		(v) =>
			(v.make ?? "").toLowerCase().includes(lower) ||
			(v.model ?? "").toLowerCase().includes(lower) ||
			String(v.year ?? "").includes(lower) ||
			(v.propertyLabel ?? "").toLowerCase().includes(lower),
	);
}

// ─── Pattern queries ──────────────────────────
export async function getPatternsByVehicle(
	vehicleId: string,
): Promise<Pattern[]> {
	const q = query(
		collection(db, Collections.PATTERNS),
		where("vehicleId", "==", vehicleId),
		where("isPublished", "==", true),
		orderBy("zone"),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toPattern(d.id, d.data()));
}

// ─── Job queries ──────────────────────────────
export function subscribeUserJobs(
	uid: string,
	onNext: (jobs: CutJob[]) => void,
	limitCount = 100,
): Unsubscribe {
	const q = query(
		collection(db, Collections.JOBS),
		where("userId", "==", uid),
		limit(limitCount),
	);
	return onSnapshot(q, (snap) => {
		const jobs = snap.docs
			.map((d) => {
				const data = d.data();
				return {
					id: d.id,
					...data,
					createdAt:   data.createdAt?.toDate?.()   ?? data.createdAt   ?? new Date(),
					updatedAt:   data.updatedAt?.toDate?.()   ?? data.updatedAt   ?? new Date(),
					completedAt: data.completedAt?.toDate?.() ?? data.completedAt ?? null,
				} as CutJob;
			})
			.sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime());
		onNext(jobs);
	});
}

export async function getUserJobs(
	uid: string,
	limitCount = 100,
): Promise<CutJob[]> {
	// Avoid orderBy(updatedAt) + where(userId) — that combination requires a
	// composite index which may not exist and causes the SDK to hang instead of
	// rejecting cleanly. Sort client-side after fetching instead.
	const q = query(
		collection(db, Collections.JOBS),
		where("userId", "==", uid),
		limit(limitCount),
	);
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => {
			const data = d.data();
			// Firestore returns Timestamp objects; coerce to JS Date so callers
			// that type CutJob.createdAt as Date don't crash at runtime.
			return {
				id: d.id,
				...data,
				createdAt:   data.createdAt?.toDate?.()   ?? data.createdAt   ?? new Date(),
				updatedAt:   data.updatedAt?.toDate?.()   ?? data.updatedAt   ?? new Date(),
				completedAt: data.completedAt?.toDate?.() ?? data.completedAt ?? null,
			} as CutJob;
		})
		.sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime());
}

// ─── Cut usage tracking ───────────────────────
// Call once per successful cut/download. Handles 30-day window reset client-side.
// The real-time listener on the user document propagates the change back to userStore
// so canCut() re-derives immediately without requiring a page reload.
export async function incrementCutUsage(
	uid: string,
	currentMonthResetAt: Date | null,
	currentDayResetAt: Date | null = null,
): Promise<void> {
	const now = new Date();
	const monthWindowExpired = !currentMonthResetAt || now >= currentMonthResetAt;
	const dayWindowExpired = !currentDayResetAt || now >= currentDayResetAt;

	const patch: Record<string, unknown> = {
		"usage.cutCount": increment(1),
		"usage.lastCutAt": serverTimestamp(),
		updatedAt: serverTimestamp(),
	};

	if (monthWindowExpired) {
		// Start a fresh 30-day window
		patch["usage.monthlyCount"] = 1;
		patch["usage.monthResetAt"] = Timestamp.fromDate(
			new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
		);
	} else {
		patch["usage.monthlyCount"] = increment(1);
	}

	if (dayWindowExpired) {
		// Start a fresh 24-hour window
		patch["usage.dailyCount"] = 1;
		patch["usage.dayResetAt"] = Timestamp.fromDate(
			new Date(now.getTime() + 24 * 60 * 60 * 1000),
		);
	} else {
		patch["usage.dailyCount"] = increment(1);
	}

	await updateDoc(doc(db, Collections.USERS, uid), patch);
}

export async function saveJob(job: CutJob): Promise<void> {
	const ref = doc(db, Collections.JOBS, job.id);
	await setDoc(
		ref,
		{ ...job, updatedAt: serverTimestamp() },
		{ merge: true },
	);
}

// ─── Admin queries ────────────────────────────
export async function getAllUsers(limitCount = 50): Promise<UserProfile[]> {
	const q = query(
		collection(db, Collections.USERS),
		orderBy("createdAt", "desc"),
		limit(limitCount),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toUserProfile(d.id, d.data()));
}

export async function setUserTier(
	uid: string,
	tier: UserProfile["tier"],
): Promise<void> {
	await updateDoc(doc(db, Collections.USERS, uid), {
		tier,
		updatedAt: serverTimestamp(),
	});
}

// ─── Session management ───────────────────────
export async function writeSessionId(uid: string, sessionId: string): Promise<void> {
	await updateDoc(doc(db, Collections.USERS, uid), {
		activeSessionId: sessionId,
		updatedAt: serverTimestamp(),
	});
}

// ─── VehicleEntry converters ──────────────────
export function toVehicleEntry(id: string, data: DocumentData): VehicleEntry {
	return {
		id,
		projectType: data.projectType ?? "vehicle",
		make: data.make,
		model: data.model,
		year: data.year,
		bodyStyle: data.bodyStyle,
		address: data.address,
		propertyLabel: data.propertyLabel,
		tags: data.tags ?? [],
		popular: data.popular ?? false,
		status: data.status ?? "draft",
		updatedAt:
			data.updatedAt instanceof Timestamp
				? data.updatedAt.toDate().toISOString().split("T")[0]
				: (data.updatedAt ?? ""),
	};
}

export function toPatternRequest(id: string, data: DocumentData): PatternRequest {
	return {
		id,
		vehicle: data.vehicle ?? "",
		make: data.make ?? "",
		model: data.model ?? "",
		year: data.year ?? 0,
		notes: data.notes ?? "",
		votes: data.votes ?? 0,
		status: data.status ?? "queued",
		requestedAt:
			data.requestedAt instanceof Timestamp
				? data.requestedAt.toDate().toISOString().split("T")[0]
				: (data.requestedAt ?? ""),
	};
}

// ─── Real-time subscriptions ──────────────────
export function subscribeVehicles(
	onNext: (entries: VehicleEntry[]) => void,
	onError?: (err: Error) => void,
): Unsubscribe {
	return onSnapshot(
		collection(db, Collections.VEHICLES),
		(snap) => onNext(snap.docs.map((d) => toVehicleEntry(d.id, d.data()))),
		onError,
	);
}

export function subscribePatterns(
	onNext: (patterns: Pattern[]) => void,
	onError?: (err: Error) => void,
): Unsubscribe {
	return onSnapshot(
		collection(db, Collections.PATTERNS),
		(snap) => onNext(snap.docs.map((d) => toPattern(d.id, d.data()))),
		onError,
	);
}

export function subscribeRequests(
	onNext: (requests: PatternRequest[]) => void,
	onError?: (err: Error) => void,
): Unsubscribe {
	return onSnapshot(
		collection(db, Collections.REQUESTS),
		(snap) => onNext(snap.docs.map((d) => toPatternRequest(d.id, d.data()))),
		onError,
	);
}

// ─── VehicleEntry CRUD ────────────────────────
export async function setVehicleDoc(v: VehicleEntry): Promise<void> {
	await setDoc(
		doc(db, Collections.VEHICLES, v.id),
		{
			projectType: v.projectType ?? "vehicle",
			make: v.make ?? null,
			model: v.model ?? null,
			year: v.year ?? null,
			bodyStyle: v.bodyStyle ?? null,
			address: v.address ?? null,
			propertyLabel: v.propertyLabel ?? null,
			tags: v.tags,
			popular: v.popular ?? false,
			status: v.status,
			updatedAt: v.updatedAt,
		},
		{ merge: true },
	);
}

export async function updateVehicleDoc(
	id: string,
	patch: Partial<VehicleEntry>,
): Promise<void> {
	await updateDoc(doc(db, Collections.VEHICLES, id), patch);
}

export async function deleteVehicleDoc(id: string): Promise<void> {
	await deleteDoc(doc(db, Collections.VEHICLES, id));
}

// ─── Pattern CRUD ─────────────────────────────
export async function setPatternDoc(p: Pattern): Promise<void> {
	await setDoc(
		doc(db, Collections.PATTERNS, p.id),
		{
			vehicleId: p.vehicleId,
			projectType: p.projectType ?? "vehicle",
			category: p.category,
			zone: p.zone,
			name: p.name,
			coverage: p.coverage,
			svgPath: p.svgPath,
			svgUrl: p.svgUrl ?? null,
			widthInches: p.widthInches,
			heightInches: p.heightInches,
			revision: p.revision,
			notes: p.notes ?? null,
			isPublished: p.isPublished,
			createdAt:
				p.createdAt instanceof Date
					? Timestamp.fromDate(p.createdAt)
					: serverTimestamp(),
			updatedAt: serverTimestamp(),
		},
		{ merge: true },
	);
}

export async function updatePatternDoc(
	id: string,
	patch: Partial<Pattern>,
): Promise<void> {
	await updateDoc(doc(db, Collections.PATTERNS, id), {
		...patch,
		updatedAt: serverTimestamp(),
	});
}

export async function deletePatternDoc(id: string): Promise<void> {
	await deleteDoc(doc(db, Collections.PATTERNS, id));
}

// ─── User Patterns ────────────────────────────
function toUserPattern(id: string, data: DocumentData): UserPattern {
	return {
		id,
		ownerId:           data.ownerId          ?? "",
		submitToCommunity: data.submitToCommunity ?? false,
		isPublished:       data.isPublished       ?? false,
		status:            data.status            ?? "private",
		adminNotes:        data.adminNotes,
		vehicleId:         data.vehicleId,
		make:              data.make                                          ?? "",
		models:            Array.isArray(data.models) ? data.models
		                   : data.model ? [data.model as string] : [],
		years:             Array.isArray(data.years) ? data.years
		                   : data.year ? [String(data.year)] : [],
		bodyStyle:         data.bodyStyle         ?? "sedan",
		category:          data.category          ?? "ppf",
		zones:             Array.isArray(data.zones) ? data.zones
		                   : data.zone ? [data.zone as string] : [],
		name:              data.name              ?? "",
		coverage:          data.coverage          ?? "full",
		widthInches:       data.widthInches       ?? 0,
		heightInches:      data.heightInches      ?? 0,
		svgPath:           data.svgPath           ?? "",
		notes:             data.notes,
		createdAt:         fromTimestamp(data.createdAt),
		updatedAt:         fromTimestamp(data.updatedAt),
	};
}

export async function addUserPattern(
	data: Omit<UserPattern, "id" | "createdAt" | "updatedAt" | "status" | "isPublished">,
): Promise<string> {
	const ref = doc(collection(db, Collections.USER_PATTERNS));
	const { vehicleId, notes, adminNotes, patternName, address, propertyLabel, ...rest } = data;
	await setDoc(ref, {
		...rest,
		...(vehicleId     ? { vehicleId }     : {}),
		...(notes         ? { notes }         : {}),
		...(adminNotes    ? { adminNotes }    : {}),
		...(patternName   ? { patternName }   : {}),
		...(address       ? { address }       : {}),
		...(propertyLabel ? { propertyLabel } : {}),
		isPublished: false,
		status: data.submitToCommunity ? "pending" : "private",
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
	});
	return ref.id;
}

export async function getUserPatterns(ownerId: string): Promise<UserPattern[]> {
	const q = query(
		collection(db, Collections.USER_PATTERNS),
		where("ownerId", "==", ownerId),
	);
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => toUserPattern(d.id, d.data()))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getUserPatternById(id: string): Promise<UserPattern | null> {
	const snap = await getDoc(doc(db, Collections.USER_PATTERNS, id));
	return snap.exists() ? toUserPattern(snap.id, snap.data()) : null;
}

export async function updateUserPattern(
	id: string,
	patch: Partial<Pick<UserPattern,
		| "submitToCommunity" | "name" | "notes" | "svgPath"
		| "widthInches" | "heightInches" | "coverage"
		| "category" | "zones" | "make" | "models" | "years" | "bodyStyle"
	>>,
): Promise<void> {
	const update: Record<string, unknown> = { ...patch, updatedAt: serverTimestamp() };
	if (patch.submitToCommunity !== undefined) {
		update.status = patch.submitToCommunity ? "pending" : "private";
	}
	// Firebase v12 throws on undefined values in updateDoc — convert them to
	// deleteField() so optional fields (e.g. notes) are properly cleared.
	for (const key of Object.keys(update)) {
		if (update[key] === undefined) update[key] = deleteField();
	}
	await updateDoc(doc(db, Collections.USER_PATTERNS, id), update);
}

export async function deleteUserPattern(id: string): Promise<void> {
	await deleteDoc(doc(db, Collections.USER_PATTERNS, id));
}

export async function adminUpdateUserPattern(
	id: string,
	patch: Partial<UserPattern>,
): Promise<void> {
	await updateDoc(doc(db, Collections.USER_PATTERNS, id), {
		...patch,
		updatedAt: serverTimestamp(),
	});
}

export async function getSubmissions(): Promise<UserPattern[]> {
	const q = query(
		collection(db, Collections.USER_PATTERNS),
		where("submitToCommunity", "==", true),
	);
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => toUserPattern(d.id, d.data()))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getAdjustmentRequests(): Promise<PatternAdjustmentRequest[]> {
	const q = query(collection(db, Collections.PATTERN_ADJUSTMENTS));
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => ({
			id: d.id,
			patternId:   d.data().patternId   ?? "",
			requestedBy: d.data().requestedBy ?? "",
			notes:       d.data().notes       ?? "",
			status:      d.data().status      ?? "pending",
			adminResponse: d.data().adminResponse,
			createdAt:   fromTimestamp(d.data().createdAt),
		} as PatternAdjustmentRequest))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function resolveAdjustmentRequest(
	id: string,
	status: "approved" | "rejected",
	adminResponse?: string,
): Promise<void> {
	await updateDoc(doc(db, Collections.PATTERN_ADJUSTMENTS, id), {
		status,
		...(adminResponse ? { adminResponse } : {}),
	});
}

export async function addPatternAdjustmentRequest(
	data: Pick<PatternAdjustmentRequest, "patternId" | "requestedBy" | "notes">,
): Promise<void> {
	const ref = doc(collection(db, Collections.PATTERN_ADJUSTMENTS));
	await setDoc(ref, {
		...data,
		status: "pending",
		createdAt: serverTimestamp(),
	});
}

// ─── PatternRequest CRUD ──────────────────────
export async function setRequestDoc(r: PatternRequest): Promise<void> {
	await setDoc(doc(db, Collections.REQUESTS, r.id), {
		vehicle: r.vehicle,
		make: r.make,
		model: r.model,
		year: r.year,
		notes: r.notes,
		votes: r.votes,
		status: r.status,
		requestedAt: r.requestedAt,
	});
}

export async function updateRequestDoc(
	id: string,
	patch: Partial<PatternRequest>,
): Promise<void> {
	await updateDoc(doc(db, Collections.REQUESTS, id), patch);
}

// ─── Admin: seed all data to Firestore ────────
// Chunks writes into batches of 400 to stay under the 500-op Firestore limit.
export async function batchSeedData(
	vehicles: VehicleEntry[],
	patternsMap: Record<string, Pattern[]>,
	requests: PatternRequest[],
): Promise<void> {
	const allPatterns = Object.values(patternsMap).flat();

	type WriteOp = { ref: ReturnType<typeof doc>; data: Record<string, unknown> };
	const ops: WriteOp[] = [
		...vehicles.map((v) => ({
			ref: doc(db, Collections.VEHICLES, v.id),
			data: {
				projectType: v.projectType ?? "vehicle",
				make: v.make ?? null,
				model: v.model ?? null,
				year: v.year ?? null,
				bodyStyle: v.bodyStyle ?? null,
				address: v.address ?? null,
				propertyLabel: v.propertyLabel ?? null,
				tags: v.tags,
				popular: v.popular ?? false,
				status: v.status,
				updatedAt: v.updatedAt,
			},
		})),
		...allPatterns.map((p) => ({
			ref: doc(db, Collections.PATTERNS, p.id),
			data: {
				vehicleId: p.vehicleId,
				projectType: p.projectType ?? "vehicle",
				category: p.category,
				zone: p.zone,
				name: p.name,
				coverage: p.coverage,
				svgPath: p.svgPath,
				svgUrl: p.svgUrl ?? null,
				widthInches: p.widthInches,
				heightInches: p.heightInches,
				revision: p.revision,
				notes: p.notes ?? null,
				isPublished: p.isPublished,
				createdAt:
					p.createdAt instanceof Date
						? Timestamp.fromDate(p.createdAt)
						: serverTimestamp(),
				updatedAt: serverTimestamp(),
			},
		})),
		...requests.map((r) => ({
			ref: doc(db, Collections.REQUESTS, r.id),
			data: {
				vehicle: r.vehicle,
				make: r.make,
				model: r.model,
				year: r.year,
				notes: r.notes,
				votes: r.votes,
				status: r.status,
				requestedAt: r.requestedAt,
			},
		})),
	];

	// Chunk into batches of 400
	for (let i = 0; i < ops.length; i += 400) {
		const batch = writeBatch(db);
		for (const op of ops.slice(i, i + 400)) {
			batch.set(op.ref, op.data, { merge: true });
		}
		await batch.commit();
	}
}

// ─── Org converters ────────────────────────────
export function toOrganization(id: string, data: DocumentData): Organization {
	return {
		id,
		name: data.name ?? "",
		ownerId: data.ownerId ?? "",
		plan: data.plan ?? "starter",
		seats: data.seats ?? 1,
		stripeCustomerId: data.stripeCustomerId ?? null,
		stripePriceId: data.stripePriceId ?? null,
		subscriptionStatus: data.subscriptionStatus ?? null,
		currentPeriodEnd: data.currentPeriodEnd ? fromTimestamp(data.currentPeriodEnd) : null,
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
	};
}

export async function getOrg(orgId: string): Promise<Organization | null> {
	const snap = await getDoc(doc(db, Collections.ORGS, orgId));
	if (!snap.exists()) return null;
	return toOrganization(snap.id, snap.data());
}

export interface OrgSummary {
	id: string;
	name: string;
	plan: Shop["plan"];
	role: ShopRole;
}

// Runs server-side (GET /api/orgs) — enumerating "orgs this uid belongs
// to" needs a collectionGroup("members") query, which the client SDK
// can't scope the way the server route does (see route comment).
export async function getUserOrgs(): Promise<OrgSummary[]> {
	const res = await authedFetch("/api/orgs");
	const d = await res.json();
	return d.orgs;
}

export interface OrgShopSummary {
	id: string;
	orgId: string;
	name: string;
	plan: Shop["plan"];
	seats: number;
	ownerId: string;
}

// Runs server-side (GET /api/orgs/[orgId]/shops) — shops/{shopId} itself
// stays deny-all client reads even for an org-wide member, so this is the
// only way to list which shops an org has.
export async function getOrgShops(orgId: string): Promise<OrgShopSummary[]> {
	const res = await authedFetch(`/api/orgs/${orgId}/shops`);
	const d = await res.json();
	return d.shops;
}

// Runs server-side (PATCH /api/users/active-shop) — validates membership
// and derives shopRole from the target shop's own member doc, so a
// switcher can never carry over a role from whichever shop was active
// before.
export async function switchActiveShop(shopId: string): Promise<{ shopId: string; shopRole: ShopRole }> {
	const res = await authedFetch("/api/users/active-shop", {
		method: "PATCH",
		body: JSON.stringify({ shopId }),
	});
	return res.json();
}

// ─── Groups (Phase 3 entity, Phase 5 client access) ───────────────────
// Mutations already go through src/routes/api/orgs/[orgId]/groups/** as
// of Phase 3. Listing is a direct client read — firestore.rules already
// allows it (read if isOrgMember(orgId)), same pattern as orgs/shops.
export function toGroup(id: string, data: DocumentData): Group {
	return {
		id,
		orgId: data.orgId ?? "",
		name: data.name ?? "",
		role: data.role ?? "tech",
		shopIds: data.shopIds ?? null,
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
	};
}

export function toGroupMember(data: DocumentData): GroupMember {
	return {
		uid: data.uid ?? "",
		orgId: data.orgId ?? "",
		groupId: data.groupId ?? "",
		joinedAt: fromTimestamp(data.joinedAt),
	};
}

export async function getOrgGroups(orgId: string): Promise<Group[]> {
	const snap = await getDocs(collection(db, Collections.ORGS, orgId, "groups"));
	return snap.docs.map((d) => toGroup(d.id, d.data()));
}

export async function getGroupMembers(orgId: string, groupId: string): Promise<GroupMember[]> {
	const snap = await getDocs(collection(db, Collections.ORGS, orgId, "groups", groupId, "groupMembers"));
	return snap.docs.map((d) => toGroupMember(d.data()));
}

export async function createGroup(
	orgId: string,
	name: string,
	role: ShopRole,
	shopIds: string[] | null,
): Promise<Group> {
	const res = await authedFetch(`/api/orgs/${orgId}/groups`, {
		method: "POST",
		body: JSON.stringify({ name, role, shopIds }),
	});
	const d = await res.json();
	return { ...d, createdAt: new Date(), updatedAt: new Date() };
}

export async function updateGroup(
	orgId: string,
	groupId: string,
	patch: { name?: string; role?: ShopRole; shopIds?: string[] | null },
): Promise<void> {
	await authedFetch(`/api/orgs/${orgId}/groups/${groupId}`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});
}

export async function deleteGroup(orgId: string, groupId: string): Promise<void> {
	await authedFetch(`/api/orgs/${orgId}/groups/${groupId}`, { method: "DELETE" });
}

export async function addGroupMember(orgId: string, groupId: string, uid: string): Promise<void> {
	await authedFetch(`/api/orgs/${orgId}/groups/${groupId}/members/${uid}`, { method: "POST" });
}

export async function removeGroupMember(orgId: string, groupId: string, uid: string): Promise<void> {
	await authedFetch(`/api/orgs/${orgId}/groups/${groupId}/members/${uid}`, { method: "DELETE" });
}

export function toOrgMember(data: DocumentData): OrgMember {
	return {
		uid: data.uid ?? "",
		orgId: data.orgId ?? "",
		directRole: data.directRole ?? null,
		directShopIds: data.directShopIds ?? null,
		role: data.role ?? "tech",
		shopIds: data.shopIds ?? null,
		displayName: data.displayName ?? "",
		email: data.email ?? "",
		joinedAt: fromTimestamp(data.joinedAt),
	};
}

// ─── Shop converters ──────────────────────────
export function toShop(id: string, data: DocumentData): Shop {
	return {
		id,
		orgId: data.orgId ?? null,
		name: data.name ?? "",
		plan: data.plan ?? "starter",
		seats: data.seats ?? 1,
		ownerId: data.ownerId ?? "",
		stripeCustomerId: data.stripeCustomerId ?? null,
		stripePriceId: data.stripePriceId ?? null,
		subscriptionStatus: data.subscriptionStatus ?? null,
		currentPeriodEnd: data.currentPeriodEnd
			? fromTimestamp(data.currentPeriodEnd)
			: null,
		createdAt: fromTimestamp(data.createdAt),
		updatedAt: fromTimestamp(data.updatedAt),
	};
}

export function toShopMember(data: DocumentData): ShopMember {
	return {
		uid: data.uid ?? "",
		shopId: data.shopId ?? "",
		role: data.role ?? "tech",
		displayName: data.displayName ?? "",
		email: data.email ?? "",
		joinedAt: fromTimestamp(data.joinedAt),
	};
}

export function toShopInvite(id: string, data: DocumentData): ShopInvite {
	return {
		id,
		shopId: data.shopId ?? "",
		shopName: data.shopName ?? "",
		role: data.role ?? "tech",
		email: data.email ?? null,
		createdBy: data.createdBy ?? "",
		status: data.status ?? "pending",
		createdAt: fromTimestamp(data.createdAt),
		expiresAt: fromTimestamp(data.expiresAt),
	};
}

// ─── Shop CRUD ────────────────────────────────
// Runs server-side (POST /api/shops) — writes to the orgs collection, and
// firestore.rules only permits self-bootstrap create there, not the
// multi-doc batch this needs. `ownerId` is implicit (the authed caller);
// kept as a parameter so call sites don't change.
export async function createShop(
	_ownerId: string,
	name: string,
	plan: Shop["plan"] = "starter",
): Promise<Shop> {
	const res = await authedFetch("/api/shops", {
		method: "POST",
		body: JSON.stringify({ name, plan }),
	});
	const d = await res.json();
	return {
		...d,
		currentPeriodEnd: d.currentPeriodEnd ? new Date(d.currentPeriodEnd) : null,
		createdAt: new Date(d.createdAt),
		updatedAt: new Date(d.updatedAt),
	};
}

export async function getShop(shopId: string): Promise<Shop | null> {
	const snap = await getDoc(doc(db, Collections.SHOPS, shopId));
	if (!snap.exists()) return null;
	return toShop(snap.id, snap.data());
}

export async function updateShop(
	shopId: string,
	patch: Partial<Pick<Shop, "name" | "plan" | "seats" | "stripeCustomerId" | "stripePriceId" | "subscriptionStatus" | "currentPeriodEnd">>,
): Promise<void> {
	await updateDoc(doc(db, Collections.SHOPS, shopId), {
		...patch,
		updatedAt: serverTimestamp(),
	});
}

export function subscribeToShop(
	shopId: string,
	callback: (shop: Shop | null) => void,
): () => void {
	return onSnapshot(doc(db, Collections.SHOPS, shopId), (snap) => {
		callback(snap.exists() ? toShop(snap.id, snap.data()) : null);
	});
}

// ─── Shop members ─────────────────────────────
export async function getShopMembers(shopId: string): Promise<ShopMember[]> {
	const snap = await getDocs(collection(db, Collections.SHOPS, shopId, "members"));
	return snap.docs.map((d) => toShopMember({ ...d.data(), uid: d.id }));
}

export function subscribeToShopMembers(
	shopId: string,
	callback: (members: ShopMember[]) => void,
): () => void {
	return onSnapshot(
		collection(db, Collections.SHOPS, shopId, "members"),
		(snap) => callback(snap.docs.map((d) => toShopMember({ ...d.data(), uid: d.id }))),
	);
}

// Runs server-side (PATCH/DELETE /api/shops/[shopId]/members/[uid]) — the
// route enforces the last-owner invariant and the role-escalation cap,
// neither of which security rules can express.
export async function removeShopMember(shopId: string, uid: string): Promise<void> {
	await authedFetch(`/api/shops/${shopId}/members/${uid}`, { method: "DELETE" });
}

export async function updateShopMemberRole(
	shopId: string,
	uid: string,
	role: ShopRole,
): Promise<void> {
	await authedFetch(`/api/shops/${shopId}/members/${uid}`, {
		method: "PATCH",
		body: JSON.stringify({ role }),
	});
}

// ─── Shop invites ─────────────────────────────
// Runs server-side (POST /api/shops/[shopId]/invites) — the route caps the
// invite's role at the caller's own, which a client write can't be trusted
// to enforce.
export async function createShopInvite(
	shopId: string,
	_shopName: string,
	_createdBy: string,
	role: ShopRole = "tech",
	email: string | null = null,
): Promise<ShopInvite> {
	const res = await authedFetch(`/api/shops/${shopId}/invites`, {
		method: "POST",
		body: JSON.stringify({ role, email }),
	});
	const d = await res.json();
	return { ...d, createdAt: new Date(d.createdAt), expiresAt: new Date(d.expiresAt) };
}

export async function getShopInvite(token: string): Promise<ShopInvite | null> {
	const snap = await getDoc(doc(db, Collections.SHOP_INVITES, token));
	if (!snap.exists()) return null;
	return toShopInvite(snap.id, snap.data());
}

// Runs server-side (POST /api/shops/invites/[token]/accept) — role comes
// from the stored invite doc only, never from the caller, closing the
// self-escalation gap a client write could exploit.
export async function acceptShopInvite(
	token: string,
	_uid: string,
	_displayName: string,
	_email: string,
): Promise<void> {
	await authedFetch(`/api/shops/invites/${token}/accept`, { method: "POST" });
}

export async function revokeShopInvite(token: string): Promise<void> {
	await authedFetch(`/api/shops/invites/${token}`, { method: "DELETE" });
}

export async function getShopInvitesByShop(shopId: string): Promise<ShopInvite[]> {
	const q = query(
		collection(db, Collections.SHOP_INVITES),
		where("shopId", "==", shopId),
		where("status", "==", "pending"),
		orderBy("createdAt", "desc"),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toShopInvite(d.id, d.data()));
}

// ─── Plotter Device CRUD ──────────────────────

function toPlotterDevice(id: string, data: DocumentData): PlotterDevice {
	return {
		id,
		userId:          data.userId ?? "",
		name:            data.name ?? "",
		presetName:      data.presetName ?? "",
		manufacturer:    data.manufacturer ?? "",
		model:           data.model ?? "",
		protocol:        data.protocol ?? "hpgl",
		connection:      data.connection ?? "download",
		maxMediaWidthMm: data.maxMediaWidthMm ?? 0,
		ipAddress:       data.ipAddress,
		port:            data.port,
		baudRate:        data.baudRate,
		serialPort:      data.serialPort,
		agentUrl:        data.agentUrl,
		compatNote:      data.compatNote,
		vendorId:        data.vendorId,
		productId:       data.productId,
		lastConnectedAt: data.lastConnectedAt ? fromTimestamp(data.lastConnectedAt) : null,
		createdAt:       fromTimestamp(data.createdAt),
		updatedAt:       fromTimestamp(data.updatedAt),
	};
}

export async function getUserPlotters(uid: string): Promise<PlotterDevice[]> {
	const q = query(
		collection(db, Collections.PLOTTERS),
		where("userId", "==", uid),
		orderBy("createdAt", "asc"),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toPlotterDevice(d.id, d.data()));
}

export async function savePlotter(plotter: PlotterDevice): Promise<void> {
	// Firestore's setDoc rejects explicit `undefined` field values (throws
	// "Unsupported field value: undefined"). PlotterDevice has several optional
	// fields (vendorId, ipAddress, serialPort, ...) that are `undefined` rather
	// than omitted depending on connection type — strip them before writing.
	const data: Record<string, unknown> = { ...plotter, updatedAt: serverTimestamp() };
	for (const key of Object.keys(data)) {
		if (data[key] === undefined) delete data[key];
	}
	await setDoc(
		doc(db, Collections.PLOTTERS, plotter.id),
		data,
		{ merge: true },
	);
}

export async function deletePlotter(id: string): Promise<void> {
	await deleteDoc(doc(db, Collections.PLOTTERS, id));
}

export function subscribeToPlotters(
	uid: string,
	callback: (plotters: PlotterDevice[]) => void,
): Unsubscribe {
	const q = query(
		collection(db, Collections.PLOTTERS),
		where("userId", "==", uid),
		orderBy("createdAt", "asc"),
	);
	return onSnapshot(q, (snap) => {
		callback(snap.docs.map((d) => toPlotterDevice(d.id, d.data())));
	});
}

// ─── Insight converters ───────────────────────
export function toInsightPost(id: string, data: DocumentData): InsightPost {
	return {
		id,
		slug:             data.slug             ?? "",
		title:            data.title            ?? "",
		excerpt:          data.excerpt          ?? "",
		content:          data.content          ?? "",
		category:         data.category         ?? "guides",
		tags:             data.tags             ?? [],
		status:           data.status           ?? "draft",
		coverImageUrl:    data.coverImageUrl    ?? null,
		author:           data.author           ?? "OmniPlot",
		readTimeMinutes:  data.readTimeMinutes  ?? 1,
		viewCount:        data.viewCount        ?? 0,
		metaTitle:        data.metaTitle        ?? null,
		metaDescription:  data.metaDescription  ?? null,
		publishedAt:      data.publishedAt ? fromTimestamp(data.publishedAt) : null,
		createdAt:        fromTimestamp(data.createdAt),
		updatedAt:        fromTimestamp(data.updatedAt),
	};
}

// ─── Insight CRUD ─────────────────────────────
export async function getPublishedInsights(): Promise<InsightPost[]> {
	const q = query(
		collection(db, Collections.INSIGHTS),
		where("status", "==", "published"),
		orderBy("publishedAt", "desc"),
		limit(100),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => toInsightPost(d.id, d.data()));
}

export async function getInsightBySlug(slug: string): Promise<InsightPost | null> {
	const q = query(
		collection(db, Collections.INSIGHTS),
		where("slug", "==", slug),
		where("status", "==", "published"),
		limit(1),
	);
	const snap = await getDocs(q);
	if (snap.empty) return null;
	return toInsightPost(snap.docs[0].id, snap.docs[0].data());
}

export async function getAllInsights(): Promise<InsightPost[]> {
	// No orderBy — avoids composite index requirement. Sort client-side.
	const q = query(
		collection(db, Collections.INSIGHTS),
		limit(200),
	);
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => toInsightPost(d.id, d.data()))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function createInsightPost(
	data: Omit<InsightPost, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
	const ref = doc(collection(db, Collections.INSIGHTS));
	await setDoc(ref, {
		...data,
		publishedAt: data.publishedAt ? Timestamp.fromDate(data.publishedAt) : null,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
	});
	return ref.id;
}

export async function updateInsightPost(
	id: string,
	patch: Partial<Omit<InsightPost, "id" | "createdAt">>,
): Promise<void> {
	const { publishedAt, ...rest } = patch;
	await updateDoc(doc(db, Collections.INSIGHTS, id), {
		...rest,
		...(publishedAt !== undefined
			? { publishedAt: publishedAt ? Timestamp.fromDate(publishedAt) : null }
			: {}),
		updatedAt: serverTimestamp(),
	});
}

export async function deleteInsightPost(id: string): Promise<void> {
	await deleteDoc(doc(db, Collections.INSIGHTS, id));
}

// ─── Plotter Error Reports ────────────────────

function toPlotterErrorReport(id: string, data: DocumentData): PlotterErrorReport {
	return {
		id,
		userId:       data.userId       ?? "",
		userEmail:    data.userEmail    ?? null,
		displayName:  data.displayName  ?? null,
		plotterPreset: data.plotterPreset ?? "",
		connection:   data.connection   ?? "",
		protocol:     data.protocol     ?? "",
		errorCode:    data.errorCode    ?? "UNKNOWN",
		errorTitle:   data.errorTitle   ?? "",
		errorRaw:     data.errorRaw     ?? "",
		agentVersion: data.agentVersion ?? null,
		userAgent:    data.userAgent    ?? "",
		autoReported: data.autoReported ?? false,
		resolvedAt:   data.resolvedAt ? fromTimestamp(data.resolvedAt) : null,
		createdAt:    fromTimestamp(data.createdAt),
	};
}

// Client-side dedup: same user+code+preset within 5 minutes won't double-log.
const _errorLogCache = new Map<string, number>();

export async function logPlotterError(
	report: Omit<PlotterErrorReport, "id" | "createdAt" | "resolvedAt">,
): Promise<void> {
	const key = `${report.userId}:${report.errorCode}:${report.plotterPreset}`;
	const lastLogged = _errorLogCache.get(key) ?? 0;
	if (Date.now() - lastLogged < 5 * 60 * 1000) return;
	_errorLogCache.set(key, Date.now());

	const ref = doc(collection(db, Collections.PLOTTER_ERRORS));
	await setDoc(ref, {
		...report,
		resolvedAt: null,
		createdAt: serverTimestamp(),
	});
}

export async function getPlotterErrors(maxResults = 150): Promise<PlotterErrorReport[]> {
	// No orderBy — sort client-side to avoid composite index requirement
	const q = query(collection(db, Collections.PLOTTER_ERRORS), limit(maxResults));
	const snap = await getDocs(q);
	return snap.docs
		.map((d) => toPlotterErrorReport(d.id, d.data()))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function resolvePlotterError(id: string): Promise<void> {
	await updateDoc(doc(db, Collections.PLOTTER_ERRORS, id), {
		resolvedAt: serverTimestamp(),
	});
}
