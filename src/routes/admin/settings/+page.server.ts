import type { PageServerLoad } from './$types';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';
import { stripe } from '$lib/server/stripe';

export const load: PageServerLoad = async () => {
	let stripeAccountName: string | null = null;
	let stripeAccountEmail: string | null = null;

	try {
		const account = await stripe.accounts.retrieve(STRIPE_CONNECTED_ACCOUNT_ID);
		stripeAccountName  = account.business_profile?.name
			?? account.settings?.dashboard?.display_name
			?? null;
		stripeAccountEmail = account.email ?? null;
	} catch {
		// Non-fatal — page still loads, Stripe section shows degraded state
	}

	return {
		stripeConnectedAccountId: STRIPE_CONNECTED_ACCOUNT_ID,
		stripeAccountName,
		stripeAccountEmail,
	};
};
