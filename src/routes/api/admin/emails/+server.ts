import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import {
	sendWelcomeEmail,
	sendUpgradeEmail,
	sendReceiptEmail,
	sendCancellationEmail,
	sendRefundEmail,
	sendMonthlyReportEmail,
} from '$lib/server/email';

type EmailType = 'welcome' | 'upgrade' | 'receipt' | 'cancellation' | 'refund' | 'monthly_report';

async function assertAdmin(request: Request): Promise<string | null> {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return null;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin' ? uid : null;
}

// POST — send a test email
export const POST: RequestHandler = async ({ request }) => {
	const adminUid = await assertAdmin(request);
	if (!adminUid) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { type, to }: { type: EmailType; to: string } = body;

	if (!type || !to) return json({ error: 'type and to are required' }, { status: 400 });

	const now        = new Date();
	const periodEnd  = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
	const accessEnd  = new Date(now.getFullYear(), now.getMonth() + 1, 15);

	try {
		switch (type) {
			case 'welcome':
				await sendWelcomeEmail(to, 'Alex Johnson');
				break;

			case 'upgrade':
				await sendUpgradeEmail(to, 'Alex Johnson', 'Pro', 79, 'usd', periodEnd);
				break;

			case 'receipt':
				await sendReceiptEmail(
					to,
					'Alex Johnson',
					79,
					'usd',
					'Pro — Monthly',
					null,
					periodEnd,
				);
				break;

			case 'cancellation':
				await sendCancellationEmail(to, 'Alex Johnson', 'Pro — Monthly', accessEnd);
				break;

			case 'refund':
				await sendRefundEmail(to, 'Alex Johnson', 79, 'usd');
				break;

			case 'monthly_report':
				await sendMonthlyReportEmail(
					to,
					'Alex Johnson',
					now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
					42,
					17,
					'Pro',
				);
				break;

			default:
				return json({ error: 'Unknown email type' }, { status: 400 });
		}

		return json({ ok: true });
	} catch (err) {
		console.error('[admin/emails] test send failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Send failed' }, { status: 500 });
	}
};
