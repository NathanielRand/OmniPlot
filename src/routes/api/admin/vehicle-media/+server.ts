import { json } from '@sveltejs/kit';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { RequestHandler } from './$types';
import { getAdminBucket, getAdminDb, verifyIdToken } from '$lib/server/firebase-admin';
import { targetId, type MediaTarget } from '$lib/utils/vehicleCatalog';

// Admin-only media for the library: logos / cover images for makes, images for
// models and trims, and one image for residential / commercial / custom subjects.
//
// One request does the whole job — store the file, link it to its make / model /
// trim / subject doc, and remove the file it replaces — so a half-finished
// upload (file stored, nothing attached) can't happen. The doc id is derived
// here from the target, never trusted from the client.
//
//   POST   multipart { file | url, field, target(JSON), force? }
//   DELETE json      { field, target }

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
	'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
};
const COLLECTION = 'vehicleMedia';
type Field = 'logoUrl' | 'imageUrl';
const SLOT = { logoUrl: 'logo', imageUrl: 'image' } as const;

const log = (...a: unknown[]) => console.log('[vehicle-media]', ...a);
const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => json({ error, ...extra }, { status });

async function assertAdmin(request: Request): Promise<string | Response> {
	const uid = await verifyIdToken(request.headers.get('authorization'));
	if (!uid) return fail('Not signed in — token missing, invalid or revoked.', 401);
	const user = await getAdminDb().doc(`users/${uid}`).get();
	if (user.data()?.tier !== 'admin') return fail(`Not an admin (tier=${user.data()?.tier ?? 'no user doc'}).`, 403);
	return uid;
}

function parseTarget(raw: unknown): MediaTarget | null {
	if (!raw || typeof raw !== 'object') return null;
	const t = raw as MediaTarget;
	if (!['make', 'model', 'trim', 'subject', 'generation', 'year'].includes(t.kind)) return null;
	if (t.kind === 'subject' ? !t.label?.trim() : !t.make?.trim()) return null;
	if ((t.kind === 'model' || t.kind === 'trim' || t.kind === 'generation' || t.kind === 'year') && !t.model?.trim()) return null;
	if (t.kind === 'generation' && !t.generation?.trim()) return null;
	if (t.kind === 'year' && !(Math.floor(Number(t.year)) >= 1900)) return null;
	if (t.kind === 'trim' && !t.trim?.trim()) return null;
	return t;
}

const labelOf = (d: FirebaseFirestore.DocumentData | undefined, id: string) =>
	d?.label || [d?.make, d?.model, d?.trim, d?.generation, d?.year].filter(Boolean).join(' ') || id;

/** Best-effort removal of a replaced / cleared file. Never blocks the response. */
async function dropFile(path: string | null | undefined) {
	if (!path || !path.startsWith('vehicle-media/')) return;
	try { await getAdminBucket().file(path).delete({ ignoreNotFound: true }); }
	catch (e) { console.warn('[vehicle-media] could not delete old file', path, e); }
}

