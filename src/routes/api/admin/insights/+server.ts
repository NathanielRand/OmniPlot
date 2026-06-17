import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

async function assertAdmin(authHeader: string | null): Promise<string | null> {
	const uid = await verifyIdToken(authHeader);
	if (!uid) return null;
	const snap = await getAdminDb().doc(`users/${uid}`).get();
	return snap.data()?.tier === 'admin' ? uid : null;
}

function serializePost(id: string, d: FirebaseFirestore.DocumentData) {
	return {
		id,
		slug:            d.slug            ?? '',
		title:           d.title           ?? '',
		excerpt:         d.excerpt         ?? '',
		content:         d.content         ?? '',
		category:        d.category        ?? 'ppf',
		tags:            d.tags            ?? [],
		status:          d.status          ?? 'draft',
		coverImageUrl:   d.coverImageUrl   ?? null,
		author:          d.author          ?? '',
		readTimeMinutes: d.readTimeMinutes ?? 1,
		viewCount:       d.viewCount       ?? 0,
		metaTitle:       d.metaTitle       ?? null,
		metaDescription: d.metaDescription ?? null,
		publishedAt:     d.publishedAt instanceof Timestamp ? d.publishedAt.toDate().toISOString() : null,
		createdAt:       d.createdAt  instanceof Timestamp ? d.createdAt.toDate().toISOString()  : new Date().toISOString(),
		updatedAt:       d.updatedAt  instanceof Timestamp ? d.updatedAt.toDate().toISOString()  : new Date().toISOString(),
	};
}

// GET /api/admin/insights — list all posts
export const GET: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	const snap = await getAdminDb().collection('insights').limit(200).get();
	const posts = snap.docs
		.map((d) => serializePost(d.id, d.data()))
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return json({ posts });
};

// POST /api/admin/insights — create post
export const POST: RequestHandler = async ({ request }) => {
	if (!await assertAdmin(request.headers.get('authorization'))) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
	}
	const body = await request.json();
	const ref = getAdminDb().collection('insights').doc();
	const { publishedAt, ...rest } = body;
	await ref.set({
		...rest,
		publishedAt: publishedAt ? Timestamp.fromDate(new Date(publishedAt)) : null,
		createdAt:   FieldValue.serverTimestamp(),
		updatedAt:   FieldValue.serverTimestamp(),
	});
	return json({ id: ref.id });
};
