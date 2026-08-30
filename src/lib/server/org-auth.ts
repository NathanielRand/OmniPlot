import { getAdminDb } from "$lib/server/firebase-admin";
import { isPlatformAdmin } from "$lib/server/shop-auth";
import type { ShopRole } from "$lib/types";

export { roleAtLeast, roleOutranks, isPlatformAdmin } from "$lib/server/shop-auth";

/**
 * Reads the caller's EFFECTIVE role on an org (the resolved
 * orgs/{orgId}/members/{uid} doc). A platform admin resolves to "owner"
 * unconditionally, same bypass and same rationale as getShopRole.
 */
export async function getOrgRole(orgId: string, uid: string): Promise<ShopRole | null> {
	if (await isPlatformAdmin(uid)) return "owner";
	const snap = await getAdminDb().doc(`orgs/${orgId}/members/${uid}`).get();
	return (snap.data()?.role as ShopRole | undefined) ?? null;
}
