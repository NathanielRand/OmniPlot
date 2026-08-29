import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, roleAtLeast, roleOutranks } from "$lib/server/shop-auth";
import { getOrgRole } from "$lib/server/org-auth";
import { recomputeOrgMember } from "$lib/server/recompute-org-member";
import { FieldValue } from "firebase-admin/firestore";

// POST /api/orgs/[orgId]/groups/[groupId]/members/[uid] — add a member to
// a group. Caller must be owner/manager, and can't add someone to a group
// whose grant outranks the caller's own effective role.
export const POST: RequestHandler = async ({ request, params }) => {
	const callerUid = await requireUid(request);
	if (!callerUid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const groupId = params.groupId!;
	const targetUid = params.uid!;

	const callerRole = await getOrgRole(orgId, callerUid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const db = getAdminDb();
	const groupSnap = await db.doc(`orgs/${orgId}/groups/${groupId}`).get();
	if (!groupSnap.exists) {
		return new Response(JSON.stringify({ error: "Group not found" }), { status: 404 });
	}
	if (roleOutranks(groupSnap.data()!.role, callerRole)) {
		return new Response(
			JSON.stringify({ error: "Cannot add a member to a group above your own role" }),
			{ status: 403 },
		);
	}

	await db.doc(`orgs/${orgId}/groups/${groupId}/groupMembers/${targetUid}`).set({
		uid: targetUid,
		orgId,
		groupId,
		joinedAt: FieldValue.serverTimestamp(),
	});

	await recomputeOrgMember(orgId, targetUid);

	return json({ ok: true });
};

// DELETE /api/orgs/[orgId]/groups/[groupId]/members/[uid] — remove a
// member from a group (or self-leave), then recompute their grant.
export const DELETE: RequestHandler = async ({ request, params }) => {
	const callerUid = await requireUid(request);
	if (!callerUid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const groupId = params.groupId!;
	const targetUid = params.uid!;
	const isSelf = callerUid === targetUid;

	if (!isSelf) {
		const callerRole = await getOrgRole(orgId, callerUid);
		if (!callerRole || !roleAtLeast(callerRole, "manager")) {
			return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
		}
	}

	const db = getAdminDb();
	await db.doc(`orgs/${orgId}/groups/${groupId}/groupMembers/${targetUid}`).delete();
	await recomputeOrgMember(orgId, targetUid);

	return json({ ok: true });
};
