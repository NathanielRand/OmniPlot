import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

// Pinned to the version the installed `stripe` package's types require —
// bumping the npm package pins a new default too, so this needs to move in
// lockstep with it rather than sit on a stale literal the SDK no longer
// recognizes.
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2026-04-22.dahlia',
});

// Pass as the second argument to every Stripe API call to scope it to the connected account.
export const connectedAccount: Stripe.RequestOptions = {
	stripeAccount: STRIPE_CONNECTED_ACCOUNT_ID,
};
