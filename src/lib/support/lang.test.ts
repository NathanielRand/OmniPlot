import { describe, it, expect } from 'vitest';
import { cleanTranslation, detectLanguage, splitForTranslation } from './lang';

describe('detectLanguage', () => {
	it('recognises Spanish support messages', () => {
		expect(detectLanguage('Hola, pagué el plan Lite pero mi cuenta sigue apareciendo como gratis.')).toBe('Spanish');
		expect(detectLanguage('La cortadora no conecta con el programa')).toBe('Spanish');
		expect(detectLanguage('¿Me pueden ayudar?')).toBe('Spanish');
	});

	it('recognises English', () => {
		expect(detectLanguage("I paid for Lite but my account still shows the free plan.")).toBe('English');
		expect(detectLanguage('Thanks — that fixed it!')).toBe('English');
	});

	it('says nothing when there is no signal', () => {
		expect(detectLanguage('')).toBeNull();
		expect(detectLanguage('OK')).toBeNull();
		expect(detectLanguage('VEVOR 28"')).toBeNull();
	});
});

describe('splitForTranslation', () => {
	it('keeps line breaks and reassembles to the same layout', () => {
		const text = 'Hola.\n\n• Uno\n• Dos';
		const parts = splitForTranslation(text);
		expect(parts.map((p) => p.chunk)).toEqual(['Hola.', '• Uno', '• Dos']);
		expect(parts.map((p) => p.sep + p.chunk).join('')).toBe(text);
	});

	it('gives every sentence its own chunk, including ¿…? openers', () => {
		const parts = splitForTranslation('¿Me pueden ayudar? Necesito cortar un patrón. Gracias');
		expect(parts.map((p) => p.chunk)).toEqual(['¿Me pueden ayudar?', 'Necesito cortar un patrón.', 'Gracias']);
		expect(parts.map((p) => p.sep + p.chunk).join('')).toBe('¿Me pueden ayudar? Necesito cortar un patrón. Gracias');
	});

	it('tidies doubled periods and matches the source ending', () => {
		expect(cleanTranslation('Ya reinicié.', 'I already restarted..')).toBe('I already restarted.');
		expect(cleanTranslation('Gracias', 'Thank you.')).toBe('Thank you');
		expect(cleanTranslation('¿Me pueden ayudar?', 'Can you help me??????')).toBe('Can you help me?');
	});

	it('breaks long paragraphs at sentence boundaries under the limit', () => {
		const long = Array.from({ length: 30 }, (_, i) => `Frase número ${i} de prueba.`).join(' ');
		const parts = splitForTranslation(long, 120);
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((p) => p.chunk.length <= 150)).toBe(true);
	});
});
