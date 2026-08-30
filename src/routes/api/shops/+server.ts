import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/server/firebase-admin";
import { requireUid } from "$lib/server/shop-auth";
import { FieldValue } from "firebase-admin/firestore";
import type { ShopPlan } from "$lib/types";

// POST /api/shops — create a shop + its owning org, atomically.
export const POST: RequestHandler = async ({ request }) => {
	const uid = await requireUid(request);
	if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

	const { name, plan } = (await request.json()) as { name?: string; plan?: ShopPlan };
	if (!name || typeof name !== "string") {
		return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
	}
	const shopPlan: ShopPlan = plan === "team" || plan === "studio" ? plan : "starter";
	const seats = shopPlan === "starter" ? 3 : shopPlan === "team" ? 10 : 25;

	const db = getAdminDb();
	const orgRef = db.collection("orgs").doc();
	const shopRef = db.collection("shops").doc();
	const now = FieldValue.serverTimestamp();

	const batch = db.batch();

	batch.set(orgRef, {
		name,
		ownerId: uid,
		plan: shopPlan,
		seats,
		stripeCustomerId: null,
		stripePriceId: null,
		subscriptionStatus: null,
		currentPeriodEnd: null,
		createdAt: now,
		updatedAt: now,
	});

	batch.set(shopRef, {
		orgId: orgRef.id,
		name,
		plan: shopPlan,
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

	batch.set(orgRef.collection("members").doc(uid), {
		uid,
		orgId: orgRef.id,
		role: "owner",
		shopIds: [shopRef.id],
		directRole: "owner",
		directShopIds: [shopRef.id],
		joinedAt: now,
	});

	batch.update(db.doc(`users/${uid}`), {
		shopId: shopRef.id,
		shopRole: "owner",
		updatedAt: now,
	});

	await batch.commit();

	const nowIso = new Date().toISOString();
	return json({
		id: shopRef.id,
		orgId: orgRef.id,
		name,
		plan: shopPlan,
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
