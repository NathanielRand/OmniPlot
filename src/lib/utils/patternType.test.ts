import { describe, it, expect } from 'vitest';
import { resolveProjectType } from './patternType';

describe('resolveProjectType', () => {
	it('keeps an explicit non-vehicle type', () => {
		expect(resolveProjectType('residential', 'Residential')).toBe('residential');
		expect(resolveProjectType('custom', 'Whatever')).toBe('custom');
	});
	it('treats a real vehicle as a vehicle', () => {
		expect(resolveProjectType('vehicle', 'Chevrolet')).toBe('vehicle');
		expect(resolveProjectType(undefined, 'Ford')).toBe('vehicle');
	});
	it('heals a missing or wrong type from the reserved make', () => {
		expect(resolveProjectType(undefined, 'Residential')).toBe('residential');
		expect(resolveProjectType('vehicle', 'Commercial')).toBe('commercial');
		expect(resolveProjectType(undefined, 'Custom')).toBe('custom');
	});
	it('ignores junk', () => {
		expect(resolveProjectType(42, null)).toBe('vehicle');
	});
});
