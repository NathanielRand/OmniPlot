import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlanSettings } from '$lib/server/plans';

// Public, read-only mirror of the admin-configured plan allowances and
// pricing (settings/platform.plans / .shopPlans) — the client needs these
// to enforce cut limits, gate features (e.g. custom uploads), and display
// live prices and limits in copy without an admin token. Stripe price IDs
// are not secret (already client-visible via the old VITE_STRIPE_* vars) so
// they're safe to include here too. Edited from /admin/products; defaults
// live in $lib/plans.
export const GET: RequestHandler = async () => {
	return json(await getPlanSettings());
};
