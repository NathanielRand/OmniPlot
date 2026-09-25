// ─────────────────────────────────────────────
// OmniPlot — SUPPORT BADGE COUNTS
// ─────────────────────────────────────────────
// Nav badge numbers for the app (tickets needing the user) and admin
// (tickets needing staff). AppShell / the admin layout poll these; ticket
// pages call refresh() right after an action so the badge clears instantly.

import { auth } from '$lib/firebase/client';

const POLL_MS = 90_000;

async function authedGet(url: string): Promise<Response | null> {
	const token = await auth.currentUser?.getIdToken().catch(() => null);
	if (!token) return null;
	return fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
}

function createSupportStore() {
	let userAttention = $state(0);
	let admin = $state({ needsReply: 0, new: 0, urgent: 0 });

	async function refreshUser() {
		const res = await authedGet('/api/support/tickets?summary=1');
		if (res?.ok) userAttention = (await res.json()).attention ?? 0;
	}

	async function refreshAdmin() {
		const res = await authedGet('/api/admin/support?summary=1');
		if (res?.ok) admin = (await res.json()).counts ?? admin;
	}

	/** Polls while the tab is visible and on refocus. Returns a cleanup fn
	 *  for $effect. */
	function watch(which: 'user' | 'admin') {
		const refresh = which === 'user' ? refreshUser : refreshAdmin;
		refresh();
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') refresh();
		}, POLL_MS);
		const onFocus = () => refresh();
		window.addEventListener('focus', onFocus);
		return () => {
			clearInterval(timer);
			window.removeEventListener('focus', onFocus);
		};
	}

	return {
		get userAttention() { return userAttention; },
		get admin() { return admin; },
		refreshUser,
		refreshAdmin,
		watch,
	};
}

export const supportStore = createSupportStore();
