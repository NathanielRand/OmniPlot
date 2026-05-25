import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { sendWelcomeEmail } from '$lib/server/email';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const snap = await getAdminDb().doc(`users/${uid}`).get();
		const userData = snap.data() ?? {};

		// Idempotent — only send once
		if (userData.welcomeEmailSent === true) {
			return json({ ok: true });
		}

		try {
			await sendWelcomeEmail(userData.email ?? '', userData.displayName ?? '');
		} catch (emailErr) {
			// Non-fatal — don't fail the endpoint if Resend fails
			console.error('[welcome] Email send failed:', emailErr);
		}

		await getAdminDb().doc(`users/${uid}`).update({ welcomeEmailSent: true });

		return json({ ok: true });
	} catch (err) {
		console.error('[welcome]', err);
		return json({ error: 'Could not send welcome email.' }, { status: 500 });
	}
};
