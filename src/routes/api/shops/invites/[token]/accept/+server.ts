import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid } from "$lib/server/shop-auth";
import { FieldValue } from "firebase-admin/firestore";

// POST /api/shops/invites/[token]/accept — role is read from the stored
// invite doc only, never from the request body. That's the fix for the
// privilege-escalation gap: the old client-write path let anyone rewrite
// the invite's role before accepting.
export const POST: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const db = getAdminDb();
	const inviteRef = db.doc(`shopInvites/${params.token}`);
	const inviteSnap = await inviteRef.get();
	if (!inviteSnap.exists) {
		return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404 });
	}
	const invite = inviteSnap.data()!;
	if (invite.status !== "pending") {
		return new Response(JSON.stringify({ error: "Invite is no longer valid" }), { status: 409 });
	}
	if (invite.expiresAt?.toDate?.() < new Date()) {
		return new Response(JSON.stringify({ error: "Invite has expired" }), { status: 409 });
	}

	const userSnap = await db.doc(`users/${uid}`).get();
	const user = userSnap.data() ?? {};

	const batch = db.batch();
	const now = FieldValue.serverTimestamp();

	batch.set(db.doc(`shops/${invite.shopId}/members/${uid}`), {
		uid,
		shopId: invite.shopId,
		role: invite.role,
		displayName: user.displayName ?? "",
		email: user.email ?? "",
		joinedAt: now,
	});

	batch.update(db.doc(`users/${uid}`), {
		shopId: invite.shopId,
		shopRole: invite.role,
		updatedAt: now,
	});

	batch.update(inviteRef, { status: "accepted" });

	await batch.commit();

	return json({ shopId: invite.shopId, role: invite.role });
};
