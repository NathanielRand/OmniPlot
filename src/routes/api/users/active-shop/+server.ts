import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid } from "$lib/server/shop-auth";
import { FieldValue } from "firebase-admin/firestore";

// PATCH /api/users/active-shop — switch which shop is the user's
// default/last-active pointer (users/{uid}.shopId/.shopRole). The two
// fields must update atomically and shopRole must come from the target
// shop's own member doc, never carried over from whichever shop was
// active before — a tech switching into a shop they own must see owner
// controls, not the reverse. The old client-write path (`users/{userId}`
// still allows self-write) could set shopId to any string with no
// membership check at all; this route is the validated replacement for
// the switcher UI, though the raw client write remains technically
// possible until firestore.rules is tightened for it separately.
export const PATCH: RequestHandler = async ({ request }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const { shopId } = (await request.json()) as { shopId?: string };
	if (!shopId || typeof shopId !== "string") {
		return new Response(JSON.stringify({ error: "shopId required" }), { status: 400 });
	}

	const db = getAdminDb();
	const memberSnap = await db.doc(`shops/${shopId}/members/${uid}`).get();
	const role = memberSnap.data()?.role;
	if (!role) {
		return new Response(JSON.stringify({ error: "Not a member of this shop" }), { status: 403 });
	}

	await db.doc(`users/${uid}`).update({
		shopId,
		shopRole: role,
		updatedAt: FieldValue.serverTimestamp(),
	});

	return json({ shopId, shopRole: role });
};
