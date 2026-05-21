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
	query,
	where,
	orderBy,
	limit,
	onSnapshot,
	serverTimestamp,
	Timestamp,
	type DocumentData,
	type QueryConstraint,
} from "firebase/firestore";
import { db } from "./client";
import type {
	UserProfile,
	Vehicle,
	Pattern,
	CutJob,
	AdminStats,
} from "$lib/types";

// ─── Collection refs ──────────────────────────
export const Collections = {
	USERS: "users",
	VEHICLES: "vehicles",
	PATTERNS: "patterns",
	JOBS: "jobs",
	STATS: "stats",
	PLOTTERS: "plotters",
} as const;

// ─── Converters ───────────────────────────────
function fromTimestamp(val: unknown): Date {
	if (val instanceof Timestamp) return val.toDate();
	if (val instanceof Date) return val;
	return new Date();
}

export function toUserProfile(id: string, data: DocumentData): UserProfile {
	return {
		uid: id,
		email: data.email ?? "",
		displayName: data.displayName ?? "",
		photoURL: data.photoURL ?? null,
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
		},
		subscription: {
			stripeCustomerId: data.subscription?.stripeCustomerId ?? null,
			stripePriceId: data.subscription?.stripePriceId ?? null,
			status: data.subscription?.status ?? null,
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
	};
}

export function toVehicle(id: string, data: DocumentData): Vehicle {
	return {
		id,
		make: data.make ?? "",
		model: data.model ?? "",
		year: data.year ?? 0,
		variant: data.variant,
		bodyStyle: data.bodyStyle ?? "sedan",
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
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
		tier: "free",
		usage: {
			cutCount: 0,
			lastCutAt: null,
			monthlyCount: 0,
			monthResetAt: serverTimestamp(),
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
			v.make.toLowerCase().includes(lower) ||
			v.model.toLowerCase().includes(lower) ||
			String(v.year).includes(lower),
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
export async function getUserJobs(
	uid: string,
	limitCount = 20,
): Promise<CutJob[]> {
	const q = query(
		collection(db, Collections.JOBS),
		where("userId", "==", uid),
		orderBy("updatedAt", "desc"),
		limit(limitCount),
	);
	const snap = await getDocs(q);
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CutJob);
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
