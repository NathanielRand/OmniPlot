import { getAdminDb } from "$lib/server/firebase-admin";
import { maxRole } from "$lib/server/shop-auth";
import { FieldValue } from "firebase-admin/firestore";
import type { ShopRole } from "$lib/types";

/**
 * Scans every shop under this org for a shops/{shopId}/members/{uid} doc and
 * folds them into a single direct grant. Only one shop per org exists today
 * (Phase 1 backfill is 1:1), but this doesn't assume that stays true.
 */
async function computeDirectGrant(
	orgId: string,
	uid: string,
): Promise<{ role: ShopRole | null; shopIds: string[] | null }> {
	const db = getAdminDb();
	const shopsSnap = await db.collection("shops").where("orgId", "==", orgId).get();

	// Direct grants always come from a specific shop's members subcollection,
	// so they're always shop-scoped — never org-wide (only a group grant can
	// be org-wide, via a null Group.shopIds).
	let role: ShopRole | null = null;
	let shopIds: string[] | null = null;

	for (const shopDoc of shopsSnap.docs) {
		const memberSnap = await db.doc(`shops/${shopDoc.id}/members/${uid}`).get();
		const memberRole = memberSnap.data()?.role as ShopRole | undefined;
		if (!memberRole) continue;
		role = role ? maxRole(role, memberRole) : memberRole;
		shopIds = [...(shopIds ?? []), shopDoc.id];
	}

	return { role, shopIds };
}

/**
 * Folds every group this uid belongs to (within this org) into a single
 * grant, alongside the direct (shop-membership) grant as the floor.
 * Writes the resolved orgs/{orgId}/members/{uid} doc, or deletes it if the
 * member has no grant left at all (no shops, no groups).
 *
 * Call this after ANY mutation that could change a member's effective
 * permissions: shop membership add/remove/role-change, or group
 * create/update/delete/membership add/remove.
 */
export async function recomputeOrgMember(orgId: string, uid: string): Promise<void> {
	const db = getAdminDb();
	const direct = await computeDirectGrant(orgId, uid);

	const groupMembersSnap = await db
		.collectionGroup("groupMembers")
		.where("uid", "==", uid)
		.where("orgId", "==", orgId)
		.get();

	let role = direct.role;
	let shopIds = direct.shopIds;
	let orgWide = direct.shopIds === null && direct.role !== null;

	for (const gm of groupMembersSnap.docs) {
		const groupSnap = await gm.ref.parent.parent!.get();
		const group = groupSnap.data();
		if (!group) continue;
		const groupRole = group.role as ShopRole;
		const groupShopIds = (group.shopIds as string[] | null) ?? null;

		role = role ? maxRole(role, groupRole) : groupRole;
		if (groupShopIds === null) {
			orgWide = true;
		} else if (!orgWide) {
			shopIds = [...new Set([...(shopIds ?? []), ...groupShopIds])];
		}
	}

	const memberRef = db.doc(`orgs/${orgId}/members/${uid}`);

	if (!role) {
		// No grant left anywhere — the member doc represents nothing.
		await memberRef.delete().catch(() => {});
		return;
	}

	const [userSnap, existingSnap] = await Promise.all([
		db.doc(`users/${uid}`).get(),
		memberRef.get(),
	]);
	const user = userSnap.data() ?? {};

	await memberRef.set(
		{
			uid,
			orgId,
			role,
			shopIds: orgWide ? null : shopIds,
			directRole: direct.role,
			directShopIds: direct.shopIds,
			displayName: user.displayName ?? "",
			email: user.email ?? "",
			// Only stamp joinedAt on first creation — recompute must not
			// reset it on every subsequent shop/group change.
			...(existingSnap.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
		},
		{ merge: true },
	);
}
