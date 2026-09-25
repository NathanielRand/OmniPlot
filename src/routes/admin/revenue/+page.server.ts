import type { PageServerLoad } from './$types';
import { STRIPE_CONNECTED_ACCOUNT_ID } from '$env/static/private';

export const load: PageServerLoad = () => ({
	stripeConnectedAccountId: STRIPE_CONNECTED_ACCOUNT_ID,
});
