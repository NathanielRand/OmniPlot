import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CRON_SECRET } from '$env/static/private';
import { checkBillingHealth } from '$lib/server/billing-health';
import { logServerError } from '$lib/server/log-error';

// Daily billing self-test (vercel.json cron). Each failing check is written
// to errorLogs — which alerts support@ — so a misrouted or silently-failing
// billing setup surfaces within a day instead of weeks.
export const GET: RequestHandler = async ({ request }) => {
	if (!CRON_SECRET) return json({ error: 'Cron secret not configured.' }, { status: 500 });
	if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const checks = await checkBillingHealth();
	const failed = checks.filter((c) => !c.ok);
	for (const c of failed) {
		await logServerError(new Error(`Billing health: ${c.name} — ${c.detail}`), {
			source: 'api',
			route:  `cron:billing-health:${c.name}`,
			severity: 'error',
		});
	}
	return json({ ok: failed.length === 0, failed: failed.length, checks });
};
