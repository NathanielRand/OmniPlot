// ─────────────────────────────────────────────
// OmniPlot — FUZZY PHONE MATCHING (support)
// ─────────────────────────────────────────────
// Accounts store the E.164 number Firebase phone auth gave them
// ("+15551234567"). Customers type numbers every which way — "(555) 123-4567",
// "07911 123456", "0052 1 55 1234 5678" — so instead of fuzzy-scanning every
// user, we expand what they typed into the handful of E.164 strings it could
// be and look those up exactly. A match is only ever a suggestion: staff
// confirm it before a ticket is linked.

/** Country dial codes we sell into (mirrors PhoneInput's list). */
const DIAL_CODES = ['1', '44', '61', '52', '49', '33', '55', '91', '81', '82', '31', '34', '39'];

const MIN_NATIONAL = 7;
const MAX_E164 = 15;

/** Every E.164 number `raw` could plausibly be, most likely first. Empty when
 *  it doesn't look like a phone number at all. */
export function phoneCandidates(raw: string): string[] {
	const s = raw.trim();
	let d = s.replace(/\D/g, '');
	let intl = s.startsWith('+');
	// International dialing prefixes: 00 (most of the world), 011 (NANP).
	if (!intl && d.startsWith('00')) { d = d.slice(2); intl = true; }
	else if (!intl && d.startsWith('011') && d.length > 13) { d = d.slice(3); intl = true; }
	if (d.length < MIN_NATIONAL || d.length > MAX_E164) return [];

	const out: string[] = [];
	const add = (e164: string) => {
		const digits = e164.slice(1);
		if (digits.length >= 8 && digits.length <= MAX_E164 && !out.includes(e164)) out.push(e164);
	};

	if (intl) {
		add(`+${d}`);
	} else {
		// A national number: strip a trunk "0" (UK "07911…") and try each
		// country — NANP first since most customers are US-based.
		const national = d.startsWith('0') ? d.slice(1) : d;
		if (national.length === 10) add(`+1${national}`);
		if (d.length === 11 && d.startsWith('1')) add(`+${d}`);
		for (const dial of DIAL_CODES) add(`+${dial}${national}`);
		// …or they typed the country code without the "+".
		add(`+${d}`);
	}

	// Mexico dropped the mobile "1" after +52 in 2019; accounts exist both ways.
	for (const e of [...out]) {
		if (/^\+521\d{10}$/.test(e)) add(`+52${e.slice(4)}`);
		else if (/^\+52\d{10}$/.test(e)) add(`+521${e.slice(3)}`);
	}
	return out;
}

/** Phone-looking runs in free text ("my number is 555-123-4567"). Ten digits
 *  minimum (or a leading "+") so dates, order numbers and ticket refs don't
 *  count. */
export function extractPhones(text: string, max = 5): string[] {
	const found: string[] = [];
	for (const m of text.matchAll(/(?:\+|\(|\b)\d[\d\s().-]{5,20}\d\b/g)) {
		const raw = m[0].trim();
		const digits = raw.replace(/\D/g, '').length;
		if (digits > MAX_E164 || digits < (raw.startsWith('+') ? 8 : 10)) continue;
		if (/^\d{4}-\d{2}-\d{2}/.test(raw)) continue;
		if (!found.includes(raw)) found.push(raw);
		if (found.length >= max) break;
	}
	return found;
}

/** True when `stored` (an account's E.164 number) is one of the numbers `typed` could be. */
export function phoneMatches(typed: string, stored: string | null | undefined): boolean {
	return !!stored && phoneCandidates(typed).includes(stored);
}
