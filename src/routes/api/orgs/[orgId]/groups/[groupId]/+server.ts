import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, roleAtLeast, roleOutranks } from "$lib/server/shop-auth";
import { getOrgRole } from "$lib/server/org-auth";
import { recomputeOrgMember } from "$lib/server/recompute-org-member";
import { FieldValue } from "firebase-admin/firestore";
import type { ShopRole } from "$lib/types";

const VALID_ROLES: ShopRole[] = ["owner", "manager", "tech"];

// PATCH /api/orgs/[orgId]/groups/[groupId] — update a group's name/role/
// shopIds. Changing role/shopIds changes every member's effective grant,
// so every current member gets recomputed.
export const PATCH: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const groupId = params.groupId!;
	const callerRole = await getOrgRole(orgId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const db = getAdminDb();
	const groupRef = db.doc(`orgs/${orgId}/groups/${groupId}`);
	const groupSnap = await groupRef.get();
	if (!groupSnap.exists) {
		return new Response(JSON.stringify({ error: "Group not found" }), { status: 404 });
	}

	const { name, role, shopIds } = (await request.json()) as {
		name?: string;
		role?: ShopRole;
		shopIds?: string[] | null;
	};

	const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
	if (name) patch.name = name;
	if (role) {
		if (!VALID_ROLES.includes(role)) {
			return new Response(JSON.stringify({ error: "Invalid role" }), { status: 400 });
		}
		if (roleOutranks(role, callerRole)) {
			return new Response(
				JSON.stringify({ error: "Cannot grant a role above your own" }),
				{ status: 403 },
			);
		}
		patch.role = role;
	}
	if (shopIds !== undefined) {
		if (shopIds) {
			for (const shopId of shopIds) {
				const shopSnap = await db.doc(`shops/${shopId}`).get();
				if (shopSnap.data()?.orgId !== orgId) {
					return new Response(
						JSON.stringify({ error: `Shop ${shopId} does not belong to this org` }),
						{ status: 400 },
					);
				}
			}
		}
		patch.shopIds = shopIds;
	}

	await groupRef.update(patch);

	if (role || shopIds !== undefined) {
		const membersSnap = await groupRef.collection("groupMembers").get();
		await Promise.all(membersSnap.docs.map((m) => recomputeOrgMember(orgId, m.id)));
	}

	return json({ ok: true });
};

// DELETE /api/orgs/[orgId]/groups/[groupId] — delete a group and its
// membership docs, then recompute every affected member's grant.
export const DELETE: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const groupId = params.groupId!;
	const callerRole = await getOrgRole(orgId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const db = getAdminDb();
	const groupRef = db.doc(`orgs/${orgId}/groups/${groupId}`);
	const membersSnap = await groupRef.collection("groupMembers").get();
	const memberUids = membersSnap.docs.map((m) => m.id);

	const batch = db.batch();
	for (const m of membersSnap.docs) batch.delete(m.ref);
	batch.delete(groupRef);
	await batch.commit();

	await Promise.all(memberUids.map((memberUid) => recomputeOrgMember(orgId, memberUid)));

	return json({ ok: true });
};
