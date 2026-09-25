import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireSupportAdmin } from '$lib/server/support/admin-auth';
import { listAllTickets } from '$lib/server/support/store';
import { hasAdminUnread, needsAdminAction } from '$lib/support/tickets';

// GET — the support inbox. `?summary=1` returns just the sidebar badge
// counts, which the admin layout polls.
export const GET: RequestHandler = async ({ request, url }) => {
	const admin = await requireSupportAdmin(request);
	if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

	try {
		const tickets = await listAllTickets();
		const counts = {
			needsReply: tickets.filter(needsAdminAction).length,
			new:        tickets.filter((t) => t.status === 'new').length,
			urgent:     tickets.filter((t) => needsAdminAction(t) && t.priority === 'urgent').length,
		};
		if (url.searchParams.get('summary')) return json({ counts });

		// The inbox only needs a preview, not every thread.
		const rows = tickets.map(({ messages, ...t }) => {
			const last = [...messages].reverse().find((m) => !m.internal);
			return {
				...t,
				messageCount: messages.filter((m) => !m.internal).length,
				preview: (last?.body ?? t.message).slice(0, 160),
				lastFrom: last?.from ?? 'user',
				unread: hasAdminUnread(t),
			};
		});
		return json({ tickets: rows, counts });
	} catch (err) {
		console.error('[admin/support GET]', err);
		return json({ error: 'Could not load tickets.' }, { status: 500 });
	}
};
