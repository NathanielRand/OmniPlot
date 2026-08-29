import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { stripe, connectedAccount } from '$lib/server/stripe';
import { getAdminDb, getAdminAuth, verifyIdToken } from '$lib/server/firebase-admin';

// Deletes every batch of docs matching a query, chunked to Firestore's
// 500-write batch limit.
async function deleteQuery(query: FirebaseFirestore.Query): Promise<void> {
	const snap = await query.get();
	const db = getAdminDb();
	for (let i = 0; i < snap.docs.length; i += 500) {
		const batch = db.batch();
		for (const doc of snap.docs.slice(i, i + 500)) batch.delete(doc.ref);
		await batch.commit();
	}
}

async function cancelStripeSubscription(customerId: string | undefined): Promise<void> {
	if (!customerId) return;
	// No status filter — `subscriptions.list` already excludes fully canceled
	// ones, and a `trialing`/`past_due` sub still needs to be stopped here too
	// or it keeps invoicing a customer whose account no longer exists.
	const subs = await stripe.subscriptions.list({ customer: customerId, limit: 10 }, connectedAccount);
	for (const sub of subs.data) {
		await stripe.subscriptions.cancel(sub.id, {}, connectedAccount).catch(() => {});
	}
}

// POST /api/user/delete-account — permanently deletes the caller's own
// account: their individual Stripe subscription is canceled immediately,
// their owned Firestore data is removed, and their Firebase Auth user is
// deleted last (so a mid-flow failure leaves them able to sign in and retry).
//
// The `transactions` revenue ledger is never touched here — it's a financial
// record, not user data, and rows already carry the uid as a plain field.
export const POST: RequestHandler = async ({ request }) => {
	const db = getAdminDb();
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const userSnap = await db.doc(`users/${uid}`).get();
		const userData = userSnap.data() ?? {};

		// Shop owners must resolve their shop first — there's no ownership
		// transfer mechanism, so we refuse rather than orphan the shop's
		// billing and remaining members.
		if (userData.shopRole === 'owner' && userData.shopId) {
			const members = await db.collection(`shops/${userData.shopId}/members`).get();
			const otherMembers = members.docs.filter((d) => d.id !== uid);
			if (otherMembers.length > 0) {
				return json({
					error: 'You own a shop with other members. Transfer ownership or remove all other members before deleting your account.',
				}, { status: 409 });
			}
			// Sole member — cancel the shop's subscription and remove the shop,
			// along with any invites still pointing at it.
			const shopSnap = await db.doc(`shops/${userData.shopId}`).get();
			await cancelStripeSubscription(shopSnap.data()?.stripeCustomerId);
			await deleteQuery(db.collection('shopInvites').where('shopId', '==', userData.shopId));
			await db.doc(`shops/${userData.shopId}/members/${uid}`).delete();
			await db.doc(`shops/${userData.shopId}`).delete();
		} else if (userData.shopId) {
			// Non-owner member — just leave the shop.
			await db.doc(`shops/${userData.shopId}/members/${uid}`).delete().catch(() => {});
		}

		// Cancel the user's own individual subscription (if any).
		await cancelStripeSubscription(userData.subscription?.stripeCustomerId);

		// Remove owned Firestore data.
		await Promise.all([
			deleteQuery(db.collection('jobs').where('userId', '==', uid)),
			deleteQuery(db.collection('userPatterns').where('ownerId', '==', uid)),
			deleteQuery(db.collection('patternAdjustments').where('requestedBy', '==', uid)),
			deleteQuery(db.collection('plotters').where('userId', '==', uid)),
			deleteQuery(db.collection(`users/${uid}/sessions`)),
		]);

		await db.doc(`users/${uid}`).delete();

		// Delete the Auth user last so a failure above still leaves them able
		// to sign in and retry. Let a failure here throw — swallowing it would
		// leave a zombie: no Firestore data, but Auth still lets them sign in,
		// which just re-creates a fresh (unpaid, empty) profile on next login.
		await getAdminAuth().deleteUser(uid);

		return json({ ok: true });

	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			return json({ error: err.message }, { status: err.statusCode ?? 500 });
		}
		console.error('[delete-account]', err);
		return json({ error: 'Could not delete account.' }, { status: 500 });
	}
};
