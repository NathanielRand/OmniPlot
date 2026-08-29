import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, roleAtLeast, roleOutranks } from "$lib/server/shop-auth";
import { getOrgRole } from "$lib/server/org-auth";
import { FieldValue } from "firebase-admin/firestore";
import type { ShopRole } from "$lib/types";

const VALID_ROLES: ShopRole[] = ["owner", "manager", "tech"];

// POST /api/orgs/[orgId]/groups — create a group. Caller must be an
// owner/manager on the org, and can never mint a group whose grant
// outranks their own effective role.
export const POST: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const callerRole = await getOrgRole(orgId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const { name, role, shopIds } = (await request.json()) as {
		name?: string;
		role?: ShopRole;
		shopIds?: string[] | null;
	};
	if (!name || typeof name !== "string") {
		return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
	}
	const groupRole: ShopRole = role && VALID_ROLES.includes(role) ? role : "tech";
	if (roleOutranks(groupRole, callerRole)) {
		return new Response(
			JSON.stringify({ error: "Cannot grant a role above your own" }),
			{ status: 403 },
		);
	}

	const db = getAdminDb();

	// Every shopId, if given, must belong to this org.
	const scopedShopIds = shopIds ?? null;
	if (scopedShopIds) {
		for (const shopId of scopedShopIds) {
			const shopSnap = await db.doc(`shops/${shopId}`).get();
			if (shopSnap.data()?.orgId !== orgId) {
				return new Response(
					JSON.stringify({ error: `Shop ${shopId} does not belong to this org` }),
					{ status: 400 },
				);
			}
		}
	}

	const now = FieldValue.serverTimestamp();
	const ref = db.collection(`orgs/${orgId}/groups`).doc();
	await ref.set({
		orgId,
		name,
		role: groupRole,
		shopIds: scopedShopIds,
		createdAt: now,
		updatedAt: now,
	});

	return json({ id: ref.id, orgId, name, role: groupRole, shopIds: scopedShopIds });
};
