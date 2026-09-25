import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CRON_SECRET } from '$env/static/private';
import { sendAdminDigestEmail } from '$lib/server/email';
import { changeStatus, listOpenTicketsForSweep, recordReminder } from '$lib/server/support/store';
import { adminLink, notifyNudge, notifyStatusChange } from '$lib/server/support/notify';
import { needsAdminAction, needsUserAction, ticketRef } from '$lib/support/tickets';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Staff side: we promise "one business day", so 24h is overdue and 72h is
// badly overdue. Both go out as one digest, not an email per ticket.
const ADMIN_STAGES = [
	{ id: 'admin_72h', after: 72 * HOUR },
	{ id: 'admin_24h', after: 24 * HOUR },
];

// Customer side: one nudge, then resolve rather than leave it hanging open
// forever. Replying reopens it, so nothing is lost.
const NUDGE_AFTER = 3 * DAY;
const AUTO_RESOLVE_AFTER = 7 * DAY;

// Daily sweep (vercel.json cron). Each stage is recorded on the ticket and the
// set resets whenever the turn flips, so a later wait gets a fresh cycle.
export const GET: RequestHandler = async ({ request }) => {
	if (!CRON_SECRET) return json({ error: 'Cron secret not configured.' }, { status: 500 });
	if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const now = Date.now();
	const open = await listOpenTicketsForSweep();

	const digest: Parameters<typeof sendAdminDigestEmail>[0] = [];
	const digestStages: { id: string; stage: string }[] = [];
	let nudged = 0;
	let autoResolved = 0;

	for (const { ticket, remindersSent, accessKey } of open) {
		const waited = now - ticket.awaitingSince;

		if (needsAdminAction(ticket)) {
			const stage = ADMIN_STAGES.find((s) => waited >= s.after && !remindersSent.includes(s.id));
			// Already reminded at a higher stage — don't fall back to a lower one.
			if (stage && !(stage.id === 'admin_24h' && remindersSent.includes('admin_72h'))) {
				digest.push({
					ref: ticketRef(ticket.id),
					subject: ticket.subject,
					name: ticket.name || ticket.email,
					priority: ticket.priority,
					waitingHours: Math.round(waited / HOUR),
					link: adminLink(ticket),
				});
				digestStages.push({ id: ticket.id, stage: stage.id });
			}
			continue;
		}

		if (needsUserAction(ticket)) {
			try {
				if (waited >= AUTO_RESOLVE_AFTER) {
					const resolved = await changeStatus(ticket.id, 'resolved', { actor: 'system' });
					await notifyStatusChange(resolved, accessKey, true);
					autoResolved++;
				} else if (waited >= NUDGE_AFTER && !remindersSent.includes('user_3d')) {
					await notifyNudge(ticket, accessKey);
					await recordReminder(ticket.id, 'user_3d');
					nudged++;
				}
			} catch (err) {
				console.error(`[cron/support-sweep] customer step failed for ${ticket.id}:`, err);
			}
		}
	}

	if (digest.length > 0) {
		digest.sort((a, b) => b.waitingHours - a.waitingHours);
		try {
			await sendAdminDigestEmail(digest);
			// Only mark stages sent once the digest actually went out.
			await Promise.all(digestStages.map((d) => recordReminder(d.id, d.stage)));
		} catch (err) {
			console.error('[cron/support-sweep] digest failed:', err);
			return json({ ok: false, error: 'Digest email failed', nudged, autoResolved }, { status: 502 });
		}
	}

	return json({ ok: true, overdue: digest.length, nudged, autoResolved });
};
