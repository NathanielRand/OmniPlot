// ─────────────────────────────────────────────
// OmniPlot — TICKET ↔ ACCOUNT MATCHING
// ─────────────────────────────────────────────
// Finds the OmniPlot account behind a guest ticket when the email doesn't
// match — mostly SMS-login customers, whose accounts have a phone and no
// email. Results are suggestions for staff; nothing here links a ticket.

import { getAdminDb } from '$lib/server/firebase-admin';
import { extractPhones, phoneCandidates } from '$lib/support/phone';
import type { Ticket } from '$lib/support/tickets';

export interface AccountHit {
	uid: string;
	displayName: string;
	email: string;
	phone: string | null;
	tier: string;
}

export interface PhoneMatch extends AccountHit {
	/** What the requester typed that matched, and where it came from. */
	typed: string;
	source: 'form' | 'message';
}

const IN_LIMIT = 30;

function hit(doc: FirebaseFirestore.DocumentSnapshot): AccountHit {
	const d = doc.data() ?? {};
	return {
		uid: doc.id,
		displayName: d.displayName ?? '',
		email: d.email ?? '',
		phone: d.phone ?? null,
		tier: d.tier ?? 'free',
	};
}

async function usersByPhone(candidates: string[]): Promise<AccountHit[]> {
	const users = getAdminDb().collection('users');
	const chunks: string[][] = [];
	for (let i = 0; i < candidates.length; i += IN_LIMIT) chunks.push(candidates.slice(i, i + IN_LIMIT));
	const snaps = await Promise.all(chunks.map((c) => users.where('phone', 'in', c).limit(10).get()));
	return snaps.flatMap((s) => s.docs.map(hit));
}

/** Phone numbers the requester gave us: the form field first, then any
 *  typed into the subject, original message or their replies. */
export function ticketPhones(t: Pick<Ticket, 'phone' | 'subject' | 'message' | 'messages'>): { typed: string; source: 'form' | 'message' }[] {
	const out: { typed: string; source: 'form' | 'message' }[] = [];
	if (t.phone) out.push({ typed: t.phone, source: 'form' });
	const text = [t.subject, t.message, ...t.messages.filter((m) => m.from === 'user').map((m) => m.body)].join('\n');
	for (const typed of extractPhones(text)) out.push({ typed, source: 'message' });
	return out.slice(0, 5);
}

/** Accounts whose phone matches a number on the ticket, best source first. */
export async function findPhoneMatches(t: Ticket): Promise<PhoneMatch[]> {
	const phones = ticketPhones(t);
	if (!phones.length) return [];
	const byCandidate = new Map<string, (typeof phones)[number]>();
	for (const p of phones) for (const c of phoneCandidates(p.typed)) if (!byCandidate.has(c)) byCandidate.set(c, p);
	if (!byCandidate.size) return [];

	const hits = await usersByPhone([...byCandidate.keys()]);
	const seen = new Set<string>();
	const matches: PhoneMatch[] = [];
	for (const h of hits) {
		if (seen.has(h.uid)) continue;
		seen.add(h.uid);
		const from = byCandidate.get(h.phone ?? '')!;
		matches.push({ ...h, typed: from.typed, source: from.source });
	}
	return matches.sort((a, b) => (a.source === b.source ? 0 : a.source === 'form' ? -1 : 1));
}

/** Staff search for "attach to account…": email (exact or prefix), phone
 *  (fuzzy), uid, or display-name prefix. */
export async function searchAccounts(q: string): Promise<AccountHit[]> {
	const query = q.trim();
	if (query.length < 2) return [];
	const users = getAdminDb().collection('users');
	const results = new Map<string, AccountHit>();
	const add = (docs: FirebaseFirestore.DocumentSnapshot[]) => { for (const d of docs) if (d.exists) results.set(d.id, hit(d)); };

	const lookups: Promise<void>[] = [];
	const phones = phoneCandidates(query);
	if (phones.length && /^[\d\s()+.-]+$/.test(query)) lookups.push(usersByPhone(phones).then((h) => { for (const x of h) results.set(x.uid, x); }));

	if (/^[A-Za-z0-9]{20,40}$/.test(query)) lookups.push(users.doc(query).get().then((d) => add([d])));

	const lower = query.toLowerCase();
	lookups.push(users.where('email', '>=', lower).where('email', '<', `${lower}`).limit(10).get().then((s) => add(s.docs)));

	// displayName is stored as typed — try it as given and capitalized.
	const cap = query.charAt(0).toUpperCase() + query.slice(1);
	for (const name of new Set([query, cap])) {
		lookups.push(users.where('displayName', '>=', name).where('displayName', '<', `${name}`).limit(10).get().then((s) => add(s.docs)));
	}

	await Promise.all(lookups);
	return [...results.values()].slice(0, 15);
}

export async function getAccount(uid: string): Promise<AccountHit | null> {
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.exists ? hit(snap) : null;
}
