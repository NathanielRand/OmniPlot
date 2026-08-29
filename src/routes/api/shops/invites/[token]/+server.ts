import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, getShopRole, roleAtLeast } from "$lib/server/shop-auth";

// DELETE /api/shops/invites/[token] — revoke a pending invite. Caller must
// be owner/manager on the invite's shop.
export const DELETE: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const db = getAdminDb();
	const ref = db.doc(`shopInvites/${params.token}`);
	const snap = await ref.get();
	if (!snap.exists) {
		return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404 });
	}

	const shopId = snap.data()!.shopId as string;
	const callerRole = await getShopRole(shopId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	await ref.update({ status: "revoked" });
	return json({ ok: true });
};
