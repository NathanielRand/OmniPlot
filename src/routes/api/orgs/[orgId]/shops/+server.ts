import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid, roleAtLeast } from "$lib/server/shop-auth";
import { getOrgRole } from "$lib/server/org-auth";
import { recomputeOrgMember } from "$lib/server/recompute-org-member";
import { FieldValue } from "firebase-admin/firestore";

// GET /api/orgs/[orgId]/shops — list every shop under this org, for the org
// switcher. shops/{shopId} itself is deny-all client reads (server-only),
// so this is the only way a client learns which shops belong to an org it
// isn't already an active member of.
export const GET: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const callerRole = await getOrgRole(orgId, uid);
	if (!callerRole) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}

	const db = getAdminDb();
	const shopsSnap = await db.collection("shops").where("orgId", "==", orgId).get();
	const shops = shopsSnap.docs.map((d) => {
		const s = d.data();
		return {
			id: d.id,
			orgId: s.orgId,
			name: s.name,
			plan: s.plan,
			seats: s.seats,
			ownerId: s.ownerId,
			createdAt: s.createdAt?.toDate?.()?.toISOString() ?? null,
			updatedAt: s.updatedAt?.toDate?.()?.toISOString() ?? null,
		};
	});

	return json({ shops });
};

// POST /api/orgs/[orgId]/shops — add a shop under an EXISTING org. Distinct
// from POST /api/shops, which always mints a new org alongside the shop.
// Caller must be owner/manager on the org; billing (plan/seats) already
// lives on the org, so the new shop just mirrors it — no separate checkout.
export const POST: RequestHandler = async ({ request, params }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const orgId = params.orgId!;
	const callerRole = await getOrgRole(orgId, uid);
	if (!callerRole || !roleAtLeast(callerRole, "manager")) {
		return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
	}
	// A manager creating a shop under their own org and becoming ITS owner
	// is deliberate, not an escalation gap — Phase 2's caps exist to stop
	// granting a role you don't already effectively hold, and org-manager
	// already implies manager-or-above on every shop in the org.

	const { name } = (await request.json()) as { name?: string };
	if (!name || typeof name !== "string") {
		return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
	}

	const db = getAdminDb();
	const orgSnap = await db.doc(`orgs/${orgId}`).get();
	if (!orgSnap.exists) {
		return new Response(JSON.stringify({ error: "Org not found" }), { status: 404 });
	}
	const org = orgSnap.data()!;

	const shopRef = db.collection("shops").doc();
	const now = FieldValue.serverTimestamp();
	const plan = org.plan ?? "starter";
	const seats = org.seats ?? 3;

	const batch = db.batch();
	batch.set(shopRef, {
		orgId,
		name,
		// Legacy fallback fields — billing itself lives on the org. ownerId
		// here means "who created this shop" (consistent with a manager
		// self-elevating to shop-owner on creation, see above) — distinct
		// from Organization.ownerId, which means "who created the org" and
		// is what attributeUid's org-lookup fallback actually reads.
		plan,
		seats,
		ownerId: uid,
		stripeCustomerId: null,
		stripePriceId: null,
		subscriptionStatus: null,
		currentPeriodEnd: null,
		createdAt: now,
		updatedAt: now,
	});
	batch.set(shopRef.collection("members").doc(uid), {
		uid,
		shopId: shopRef.id,
		role: "owner",
		joinedAt: now,
	});
	await batch.commit();

	await recomputeOrgMember(orgId, uid);

	const nowIso = new Date().toISOString();
	return json({
		id: shopRef.id,
		orgId,
		name,
		plan,
		seats,
		ownerId: uid,
		stripeCustomerId: null,
		stripePriceId: null,
		subscriptionStatus: null,
		currentPeriodEnd: null,
		createdAt: nowIso,
		updatedAt: nowIso,
	});
};
