import type { PageServerLoad } from './$types';
import { getAdminDb } from '$lib/server/firebase-admin';

export const load: PageServerLoad = async () => {
	try {
		const db = getAdminDb();
		// Single equality filter — no composite index required.
		// Sort by publishedAt descending in JS.
		const snap = await db.collection('insights')
			.where('status', '==', 'published')
			.limit(100)
			.get();

		const posts = snap.docs
			.map((d) => {
				const data = d.data();
				return {
					id:              d.id,
					slug:            (data.slug            ?? '') as string,
					title:           (data.title           ?? '') as string,
					excerpt:         (data.excerpt         ?? '') as string,
					category:        (data.category        ?? 'guides') as string,
					tags:            (data.tags            ?? []) as string[],
					coverImageUrl:   (data.coverImageUrl   ?? null) as string | null,
					author:          (data.author          ?? 'OmniPlot') as string,
					readTimeMinutes: (data.readTimeMinutes ?? 1) as number,
					publishedAt:     (data.publishedAt?.toDate?.()?.toISOString() ?? null) as string | null,
				};
			})
			.sort((a, b) => {
				if (!a.publishedAt) return 1;
				if (!b.publishedAt) return -1;
				return b.publishedAt.localeCompare(a.publishedAt);
			});

		return { posts };
	} catch (e) {
		console.error('[insights index load]', e);
		return { posts: [] };
	}
};
