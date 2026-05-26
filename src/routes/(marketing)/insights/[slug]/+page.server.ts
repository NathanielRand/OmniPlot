import type { PageServerLoad } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const db = getAdminDb();

		// Single equality filter on slug — no composite index needed.
		// Status check is done in JS so we avoid the two-field compound query.
		const snap = await db.collection('insights')
			.where('slug', '==', params.slug)
			.limit(1)
			.get();

		if (snap.empty) throw error(404, 'Post not found');

		const d    = snap.docs[0];
		const data = d.data();

		if (data.status !== 'published') throw error(404, 'Post not found');

		// Increment view count — fire-and-forget, never blocks the page load.
		d.ref.update({ viewCount: FieldValue.increment(1) }).catch(() => {});

		// Related posts: single equality filter, filter + sort in JS.
		const relatedSnap = await db.collection('insights')
			.where('status', '==', 'published')
			.limit(50)
			.get();

		const related = relatedSnap.docs
			.filter((rd) => rd.id !== d.id && rd.data().category === data.category)
			.sort((a, b) => {
				const aDate = a.data().publishedAt?.toDate?.()?.toISOString() ?? '';
				const bDate = b.data().publishedAt?.toDate?.()?.toISOString() ?? '';
				return bDate.localeCompare(aDate);
			})
			.slice(0, 3)
			.map((rd) => {
				const r = rd.data();
				return {
					id:              rd.id,
					slug:            (r.slug            ?? '') as string,
					title:           (r.title           ?? '') as string,
					excerpt:         (r.excerpt         ?? '') as string,
					category:        (r.category        ?? 'guides') as string,
					coverImageUrl:   (r.coverImageUrl   ?? null) as string | null,
					readTimeMinutes: (r.readTimeMinutes ?? 1) as number,
					publishedAt:     (r.publishedAt?.toDate?.()?.toISOString() ?? null) as string | null,
				};
			});

		return {
			post: {
				id:              d.id,
				slug:            (data.slug            ?? '') as string,
				title:           (data.title           ?? '') as string,
				excerpt:         (data.excerpt         ?? '') as string,
				content:         (data.content         ?? '') as string,
				category:        (data.category        ?? 'guides') as string,
				tags:            (data.tags            ?? []) as string[],
				coverImageUrl:   (data.coverImageUrl   ?? null) as string | null,
				author:          (data.author          ?? 'OmniPlot') as string,
				readTimeMinutes: (data.readTimeMinutes ?? 1) as number,
				metaTitle:       (data.metaTitle       ?? null) as string | null,
				metaDescription: (data.metaDescription ?? null) as string | null,
				publishedAt:     (data.publishedAt?.toDate?.()?.toISOString() ?? null) as string | null,
			},
			related,
		};
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		throw error(404, 'Post not found');
	}
};
