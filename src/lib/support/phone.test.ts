import { describe, it, expect } from 'vitest';
import { extractPhones, phoneCandidates, phoneMatches } from './phone';

describe('phoneCandidates', () => {
	it('keeps an E.164 number as-is', () => {
		expect(phoneCandidates('+15551234567')[0]).toBe('+15551234567');
		expect(phoneCandidates('+44 7911 123456')).toEqual(['+447911123456']);
	});

	it('reads a US number typed any way', () => {
		for (const typed of ['(555) 123-4567', '555.123.4567', '5551234567', '1-555-123-4567', '+1 555 123 4567']) {
			expect(phoneCandidates(typed)[0]).toBe('+15551234567');
		}
	});

	it('handles 00 / 011 international prefixes', () => {
		expect(phoneCandidates('0044 7911 123456')).toEqual(['+447911123456']);
		expect(phoneCandidates('011 44 7911 123456')).toEqual(['+447911123456']);
	});

	it('strips a national trunk 0', () => {
		expect(phoneCandidates('07911 123456')).toContain('+447911123456');
	});

	it('covers both Mexican mobile formats', () => {
		expect(phoneCandidates('+52 1 55 1234 5678')).toEqual(['+5215512345678', '+525512345678']);
		expect(phoneCandidates('55 1234 5678')).toEqual(expect.arrayContaining(['+525512345678', '+5215512345678']));
	});

	it('rejects things that are not phone numbers', () => {
		expect(phoneCandidates('')).toEqual([]);
		expect(phoneCandidates('12345')).toEqual([]);
		expect(phoneCandidates('1234567890123456789')).toEqual([]);
	});

	it('stays under Firestore\'s 30-value "in" limit', () => {
		expect(phoneCandidates('5551234567').length).toBeLessThanOrEqual(30);
		expect(phoneCandidates('0551234567').length).toBeLessThanOrEqual(30);
	});
});

describe('phoneMatches', () => {
	it('matches a stored E.164 number loosely', () => {
		expect(phoneMatches('(555) 123-4567', '+15551234567')).toBe(true);
		expect(phoneMatches('555 123 4568', '+15551234567')).toBe(false);
		expect(phoneMatches('555 123 4567', null)).toBe(false);
	});
});

describe('extractPhones', () => {
	it('finds numbers in a message', () => {
		expect(extractPhones('I signed up with my number (555) 123-4567 but the code never comes')).toEqual(['(555) 123-4567']);
		expect(extractPhones('mi número es +52 1 55 1234 5678, gracias')).toEqual(['+52 1 55 1234 5678']);
	});

	it('ignores dates, years and short numbers', () => {
		expect(extractPhones('Charged on 2026-09-24 for order 48213, plotter model 2019')).toEqual([]);
	});
});
