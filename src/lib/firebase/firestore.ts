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
	Timestamp,
	type DocumentData,
	type QueryConstraint,
	type Unsubscribe,
} from "firebase/firestore";
import { db } from "./client";
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
	PlotterDevice,
	InsightPost,
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
	INSIGHTS: "insights",
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
		},
		subscription: {
			stripeCustomerId:     data.subscription?.stripeCustomerId     ?? null,
			stripePriceId:        data.subscription?.stripePriceId        ?? null,
			stripeSubscriptionId: data.subscription?.stripeSubscriptionId ?? null,
			status:               data.subscription?.status               ?? null,
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
		make: data.make ?? "",
		model: data.model ?? "",
		year: data.year ?? 0,
		bodyStyle: data.bodyStyle ?? "sedan",
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
			make: v.make,
			model: v.model,
			year: v.year,
			bodyStyle: v.bodyStyle,
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
				make: v.make,
				model: v.model,
				year: v.year,
				bodyStyle: v.bodyStyle,
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

// ─── Shop converters ──────────────────────────
export function toShop(id: string, data: DocumentData): Shop {
	return {
		id,
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
export async function createShop(
	ownerId: string,
	name: string,
	plan: Shop["plan"] = "starter",
): Promise<Shop> {
	const ref = doc(collection(db, Collections.SHOPS));
	const now = serverTimestamp();
	const seats = plan === "starter" ? 3 : plan === "team" ? 10 : 25;
	await setDoc(ref, {
		name,
		plan,
		seats,
		ownerId,
		stripeCustomerId: null,
		stripePriceId: null,
		subscriptionStatus: null,
		currentPeriodEnd: null,
		createdAt: now,
		updatedAt: now,
	});

	// Write the owner as first member
	const memberRef = doc(db, Collections.SHOPS, ref.id, "members", ownerId);
	await setDoc(memberRef, {
		uid: ownerId,
		shopId: ref.id,
		role: "owner",
		joinedAt: now,
	});

	// Stamp shopId + shopRole on the owner's user doc
	await updateDoc(doc(db, Collections.USERS, ownerId), {
		shopId: ref.id,
		shopRole: "owner",
		updatedAt: now,
	});

	const snap = await getDoc(ref);
	return toShop(ref.id, snap.data()!);
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

export async function removeShopMember(shopId: string, uid: string): Promise<void> {
	const batch = writeBatch(db);
	batch.delete(doc(db, Collections.SHOPS, shopId, "members", uid));
	batch.update(doc(db, Collections.USERS, uid), {
		shopId: null,
		shopRole: null,
		updatedAt: serverTimestamp(),
	});
	await batch.commit();
}

export async function updateShopMemberRole(
	shopId: string,
	uid: string,
	role: ShopRole,
): Promise<void> {
	const batch = writeBatch(db);
	batch.update(doc(db, Collections.SHOPS, shopId, "members", uid), { role });
	batch.update(doc(db, Collections.USERS, uid), {
		shopRole: role,
		updatedAt: serverTimestamp(),
	});
	await batch.commit();
}

// ─── Shop invites ─────────────────────────────
export async function createShopInvite(
	shopId: string,
	shopName: string,
	createdBy: string,
	role: ShopRole = "tech",
	email: string | null = null,
): Promise<ShopInvite> {
	const ref = doc(collection(db, Collections.SHOP_INVITES));
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
	await setDoc(ref, {
		shopId,
		shopName,
		role,
		email,
		createdBy,
		status: "pending",
		createdAt: Timestamp.fromDate(now),
		expiresAt: Timestamp.fromDate(expiresAt),
	});
	const snap = await getDoc(ref);
	return toShopInvite(ref.id, snap.data()!);
}

export async function getShopInvite(token: string): Promise<ShopInvite | null> {
	const snap = await getDoc(doc(db, Collections.SHOP_INVITES, token));
	if (!snap.exists()) return null;
	return toShopInvite(snap.id, snap.data());
}

export async function acceptShopInvite(
	token: string,
	uid: string,
	displayName: string,
	email: string,
): Promise<void> {
	const inviteRef = doc(db, Collections.SHOP_INVITES, token);
	const inviteSnap = await getDoc(inviteRef);
	if (!inviteSnap.exists()) throw new Error("Invite not found");

	const invite = toShopInvite(inviteSnap.id, inviteSnap.data());
	if (invite.status !== "pending") throw new Error("Invite is no longer valid");
	if (invite.expiresAt < new Date()) throw new Error("Invite has expired");

	const batch = writeBatch(db);

	// Add member to shop
	batch.set(doc(db, Collections.SHOPS, invite.shopId, "members", uid), {
		uid,
		shopId: invite.shopId,
		role: invite.role,
		displayName,
		email,
		joinedAt: serverTimestamp(),
	});

	// Stamp shopId + shopRole on the user doc
	batch.update(doc(db, Collections.USERS, uid), {
		shopId: invite.shopId,
		shopRole: invite.role,
		updatedAt: serverTimestamp(),
	});

	// Mark invite as accepted
	batch.update(inviteRef, { status: "accepted" });

	await batch.commit();
}

export async function revokeShopInvite(token: string): Promise<void> {
	await updateDoc(doc(db, Collections.SHOP_INVITES, token), { status: "revoked" });
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
	await setDoc(
		doc(db, Collections.PLOTTERS, plotter.id),
		{ ...plotter, updatedAt: serverTimestamp() },
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
