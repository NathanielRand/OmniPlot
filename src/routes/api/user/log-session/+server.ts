import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// ─── IP helpers ───────────────────────────────────────────────────────────────

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|localhost$|unknown$)/;

function getClientIP(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		request.headers.get('x-real-ip') ??
		'unknown'
	);
}

async function geolocate(ip: string) {
	if (PRIVATE_IP_RE.test(ip)) {
		return { city: 'Local network', region: '', country: '', countryCode: '' };
	}
	try {
		const res = await fetch(`https://ipwho.is/${ip}`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) throw new Error('geo failed');
		const d = await res.json();
		if (!d.success) throw new Error('geo unsuccessful');
		return {
			city:        d.city        ?? '',
			region:      d.region      ?? '',
			country:     d.country     ?? '',
			countryCode: d.country_code ?? '',
		};
	} catch {
		return { city: '', region: '', country: '', countryCode: '' };
	}
}

// ─── User-agent parsing ───────────────────────────────────────────────────────

function parseUserAgent(ua: string) {
	// Browser + version
	let browser = 'Unknown';
	let browserVersion = '';
	const edgM    = ua.match(/Edg\/(\d+)/);
	const oprM    = ua.match(/OPR\/(\d+)/);
	const chromeM = ua.match(/Chrome\/(\d+)/);
	const ffM     = ua.match(/Firefox\/(\d+)/);
	const safM    = ua.match(/Version\/(\d+)[^\s]*\s+Safari/);

	if      (edgM)    { browser = 'Edge';    browserVersion = edgM[1]; }
	else if (oprM)    { browser = 'Opera';   browserVersion = oprM[1]; }
	else if (chromeM) { browser = 'Chrome';  browserVersion = chromeM[1]; }
	else if (ffM)     { browser = 'Firefox'; browserVersion = ffM[1]; }
	else if (safM)    { browser = 'Safari';  browserVersion = safM[1]; }

	// OS + version
	let os = 'Unknown';
	let osVersion = '';
	const WIN_LABELS: Record<string, string> = {
		'10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7',
	};
	const winM = ua.match(/Windows NT ([\d.]+)/);
	const macM = ua.match(/Mac OS X ([\d_]+)/);
	const andM = ua.match(/Android ([\d.]+)/);
	const iosM = ua.match(/(?:iPhone|iPad) OS ([\d_]+)/);

	if      (winM) { os = 'Windows'; osVersion = WIN_LABELS[winM[1]] ?? winM[1]; }
	else if (andM) { os = 'Android'; osVersion = andM[1]; }
	else if (iosM) {
		os = ua.includes('iPad') ? 'iPadOS' : 'iOS';
		osVersion = iosM[1].replace(/_/g, '.');
	}
	else if (macM) { os = 'macOS'; osVersion = macM[1].replace(/_/g, '.'); }
	else if (/Linux/.test(ua)) { os = 'Linux'; }

	// Device category
	let device: 'mobile' | 'tablet' | 'desktop' = 'desktop';
	if (/iPhone|Android.*Mobile/.test(ua))        device = 'mobile';
	else if (/iPad|Android(?!.*Mobile)/.test(ua)) device = 'tablet';

	return { browser, browserVersion, os, osVersion, device };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	try {
		const uid = await verifyIdToken(request.headers.get('authorization'));
		if (!uid) return json({ error: 'Unauthorized' }, { status: 401 });

		const body = await request.json().catch(() => ({}));
		const sessionId = body.sessionId ?? '';

		const ua = request.headers.get('user-agent') ?? '';
		const ip = getClientIP(request);

		const [geo, ua_parsed] = await Promise.all([
			geolocate(ip),
			Promise.resolve(parseUserAgent(ua)),
		]);

		const db  = getAdminDb();
		const ref = db.collection(`users/${uid}/sessions`).doc();

		await ref.set({
			sessionId,
			ip,
			...geo,
			...ua_parsed,
			userAgent: ua,
			createdAt: FieldValue.serverTimestamp(),
		});

		// Keep only the 20 most recent sessions
		const all = await db
			.collection(`users/${uid}/sessions`)
			.orderBy('createdAt', 'desc')
			.offset(20)
			.limit(100)
			.get();
		if (!all.empty) {
			const batch = db.batch();
			all.docs.forEach(d => batch.delete(d.ref));
			await batch.commit();
		}

		return json({ id: ref.id });
	} catch (err) {
		console.error('[log-session]', err);
		return json({ error: 'Could not log session.' }, { status: 500 });
	}
};
