import { getAdminDb, verifyIdToken } from "$lib/server/firebase-admin";
import type { ShopRole } from "$lib/types";

// Higher number = more privilege. Used to stop a caller granting or
// touching a role above their own — rules can't express this, so it lives
// here and every mutation route must call it.
export const ROLE_RANK: Record<ShopRole, number> = { tech: 1, manager: 2, owner: 3 };

export function roleAtLeast(role: ShopRole, min: ShopRole): boolean {
	return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function roleOutranks(a: ShopRole, b: ShopRole): boolean {
	return ROLE_RANK[a] > ROLE_RANK[b];
}

export function maxRole(a: ShopRole, b: ShopRole): ShopRole {
	return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export async function requireUid(request: Request): Promise<string | null> {
	return verifyIdToken(request.headers.get("authorization"));
}

/** Reads the caller's role on a shop directly — the source of truth for these routes. */
export async function getShopRole(shopId: string, uid: string): Promise<ShopRole | null> {
	const snap = await getAdminDb().doc(`shops/${shopId}/members/${uid}`).get();
	return (snap.data()?.role as ShopRole | undefined) ?? null;
}

/** True if removing `uid` (or demoting them off "owner") would leave the shop with no owner. */
export async function isLastOwner(shopId: string, uid: string): Promise<boolean> {
	const db = getAdminDb();
	const memberSnap = await db.doc(`shops/${shopId}/members/${uid}`).get();
	if (memberSnap.data()?.role !== "owner") return false;
	const ownersSnap = await db
		.collection(`shops/${shopId}/members`)
		.where("role", "==", "owner")
		.get();
	return ownersSnap.size <= 1;
}
