import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import {
	requireUid,
	getShopRole,
	roleAtLeast,
	roleOutranks,
	isLastOwner,
} from "$lib/server/shop-auth";
import { recomputeOrgMember } from "$lib/server/recompute-org-member";
import { FieldValue } from "firebase-admin/firestore";
import type { ShopRole } from "$lib/types";

async function recomputeForShop(shopId: string, uid: string): Promise<void> {
	const shopSnap = await getAdminDb().doc(`shops/${shopId}`).get();
	const orgId = shopSnap.data()?.orgId;
	if (orgId) await recomputeOrgMember(orgId, uid);
}

const VALID_ROLES: ShopRole[] = ["owner", "manager", "tech"];

// PATCH /api/shops/[shopId]/members/[uid] — change a member's role. Caller
// must be owner/manager, can't set a role above their own, and can't
// demote the shop's sole owner (that would leave it ownerless).
export const PATCH: RequestHandler = async ({ request, params }) => {
	const callerUid = await requireUid(request);
	if (!callerUid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const shopId = params.shopId!;
	const targetUid = params.uid!;
	const callerRole = await getShopRole(shopId, callerUid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const { role } = (await request.json()) as { role?: ShopRole };
	if (!role || !VALID_ROLES.includes(role)) {
		return new Response(JSON.stringify({ error: "Invalid role" }), { status: 400 });
	}
	if (roleOutranks(role, callerRole)) {
		return new Response(
			JSON.stringify({ error: "Cannot grant a role above your own" }),
			{ status: 403 },
		);
	}
	if (role !== "owner" && (await isLastOwner(shopId, targetUid))) {
		return new Response(
			JSON.stringify({ error: "Shop must have at least one owner" }),
			{ status: 409 },
		);
	}

	const db = getAdminDb();
	const batch = db.batch();
	batch.update(db.doc(`shops/${shopId}/members/${targetUid}`), { role });
	batch.update(db.doc(`users/${targetUid}`), {
		shopRole: role,
		updatedAt: FieldValue.serverTimestamp(),
	});
	await batch.commit();
	await recomputeForShop(shopId, targetUid);

	return json({ ok: true });
};

// DELETE /api/shops/[shopId]/members/[uid] — remove a member, or leave the
// shop yourself. Blocked when it would remove the shop's sole owner.
export const DELETE: RequestHandler = async ({ request, params }) => {
	const callerUid = await requireUid(request);
	if (!callerUid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const shopId = params.shopId!;
	const targetUid = params.uid!;
	const isSelf = callerUid === targetUid;

	if (!isSelf) {
		const callerRole = await getShopRole(shopId, callerUid);
		if (!callerRole || !roleAtLeast(callerRole, "manager")) {
			return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
		}
	}

	if (await isLastOwner(shopId, targetUid)) {
		return new Response(
			JSON.stringify({ error: "Shop must have at least one owner" }),
			{ status: 409 },
		);
	}

	const db = getAdminDb();
	const batch = db.batch();
	batch.delete(db.doc(`shops/${shopId}/members/${targetUid}`));

	// Only clear the user doc's pointer if this shop is their active one —
	// removing them from a non-active shop shouldn't touch it.
	const userSnap = await db.doc(`users/${targetUid}`).get();
	if (userSnap.data()?.shopId === shopId) {
		batch.update(db.doc(`users/${targetUid}`), {
			shopId: null,
			shopRole: null,
			updatedAt: FieldValue.serverTimestamp(),
		});
	}

	await batch.commit();
	await recomputeForShop(shopId, targetUid);

	return json({ ok: true });
};
