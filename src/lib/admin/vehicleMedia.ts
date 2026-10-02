// Client side of /api/admin/vehicle-media. The server stores the file AND links
// it to its make / model / trim / subject, so there is nothing to save after.

import { auth } from "$lib/firebase/client";
import type { MediaTarget } from "$lib/utils/vehicleCatalog";

export type MediaField = "logoUrl" | "imageUrl";

export type MediaResult =
	| { ok: true; url: string; unchanged?: boolean }
	| { ok: false; error: string; duplicate?: { id: string; label: string } };

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
export const MEDIA_TYPES = "image/png,image/jpeg,image/webp,image/avif,image/svg+xml";
const OK_TYPE = /^image\/(png|jpe?g|webp|svg\+xml|avif)$/;

async function authHeader(): Promise<Record<string, string>> {
	const token = await auth.currentUser?.getIdToken();
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function read(res: Response): Promise<MediaResult> {
	const raw = await res.text();
	let body: { url?: string; error?: string; unchanged?: boolean; duplicate?: { id: string; label: string } } = {};
	try { body = JSON.parse(raw); } catch { /* non-JSON (e.g. an HTML error page) */ }
	console.log("[vehicle-media] response", res.status, raw.slice(0, 300));
	if (res.ok && body.url) return { ok: true, url: body.url, unchanged: body.unchanged };
	return { ok: false, error: body.error ?? `HTTP ${res.status}: ${raw.slice(0, 120)}`, duplicate: body.duplicate };
}

export async function uploadMedia(
	target: MediaTarget,
	field: MediaField,
	src: { file: File; force?: boolean } | { url: string },
): Promise<MediaResult> {
	const form = new FormData();
	form.append("field", field);
	form.append("target", JSON.stringify(target));
	if ("file" in src) {
		if (!OK_TYPE.test(src.file.type)) return { ok: false, error: "Use PNG, JPG, WebP, AVIF or SVG." };
		if (src.file.size > MAX_MEDIA_BYTES) return { ok: false, error: "Keep images under 4 MB." };
		form.append("file", src.file);
		if (src.force) form.append("force", "1");
	} else {
		if (!/^https:\/\//.test(src.url.trim())) return { ok: false, error: "Paste a full https:// image URL." };
		form.append("url", src.url.trim());
	}
	try {
		console.log("[vehicle-media] POST", target, field, "file" in src ? src.file.name : src.url);
		return await read(await fetch("/api/admin/vehicle-media", { method: "POST", headers: await authHeader(), body: form }));
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function removeMedia(target: MediaTarget, field: MediaField): Promise<MediaResult | { ok: true; url: "" }> {
	try {
		const res = await fetch("/api/admin/vehicle-media", {
			method: "DELETE",
			headers: { "Content-Type": "application/json", ...(await authHeader()) },
			body: JSON.stringify({ target, field }),
		});
		if (res.ok) return { ok: true, url: "" };
		return read(res);
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
