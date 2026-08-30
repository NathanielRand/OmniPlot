import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid } from "$lib/server/shop-auth";

// GET /api/orgs — list every org the caller belongs to (effective grant,
// i.e. orgs/{orgId}/members/{uid} exists). Enumerating this client-side
// isn't possible: it needs a collectionGroup("members") query, and that
// collection name is shared with shops/{shopId}/members — filtering here
// by actual document path (parent-of-parent-of-parent === "orgs") avoids
// the ambiguity rather than relying on which fields happen to be present.
export const GET: RequestHandler = async ({ request }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const db = getAdminDb();
	const membersSnap = await db.collectionGroup("members").where("uid", "==", uid).get();
	const orgDocs = membersSnap.docs.filter((d) => d.ref.parent.parent?.parent.id === "orgs");

	const orgs = await Promise.all(
		orgDocs.map(async (memberDoc) => {
			const orgId = memberDoc.ref.parent.parent!.id;
			const orgSnap = await db.doc(`orgs/${orgId}`).get();
			const o = orgSnap.data();
			if (!o) return null;
			return {
				id: orgId,
				name: o.name,
				plan: o.plan,
				role: memberDoc.data().role,
			};
		}),
	);

	return json({ orgs: orgs.filter((o): o is NonNullable<typeof o> => o !== null) });
};
