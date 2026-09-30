import type { ProjectType } from '$lib/types';

// The upload form writes these reserved makes for non-vehicle patterns
// (see identityPayload in library/upload). A stored record whose projectType
// is missing, or says "vehicle" while carrying one of them, was filed under
// the wrong type — read it back as what it really is instead of showing a
// house or a custom project in the vehicle list.
const RESERVED_MAKE: Record<string, ProjectType> = {
	residential: 'residential',
	commercial:  'commercial',
	custom:      'custom',
};

export function resolveProjectType(stored: unknown, make: unknown): ProjectType {
	const declared = stored === 'vehicle' || stored === 'residential' || stored === 'commercial' || stored === 'custom'
		? stored as ProjectType
		: undefined;
	if (declared && declared !== 'vehicle') return declared;
	const inferred = typeof make === 'string' ? RESERVED_MAKE[make.trim().toLowerCase()] : undefined;
	return inferred ?? declared ?? 'vehicle';
}
