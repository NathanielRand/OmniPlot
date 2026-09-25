import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { getAdminDb } from '$lib/server/firebase-admin';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import { applyCredit, getCreditSummary, reverseCredit, CreditError, CREDIT_REASON_LABEL, type CreditReason } from '$lib/server/credits';
import { sendAccountCreditEmail } from '$lib/server/email';

const REASONS = Object.keys(CREDIT_REASON_LABEL) as CreditReason[];

function fail(err: unknown, label: string) {
	if (err instanceof CreditError) return json({ error: err.message }, { status: err.status });
	if (err instanceof Stripe.errors.StripeError) return json({ error: err.message }, { status: err.statusCode ?? 500 });
	console.error(`[admin/billing/credits ${label}]`, err);
	return json({ error: 'Unexpected server error.' }, { status: 500 });
}

// GET ?uid= — their live subscription, free months waiting on it, and history.
export const GET: RequestHandler = async ({ request, url }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	const uid = url.searchParams.get('uid');
	if (!uid) return json({ error: 'uid required' }, { status: 400 });
	try {
		return json(await getCreditSummary(uid));
	} catch (err) {
		return fail(err, 'GET');
	}
};

// POST { uid, months? | amountCents?, reason, note?, ticketId?, notify? }
//   or { action: 'reverse', creditId }
export const POST: RequestHandler = async ({ request }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
	const body = await request.json().catch(() => ({}));

	try {
		if (body.action === 'reverse') {
			if (!body.creditId) return json({ error: 'creditId required' }, { status: 400 });
			const credit = await reverseCredit(String(body.creditId), admin);
			return json({ credit, summary: await getCreditSummary(credit.uid) });
		}

		if (!body.uid) return json({ error: 'uid required' }, { status: 400 });
		const credit = await applyCredit({
			uid: String(body.uid),
			months: body.months ? Number(body.months) : undefined,
			amountCents: body.amountCents ? Number(body.amountCents) : undefined,
			reason: REASONS.includes(body.reason) ? body.reason : 'goodwill',
			note: body.note ? String(body.note) : '',
			ticketId: body.ticketId ? String(body.ticketId) : null,
			admin,
		});

		// Free months granted from a ticket are announced in the reply itself;
		// ones granted from the Users panel get their own email.
		if (body.notify) {
			const user = (await getAdminDb().doc(`users/${credit.uid}`).get()).data() ?? {};
			if (user.email) {
				await sendAccountCreditEmail(user.email, user.displayName ?? '', credit.label, credit.months)
					.catch((e) => console.error('[admin/billing/credits] notify failed:', e));
			}
		}

		return json({ credit, summary: await getCreditSummary(credit.uid) });
	} catch (err) {
		return fail(err, 'POST');
	}
};
