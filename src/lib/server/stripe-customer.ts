import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb } from '$lib/server/firebase-admin';

/**
 * The user's Stripe customer ID on the CONNECTED account, or null.
 *
 * From ~Sep 4 to Sep 24 2026 production ran without a valid connected
 * account ID, so customers created in that window live on the platform
 * account and every connected-account call against them fails with
 * "No such customer". A stored ID that doesn't resolve on the connected
 * account is moved aside to `subscription.legacyStripeCustomerId` (kept for
 * the migration audit trail) and, when `create` is set, replaced with a
 * fresh connected-account customer.
 */
export async function getConnectedCustomerId(
	uid: string,
	{ create = false }: { create?: boolean } = {},
): Promise<string | null> {
	const db   = getAdminDb();
	const ref  = db.doc(`users/${uid}`);
	const data = (await ref.get()).data() ?? {};
	const stored: string = data.subscription?.stripeCustomerId ?? '';

	if (stored) {
		const valid = await stripe.customers.retrieve(stored, {}, connectedAccount)
			.then((c) => !('deleted' in c && c.deleted))
			.catch(() => false);
		if (valid) return stored;
		await ref.set({ subscription: { stripeCustomerId: null, legacyStripeCustomerId: stored } }, { merge: true });
	}

	if (!create) return null;

	const customer = await stripe.customers.create({
		email:    data.billingEmail ?? data.email ?? undefined,
		name:     data.displayName ?? undefined,
		metadata: { uid },
	}, connectedAccount);
	await ref.set({ subscription: { stripeCustomerId: customer.id } }, { merge: true });
	return customer.id;
}