export const POST: RequestHandler = async ({ request }) => {
	let stage = 'start';
	try {
		stage = 'auth';
		const who = await assertAdmin(request);
		if (who instanceof Response) return who;

		stage = 'parse';
		const form = await request.formData();
		const field = form.get('field') as Field;
		if (field !== 'logoUrl' && field !== 'imageUrl') return fail('Bad field.', 400);
		let target: MediaTarget | null = null;
		try { target = parseTarget(JSON.parse(String(form.get('target') ?? ''))); } catch { /* handled below */ }
		if (!target) return fail('Missing or invalid target (make / model / trim / subject).', 400);
		const force = form.get('force') === '1';
		const id = targetId(target);
		const file = form.get('file');
		const pastedUrl = String(form.get('url') ?? '').trim();
		log('POST', { id, field, force, hasFile: file instanceof File, pastedUrl: !!pastedUrl });

		const ref = getAdminDb().collection(COLLECTION).doc(id);
		const prev = (await ref.get()).data();
		const slot = SLOT[field];
		const base: Record<string, unknown> = {
			kind: target.kind,
			make: target.make ?? null,
			model: target.model ?? null,
			trim: target.trim ?? null,
			generation: target.generation ?? null,
			year: target.year ? Math.floor(Number(target.year)) : null,
			projectType: target.projectType ?? null,
			label: target.label ?? null,
			updatedAt: FieldValue.serverTimestamp(),
			updatedBy: who,
		};

		// ── a pasted link: no file, no hash ──
		if (!(file instanceof File)) {
			if (!/^https:\/\//.test(pastedUrl)) return fail('Send an image file or a full https:// link.', 400);
			stage = 'save-link';
			await ref.set({ ...base, [field]: pastedUrl, [`${slot}Path`]: FieldValue.delete(), [`${slot}Hash`]: FieldValue.delete() }, { merge: true });
			await dropFile(prev?.[`${slot}Path`]);
			return json({ id, url: pastedUrl });
		}

		stage = 'validate';
		const ext = TYPES[file.type];
		if (!ext) return fail(`Unsupported type "${file.type}". Use PNG, JPG, WebP, AVIF or SVG.`, 400);
		if (file.size > MAX_BYTES) return fail('Keep images under 4 MB.', 400);
		const bytes = Buffer.from(await file.arrayBuffer());
		const hash = createHash('sha256').update(bytes).digest('hex');

		stage = 'dedupe';
		if (prev?.[`${slot}Hash`] === hash) return json({ id, url: prev[field], unchanged: true });
		if (!force) {
			const [a, b] = await Promise.all([
				getAdminDb().collection(COLLECTION).where('logoHash', '==', hash).limit(3).get(),
				getAdminDb().collection(COLLECTION).where('imageHash', '==', hash).limit(3).get(),
			]);
			const hit = [...a.docs, ...b.docs].find((d) => d.id !== id);
			if (hit) {
				return fail('This exact image is already used elsewhere.', 409, {
					duplicate: { id: hit.id, label: labelOf(hit.data(), hit.id) },
				});
			}
		}

		stage = 'store';
		const bucket = getAdminBucket();
		const path = `vehicle-media/${id}/${slot}-${Date.now()}.${ext}`;
		const token = randomUUID();
		await bucket.file(path).save(bytes, {
			contentType: file.type,
			metadata: { cacheControl: 'public,max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
		});
		const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

		stage = 'link';
		await ref.set({ ...base, [field]: url, [`${slot}Path`]: path, [`${slot}Hash`]: hash }, { merge: true });
		await dropFile(prev?.[`${slot}Path`]);
		log('saved', id, path);
		return json({ id, url });
	} catch (e) {
		console.error('[vehicle-media] POST failed at', stage, e);
		return fail(`${stage}: ${(e as Error).message ?? String(e)}`, 500, { stage });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	let stage = 'start';
	try {
		const who = await assertAdmin(request);
		if (who instanceof Response) return who;
		stage = 'parse';
		const body = await request.json().catch(() => ({}));
		const field = body.field as Field;
		const target = parseTarget(body.target);
		if ((field !== 'logoUrl' && field !== 'imageUrl') || !target) return fail('Bad request.', 400);
		const id = targetId(target);
		const slot = SLOT[field];
		const ref = getAdminDb().collection(COLLECTION).doc(id);
		const snap = await ref.get();
		if (!snap.exists) return json({ id, removed: false });

		stage = 'clear';
		const d = snap.data()!;
		const otherUrl = d[field === 'logoUrl' ? 'imageUrl' : 'logoUrl'];
		// A model doc may also hold its generations — only a doc with nothing left goes.
		if (otherUrl || d.generations?.length) {
			await ref.update({ [field]: FieldValue.delete(), [`${slot}Path`]: FieldValue.delete(), [`${slot}Hash`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: who });
		} else {
			await ref.delete(); // nothing left on it
		}
		await dropFile(d[`${slot}Path`]);
		return json({ id, removed: true });
	} catch (e) {
		console.error('[vehicle-media] DELETE failed at', stage, e);
		return fail(`${stage}: ${(e as Error).message ?? String(e)}`, 500, { stage });
	}
};
