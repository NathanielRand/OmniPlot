// ─────────────────────────────────────────────
// OmniPlot — IN-BROWSER TICKET TRANSLATION (admin only)
// ─────────────────────────────────────────────
// Free and open source: Helsinki-NLP's opus-mt models (ONNX builds by
// Xenova) run locally through Transformers.js. No API key, no per-use cost,
// and customer text never leaves the admin's browser. The model downloads on
// first use and the browser caches it after that.
//
// Browser-only: the library is imported dynamically on first click, so it
// never lands in the server bundle or in pages that don't translate.

import { TRANSLATABLE, cleanTranslation, detectLanguage, splitForTranslation, type DetectedLanguage } from './lang';
import type { TicketTranslation } from './tickets';

type Translator = (texts: string[]) => Promise<{ translation_text: string }[]>;

const loaded = new Map<string, Promise<Translator>>();

async function loadTranslator(model: string, onProgress?: (pct: number) => void): Promise<Translator> {
	let p = loaded.get(model);
	if (!p) {
		p = (async () => {
			const { pipeline } = await import('@huggingface/transformers');
			const pipe = await pipeline('translation', model, {
				dtype: 'q8', // quantized: far smaller download, near-identical output
				progress_callback: (info) => {
					if (info.status === 'progress_total') onProgress?.(Math.round(info.progress));
				},
			});
			return (texts: string[]) => pipe(texts) as Promise<{ translation_text: string }[]>;
		})();
		loaded.set(model, p);
		// A failed load (offline, blocked) shouldn't poison later attempts.
		p.catch(() => loaded.delete(model));
	}
	return p;
}

export type TranslateProgress =
	| { phase: 'loading'; percent: number }
	| { phase: 'translating'; done: number; total: number };

/**
 * Translates what needs translating and returns a cache entry for every
 * part: foreign parts get their English text; English or undetectable parts
 * are recorded as such (so the button doesn't keep offering them).
 */
export async function translateParts(
	parts: { id: string; text: string }[],
	onProgress?: (p: TranslateProgress) => void,
): Promise<Record<string, TicketTranslation>> {
	const result: Record<string, TicketTranslation> = {};
	const byLanguage = new Map<Exclude<DetectedLanguage, 'English'>, { id: string; text: string }[]>();

	for (const part of parts) {
		const lang = detectLanguage(part.text);
		if (lang && lang !== 'English') {
			(byLanguage.get(lang) ?? byLanguage.set(lang, []).get(lang)!).push(part);
		} else {
			result[part.id] = { language: lang ?? 'Unknown', english: part.text };
		}
	}

	const total = [...byLanguage.values()].reduce((n, list) => n + list.length, 0);
	let done = 0;
	for (const [language, list] of byLanguage) {
		onProgress?.({ phase: 'loading', percent: 0 });
		const translate = await loadTranslator(TRANSLATABLE[language], (percent) => onProgress?.({ phase: 'loading', percent }));
		for (const part of list) {
			onProgress?.({ phase: 'translating', done, total });
			const pieces = splitForTranslation(part.text);
			const out = await translate(pieces.map((p) => p.chunk));
			result[part.id] = {
				language,
				english: pieces.map((p, i) => p.sep + cleanTranslation(p.chunk, out[i]?.translation_text ?? p.chunk)).join(''),
			};
			done++;
		}
	}
	return result;
}
