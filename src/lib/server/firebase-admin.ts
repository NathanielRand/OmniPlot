import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FIREBASE_SERVICE_ACCOUNT_JSON } from '$env/static/private';

// Lazily initialize on first access so the module doesn't crash during SSR
// prerendering when FIREBASE_SERVICE_ACCOUNT_JSON is a placeholder.
function getAdminApp() {
	if (getApps().length) return getApp();
	const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
	return initializeApp({ credential: cert(sa) });
}

export function getAdminDb() {
	return getFirestore(getAdminApp());
}

export function getAdminAuth() {
	return getAuth(getAdminApp());
}

export async function verifyIdToken(authHeader: string | null): Promise<string | null> {
	if (!authHeader?.startsWith('Bearer ')) return null;
	try {
		const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
		return decoded.uid;
	} catch {
		return null;
	}
}
