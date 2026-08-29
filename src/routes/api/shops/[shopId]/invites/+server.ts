import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, getShopRole, roleAtLeast, roleOutranks } from "$lib/server/shop-auth";
import { Timestamp } from "firebase-admin/firestore";
import type { ShopRole } from "$lib/types";

const VALID_ROLES: ShopRole[] = ["owner", "manager", "tech"];

// POST /api/shops/[shopId]/invites — create an invite. Caller must be
// owner/manager on this shop, and can never mint an invite for a role
// above their own (a manager can't invite an owner).
export const POST: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const shopId = params.shopId!;
	const callerRole = await getShopRole(shopId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const { role, email } = (await request.json()) as { role?: ShopRole; email?: string | null };
	const inviteRole: ShopRole = role && VALID_ROLES.includes(role) ? role : "tech";
	if (roleOutranks(inviteRole, callerRole)) {
		return new Response(
			JSON.stringify({ error: "Cannot grant a role above your own" }),
			{ status: 403 },
		);
	}

	const db = getAdminDb();
	const shopSnap = await db.doc(`shops/${shopId}`).get();
	if (!shopSnap.exists) {
		return new Response(JSON.stringify({ error: "Shop not found" }), { status: 404 });
	}
	const shopName = shopSnap.data()?.name ?? "";

	const now = new Date();
	const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
	const ref = db.collection("shopInvites").doc();
	await ref.set({
		shopId,
		shopName,
		role: inviteRole,
		email: email ?? null,
		createdBy: uid,
		status: "pending",
		createdAt: Timestamp.fromDate(now),
		expiresAt: Timestamp.fromDate(expiresAt),
	});

	return json({
		id: ref.id,
		shopId,
		shopName,
		role: inviteRole,
		email: email ?? null,
		createdBy: uid,
		status: "pending",
		createdAt: now.toISOString(),
		expiresAt: expiresAt.toISOString(),
	});
};
