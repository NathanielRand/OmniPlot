import Stripe from 'stripe';
import { STRIPE_SECRET_KEY, STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
	apiVersion: '2025-04-30.basil',
});

// Pass as the second argument to every Stripe API call to scope it to the connected account.
export const connectedAccount: Stripe.RequestOptions = {
	stripeAccount: STRIPE_CONNECTED_ACCOUNT_ID,
};
