import { getAdminDb } from "$lib/server/firebase-admin";
import type { ShopRole } from "$lib/types";

export { roleAtLeast, roleOutranks } from "$lib/server/shop-auth";

/** Reads the caller's EFFECTIVE role on an org — the resolved orgs/{orgId}/members/{uid} doc. */
export async function getOrgRole(orgId: string, uid: string): Promise<ShopRole | null> {
	const snap = await getAdminDb().doc(`orgs/${orgId}/members/${uid}`).get();
	return (snap.data()?.role as ShopRole | undefined) ?? null;
}
