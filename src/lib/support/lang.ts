// ─────────────────────────────────────────────
// OmniPlot — SUPPORT MESSAGE LANGUAGE DETECTION
// ─────────────────────────────────────────────
// Decides which customer messages need translating before they go through a
// Spanish→English model (which garbles text that's already English). Plain
// function-word counting: dependable on support-length text, instant, and
// needs no model. Extend TRANSLATABLE + the word lists to add languages.

export type DetectedLanguage = 'English' | 'Spanish';

/** Languages the in-browser translator has a model for. */
export const TRANSLATABLE: Record<Exclude<DetectedLanguage, 'English'>, string> = {
	Spanish: 'Xenova/opus-mt-es-en',
};

const SPANISH = new Set(
	`de la que el en los se del las por un para con no una su al lo como más mas pero sus le ya este sí si porque esta entre cuando muy sin sobre también me hasta hay donde desde todo nos durante todos uno les ni contra otros ese eso esto antes algunos qué unos yo otro otras otra él tanto esa estos mucho nada muchos cual poco ella estar estas algunas algo mi mis tu tus te ti hola gracias buenos buenas tengo tiene puedo puede quiero necesito ayuda cuenta pago plan cortadora está están estoy fue era hace favor sigue aparece ahora pero también`.split(/\s+/),
);

const ENGLISH = new Set(
	`the and is are was were to of it i you that my have has had not with for this be but on at they we he she your our what when can could would should will do does did don't didn't can't it's i'm just from there their them please thanks hello hi help account plan payment still`.split(/\s+/),
);

/** 'Spanish' / 'English', or null when there isn't enough signal to say. */
export function detectLanguage(text: string): DetectedLanguage | null {
	const words = text.toLowerCase().normalize('NFC').match(/[\p{L}']+/gu) ?? [];
	if (!words.length) return null;
	let es = 0;
	let en = 0;
	for (const w of words) {
		if (SPANISH.has(w)) es++;
		if (ENGLISH.has(w)) en++;
	}
	// Spanish-only letters are strong evidence on short messages.
	if (/[ñ¿¡]/i.test(text)) es += 2;
	if (/[áéíóú]/i.test(text)) es += 1;
	if (es + en < 2) return null;
	if (es >= en * 1.5) return 'Spanish';
	if (en >= es * 1.5) return 'English';
	return null;
}

/**
 * Splits text into single sentences for the translation model (small MT
 * models drop whole sentences when fed several at once), keeping line breaks
 * so lists and paragraphs survive. Returns [separator, chunk] pairs that
 * reassemble to the original layout.
 */
export function splitForTranslation(text: string, maxChars = 400): { sep: string; chunk: string }[] {
	const out: { sep: string; chunk: string }[] = [];
	let sep = '';
	for (const part of text.split(/(\r?\n+)/)) {
		if (!part.trim()) { sep += part; continue; }
		const lead = part.match(/^\s*/)![0];
		sep += lead;
		// Sentence = optional ¿/¡ opener, then text up to and including . ! ? (or the end).
		const sentences = part.slice(lead.length).match(/[¿¡]?[^.!?¿¡]+(?:[.!?]+|$)|[¿¡][^.!?]*[.!?]*/g) ?? [part];
		for (const raw of sentences) {
			const chunk = raw.trim();
			if (!chunk) continue;
			// Rare run-on "sentence" past the limit: cut at a comma or space.
			for (let rest = chunk; rest; ) {
				let piece = rest;
				if (rest.length > maxChars) {
					const cut = Math.max(rest.lastIndexOf(', ', maxChars), rest.lastIndexOf(' ', maxChars));
					piece = rest.slice(0, cut > 0 ? cut + 1 : maxChars);
				}
				out.push({ sep, chunk: piece.trim() });
				sep = ' ';
				rest = rest.slice(piece.length).trim();
			}
		}
		sep = '';
	}
	return out;
}

/** Tidies model output: the model sometimes repeats the final punctuation
 *  ("restarted..", "help me??????"). */
export function cleanTranslation(source: string, english: string): string {
	let t = english.trim().replace(/([.?!])\1+$/, '$1');
	if (!/[.!?…]$/.test(source.trim())) t = t.replace(/[.]$/, '');
	return t;
}
