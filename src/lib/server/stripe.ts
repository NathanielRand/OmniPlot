import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

// Pinned to the version the installed `stripe` package's types require —
// bumping the npm package pins a new default too, so this needs to move in
// lockstep with it rather than sit on a stale literal the SDK no longer
// recognizes.
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-04-22.dahlia',
});

// A missing/blank connected account ID doesn't error — Stripe silently runs
// every call against the PLATFORM account instead. That's exactly how
// Sep 2026's Lite checkouts charged customers on the wrong account and never
// granted the tier. Refuse to run billing at all rather than misroute money.
const CONNECTED_ID = (STRIPE_CONNECTED_ACCOUNT_ID ?? '').trim();
if (!/^acct_[A-Za-z0-9]+$/.test(CONNECTED_ID)) {
	console.error('[stripe] STRIPE_CONNECTED_ACCOUNT_ID is missing or malformed — billing calls will be refused.');
}

// Pass as the second argument to every Stripe API call to scope it to the connected account.
// The getter throws (inside each route's try/catch → 500) instead of letting
// a request fall through to the platform account.
export const connectedAccount: Stripe.RequestOptions = {
	get stripeAccount(): string {
		if (!/^acct_[A-Za-z0-9]+$/.test(CONNECTED_ID)) {
			throw new Error('Billing misconfigured: STRIPE_CONNECTED_ACCOUNT_ID is not set.');
		}
		return CONNECTED_ID;
	},
};
